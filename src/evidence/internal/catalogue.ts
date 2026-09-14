// The document-type catalogue — A8's open half, in code. Slice 3.1.
//
// **Everything here is read at run time and nothing is compiled in.** Slice 3.3's verification guard
// reads `verification_terms` off the type row and slice 4.2's extraction reads the field
// declarations, both through these functions. The alternative — a `Record<TypeKey, …>` in
// TypeScript — would make a new document type cost a seed row *and a release*, because until the
// release it would ship unguarded and with no fields: A8 true of the catalogue and false of the
// first thing that consumes it (slice 3.0's call, carried here).
import { inTransaction } from '../../kernel/db.ts';
import { KernelError } from '../../kernel/errors.ts';
import { newId } from '../../kernel/ids.ts';
import { INSERTED, type UpsertResult } from '../../kernel/upsert.ts';
import { moneyRefusal, namesMoney } from './money.ts';
import type { Queryable } from './types.ts';

/**
 * The workbook's E16 `value_type`. **No MONEY member** — foundation rule 2, and READ ME rule 3.
 *
 * **A runtime array from slice 7.2**, where it stopped being a type only: the declaration editor
 * fills a `<select>` from it and the route validates against it, and a second list typed into
 * either of those is a list that drifts from the `CHECK` in `0011_evidence.sql`.
 */
export const FIELD_VALUE_TYPES = [
  'TEXT',
  'NUMBER',
  'DATE',
  'BOOLEAN',
  'ENUM',
] as const;
export type FieldValueType = (typeof FIELD_VALUE_TYPES)[number];

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
 * How many fields each type declares **on a given day**. Slice 7.1.
 *
 * One query rather than one per type, because the documents tab needs every type's count to decide
 * which declaration to open on and a landing page that walks the catalogue row by row is the N+1 a
 * console notices first. The date is a parameter for the same reason it is one above.
 *
 * A type with no declaration is absent from the map rather than present as zero — the caller asks
 * "which types declare something", and a zero row would answer a different question.
 */
export async function documentTypeFieldCounts(
  db: Queryable,
  on: string,
): Promise<Map<string, number>> {
  const result = await db.query<{ type_key: string; n: string }>(
    `SELECT t.type_key, count(*)::text AS n
       FROM document_type_field f
       JOIN document_type t ON t.document_type_id = f.document_type_id
      WHERE f.effective_from <= $1::date
        AND (f.effective_to IS NULL OR f.effective_to >= $1::date)
      GROUP BY t.type_key`,
    [on],
  );
  return new Map(result.rows.map((row) => [row.type_key, Number(row.n)]));
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

/**
 * What an administrator declares at run time. Slice 7.2, flow A14.
 *
 * `on` is the clock's day and never `CURRENT_DATE`, for the reason every date in this system is
 * injected: a write the tests cannot pin is a write that behaves differently on a Tuesday.
 */
export interface FieldDeclaration {
  typeKey: string;
  fieldKey: string;
  labelHe: string;
  valueType: FieldValueType;
  isRequired: boolean;
  extractionHint: string | null;
  on: string;
}

/** What the write left behind, for the audit line and for the test's row counts. */
export interface DeclarationResult {
  documentTypeFieldId: string | null;
  /** The declaration this one superseded, or null when nothing was declared here before. */
  supersededId: string | null;
  /** The day the superseded row was closed at — always the day before `on`. */
  supersededTo: string | null;
}

/** The declaration governing `on`, locked for the duration of the caller's transaction. */
async function liveDeclaration(
  db: Queryable,
  documentTypeId: string,
  fieldKey: string,
  on: string,
): Promise<{ id: string; effectiveFrom: string } | null> {
  const result = await db.query<{
    document_type_field_id: string;
    effective_from: string;
  }>(
    `SELECT document_type_field_id,
            to_char(effective_from, 'YYYY-MM-DD') AS effective_from
       FROM document_type_field
      WHERE document_type_id = $1
        AND field_key = $2
        AND effective_from <= $3::date
        AND (effective_to IS NULL OR effective_to >= $3::date)
      ORDER BY effective_from DESC
      FOR UPDATE`,
    [documentTypeId, fieldKey, on],
  );
  const row = result.rows[0];
  return row
    ? {
        id: row.document_type_field_id,
        effectiveFrom: row.effective_from,
      }
    : null;
}

async function typeIdOf(db: Queryable, typeKey: string): Promise<string> {
  const type = await documentTypeByKey(db, typeKey);
  if (!type) {
    throw new KernelError('not_found', 'no document type holds that key');
  }
  return type.documentTypeId;
}

/**
 * Closes every declaration of one field that is live on `on`, **at the day before `on`**.
 *
 * **The day before, and not `on` itself.** `documentTypeFields` is inclusive at both ends —
 * `effective_from <= on AND (effective_to IS NULL OR effective_to >= on)` — so a row closed at `on`
 * is still live on `on`. Closing at `on` and opening the successor at `on` would leave **two live
 * declarations of one field today**: the screen would print the field twice and extraction would
 * hand the model the same key twice. The seed has used this convention since 3.1 (`2026-09-07`
 * closed, `2026-09-08` opened) and so has `schema.test.ts`; `tasks/todo.md`'s 7.2 bullet said
 * `effective_to = <clock date>` and was corrected here rather than implemented.
 *
 * Every live row rather than one, because if the table ever held two the repair is to close both,
 * and a loop that closed the newest would leave the older one governing today.
 */
async function closeLiveDeclarations(
  db: Queryable,
  documentTypeId: string,
  fieldKey: string,
  on: string,
): Promise<{ closed: number; closedTo: string | null }> {
  const result = await db.query<{ effective_to: string }>(
    `UPDATE document_type_field
        SET effective_to = $3::date - 1
      WHERE document_type_id = $1
        AND field_key = $2
        AND effective_from <= $3::date
        AND (effective_to IS NULL OR effective_to >= $3::date)
      RETURNING to_char(effective_to, 'YYYY-MM-DD') AS effective_to`,
    [documentTypeId, fieldKey, on],
  );
  return {
    closed: result.rowCount ?? 0,
    closedTo: result.rows[0]?.effective_to ?? null,
  };
}

/**
 * Declares a field, or corrects the declaration governing today. **Slice 7.2, flow A14.**
 *
 * This is the run-time half of foundation rule 8, and it is deliberately **not**
 * `upsertDocumentTypeField`. That function is the seed's idempotent re-apply — its
 * `ON CONFLICT … DO UPDATE` is what lets `npm run seed:doctypes` run twice, and it is precisely the
 * edit R18 forbids at run time: an admin correcting a hint through it would overwrite the
 * declaration that governed every value already extracted under it. Two functions, because the seed
 * re-states a declaration it already owns and an administrator supersedes one.
 *
 * **A correction is one transaction**: close the live row at the day before `on`, insert the new
 * declaration at `on`. The caller may already be inside a transaction — `inTransaction` passes a
 * client straight through — and a correction that closed a row and then failed to insert would
 * leave the field declared by nothing.
 *
 * **Twice in one day is a `conflict`, and the refusal is the honest one.** If the live row already
 * opens at `on` there is nothing to supersede: that declaration has governed no extraction on any
 * other day. Closing it at `on - 1` would invert its own window against
 * `document_type_field_version_is_ordered`, and the insert would hit the natural key
 * `(document_type_id, field_key, effective_from)`. Both constraints would refuse, correctly and
 * unreadably; this refuses first and says which rule.
 */
export async function declareDocumentTypeField(
  db: Queryable,
  declaration: FieldDeclaration,
): Promise<DeclarationResult> {
  // **Before the transaction, because it is not a question about the database.** The moment an
  // administrator may declare a field they may declare `rent_amount` as `NUMBER`, and foundation
  // rule 2 stops being enforceable by the schema — `value_type` has no MONEY member, and it does
  // not need one for an amount to get in. `src/evidence/internal/money.ts` says why the vocabulary
  // sits there and not under the seed; `tests/policy/money-field.test.ts` is the gate.
  const money = namesMoney(declaration);
  if (money) {
    throw new KernelError('invalid', moneyRefusal(money), {
      typeKey: declaration.typeKey,
      fieldKey: declaration.fieldKey,
    });
  }
  return inTransaction(db, async (tx) => {
    const documentTypeId = await typeIdOf(tx, declaration.typeKey);
    const live = await liveDeclaration(
      tx,
      documentTypeId,
      declaration.fieldKey,
      declaration.on,
    );
    if (live && live.effectiveFrom === declaration.on) {
      throw new KernelError(
        'conflict',
        'this field was already declared today, and a declaration made today has governed no ' +
          'extraction on any other day — there is nothing to supersede. Correct it tomorrow, or ' +
          'it was never a correction (R18)',
        { typeKey: declaration.typeKey, fieldKey: declaration.fieldKey },
      );
    }
    const superseded = live
      ? await closeLiveDeclarations(
          tx,
          documentTypeId,
          declaration.fieldKey,
          declaration.on,
        )
      : { closed: 0, closedTo: null };
    const inserted = await tx.query<{ document_type_field_id: string }>(
      `INSERT INTO document_type_field (document_type_field_id, document_type_id, field_key,
                                        label_he, value_type, is_required, extraction_hint,
                                        effective_from, effective_to)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::date, null)
       RETURNING document_type_field_id`,
      [
        newId(),
        documentTypeId,
        declaration.fieldKey,
        declaration.labelHe,
        declaration.valueType,
        declaration.isRequired,
        declaration.extractionHint,
        declaration.on,
      ],
    );
    const row = inserted.rows[0];
    if (!row) {
      throw new KernelError('conflict', 'declaration returned no row');
    }
    return {
      documentTypeFieldId: row.document_type_field_id,
      supersededId: live?.id ?? null,
      supersededTo: superseded.closedTo,
    };
  });
}

/**
 * Retires a field: closes the live declaration and inserts nothing. **Slice 7.2, flow A14.**
 *
 * **Deactivate, never delete**, which is the rule `upsertDocumentType` states for a type and is no
 * different one level down: `extracted_field` rows point at the closed declaration and stay
 * explicable by it, which is the whole of R18's promise. There is no delete here and there is not
 * going to be one.
 *
 * **It is in this slice rather than a later one because a correction keys on `field_key`.** A
 * mis-typed key cannot be corrected — only declared again beside its own mistake, forever — so an
 * editor with no retire is an editor whose first typo is permanent.
 */
export async function retireDocumentTypeField(
  db: Queryable,
  retirement: { typeKey: string; fieldKey: string; on: string },
): Promise<DeclarationResult> {
  return inTransaction(db, async (tx) => {
    const documentTypeId = await typeIdOf(tx, retirement.typeKey);
    const live = await liveDeclaration(
      tx,
      documentTypeId,
      retirement.fieldKey,
      retirement.on,
    );
    if (!live) {
      throw new KernelError(
        'not_found',
        'no declaration of that field governs this day',
        { typeKey: retirement.typeKey, fieldKey: retirement.fieldKey },
      );
    }
    if (live.effectiveFrom === retirement.on) {
      throw new KernelError(
        'conflict',
        'this field was declared today, and closing it at the day before would invert its own ' +
          'window. A declaration made today is retired tomorrow (R18)',
        { typeKey: retirement.typeKey, fieldKey: retirement.fieldKey },
      );
    }
    const closed = await closeLiveDeclarations(
      tx,
      documentTypeId,
      retirement.fieldKey,
      retirement.on,
    );
    return {
      documentTypeFieldId: null,
      supersededId: live.id,
      supersededTo: closed.closedTo,
    };
  });
}
