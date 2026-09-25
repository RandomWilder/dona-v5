// Reads on this module's contract. Slice 3.3 started with one; #122 is another.
//
// `commands.ts` still writes only. **Who a phone reaches today is `src/scope/`'s answer**
// (foundation rule 1). `listUnitTenancies` is a different question — *which lettings does this
// flat have* — and `listActiveLettingsInBuilding` is the office inventory of Units let in a
// Building today. Neither is the front door:
//
//   - both take an estate id and never a phone number;
//   - `listUnitTenancies` returns every status, dates, **no party**, **no day predicate**;
//   - `listActiveLettingsInBuilding` returns `ACTIVE` rows whose dates cover the clock's day,
//     with names except `GUARANTOR`, and does not restate the isolation join.
import { type Clock, today as dayOf } from '../../kernel/clock.ts';
import { KernelError } from '../../kernel/errors.ts';
import type { Queryable } from './types.ts';

export interface UnitLetting {
  tenancy_id: string;
  start_date: string;
  end_date: string;
  status: string;
  notice_date: string | null;
}

/** One letting on a named unit. Same facts as `UnitLetting`, so a page can ask once. #159. */
export interface LettingOnUnit extends UnitLetting {
  unit_id: string;
}

/** One letting, for the tenancy sheet. Dates, status, and the promoted copies. No party. #107, #134. */
export interface TenancyRow {
  tenancy_id: string;
  unit_id: string;
  start_date: string;
  end_date: string;
  status: string;
  rent_amount: string | null;
  rent_currency: string | null;
  option_end_date: string | null;
  parking_space_id: string | null;
  parking_name: string | null;
  storage_space_id: string | null;
  storage_name: string | null;
}

/** Who is on the letting, as ids and roles. The name lives in `party`. #107. */
export interface TenancyPartyRow {
  party_id: string;
  role: string;
  is_service_contact: boolean;
}

/**
 * Every letting on these units, newest start first within a unit. #159.
 *
 * Same question as `listUnitTenancies`, asked once for a page. Dates are cast to text so a
 * `date` does not shift when the server's timezone changes. No day predicate: a caller that
 * needs "still waiting" or "inside the expiring window" does that arithmetic on these dates
 * and the clock.
 */
export async function listLettingsForUnits(
  db: Queryable,
  unitIds: readonly string[],
): Promise<LettingOnUnit[]> {
  if (unitIds.length === 0) return [];
  const result = await db.query<LettingOnUnit>(
    `SELECT tenancy_id,
            unit_id,
            start_date::text AS start_date,
            end_date::text AS end_date,
            notice_date::text AS notice_date,
            status
       FROM tenancy
      WHERE unit_id = ANY($1::uuid[])
      ORDER BY unit_id, start_date DESC`,
    [[...unitIds]],
  );
  return result.rows;
}

/**
 * Every letting on one unit, newest first.
 *
 * Every status, deliberately. A lease being filed against a tenancy that ended in March is an
 * ordinary act — the paperwork arrives after the letting does — and a list that showed only the
 * current one would make the ordinary act impossible and the wrong one likelier.
 */
export async function listUnitTenancies(
  db: Queryable,
  unitId: string,
): Promise<UnitLetting[]> {
  const rows = await listLettingsForUnits(db, [unitId]);
  return rows.map((row) => ({
    tenancy_id: row.tenancy_id,
    start_date: row.start_date,
    end_date: row.end_date,
    status: row.status,
    notice_date: row.notice_date,
  }));
}

/**
 * One letting by id. Missing is `not_found`, same standing as `getUnit`.
 */
export async function getTenancy(
  db: Queryable,
  tenancyId: string,
): Promise<TenancyRow> {
  const result = await db.query<TenancyRow>(
    `SELECT tenancy_id,
            unit_id,
            start_date::text AS start_date,
            end_date::text AS end_date,
            status,
            rent_amount::text AS rent_amount,
            rent_currency,
            option_end_date::text AS option_end_date,
            tenancy.parking_space_id,
            p.name AS parking_name,
            tenancy.storage_space_id,
            s.name AS storage_name
       FROM tenancy
       LEFT JOIN space p ON p.space_id = tenancy.parking_space_id
       LEFT JOIN space s ON s.space_id = tenancy.storage_space_id
      WHERE tenancy_id = $1`,
    [tenancyId],
  );
  const row = result.rows[0];
  if (!row) {
    throw new KernelError('not_found', 'tenancy not found');
  }
  return row;
}

/**
 * The household on one letting, as joins, not as people. Ordered so a title can take the
 * primary tenant first without the screen sorting.
 */
export async function listTenancyParties(
  db: Queryable,
  tenancyId: string,
): Promise<TenancyPartyRow[]> {
  const result = await db.query<TenancyPartyRow>(
    `SELECT party_id, role, is_service_contact
       FROM tenancy_party
      WHERE tenancy_id = $1
      ORDER BY CASE role
                 WHEN 'PRIMARY_TENANT' THEN 0
                 WHEN 'CO_TENANT' THEN 1
                 WHEN 'OCCUPANT' THEN 2
                 WHEN 'GUARANTOR' THEN 3
                 ELSE 4
               END,
               party_id`,
    [tenancyId],
  );
  return result.rows;
}

/** One Unit let today in a Building. Names, not identifiers. #122. */
export interface ActiveLettingInBuilding {
  unit_name: string;
  start_date: string;
  end_date: string;
  party_names: string[];
}

/**
 * Units currently let in one Building. Office inventory, not the front door.
 *
 * `ACTIVE` lettings of Units in the Building, then the clock decides which of those
 * still cover today — the same comparison `activationGate` already makes, not the
 * isolation join. `GUARANTOR` is on the lease and not in `party_names`.
 */
export async function listActiveLettingsInBuilding(
  db: Queryable,
  buildingId: string,
  clock: Clock,
): Promise<ActiveLettingInBuilding[]> {
  const result = await db.query<{
    unit_name: string;
    start_date: string;
    end_date: string;
    party_names: string[] | null;
  }>(
    `SELECT s.name AS unit_name,
            t.start_date::text AS start_date,
            t.end_date::text AS end_date,
            array_agg(p.full_name ORDER BY CASE tp.role
              WHEN 'PRIMARY_TENANT' THEN 0
              WHEN 'CO_TENANT' THEN 1
              WHEN 'OCCUPANT' THEN 2
              ELSE 4
            END, p.full_name)
              FILTER (WHERE tp.role <> 'GUARANTOR') AS party_names
       FROM tenancy t
       JOIN space s ON s.space_id = t.unit_id
       LEFT JOIN tenancy_party tp ON tp.tenancy_id = t.tenancy_id
       LEFT JOIN party p ON p.party_id = tp.party_id
      WHERE s.building_id = $1
        AND t.status = 'ACTIVE'
      GROUP BY t.tenancy_id, s.name, t.start_date, t.end_date
      ORDER BY s.name`,
    [buildingId],
  );
  const day = dayOf(clock);
  return result.rows
    .filter((row) => row.start_date <= day && row.end_date >= day)
    .map((row) => ({
      unit_name: row.unit_name,
      start_date: row.start_date,
      end_date: row.end_date,
      party_names: row.party_names ?? [],
    }));
}

/**
 * **How many people on each of this flat's lettings already carry one of these identifiers.
 * Slice 6.5, flow A2.**
 *
 * A2 has to rank a flat's lettings so an operator holding a lease can be shown which one it probably
 * belongs to, and the only signal worth having is *does this letting already hold one of the people
 * this paper names* — asked of a **declared identifier** and never of a name. That distinction is
 * A2 step 5's and it is not a matter of degree: 5.5 measured **303** identified people sharing a
 * full name in one generated portfolio, so a name is a guess, while a ת.ז. printed on the page is a
 * declaration.
 *
 * **What leaves this function is a count.** No party, no name, no identifier, no key and no row. The
 * probes are normalised and compared *inside the statement*, so a value does not round-trip either —
 * the confirm screen can therefore show how many people matched and has nothing to leak. Reading it
 * is still a read of an identifier: **the caller writes `evidence.match_identifier` for it**, because
 * this module does not know who asked (SPEC.md, Security defaults).
 *
 * **`party_national_id_key` is the database's own fold**, shared with the generated column it is
 * compared against (`0009_import_natural_keys.sql`, `0027_party_national_id_key.sql`). A2 must
 * normalise an identifier read off a document *before* any party row exists to compare it to, and a
 * second copy of that fold in TypeScript is the drift `upsertPartyContact`'s comment already warns
 * about. `'PERSON'` is the registry, fixed: the people named on a lease are people, and a ח.פ. that
 * happens to be the same nine digits is a different legal person.
 *
 * **No temporal predicate, deliberately.** Whether the lease's own term overlaps a letting's is the
 * caller's arithmetic over the dates `listUnitTenancies` already returns. The comparison that would
 * express it in SQL is the isolation join's tenancy-active predicate — `src/scope/`'s alone, and the
 * one guard two matches on by name — and rephrasing that predicate to get past the guard is exactly
 * the move the guard exists to forbid. So this query carries no date at all.
 *
 * Writing the predicate out *in this comment*, to explain what is not here, turned guard two red on
 * the first run. That is the guard working and not the guard being clumsy: a predicate named in a
 * comment is a predicate somebody copies tomorrow, which is why guard one fails on a comment too.
 */
export async function countIdentifierOverlap(
  db: Queryable,
  unitId: string,
  identifiers: readonly string[],
): Promise<Map<string, number>> {
  // A lease that declared none asks nothing. Cheaper, and it keeps the audit line honest: there is
  // no read here to log.
  if (identifiers.length === 0) {
    return new Map();
  }
  const result = await db.query<{ tenancy_id: string; matched: string }>(
    `SELECT t.tenancy_id, count(DISTINCT tp.party_id)::text AS matched
       FROM tenancy t
       JOIN tenancy_party tp ON tp.tenancy_id = t.tenancy_id
       JOIN party p ON p.party_id = tp.party_id
      WHERE t.unit_id = $1
        AND p.national_id_key = ANY (
              SELECT party_national_id_key('PERSON', probe)
                FROM unnest($2::text[]) AS probe
            )
      GROUP BY t.tenancy_id`,
    [unitId, [...identifiers]],
  );
  return new Map(
    result.rows.map((row) => [row.tenancy_id, Number(row.matched)]),
  );
}
