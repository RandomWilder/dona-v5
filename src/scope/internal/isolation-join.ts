// The isolation join. Foundation rule 1, in SQL, in one file, resolved **before any model call**.
//
// Landed at slice 1.7 rather than 2.3, which is when the rest of this module builds. The two policy
// cases that gate it are written in week 1 against tables that do not exist, and a case that writes
// its own copy of the join proves that copy rather than this one — which is also a second copy of
// the join outside src/scope/, the exact drift `scripts/guards.ts` exists to stop.
//
// Written against the workbook's E4–E8 field names (docs/model/), which is a specification and not a
// description. The tables arrive at 1.9 (unit), 2.1 (party, party_contact) and 2.2 (tenancy,
// tenancy_party); until then this query raises 42P01 and the policy cases report pending against the
// named relation. If the DDL drifts from the workbook the cases go red, which is the gate working.
import type { Pool, PoolClient } from 'pg';

// The relations the query reads, in hop order. Exported because tests/policy/ must name them to
// report which one is still missing, and a test that restates them would be a second copy of the
// join's shape maintained by hand.
export const ISOLATION_JOIN_RELATIONS = [
  'party_contact',
  'party',
  'tenancy_party',
  'tenancy',
  'unit',
] as const;

export type IsolationJoinRelation = (typeof ISOLATION_JOIN_RELATIONS)[number];

export interface ScopedUnit {
  tenancy_id: string;
  unit_id: string;
  unit_number: string;
  party_id: string;
}

// Five hops: phone -> PartyContact (valid today) -> Party -> TenancyParty -> Tenancy (active today)
// -> Unit. Two temporal predicates, and neither is optional.
//
// `pc.valid_to IS NULL OR pc.valid_to >= $2` is the one that makes a recycled number representable:
// Israeli mobile numbers get reassigned, and an undated contact row resolves a stranger to the
// previous tenant's apartment. v3 could not express this case at all.
//
// `tp.is_service_contact` is not a temporal predicate and is here on purpose. Foundation rule 7 says
// a guarantor (ערב) never receives service information; the flag is forced false for
// role = GUARANTOR by a database constraint at 2.2, and this is where that constraint is *spent*.
// Leaving it out would mean a guarantor resolving to a unit and the constraint protecting nothing at
// the only point that reads it.
//
// $2 is a parameter and never CURRENT_DATE — SPEC.md's clock rule. A temporal predicate the tests
// cannot control is a test that fails on a Tuesday. It is day-grained because both dated columns are
// `date` in the workbook.
export const ISOLATION_JOIN_SQL = `
  SELECT t.tenancy_id, u.unit_id, u.unit_number, p.party_id
  FROM party_contact pc
  JOIN party p ON p.party_id = pc.party_id
  JOIN tenancy_party tp ON tp.party_id = p.party_id
  JOIN tenancy t ON t.tenancy_id = tp.tenancy_id
  JOIN unit u ON u.unit_id = t.unit_id
  WHERE pc.channel = 'PHONE'
    AND pc.value = $1
    AND pc.valid_from <= $2
    AND (pc.valid_to IS NULL OR pc.valid_to >= $2)
    AND t.status = 'ACTIVE'
    AND t.start_date <= $2
    AND t.end_date >= $2
    AND tp.is_service_contact
  ORDER BY u.unit_id
`;

// A pool or a checked-out client. The policy suite seeds its fixtures inside a transaction it rolls
// back, and a transaction is one connection: taking the pool only would have forced the fixtures to
// persist, which is how a suite starts passing because of a row someone left behind.
export type Queryable = Pool | PoolClient;

export async function resolveUnitsByPhone(
  db: Queryable,
  phone: string,
  today: Date,
): Promise<ScopedUnit[]> {
  const result = await db.query<ScopedUnit>(ISOLATION_JOIN_SQL, [
    phone,
    today.toISOString().slice(0, 10),
  ]);
  return result.rows;
}
