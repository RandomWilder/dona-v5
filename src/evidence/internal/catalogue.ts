// The document-type catalogue — A8's open half, in code. Slice 3.1.
//
// **Everything here is read at run time and nothing is compiled in.** Slice 3.3's verification guard
// reads `verification_terms` off the type row and slice 4.2's extraction reads the field
// declarations, both through these functions. The alternative — a `Record<TypeKey, …>` in
// TypeScript — would make a new document type cost a seed row *and a release*, because until the
// release it would ship unguarded and with no fields: A8 true of the catalogue and false of the
// first thing that consumes it (slice 3.0's call, carried here).
import { KernelError } from '../../kernel/errors.ts';
import { newId } from '../../kernel/ids.ts';
import { INSERTED, type UpsertResult } from '../../kernel/upsert.ts';
import type { Queryable } from './types.ts';

/** The workbook's E16 `value_type`. **No MONEY member** — foundation rule 2, and READ ME rule 3. */
export type FieldValueType = 'TEXT' | 'NUMBER' | 'DATE' | 'BOOLEAN' | 'ENUM';

export interface DocumentTypeSpec {
  /** Stable machine key. Never renamed and never reused — filed documents point at it. */
  typeKey: string;
  labelHe: string;
  labelEn: string | null;
  /**
   * Marker terms a document of this type is expected to contain — slice 3.3's guard reads this and
   * nothing else. Null is a type that is unguarded rather than unfileable.
   */
  verificationTerms: string[] | null;
  isActive: boolean;
}

export interface DocumentTypeFieldSpec {
  documentTypeId: string;
  fieldKey: string;
  labelHe: string;
  valueType: FieldValueType;
  /** A missing required field is a RESULT, not an error (SPEC-flows.md A2). */
  isRequired: boolean;
  extractionHint: string | null;
  /** The version. This declaration governs values extracted on or after this date. */
  effectiveFrom: string;
  /** Null = the current declaration. */
  effectiveTo: string | null;
}

export interface DocumentTypeRow {
  documentTypeId: string;
  typeKey: string;
  labelHe: string;
  labelEn: string | null;
  verificationTerms: string[] | null;
  isActive: boolean;
}

export interface DocumentTypeFieldRow {
  documentTypeFieldId: string;
  fieldKey: string;
  labelHe: string;
  valueType: FieldValueType;
  isRequired: boolean;
  extractionHint: string | null;
  effectiveFrom: string;
  effectiveTo: string | null;
}

/**
 * Adds a document type, or updates the one holding this `type_key`.
 *
 * The conflict target is `type_key`, the workbook's own natural key, so `npm run seed:doctypes` is a
 * no-op on its second run — the lesson 1.11 paid for by importing the Shoham fixture twice.
 *
 * **There is no delete, here or on the contract.** A type is deactivated (`isActive: false`) and
 * never deleted: filed documents still point at it and those are the records a dispute reads (R16's
 * rule, R17's table). The foreign key in `0011_evidence.sql` refuses the delete anyway, which is the
 * constraint being enforced rather than asked for — but an absent function is what stops anyone
 * asking.
 */
export async function upsertDocumentType(
  db: Queryable,
  spec: DocumentTypeSpec,
): Promise<UpsertResult> {
  const result = await db.query<{
    document_type_id: string;
    inserted: boolean;
  }>(
    `INSERT INTO document_type (document_type_id, type_key, label_he, label_en,
                                verification_terms, is_active)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (type_key) DO UPDATE
       SET label_he = EXCLUDED.label_he,
           label_en = EXCLUDED.label_en,
           verification_terms = EXCLUDED.verification_terms,
           is_active = EXCLUDED.is_active
     RETURNING document_type_id, ${INSERTED}`,
    [
      newId(),
      spec.typeKey,
      spec.labelHe,
      spec.labelEn,
      spec.verificationTerms,
      spec.isActive,
    ],
  );
  const row = result.rows[0];
  if (!row) {
    throw new KernelError('conflict', 'document type upsert returned no row');
  }
  return { id: row.document_type_id, inserted: row.inserted };
}

/**
 * Declares one field of one type, in one version of its schema.
 *
 * The conflict target is `(document_type_id, field_key, effective_from)` — R18's key. **Redeclaring
 * a field at a new `effective_from` is a new row and never an edit**, which is what keeps a value
 * extracted in January explicable after the schema is corrected in March. The upsert path here is
 * therefore narrow on purpose: it re-applies the *same* declaration idempotently so a seed can be
 * re-run, and anything that changes what a version means needs a new `effectiveFrom`.
 */
export async function upsertDocumentTypeField(
  db: Queryable,
  spec: DocumentTypeFieldSpec,
): Promise<UpsertResult> {
  const result = await db.query<{
    document_type_field_id: string;
    inserted: boolean;
  }>(
    `INSERT INTO document_type_field (document_type_field_id, document_type_id, field_key,
                                      label_he, value_type, is_required, extraction_hint,
                                      effective_from, effective_to)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (document_type_id, field_key, effective_from) DO UPDATE
       SET label_he = EXCLUDED.label_he,
           value_type = EXCLUDED.value_type,
           is_required = EXCLUDED.is_required,
           extraction_hint = EXCLUDED.extraction_hint,
           effective_to = EXCLUDED.effective_to
     RETURNING document_type_field_id, ${INSERTED}`,
    [
      newId(),
      spec.documentTypeId,
      spec.fieldKey,
      spec.labelHe,
      spec.valueType,
      spec.isRequired,
      spec.extractionHint,
      spec.effectiveFrom,
      spec.effectiveTo,
    ],
  );
  const row = result.rows[0];
  if (!row) {
    throw new KernelError(
      'conflict',
      'document type field upsert returned no row',
    );
  }
  return { id: row.document_type_field_id, inserted: row.inserted };
}

/**
 * The catalogue, in the order an administrator picks from it.
 *
 * `activeOnly` is the "file a document" list; the full list is what an audit of retired types reads.
 * Nothing here returns a person: this module's contract carries no query that reaches `party`
 * (SPEC-evidence.md, and `src/scope/` is where that question is answered).
 */
export async function listDocumentTypes(
  db: Queryable,
  options: { activeOnly?: boolean } = {},
): Promise<DocumentTypeRow[]> {
  const activeOnly = options.activeOnly ?? true;
  const result = await db.query<{
    document_type_id: string;
    type_key: string;
    label_he: string;
    label_en: string | null;
    verification_terms: string[] | null;
    is_active: boolean;
  }>(
    `SELECT document_type_id, type_key, label_he, label_en, verification_terms, is_active
       FROM document_type
      WHERE ($1::boolean = false OR is_active)
      ORDER BY type_key`,
    [activeOnly],
  );
  return result.rows.map((row) => ({
    documentTypeId: row.document_type_id,
    typeKey: row.type_key,
    labelHe: row.label_he,
    labelEn: row.label_en,
    verificationTerms: row.verification_terms,
    isActive: row.is_active,
  }));
}

/**
 * One type, by its natural key. Slice 3.3's intake reads it for two things at once: the
 * `document_type_id` a document row points at, and the marker terms the guard checks.
 *
 * Null for a key nobody has seeded, rather than a throw: whether an unknown declared type is
 * `invalid` at the edge or a 404 on a screen is the caller's decision, and a read that made it here
 * would be making it for every caller.
 */
export async function documentTypeByKey(
  db: Queryable,
  typeKey: string,
): Promise<DocumentTypeRow | null> {
  const result = await db.query<{
    document_type_id: string;
    type_key: string;
    label_he: string;
    label_en: string | null;
    verification_terms: string[] | null;
    is_active: boolean;
  }>(
    `SELECT document_type_id, type_key, label_he, label_en, verification_terms, is_active
       FROM document_type
      WHERE type_key = $1`,
    [typeKey],
  );
  const row = result.rows[0];
  return row
    ? {
        documentTypeId: row.document_type_id,
        typeKey: row.type_key,
        labelHe: row.label_he,
        labelEn: row.label_en,
        verificationTerms: row.verification_terms,
        isActive: row.is_active,
      }
    : null;
}

/**
 * The field declarations governing a type **on a given day**.
 *
 * The date is a parameter and never `CURRENT_DATE`, for the reason every date in this system is:
 * a query the tests cannot pin is a test that fails on a Tuesday. It is what makes a value extracted
 * under version 3 of a lease schema still explicable a year later — ask for the day it was
 * extracted and the answer is the declaration that governed it.
 *
 * Returns `[]` for an unknown `typeKey` rather than throwing: an empty declaration list is a fact
 * about a type, and a caller distinguishing "no fields" from "no type" reads the catalogue.
 */
export async function documentTypeFields(
  db: Queryable,
  typeKey: string,
  on: string,
): Promise<DocumentTypeFieldRow[]> {
  const result = await db.query<{
    document_type_field_id: string;
    field_key: string;
    label_he: string;
    value_type: FieldValueType;
    is_required: boolean;
    extraction_hint: string | null;
    effective_from: string;
    effective_to: string | null;
  }>(
    `SELECT f.document_type_field_id,
            f.field_key,
            f.label_he,
            f.value_type,
            f.is_required,
            f.extraction_hint,
            to_char(f.effective_from, 'YYYY-MM-DD') AS effective_from,
            to_char(f.effective_to, 'YYYY-MM-DD') AS effective_to
       FROM document_type_field f
       JOIN document_type t ON t.document_type_id = f.document_type_id
      WHERE t.type_key = $1
        AND f.effective_from <= $2::date
        AND (f.effective_to IS NULL OR f.effective_to >= $2::date)
      ORDER BY f.field_key`,
    [typeKey, on],
  );
  return result.rows.map((row) => ({
    documentTypeFieldId: row.document_type_field_id,
    fieldKey: row.field_key,
    labelHe: row.label_he,
    valueType: row.value_type,
    isRequired: row.is_required,
    extractionHint: row.extraction_hint,
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to,
  }));
}
