// The tenancy module's write commands. Slice 2.4, and the caller 2.2 predicted.
//
// Three upserts and nothing else. No read model and no query on this module's contract, for the
// reason parties has none either: **who is in a unit today is computed by `src/scope/` from these
// dates, on every load** (foundation rule 1, R6). A query here that answered it would be the second
// copy of the isolation join, and guard two exists because that is how the constraint dies.
import type { Pool } from 'pg';
import { type Clock, today as dayOf } from '../../kernel/clock.ts';
import { KernelError } from '../../kernel/errors.ts';
import { newId } from '../../kernel/ids.ts';
import { INSERTED, type UpsertResult } from '../../kernel/upsert.ts';
import type { Queryable } from './types.ts';

export type TenancyStatus = 'DRAFT' | 'ACTIVE' | 'ENDED' | 'TERMINATED_EARLY';
export type TenancyRole =
  | 'PRIMARY_TENANT'
  | 'CO_TENANT'
  | 'GUARANTOR'
  | 'OCCUPANT';

export interface TenancySpec {
  unitId: string;
  startDate: string;
  /** Contractual end. With `startDate` this is the isolation window. */
  endDate: string;
  status: TenancyStatus;
  /** Which maintenance annex governs the lease. NOT NULL — the responsibility decision keys on it. */
  termsProfileId: string;
  noticeDate: string | null;
  /** Reality, when it differs from `endDate`. */
  actualMoveOut: string | null;
}

export interface TenancyPartySpec {
  tenancyId: string;
  partyId: string;
  role: TenancyRole;
  /**
   * May this party open and discuss service calls for the unit?
   *
   * **There is no defaulting here and there must not be.** `guarantor_is_never_a_service_contact`
   * rejects `true` for a `GUARANTOR`, and this command passes the value straight to it rather than
   * quietly correcting it: foundation rule 7 says the insert is *rejected*, not defaulted politely,
   * and an import path that corrected it would be the toggle the constraint exists to deny. The
   * register reports such a row as a reject with its line number (SPEC-register.md).
   */
  isServiceContact: boolean;
}

/**
 * Looks a maintenance annex up by name, or creates it.
 *
 * `UNIQUE (name)` is the natural key, chosen at 2.4. **How many profiles are in force is week 5's**
 * and is a different question from what identifies one; only the second was owed here.
 */
export async function upsertTermsProfile(
  db: Queryable,
  name: string,
): Promise<UpsertResult> {
  const result = await db.query<{
    terms_profile_id: string;
    inserted: boolean;
  }>(
    // `SET name = EXCLUDED.name` is a no-op update and is the point: `DO NOTHING` returns no row, so
    // the caller would have to re-select the id it just failed to insert (1.11's reasoning).
    `INSERT INTO terms_profile (terms_profile_id, name)
     VALUES ($1, $2)
     ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
     RETURNING terms_profile_id, ${INSERTED}`,
    [newId(), name],
  );
  const row = result.rows[0];
  if (!row) {
    throw new KernelError('conflict', 'terms profile upsert returned no row');
  }
  return { id: row.terms_profile_id, inserted: row.inserted };
}

/**
 * Looks up a maintenance annex by name. Missing is `null`, never an insert — A2 must not invent
 * a default profile (slice 4.6).
 */
export async function findTermsProfileByName(
  db: Queryable,
  name: string,
): Promise<string | null> {
  const result = await db.query<{ terms_profile_id: string }>(
    `SELECT terms_profile_id FROM terms_profile WHERE name = $1`,
    [name],
  );
  return result.rows[0]?.terms_profile_id ?? null;
}

/**
 * Every maintenance annex name, ordered. Slice 4.6b: the confirm screen lists these; it does not
 * invent a row when the list is empty.
 */
export async function listTermsProfiles(db: Queryable): Promise<string[]> {
  const result = await db.query<{ name: string }>(
    `SELECT name FROM terms_profile ORDER BY name`,
  );
  return result.rows.map((row) => row.name);
}

/**
 * One lease term on one unit.
 *
 * The conflict target is `(unit_id, start_date)`, which landed with the table at 2.2 rather than
 * with this caller: one lease per unit per start date, so a re-run is a no-op and two leases on one
 * unit starting the same day are one lease typed twice. It covers every status, where
 * `one_active_tenancy_per_unit` covers only `ACTIVE` — and that constraint is the one that rejects a
 * register's sloppy dates, loudly, with a line number.
 */
export async function upsertTenancy(
  db: Queryable,
  spec: TenancySpec,
): Promise<UpsertResult> {
  const result = await db.query<{ tenancy_id: string; inserted: boolean }>(
    `INSERT INTO tenancy (tenancy_id, unit_id, start_date, end_date, status,
                          terms_profile_id, notice_date, actual_move_out)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (unit_id, start_date) DO UPDATE
       SET end_date = EXCLUDED.end_date,
           status = EXCLUDED.status,
           terms_profile_id = EXCLUDED.terms_profile_id,
           notice_date = EXCLUDED.notice_date,
           actual_move_out = EXCLUDED.actual_move_out
     RETURNING tenancy_id, ${INSERTED}`,
    [
      newId(),
      spec.unitId,
      spec.startDate,
      spec.endDate,
      spec.status,
      spec.termsProfileId,
      spec.noticeDate,
      spec.actualMoveOut,
    ],
  );
  const row = result.rows[0];
  if (!row) {
    throw new KernelError('conflict', 'tenancy upsert returned no row');
  }
  return { id: row.tenancy_id, inserted: row.inserted };
}

/**
 * Who is on the lease, and in what role.
 *
 * The conflict target is the composite primary key `(tenancy_id, party_id)` — the workbook's own
 * key, one party holding one role on one tenancy — so there is no second key here to keep in step
 * with the first, which is `unit`'s situation at 1.11 for the same structural reason.
 *
 * The returned id is the tenancy's: this table has no surrogate key, and a caller that needs to
 * name the row names the pair.
 */
export async function upsertTenancyParty(
  db: Queryable,
  spec: TenancyPartySpec,
): Promise<UpsertResult> {
  const result = await db.query<{ inserted: boolean }>(
    `INSERT INTO tenancy_party (tenancy_id, party_id, role, is_service_contact)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (tenancy_id, party_id) DO UPDATE
       SET role = EXCLUDED.role,
           is_service_contact = EXCLUDED.is_service_contact
     RETURNING ${INSERTED}`,
    [spec.tenancyId, spec.partyId, spec.role, spec.isServiceContact],
  );
  const inserted = result.rows[0]?.inserted;
  if (inserted === undefined) {
    throw new KernelError('conflict', 'tenancy party upsert returned no row');
  }
  return { id: spec.tenancyId, inserted };
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export type PromotedTenancyField =
  | 'start_date'
  | 'end_date'
  | 'rent_amount'
  | 'rent_currency'
  | 'option_end_date';

export interface PromotedFieldSpec {
  tenancyId: string;
  field: PromotedTenancyField;
  value: string;
  actor: string;
  at: Date;
  sourceDocumentId: string;
  extractedFieldId: string;
}

function requireDate(value: string): string {
  if (!DATE.test(value)) {
    throw new KernelError('invalid', 'that is not a date');
  }
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  const utc = new Date(Date.UTC(year, month - 1, day));
  if (
    utc.getUTCFullYear() !== year ||
    utc.getUTCMonth() !== month - 1 ||
    utc.getUTCDate() !== day
  ) {
    throw new KernelError('invalid', 'that is not a date');
  }
  return value;
}

function pgCode(error: unknown): string | undefined {
  if (error !== null && typeof error === 'object' && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    return typeof code === 'string' ? code : undefined;
  }
  return undefined;
}

const PROMOTED_COLUMN: Record<PromotedTenancyField, string> = {
  start_date: 'start_date',
  end_date: 'end_date',
  rent_amount: 'rent_amount',
  rent_currency: 'rent_currency',
  option_end_date: 'option_end_date',
};

const DATE_FIELDS = new Set<PromotedTenancyField>([
  'start_date',
  'end_date',
  'option_end_date',
]);

const AMOUNT = /^\d+(\.\d+)?$/;

function requireAmount(value: string): string {
  if (!AMOUNT.test(value)) {
    throw new KernelError('invalid', 'that is not an amount');
  }
  return value;
}

function requirePromotedValue(
  field: PromotedTenancyField,
  value: string,
): string {
  if (DATE_FIELDS.has(field)) return requireDate(value);
  if (field === 'rent_amount') return requireAmount(value);
  if (value.trim() === '') {
    throw new KernelError('invalid', 'that currency is empty');
  }
  return value;
}

/**
 * Copy a promoted value onto the tenancy row and append TenancyEvent.
 *
 * Isolation dates from the register importer still go through `upsertTenancy` and do not write
 * events. This command is the document path: old → new, who approved it, which document caused it.
 */
export async function applyPromotedField(
  db: Queryable,
  spec: PromotedFieldSpec,
): Promise<void> {
  const value = requirePromotedValue(spec.field, spec.value);
  const column = PROMOTED_COLUMN[spec.field];
  const current = await db.query<Record<string, string | null>>(
    `SELECT start_date::text, end_date::text, rent_amount::text, rent_currency,
            option_end_date::text
       FROM tenancy WHERE tenancy_id = $1`,
    [spec.tenancyId],
  );
  const row = current.rows[0];
  if (!row) {
    throw new KernelError('not_found', 'tenancy not found');
  }
  const oldValue = row[column] ?? null;
  if (oldValue !== value) {
    try {
      await db.query(
        `UPDATE tenancy SET ${column} = $2 WHERE tenancy_id = $1`,
        [spec.tenancyId, value],
      );
    } catch (error) {
      const code = pgCode(error);
      if (code === '23505') {
        throw new KernelError(
          'conflict',
          'that unit already has a lease starting on this date',
        );
      }
      if (code === '23514') {
        throw new KernelError('invalid', 'the lease period is not ordered');
      }
      throw error;
    }
  }
  await db.query(
    `INSERT INTO tenancy_event (
       tenancy_event_id, tenancy_id, at, actor, kind, field,
       old_value, new_value, source_document_id, extracted_field_id
     ) VALUES ($1, $2, $3, $4, 'amended', $5, $6, $7, $8, $9)`,
    [
      newId(),
      spec.tenancyId,
      spec.at,
      spec.actor,
      column,
      oldValue,
      value,
      spec.sourceDocumentId,
      spec.extractedFieldId,
    ],
  );
}

function isPool(db: Queryable): db is Pool {
  return 'totalCount' in db;
}

async function expireDueOn(db: Queryable, clock: Clock): Promise<void> {
  // Two different questions of the same clock: which day has ended (the office's, slice 7.2b) and
  // what instant to stamp the event with. That is the argument for passing the clock rather than an
  // instant — an instant cannot answer the first, and a date cannot answer the second.
  const today = dayOf(clock);
  const at = clock.now();
  const closed = await db.query<{ tenancy_id: string }>(
    `UPDATE tenancy
        SET status = 'ENDED'
      WHERE status = 'ACTIVE'
        AND end_date < $1::date
      RETURNING tenancy_id`,
    [today],
  );
  for (const row of closed.rows) {
    await db.query(
      `INSERT INTO tenancy_event (
         tenancy_event_id, tenancy_id, at, actor, kind, field,
         old_value, new_value, source_document_id, extracted_field_id
       ) VALUES ($1, $2, $3, 'system', 'terminated', 'status',
                 'ACTIVE', 'ENDED', NULL, NULL)`,
      [newId(), row.tenancy_id, at],
    );
  }
}

/**
 * Close ACTIVE tenancies whose contractual end_date is already before the clock's day, in the
 * office's zone.
 *
 * Isolation still counts the last day (`end_date >= today`). The day after is when the row
 * becomes ENDED and a `terminated` event is appended with no document. Idempotent.
 */
export async function expireDueTenancies(
  db: Queryable,
  clock: Clock,
): Promise<void> {
  if (isPool(db)) {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      await expireDueOn(client, clock);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    return;
  }
  await expireDueOn(db, clock);
}
