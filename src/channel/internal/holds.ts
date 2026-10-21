// A portal report's files, held between the steps. The bytes are already in
// quarantine. Only a clean scan becomes a row, and the message later points
// at that same object rather than storing a second copy.

import { createAuditLog } from '../../kernel/audit.ts';
import type { Clock } from '../../kernel/clock.ts';
import { inTransaction } from '../../kernel/db.ts';
import { KernelError } from '../../kernel/errors.ts';
import { newId } from '../../kernel/ids.ts';
import type { ObjectStore } from '../../kernel/objects.ts';
import { validId } from '../../kernel/validate.ts';
import {
  attachmentLabel,
  classifyAttachment,
  isQuarantinePath,
  scanAttachment,
  servedType,
} from './attachments.ts';
import type { MalwareScanner } from './scanner.ts';
import type { Queryable } from './types.ts';

export const REPORT_FILE_MAX = 8;

export type HoldRefusal = 'type' | 'size' | 'infected' | 'unavailable' | 'many';

export type HoldResult =
  | { status: 'clean' }
  | { status: 'refused'; reason: HoldRefusal };

export interface HeldFile {
  fileName: string;
  contentType: string;
  byteSize: number;
  objectPath: string;
  documentId: null;
  scan: 'clean';
}

export async function holdAttachment(
  db: Queryable,
  clock: Clock,
  objects: ObjectStore,
  scanner: MalwareScanner | undefined,
  spec: {
    ownerId: string;
    submissionId: string;
    fileName: string;
    bytes: Buffer;
  },
): Promise<HoldResult> {
  const ownerId = validId(spec.ownerId, 'owner');
  const submissionId = validId(spec.submissionId, 'submission');
  const kind = classifyAttachment(spec.bytes);
  if (!kind.ok) return { status: 'refused', reason: kind.reason };
  if (!(await roomForAnother(db, ownerId, submissionId))) {
    return { status: 'refused', reason: 'many' };
  }
  const objectPath = `quarantine/${newId(clock)}`;
  await objects.put(objectPath, spec.bytes, kind.contentType);
  const scan = await scanAttachment(scanner, spec.bytes);
  if (scan === 'infected') {
    await createAuditLog(db, clock).write(
      {
        actorKind: 'tenant',
        actorId: ownerId,
        action: 'channel.attachment_infected',
        subjectId: ownerId,
        inputs: { byteSize: spec.bytes.length },
      },
      { outcome: 'ok' },
    );
    return { status: 'refused', reason: 'infected' };
  }
  if (scan !== 'clean') return { status: 'refused', reason: 'unavailable' };
  const saved = await inTransaction(db, async (tx) => {
    if (!(await roomForAnother(tx, ownerId, submissionId))) return false;
    await tx.query(
      `INSERT INTO attachment_hold
         (hold_id, owner_id, submission_id, object_path, display_name,
          content_type, byte_size, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        newId(clock),
        ownerId,
        submissionId,
        objectPath,
        attachmentLabel(spec.fileName),
        kind.contentType,
        spec.bytes.length,
        clock.now(),
      ],
    );
    return true;
  });
  if (!saved) return { status: 'refused', reason: 'many' };
  return { status: 'clean' };
}

async function roomForAnother(
  db: Queryable,
  ownerId: string,
  submissionId: string,
): Promise<boolean> {
  return inTransaction(db, async (tx) => {
    await tx.query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)', [
      `${ownerId}:${submissionId}`,
    ]);
    const count = await tx.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM attachment_hold
        WHERE owner_id = $1 AND submission_id = $2`,
      [ownerId, submissionId],
    );
    return (count.rows[0]?.n ?? 0) < REPORT_FILE_MAX;
  });
}

export async function listHolds(
  db: Queryable,
  ownerId: string,
  submissionId: string,
): Promise<{ id: string; fileName: string; contentType: string }[]> {
  const owner = validId(ownerId, 'owner');
  const submission = validId(submissionId, 'submission');
  const { rows } = await db.query<{
    hold_id: string;
    display_name: string;
    content_type: string;
  }>(
    `SELECT hold_id, display_name, content_type FROM attachment_hold
      WHERE owner_id = $1 AND submission_id = $2
      ORDER BY created_at, hold_id`,
    [owner, submission],
  );
  return rows.map((row) => ({
    id: row.hold_id,
    fileName: row.display_name,
    contentType: servedType(row.content_type),
  }));
}

/** A clean hold, for the tenant who added it. Anyone else gets nothing. */
export async function openHold(
  db: Queryable,
  objects: ObjectStore,
  ownerId: string,
  holdId: string,
): Promise<{ bytes: Buffer; contentType: string; fileName: string } | null> {
  const owner = validId(ownerId, 'owner');
  const hold = validId(holdId, 'file');
  const { rows } = await db.query<{
    object_path: string;
    display_name: string;
    content_type: string;
  }>(
    `SELECT object_path, display_name, content_type FROM attachment_hold
      WHERE hold_id = $1 AND owner_id = $2`,
    [hold, owner],
  );
  const row = rows[0];
  if (row === undefined || !isQuarantinePath(row.object_path)) return null;
  const contentType = servedType(row.content_type);
  if (contentType === 'application/octet-stream') return null;
  try {
    const stored = await objects.read(row.object_path);
    return { bytes: stored.bytes, contentType, fileName: row.display_name };
  } catch (error) {
    if (error instanceof KernelError) return null;
    throw error;
  }
}

export async function removeHold(
  db: Queryable,
  ownerId: string,
  submissionId: string,
  holdId: string,
): Promise<void> {
  const owner = validId(ownerId, 'owner');
  const submission = validId(submissionId, 'submission');
  const hold = validId(holdId, 'file');
  await db.query(
    `DELETE FROM attachment_hold
      WHERE hold_id = $1 AND owner_id = $2 AND submission_id = $3`,
    [hold, owner, submission],
  );
}

export async function filesFromHolds(
  db: Queryable,
  holds: {
    ownerId: string;
    submissionId: string;
    ids: readonly string[];
  } | null,
): Promise<HeldFile[]> {
  if (holds === null || holds.ids.length === 0) return [];
  const { rows } = await db.query<{
    object_path: string;
    display_name: string;
    content_type: string;
    byte_size: number;
  }>(
    `SELECT object_path, display_name, content_type, byte_size
       FROM attachment_hold
      WHERE owner_id = $1 AND submission_id = $2 AND hold_id = ANY($3::uuid[])
      ORDER BY created_at, hold_id`,
    [holds.ownerId, holds.submissionId, holds.ids],
  );
  const files: HeldFile[] = [];
  for (const row of rows) {
    if (!isQuarantinePath(row.object_path)) continue;
    files.push({
      fileName: row.display_name,
      contentType: row.content_type,
      byteSize: row.byte_size,
      objectPath: row.object_path,
      documentId: null,
      scan: 'clean',
    });
  }
  return files;
}
