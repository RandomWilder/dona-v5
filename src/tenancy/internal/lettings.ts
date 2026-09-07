// This module's one read. Slice 3.3, and SPEC-tenancy.md, "No read model, and from 3.3 exactly one
// read".
//
// `commands.ts` says write commands only, and that stays true of it: **who is in a unit today is
// `src/scope/`'s answer and never this module's** (foundation rule 1). The question here is a
// different one, asked by an administrator with a signed lease in their hand — *which lettings does
// this flat have* — and the difference is structural rather than a matter of degree:
//
//   - it takes a `unit_id` and never a phone number, so it is not the front door;
//   - it returns every status in date order and applies **no day predicate at all**, so neither of
//     the isolation join's two temporal predicates is written here and guard two has nothing to
//     catch — which is the guard working, not a line walked up to;
//   - it returns dates and a status and **no party**, so nothing personal can reach the screen;
//   - and nothing decides what anybody may *see* from its result. It fills a select box.
import type { Queryable } from './types.ts';

export interface UnitLetting {
  tenancy_id: string;
  start_date: string;
  end_date: string;
  status: string;
}

/**
 * Every letting on one unit, newest first.
 *
 * Dates are cast to text in SQL for `read-model.ts`'s reason: `pg` hands a `date` back as a JS Date
 * at local midnight, and a date that moves a day when the server changes timezone is a bug that only
 * appears in production.
 *
 * Every status, deliberately. A lease being filed against a tenancy that ended in March is an
 * ordinary act — the paperwork arrives after the letting does — and a list that showed only the
 * current one would make the ordinary act impossible and the wrong one likelier.
 */
export async function listUnitTenancies(
  db: Queryable,
  unitId: string,
): Promise<UnitLetting[]> {
  const result = await db.query<UnitLetting>(
    `SELECT tenancy_id,
            start_date::text AS start_date,
            end_date::text AS end_date,
            status
       FROM tenancy
      WHERE unit_id = $1
      ORDER BY start_date DESC`,
    [unitId],
  );
  return result.rows;
}
