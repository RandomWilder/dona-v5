// Slice 7.3. A person looked at what the reader produced, and it is correct.
//
// **Approving is not promoting.** A promotion (4.3, `promote.ts`) says *this value is now business
// truth on a typed column*: it needs a mapping row, it moves another module's row, and it reaches
// two targets. An approval says something smaller and more useful, and every captured row can carry
// one — including `address`, `apartment_number`, `tenant_name` and `guarantor_name`, which until
// this slice were capturable, listed, searchable and unattestable.
//
// **`value` is never overwritten.** What the reader produced and what a person affirmed are two
// columns, and the difference between them is the per-field accuracy dataset this track exists to
// produce. One column would destroy the measurement on the first correction, and the correction is
// the interesting event. SPEC-evidence.md, "Approval — the stamp that is not a promotion".
import type { AuditLog } from '../../kernel/audit.ts';
import type { Clock } from '../../kernel/clock.ts';
import { inTransaction } from '../../kernel/db.ts';
import { KernelError } from '../../kernel/errors.ts';
import { requireText, validId } from '../../kernel/validate.ts';
import { type ContactRules, contactChannelOf } from './contacts.ts';
import { isIdentifierField, listExtractedFields } from './extract.ts';
import type { Queryable } from './types.ts';

/**
 * **The cut below which a reading must be touched individually. Ruled 15 Sep 2026.**
 *
 * It is a cut on *OCR word legibility* and not on the model's belief about the mapping — see
 * `isFlagged` — and 0.8 is roughly where Document AI's own guidance puts human review.
 *
 * **A constant and not a `config_settings` row.** A row with no editor is a row somebody inserts by
 * hand, and 5.8's open half already owns that debt; a second unreachable knob would be worse than a
 * number in a file a reviewer reads. `tests/policy/read-quality.test.ts` asserts against *this*
 * binding and never a copy of the digits, so moving it is one edit and one evidence file.
 */
export const READ_QUALITY_THRESHOLD = 0.8;

/**
 * **Whether this reading has to be looked at by a person before it is approved.**
 *
 * `extracted_field.confidence` is the **minimum OCR word confidence** of the words the reader
 * pointed at (`min()` in `extract.ts`), never the model's confidence in the field: 90% means
 * *Document AI read these characters well*, and a crisp page misread with total legibility scores
 * 99%. The screen calls it `איכות הקריאה` for that reason.
 *
 * **`null` is flagged.** `src/kernel/pdf.ts` gives every native-text word `confidence: null` and the
 * `min()` above turns any null into a null field, so every field of every digitally-produced lease
 * arrives here unmeasured. Treating that as passing would let one press of
 * `אישור כל מה שלא סומן` approve an entire document on no signal whatsoever.
 */
export function isFlagged(confidence: number | null): boolean {
  // `(confidence ?? 1) < READ_QUALITY_THRESHOLD` is the line this was written as first, and it is
  // the mistake the policy case exists to catch: a default of *fine* on the absence of a
  // measurement. It approved two of three fixture rows instead of one, and the extra one was the
  // row nobody had measured at all.
  return confidence === null || confidence < READ_QUALITY_THRESHOLD;
}

/**
 * **#239. On a lease, the rows that say who the letting is with, when, and where.** Each is one
 * press on הקריאה: a name, the two dates, the read address. Identifiers and contacts are in the set
 * for every type already, below.
 */
const LEASE_IDENTITY_AND_ACCESS: ReadonlySet<string> = new Set([
  'main_tenant_name',
  'second_tenant_name',
  'tenant_name',
  'guarantor_name',
  'start_date',
  'end_date',
  'address',
  'apartment_number',
  'building_number',
]);

/**
 * **Whether this row is left for its own press by `אישור כל מה שלא סומן`.** One predicate, read by
 * the command and by both screens, so the rows sorted to the top are exactly the rows the press
 * leaves. Every type: read quality, an identifier, a phone or an email. A lease adds names, the two
 * dates and the read address (#239).
 */
export function pressedAlone(
  row: { fieldKey: string; labelHe?: string; confidence: number | null },
  typeKey: string,
): boolean {
  return (
    isFlagged(row.confidence) ||
    isIdentifierField(row.fieldKey) ||
    contactChannelOf(row.fieldKey, row.labelHe) !== null ||
    (typeKey === 'lease' && LEASE_IDENTITY_AND_ACCESS.has(row.fieldKey))
  );
}

export interface ApproveDeps {
  db: Queryable;
  audit: AuditLog;
  clock: Clock;
  /**
   * **#235.** What makes a phone or an email approvable. Built at the composition root from
   * `src/scope/`'s normalisers. Without it a contact row cannot be approved at all: a number
   * nobody checked must not become somebody's contact.
   */
  contacts?: ContactRules;
}

export interface ApproveSpec {
  extractedFieldId: string;
  /**
   * The corrected value, when the reader was wrong. Absent or empty is *affirm it as read*, and
   * `approved_value` is written either way — a stamped row says what was affirmed without a join.
   */
  approvedValue?: string | null;
  approvedBy: string;
  /**
   * **Whether this caller may read a captured identifier — `party.national_id.read`.**
   *
   * Approving is an attestation, so somebody who was never shown the value may not sign for it: a
   * stamp from such a viewer is a false record in the one dataset this command exists to produce.
   * The stance is a parameter rather than a lookup because this module does not read sessions; the
   * route passes what the matrix answered.
   */
  mayReadIdentifiers: boolean;
}

export interface ApproveResult {
  extractedFieldId: string;
  fieldKey: string;
  edited: boolean;
  /** #268. The row was already approved, and this stamp replaced that one. */
  restamped: boolean;
}

export interface ApproveUnflaggedSpec {
  documentId: string;
  approvedBy: string;
}

export interface ApproveUnflaggedResult {
  approved: number;
  /** Rows left for a person: every row `pressedAlone` names. */
  flagged: number;
}

interface CapturedRow {
  extracted_field_id: string;
  document_id: string;
  field_key: string;
  value: string;
  approved_value: string | null;
  approved_at: Date | null;
  promoted_at: Date | null;
}

async function stamp(
  deps: ApproveDeps,
  db: Queryable,
  row: CapturedRow,
  approvedValue: string,
  approvedBy: string,
): Promise<ApproveResult> {
  await db.query("SELECT set_config('dona.approving', 'on', true)");
  await db.query(
    `UPDATE extracted_field
        SET approved_value = $2, approved_by = $3, approved_at = $4
      WHERE extracted_field_id = $1`,
    [row.extracted_field_id, approvedValue, approvedBy, deps.clock.now()],
  );
  const edited = approvedValue !== row.value;
  // #268. A stamp over a stamp: the earlier signature is replaced on the row and kept here.
  const restamped = row.approved_at !== null;
  // **Never the value, and never either of them.** PII does not reach a log (SPEC.md), and a line
  // carrying the correction would defeat the thing it exists to record. `edited` is the fact worth
  // keeping: it is the per-field accuracy signal in its smallest honest form.
  await deps.audit.write(
    {
      actorKind: 'staff',
      actorId: approvedBy,
      action: 'evidence.approve_field',
      subjectId: row.extracted_field_id,
      inputs: {
        documentId: row.document_id,
        fieldKey: row.field_key,
        edited,
        restamped,
      },
    },
    { outcome: 'ok' },
  );
  return {
    extractedFieldId: row.extracted_field_id,
    fieldKey: row.field_key,
    edited,
    restamped,
  };
}

async function capturedRow(
  db: Queryable,
  extractedFieldId: string,
): Promise<CapturedRow> {
  const result = await db.query<CapturedRow>(
    `SELECT e.extracted_field_id, e.document_id, f.field_key, e.value,
            e.approved_value, e.approved_at, e.promoted_at
       FROM extracted_field e
       JOIN document_type_field f
         ON f.document_type_field_id = e.document_type_field_id
      WHERE e.extracted_field_id = $1
      FOR UPDATE OF e`,
    [extractedFieldId],
  );
  const row = result.rows[0];
  if (!row) {
    throw new KernelError('not_found', 'extracted field not found');
  }
  return row;
}

/**
 * One reading, approved as read or corrected first.
 *
 * **#268. An approved reading is corrected by approving it again, with a different value.** A misread
 * a person waved through would otherwise follow the paper into the letting, or be built around. The
 * stamp is written again — value, person, time — and `value` is still the reader's, so the accuracy
 * dataset keeps both and the audit log keeps every signature. The same value again is `conflict`,
 * which the screen says as a sentence. Every field takes the same path; none is special.
 *
 * **Where it stops.** A promoted row is refused: its value is already on a typed column, and a new
 * stamp would disagree with it. A lease's reading closes when the draft opens, and that rule is the
 * routes' (they know the tenancy link; this command does not).
 */
export async function approveExtractedField(
  deps: ApproveDeps,
  spec: ApproveSpec,
): Promise<ApproveResult> {
  const extractedFieldId = validId(spec.extractedFieldId, 'extracted field');
  const approvedBy = requireText(spec.approvedBy, 'approved_by', 200);
  const corrected =
    spec.approvedValue === undefined ||
    spec.approvedValue === null ||
    spec.approvedValue.trim() === ''
      ? null
      : requireText(spec.approvedValue, 'approved_value', 2000);

  return inTransaction(deps.db, async (db) => {
    const row = await capturedRow(db, extractedFieldId);
    // First, before anything is compared: "already approved" for an equal value would tell a
    // viewer who was never shown an identifier what it says.
    if (isIdentifierField(row.field_key) && !spec.mayReadIdentifiers) {
      throw new KernelError(
        'not_allowed',
        'a reading that is withheld from you cannot be approved by you',
      );
    }
    // A row 7.3 promoted before promotion needed a stamp can still be signed once.
    if (row.approved_at !== null && row.promoted_at !== null) {
      throw new KernelError('conflict', 'that reading is already promoted');
    }
    const approved = corrected ?? row.value;
    if (row.approved_at !== null && row.approved_value === approved) {
      throw new KernelError('conflict', 'that reading is already approved');
    }
    const channel = contactChannelOf(row.field_key);
    if (channel !== null) {
      // The signed value stays as the person typed it; פתיחת טיוטה stores the normalised form.
      if (!deps.contacts) {
        throw new KernelError('invalid', 'a contact cannot be approved here');
      }
      deps.contacts.normalise(channel, approved);
    }
    return stamp(deps, db, row, approved, approvedBy);
  });
}

/**
 * **`אישור כל מה שלא סומן`, and never approve-all.**
 *
 * Eleven rows on a fourteen-page lease, most above 90%: a control that approved everything would be
 * a reflex within a week and the measurement would die the same day. What this approves is the set
 * a person would have waved through one at a time — measured and legible.
 *
 * **An identifier is never in that set, at any stance.** A ת.ז. does not reach the screen until
 * somebody asks for it by name (6.4, and 7.3's reveal), so bulk-approving one would be a signature
 * on a value the signer has not been shown — the same objection as approving a withheld row, at
 * scale and without anyone noticing. It is flagged for everybody, and it is approved one at a time
 * after it has been revealed.
 */
export async function approveUnflagged(
  deps: ApproveDeps,
  spec: ApproveUnflaggedSpec,
): Promise<ApproveUnflaggedResult> {
  const documentId = validId(spec.documentId, 'document');
  const approvedBy = requireText(spec.approvedBy, 'approved_by', 200);

  return inTransaction(deps.db, async (db) => {
    const typed = await db.query<{ type_key: string }>(
      `SELECT dt.type_key FROM document d
         JOIN document_type dt ON dt.document_type_id = d.document_type_id
        WHERE d.document_id = $1`,
      [documentId],
    );
    const typeKey = typed.rows[0]?.type_key;
    if (typeKey === undefined) {
      throw new KernelError('not_found', 'document not found');
    }
    const rows = await listExtractedFields(db, documentId);
    const open = rows.filter((row) => row.approvedAt === null);
    // A phone or an email is never in the bulk set either (#235): who it reaches is decided by
    // the person who signs it, one row at a time, after the value is checked.
    const unflagged = open.filter((row) => !pressedAlone(row, typeKey));
    for (const row of unflagged) {
      const captured = await capturedRow(db, row.extractedFieldId);
      if (captured.approved_at !== null) {
        continue;
      }
      await stamp(deps, db, captured, captured.value, approvedBy);
    }
    return {
      approved: unflagged.length,
      flagged: open.length - unflagged.length,
    };
  });
}
