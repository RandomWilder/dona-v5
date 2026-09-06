// The tenancy module's write commands. Slice 2.4, and the caller 2.2 predicted.
//
// Three upserts and nothing else. No read model and no query on this module's contract, for the
// reason parties has none either: **who is in a unit today is computed by `src/scope/` from these
// dates, on every load** (foundation rule 1, R6). A query here that answered it would be the second
// copy of the isolation join, and guard two exists because that is how the constraint dies.
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
