// Documents and their bindings. Slice 3.1, and the write half of flow A1 (SPEC-flows.md) — the
// object write itself is 3.2's and the upload screen with its verification guard is 3.3's.
//
// Two commands, both idempotent, because the acceptance criterion is a statement about repetition:
// **the same file ingested twice is one document with two links.**
import { KernelError } from '../../kernel/errors.ts';
import { newId } from '../../kernel/ids.ts';
import { INSERTED, type UpsertResult } from '../../kernel/upsert.ts';
import type { Queryable } from './types.ts';
import type { VerificationVerdict } from './verify.ts';

/** The workbook's E13 `entity_type`. PROJECT is D2's — a tender document belongs to the project. */
export type LinkEntityType =
  | 'PROJECT'
  | 'BUILDING'
  | 'SPACE'
  | 'UNIT'
  | 'TENANCY'
  | 'PARTY'
  | 'ASSET'
  | 'OBLIGATION';

export type LinkRole = 'SIGNATORY' | 'SUBJECT' | 'EVIDENCE' | 'SOURCE';

/** The three filed outcomes of the door guard. `refused` never writes a row (3.3). */
export type FiledVerdict = Exclude<VerificationVerdict, 'refused'>;

export interface DocumentSpec {
  documentTypeId: string;
  /** Our copy. The path carries the place and never the people (slice 3.2). */
  storageUri: string;
  /** Taken at ingest and immutable thereafter — the `document_is_immutable` trigger enforces it. */
  fileHash: string;
  /** Provenance only. Drive is a source, never the system of record. */
  driveFileId: string | null;
  validFrom: string | null;
  validTo: string | null;
  /** Slice 3.6. The door's result, so a list can show it without re-reading the bytes. */
  verificationVerdict: FiledVerdict;
}

export interface DocumentLinkSpec {
  documentId: string;
  entityType: LinkEntityType;
  entityId: string;
  linkRole: LinkRole | null;
}

/**
 * Files one document, or finds the one already holding these bytes.
 *
 * The conflict target is `file_hash`, which is `UNIQUE` in the DDL. **That is where the acceptance
 * criterion lives** — not in this function's logic, which is why a second caller written next month
 * cannot get it wrong. The second ingest of the same file returns the existing id with
 * `inserted: false`, and the caller adds whatever link it came to add.
 *
 * `ingestedAt` is supplied by the caller from the injected clock. No `DEFAULT now()` anywhere
 * (SPEC.md), and no `Date.now()` in here.
 *
 * **`file_hash` and `storage_uri` are excluded from the update path deliberately**, so a re-ingest
 * is a no-op on the two columns the trigger protects rather than an `UPDATE … SET file_hash =
 * file_hash` that trips it. The rest of the row is refreshed: a document re-filed with a corrected
 * validity window is the same evidence, better described.
 */
export async function ingestDocument(
  db: Queryable,
  spec: DocumentSpec,
  ingestedAt: Date,
): Promise<UpsertResult> {
  const result = await db.query<{ document_id: string; inserted: boolean }>(
    `INSERT INTO document (document_id, document_type_id, storage_uri, file_hash,
                           drive_file_id, valid_from, valid_to, ingested_at,
                           verification_verdict)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (file_hash) DO UPDATE
       SET document_type_id = EXCLUDED.document_type_id,
           drive_file_id = EXCLUDED.drive_file_id,
           valid_from = EXCLUDED.valid_from,
           valid_to = EXCLUDED.valid_to,
           verification_verdict = EXCLUDED.verification_verdict
     RETURNING document_id, ${INSERTED}`,
    [
      newId(),
      spec.documentTypeId,
      spec.storageUri,
      spec.fileHash,
      spec.driveFileId,
      spec.validFrom,
      spec.validTo,
      ingestedAt,
      spec.verificationVerdict,
    ],
  );
  const row = result.rows[0];
  if (!row) {
    throw new KernelError('conflict', 'document upsert returned no row');
  }
  return { id: row.document_id, inserted: row.inserted };
}

/**
 * Binds a document to one entity. R13: one document, several bindings.
 *
 * The conflict target is the composite primary key `(document_id, entity_type, entity_id)` — the
 * workbook's own key — so filing the same lease against the same unit twice is the same fact stated
 * twice and not a duplicate row.
 *
 * **`entityId` is not checked against anything**, and that is R13's price rather than an oversight:
 * it points at eight different tables, so no foreign key can be written. The alternative is six
 * nullable columns on `document` and a CHECK that exactly one is set, which buys integrity for the
 * entities we thought of and refuses the eighth. The caller is responsible for the id being real,
 * and `src/evidence/schema.test.ts` is where that responsibility is exercised.
 *
 * The returned id is the document's: this table has no surrogate key, and a caller naming the row
 * names the triple (`upsertTenancyParty`'s situation, for the same structural reason).
 */
export async function linkDocument(
  db: Queryable,
  spec: DocumentLinkSpec,
): Promise<UpsertResult> {
  const result = await db.query<{ inserted: boolean }>(
    `INSERT INTO document_link (document_id, entity_type, entity_id, link_role)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (document_id, entity_type, entity_id) DO UPDATE
       SET link_role = EXCLUDED.link_role
     RETURNING ${INSERTED}`,
    [spec.documentId, spec.entityType, spec.entityId, spec.linkRole],
  );
  const inserted = result.rows[0]?.inserted;
  if (inserted === undefined) {
    throw new KernelError('conflict', 'document link upsert returned no row');
  }
  return { id: spec.documentId, inserted };
}

export interface FiledDocument {
  documentId: string;
  documentTypeId: string;
  typeKey: string;
  labelHe: string;
  storageUri: string;
  fileHash: string;
  verificationVerdict: FiledVerdict;
  verificationTerms: string[] | null;
}

export async function getFiledDocument(
  db: Queryable,
  documentId: string,
): Promise<FiledDocument> {
  const result = await db.query<{
    document_id: string;
    document_type_id: string;
    type_key: string;
    label_he: string;
    storage_uri: string;
    file_hash: string;
    verification_verdict: FiledVerdict;
    verification_terms: string[] | null;
  }>(
    `SELECT d.document_id, d.document_type_id, dt.type_key, dt.label_he,
            d.storage_uri, d.file_hash, d.verification_verdict, dt.verification_terms
       FROM document d
       JOIN document_type dt ON dt.document_type_id = d.document_type_id
      WHERE d.document_id = $1`,
    [documentId],
  );
  const row = result.rows[0];
  if (!row) {
    throw new KernelError('not_found', 'document not found');
  }
  return {
    documentId: row.document_id,
    documentTypeId: row.document_type_id,
    typeKey: row.type_key,
    labelHe: row.label_he,
    storageUri: row.storage_uri,
    fileHash: row.file_hash,
    verificationVerdict: row.verification_verdict,
    verificationTerms: row.verification_terms,
  };
}

/**
 * The only verdict transition 4.1 writes: `unverified` → `verified`.
 *
 * `refused` is not a stored value (3.3: a refusal writes no row). Terms still
 * missing after OCR leave the row as it was.
 */
export async function updateVerificationVerdict(
  db: Queryable,
  documentId: string,
  verdict: 'verified',
): Promise<boolean> {
  const result = await db.query<{ document_id: string }>(
    `UPDATE document
        SET verification_verdict = $2
      WHERE document_id = $1 AND verification_verdict = 'unverified'
      RETURNING document_id`,
    [documentId, verdict],
  );
  return result.rows.length === 1;
}

export async function listUnverifiedDocuments(db: Queryable): Promise<
  Array<{
    documentId: string;
    storageUri: string;
    typeKey: string;
    verificationTerms: string[] | null;
  }>
> {
  const result = await db.query<{
    document_id: string;
    storage_uri: string;
    type_key: string;
    verification_terms: string[] | null;
  }>(
    `SELECT d.document_id, d.storage_uri, dt.type_key, dt.verification_terms
       FROM document d
       JOIN document_type dt ON dt.document_type_id = d.document_type_id
      WHERE d.verification_verdict = 'unverified'
      ORDER BY d.ingested_at`,
  );
  return result.rows.map((row) => ({
    documentId: row.document_id,
    storageUri: row.storage_uri,
    typeKey: row.type_key,
    verificationTerms: row.verification_terms,
  }));
}
