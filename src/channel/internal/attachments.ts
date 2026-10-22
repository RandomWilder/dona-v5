// #190. An attachment's bytes stay with its message. The office opens them
// from the call, and filing one is evidence's path: one Unassigned document,
// and the same attachment filed again is that document.

import { fileDocument } from '../../evidence/contract.ts';
import { createAuditLog } from '../../kernel/audit.ts';
import type { Clock } from '../../kernel/clock.ts';
import { inTransaction } from '../../kernel/db.ts';
import { KernelError } from '../../kernel/errors.ts';
import { newId } from '../../kernel/ids.ts';
import type { ObjectStore } from '../../kernel/objects.ts';
import type { PdfText } from '../../kernel/pdf.ts';
import { validId } from '../../kernel/validate.ts';
import {
  resolveUnitsByEmail,
  resolveUnitsByPhone,
  type ScopeActor,
} from '../../scope/contract.ts';
import type { MalwareScanner } from './scanner.ts';
import type { Queryable } from './types.ts';

/** 100 MiB. A larger file is not stored. */
export const ATTACHMENT_BYTES_MAX = 100 * 1024 * 1024;

const ALLOWED = new Set([
  'application/pdf',
  'image/avif',
  'image/gif',
  'image/heic',
  'image/jpeg',
  'image/png',
  'image/webp',
  'video/mp4',
  'video/quicktime',
  'video/webm',
]);

const QUARANTINE =
  /^quarantine\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const VIDEO_BRANDS = new Set([
  'isom',
  'iso2',
  'mp41',
  'mp42',
  'avc1',
  'M4V ',
  'qt  ',
]);
const HEIC_BRANDS = new Set([
  'heic',
  'heix',
  'hevc',
  'hevx',
  'mif1',
  'msf1',
  'heim',
  'heis',
]);
const AVIF_BRANDS = new Set(['avif', 'avis']);

export type AttachmentScan = 'clean' | 'infected' | 'unavailable' | 'refused';

export function isQuarantinePath(path: string): boolean {
  return QUARANTINE.test(path);
}

/** The sender's name, kept as a label. Slashes and odd marks do not survive. */
export function attachmentLabel(fileName: string): string {
  const base = fileName.split(/[/\\]/).pop() ?? '';
  const cleaned = base
    .replace(/[^\p{L}\p{N}._ -]/gu, '')
    .trim()
    .slice(0, 80);
  return cleaned === '' ? 'file' : cleaned;
}

export function classifyAttachment(
  bytes: Buffer,
): { ok: true; contentType: string } | { ok: false; reason: 'type' | 'size' } {
  if (bytes.length > ATTACHMENT_BYTES_MAX) return { ok: false, reason: 'size' };
  const contentType = sniffedType(bytes);
  if (contentType === null) return { ok: false, reason: 'type' };
  return { ok: true, contentType };
}

export async function scanAttachment(
  scanner: MalwareScanner | undefined,
  bytes: Buffer,
): Promise<'clean' | 'infected' | 'unavailable'> {
  if (!scanner) return 'unavailable';
  try {
    const verdict = await scanner.scan(bytes);
    if (verdict === 'clean' || verdict === 'infected') return verdict;
    return 'unavailable';
  } catch {
    return 'unavailable';
  }
}

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
  scan: AttachmentScan | null;
}

export interface FilingDeps {
  objects: ObjectStore;
  pdf: PdfText;
  bucket: string;
}

export async function keepAttachmentBytes(
  db: Queryable,
  clock: Clock,
  objects: ObjectStore | undefined,
  scanner: MalwareScanner | undefined,
  messageId: string,
  files: readonly {
    fileName: string;
    contentType: string | null;
    byteSize: number | null;
    bytes: Buffer | null;
  }[],
): Promise<KeptFile[]> {
  const kept: KeptFile[] = [];
  for (const file of files) {
    if (file.bytes === null || file.bytes.length === 0) {
      kept.push({
        fileName: file.fileName,
        contentType: file.contentType,
        byteSize: file.byteSize,
        objectPath: null,
        documentId: null,
        scan: 'refused',
      });
      continue;
    }
    const kind = classifyAttachment(file.bytes);
    if (!kind.ok) {
      kept.push({
        fileName: attachmentLabel(file.fileName),
        contentType: null,
        byteSize: file.bytes.length,
        objectPath: null,
        documentId: null,
        scan: 'refused',
      });
      continue;
    }
    if (!objects) {
      throw new KernelError('invalid', 'attachments cannot be kept', {
        field: 'attachments',
      });
    }
    const objectPath = `quarantine/${newId(clock)}`;
    await objects.put(objectPath, file.bytes, kind.contentType);
    const scan = await scanAttachment(scanner, file.bytes);
    if (scan === 'infected') {
      await createAuditLog(db, clock).write(
        {
          actorKind: 'system',
          action: 'channel.attachment_infected',
          subjectId: messageId,
          inputs: { byteSize: file.bytes.length },
        },
        { outcome: 'ok' },
      );
    }
    kept.push({
      fileName: attachmentLabel(file.fileName),
      contentType: kind.contentType,
      byteSize: file.bytes.length,
      objectPath,
      documentId: null,
      scan,
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
      openable:
        file.scan === 'clean' &&
        file.objectPath !== null &&
        isQuarantinePath(file.objectPath),
      documentId: file.documentId,
    });
  }
  return listed;
}

export function servedType(value: string | null): string {
  if (value === null) return 'application/octet-stream';
  const type = value.toLowerCase();
  if (ALLOWED.has(type)) return type;
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
  const path = file?.scan === 'clean' ? file.objectPath : null;
  if (path === null || !isQuarantinePath(path)) {
    throw new KernelError('not_found', 'attachment not found');
  }
  const stored = await objects.read(path);
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
    const path = file.scan === 'clean' ? file.objectPath : null;
    if (path === null || !isQuarantinePath(path)) {
      throw new KernelError('invalid', 'attachment has no file', {
        field: 'file',
      });
    }
    const stored = await deps.objects.read(path);
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
        // #237. A lease is stored unassigned at every door; the call's flat is the preselection
        // for פתיחת טיוטה, not a link.
        ...(spec.typeKey === 'lease'
          ? { place: null, preselectedUnitId: spec.unitId }
          : { place: { kind: 'UNIT' as const, id: spec.unitId } }),
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

function scanOf(value: unknown): AttachmentScan | null {
  if (
    value === 'clean' ||
    value === 'infected' ||
    value === 'unavailable' ||
    value === 'refused'
  ) {
    return value;
  }
  return null;
}

function sniffedType(bytes: Buffer): string | null {
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) {
    return 'image/jpeg';
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return 'image/png';
  }
  if (bytes.length >= 6) {
    const gif = bytes.subarray(0, 6).toString('ascii');
    if (gif === 'GIF87a' || gif === 'GIF89a') return 'image/gif';
  }
  if (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString('ascii') === 'RIFF' &&
    bytes.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp';
  }
  if (bytes.length >= 5 && bytes.subarray(0, 5).toString('ascii') === '%PDF-') {
    return 'application/pdf';
  }
  if (
    bytes.length >= 4 &&
    bytes[0] === 0x1a &&
    bytes[1] === 0x45 &&
    bytes[2] === 0xdf &&
    bytes[3] === 0xa3 &&
    bytes
      .subarray(0, Math.min(bytes.length, 256))
      .toString('latin1')
      .includes('webm')
  ) {
    return 'video/webm';
  }
  if (bytes.length >= 12 && bytes.subarray(4, 8).toString('ascii') === 'ftyp') {
    const brand = bytes.subarray(8, 12).toString('ascii');
    if (HEIC_BRANDS.has(brand)) return 'image/heic';
    if (AVIF_BRANDS.has(brand)) return 'image/avif';
    if (VIDEO_BRANDS.has(brand)) {
      return brand === 'qt  ' ? 'video/quicktime' : 'video/mp4';
    }
  }
  return null;
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
        scan: null,
      };
    }
    const row = item as Record<string, unknown>;
    return {
      fileName: typeof row.fileName === 'string' ? row.fileName : '',
      contentType: typeof row.contentType === 'string' ? row.contentType : null,
      byteSize: typeof row.byteSize === 'number' ? row.byteSize : null,
      objectPath: typeof row.objectPath === 'string' ? row.objectPath : null,
      documentId: typeof row.documentId === 'string' ? row.documentId : null,
      scan: scanOf(row.scan),
    };
  });
}
