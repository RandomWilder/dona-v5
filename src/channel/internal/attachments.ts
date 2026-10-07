// #190. An attachment's bytes stay with its message. The office opens them
// from the call, and filing one is evidence's path: one Unassigned document,
// and the same attachment filed again is that document.

import { fileDocument } from '../../evidence/contract.ts';
import { createAuditLog } from '../../kernel/audit.ts';
import type { Clock } from '../../kernel/clock.ts';
import { inTransaction } from '../../kernel/db.ts';
import { KernelError } from '../../kernel/errors.ts';
import type { ObjectStore } from '../../kernel/objects.ts';
import type { PdfText } from '../../kernel/pdf.ts';
import { validId } from '../../kernel/validate.ts';
import {
  resolveUnitsByEmail,
  resolveUnitsByPhone,
  type ScopeActor,
} from '../../scope/contract.ts';
import type { Queryable } from './types.ts';

const FILE_BYTES_MAX = 100 * 1024 * 1024;
const RENDERABLE = new Set([
  'application/pdf',
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/webp',
]);

export interface ListedAttachment {
  fileName: string;
  contentType: string | null;
  byteSize: number | null;
  index: number;
  openable: boolean;
  documentId: string | null;
}

interface KeptFile {
  fileName: string;
  contentType: string | null;
  byteSize: number | null;
  objectPath: string | null;
  documentId: string | null;
}

export interface FilingDeps {
  objects: ObjectStore;
  pdf: PdfText;
  bucket: string;
}

export async function keepAttachmentBytes(
  objects: ObjectStore | undefined,
  messageId: string,
  files: readonly {
    fileName: string;
    contentType: string | null;
    byteSize: number | null;
    bytes: Buffer | null;
  }[],
): Promise<KeptFile[]> {
  const kept: KeptFile[] = [];
  for (const [index, file] of files.entries()) {
    let objectPath: string | null = null;
    if (file.bytes && file.bytes.length <= FILE_BYTES_MAX) {
      if (!objects) {
        throw new KernelError('invalid', 'attachments cannot be kept', {
          field: 'attachments',
        });
      }
      objectPath = `channel/${messageId}/${index}`;
      await objects.put(objectPath, file.bytes, servedType(file.contentType));
    }
    kept.push({
      fileName: file.fileName,
      contentType: file.contentType,
      byteSize: file.bytes ? file.bytes.length : file.byteSize,
      objectPath,
      documentId: null,
    });
  }
  return kept;
}

export function listedAttachments(value: unknown): ListedAttachment[] {
  const listed: ListedAttachment[] = [];
  for (const [index, file] of keptFiles(value).entries()) {
    if (file.fileName === '') continue;
    listed.push({
      fileName: file.fileName,
      contentType: file.contentType,
      byteSize: file.byteSize,
      index,
      openable: file.objectPath !== null,
      documentId: file.documentId,
    });
  }
  return listed;
}

export function servedType(value: string | null): string {
  if (value === null) return 'application/octet-stream';
  const type = value.toLowerCase();
  if (RENDERABLE.has(type)) return type;
  return 'application/octet-stream';
}

export async function readAttachment(
  db: Queryable,
  objects: ObjectStore,
  spec: { callId: string; messageId: string; index: number },
): Promise<{ bytes: Buffer; contentType: string; fileName: string }> {
  const callId = validId(spec.callId, 'call');
  const messageId = validId(spec.messageId, 'message');
  const index = spec.index;
  if (!Number.isInteger(index) || index < 0) {
    throw new KernelError('not_found', 'attachment not found');
  }
  const { rows } = await db.query<{ attachments: unknown }>(
    `SELECT attachments FROM message
      WHERE message_id = $1 AND service_call_id = $2`,
    [messageId, callId],
  );
  const file = keptFiles(rows[0]?.attachments)[index];
  if (!file || file.objectPath !== `channel/${messageId}/${index}`) {
    throw new KernelError('not_found', 'attachment not found');
  }
  const stored = await objects.read(file.objectPath);
  return {
    bytes: stored.bytes,
    contentType: servedType(file.contentType),
    fileName: file.fileName,
  };
}

export async function fileAttachment(
  db: Queryable,
  clock: Clock,
  deps: FilingDeps,
  spec: {
    callId: string;
    messageId: string;
    index: number;
    typeKey: string;
    actorId: string;
    actorRole?: string | null;
  },
): Promise<{ documentId: string }> {
  const callId = validId(spec.callId, 'call');
  const messageId = validId(spec.messageId, 'message');
  const actorId = validId(spec.actorId, 'actor');
  const index = spec.index;
  if (!Number.isInteger(index) || index < 0 || index > 19) {
    throw new KernelError('not_found', 'attachment not found');
  }
  const typeKey = spec.typeKey.trim();
  if (typeKey === '') {
    throw new KernelError('invalid', 'type is required', { field: 'type' });
  }
  const actor: ScopeActor = {
    actorKind: 'staff',
    actorId,
    ...(spec.actorRole ? { actorRole: spec.actorRole } : {}),
  };

  return inTransaction(db, async (tx) => {
    const { rows } = await tx.query<{
      sender_address: string;
      attachments: unknown;
    }>(
      `SELECT sender_address, attachments FROM message
        WHERE message_id = $1 AND service_call_id = $2
        FOR UPDATE`,
      [messageId, callId],
    );
    const row = rows[0];
    if (!row) throw new KernelError('not_found', 'attachment not found');
    const files = keptFiles(row.attachments);
    const file = files[index];
    if (!file || file.fileName === '') {
      throw new KernelError('not_found', 'attachment not found');
    }
    if (file.documentId !== null) return { documentId: file.documentId };
    if (file.objectPath !== `channel/${messageId}/${index}`) {
      throw new KernelError('invalid', 'attachment has no file', {
        field: 'file',
      });
    }
    const stored = await deps.objects.read(file.objectPath);
    const unitId = await oneUnit(tx, clock, row.sender_address, actor);
    const result = await fileOne(tx, clock, deps, {
      bytes: stored.bytes,
      typeKey,
      unitId,
      actorId,
    });
    files[index] = { ...file, documentId: result.documentId };
    await tx.query(
      `UPDATE message SET attachments = $2::jsonb WHERE message_id = $1`,
      [messageId, JSON.stringify(files)],
    );
    await createAuditLog(tx, clock).write(
      {
        actorKind: 'staff',
        actorId,
        ...(spec.actorRole ? { actorRole: spec.actorRole } : {}),
        action: 'channel.file_attachment',
        subjectId: messageId,
        inputs: { callId, index, documentId: result.documentId, typeKey },
      },
      { outcome: 'ok' },
    );
    return { documentId: result.documentId };
  });
}

async function fileOne(
  db: Queryable,
  clock: Clock,
  deps: FilingDeps,
  spec: {
    bytes: Buffer;
    typeKey: string;
    unitId: string;
    actorId: string;
  },
): Promise<{ documentId: string }> {
  let result: Awaited<ReturnType<typeof fileDocument>>;
  try {
    result = await fileDocument(
      {
        db,
        objects: deps.objects,
        pdf: deps.pdf,
        audit: createAuditLog(db, clock),
        clock,
        bucket: deps.bucket,
      },
      {
        bytes: spec.bytes,
        typeKey: spec.typeKey,
        place: { kind: 'UNIT', id: spec.unitId },
        tenancyId: null,
        filedBy: spec.actorId,
      },
    );
  } catch (error) {
    if (error instanceof KernelError && error.code === 'invalid') {
      const field = error.message.includes('document type') ? 'type' : 'file';
      throw new KernelError('invalid', error.message, { field });
    }
    throw error;
  }
  if (!result.filed) {
    const field =
      result.refusal === 'terms'
        ? 'type'
        : result.refusal === 'anchored'
          ? 'anchored'
          : 'file';
    throw new KernelError('invalid', 'attachment was not filed', { field });
  }
  return { documentId: result.documentId };
}

async function oneUnit(
  db: Queryable,
  clock: Clock,
  address: string,
  actor: ScopeActor,
): Promise<string> {
  let units: { unit_id: string }[] = [];
  try {
    units = address.includes('@')
      ? await resolveUnitsByEmail(db, address, clock, { actor })
      : await resolveUnitsByPhone(db, address, clock, { actor });
  } catch (error) {
    if (!(error instanceof KernelError) || error.code !== 'invalid')
      throw error;
  }
  const ids: string[] = [];
  for (const unit of units) {
    if (!ids.includes(unit.unit_id)) ids.push(unit.unit_id);
  }
  if (ids.length !== 1 || ids[0] === undefined) {
    throw new KernelError('invalid', 'sender is not one household', {
      field: 'place',
    });
  }
  return ids[0];
}

function keptFiles(value: unknown): KeptFile[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    if (item === null || typeof item !== 'object') {
      return {
        fileName: '',
        contentType: null,
        byteSize: null,
        objectPath: null,
        documentId: null,
      };
    }
    const row = item as Record<string, unknown>;
    return {
      fileName: typeof row.fileName === 'string' ? row.fileName : '',
      contentType: typeof row.contentType === 'string' ? row.contentType : null,
      byteSize: typeof row.byteSize === 'number' ? row.byteSize : null,
      objectPath: typeof row.objectPath === 'string' ? row.objectPath : null,
      documentId: typeof row.documentId === 'string' ? row.documentId : null,
    };
  });
}
