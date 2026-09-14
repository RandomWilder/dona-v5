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
