// The isolation join. Foundation rule 1, in SQL, in one file, resolved **before any model call**.
//
// Landed at slice 1.7 rather than 2.3, which is when the rest of this module builds. The two policy
// cases that gate it are written in week 1 against tables that do not exist, and a case that writes
// its own copy of the join proves that copy rather than this one — which is also a second copy of
// the join outside src/scope/, the exact drift `scripts/guards.ts` exists to stop.
//
// **At 2.3 the hops moved into a view and the rules stayed here.** `0008_occupancy_view.sql` names
// `unit -> tenancy -> tenancy_party -> party -> party_contact` once; this file is the only place
// that decides *when* a contact or a tenancy counts. The reasoning is in that migration and in
// SPEC-scope.md, and the short version is that a view cannot take `today` as a parameter and
// CURRENT_DATE inside one is SPEC.md's clock rule broken.
//
// Written against the workbook's E4-E8 field names (docs/model/), which is a specification and not a
// description. If the DDL drifts from the workbook the policy cases go red, which is the gate
// working.
import type { Pool, PoolClient } from 'pg';
import { type ActorKind, createAuditLog } from '../../kernel/audit.ts';
import type { Clock } from '../../kernel/clock.ts';
import { normalisePhone } from './phone.ts';

// The view both questions read. A constant rather than a literal in two query strings: the name is
// what tests/policy/ reports as pending if the migration has not run, and a second spelling of it is
// a second thing to keep in step.
export const OCCUPANCY_VIEW = 'occupancy';

// What the view exposes, in its own order. Exported because `national_id` being absent from it is a
// claim SPEC.md makes and src/scope/scope.test.ts checks against the database rather than against
// this list — this is what the check is *compared to*, so a column added to the view without being
// considered here shows up as a failure.
export const OCCUPANCY_VIEW_COLUMNS = [
  'unit_id',
  'unit_number',
  'tenancy_id',
  'start_date',
  'end_date',
  'status',
  'terms_profile_id',
  'role',
  'is_service_contact',
  'party_id',
  'full_name',
  'preferred_language',
  'contact_id',
  'channel',
  'contact_value',
  'valid_from',
  'valid_to',
] as const;

// The relations the queries read. Exported because tests/policy/ must name them to report which one
// is still missing, and a test that restates them would be a second copy of the join's shape
// maintained by hand. It is one entry from 2.3: the view's own base tables are the migration's
// business, and tests/policy/fixtures.ts already declares the ones it writes.
export const ISOLATION_JOIN_RELATIONS = [OCCUPANCY_VIEW] as const;

export type IsolationJoinRelation = (typeof ISOLATION_JOIN_RELATIONS)[number];

export interface ScopedUnit {
  tenancy_id: string;
  unit_id: string;
  unit_number: string;
  party_id: string;
}

export interface OccupantRow {
  tenancy_id: string;
  party_id: string;
  full_name: string;
  preferred_language: string;
  role: string;
  is_service_contact: boolean;
}

// A pool or a checked-out client. The policy suite seeds its fixtures inside a transaction it rolls
// back, and a transaction is one connection: taking the pool only would have forced the fixtures to
// persist, which is how a suite starts passing because of a row someone left behind. From 2.3 it
// also decides where the audit line lands — on the same connection as the read, so the two are in
// one transaction and neither can outlive the other.
export type Queryable = Pool | PoolClient;

/** Who is asking. Unknown callers are `system`; the agent and the staff console name themselves. */
export interface ScopeActor {
  actorKind: ActorKind;
  actorId?: string;
  actorRole?: string;
}

export interface ScopeOptions {
  actor?: ScopeActor;
  clock?: Clock;
}

const SYSTEM: ScopeActor = { actorKind: 'system' };

// The two temporal predicates, and neither is optional.
//
// `valid_to IS NULL OR valid_to >= $today` is the one that makes a recycled number representable:
// Israeli mobile numbers get reassigned, and an undated contact row resolves a stranger to the
// previous tenant's apartment. v3 could not express this case at all.
//
// `$today` is a parameter and never CURRENT_DATE — SPEC.md's clock rule. A temporal predicate the
// tests cannot control is a test that fails on a Tuesday. It is day-grained because both dated
// columns are `date` in the workbook.
//
// **The view keeps the base tables' column names for exactly these four**, so this text still
// matches the patterns guard two greps for. Renaming them on the view would leave the canonical join
// matching nothing, and the guard would then wave through the very copy it exists to catch. Written
// with aliases first and caught by tests/policy/guards.test.ts, whose violating fixture is this
// string.
const CONTACT_VALID_TODAY = `valid_from <= $2
    AND (valid_to IS NULL OR valid_to >= $2)`;

const TENANCY_ACTIVE_TODAY = `status = 'ACTIVE'
    AND start_date <= $2
    AND end_date >= $2`;

// **Q2 — this phone number just messaged us, which unit, if any?** The isolation join, and the
// answer is frequently none, which is the point.
//
// `is_service_contact` is not a temporal predicate and is here on purpose. Foundation rule 7 says a
// guarantor (ערב) never receives service information; the flag is forced false for role = GUARANTOR
// by a database constraint at 2.2, and this is where that constraint is *spent*. Leaving it out
// would mean a guarantor resolving to a unit and the constraint protecting nothing at the only point
// that reads it.
export const ISOLATION_JOIN_SQL = `
  SELECT tenancy_id, unit_id, unit_number, party_id
  FROM ${OCCUPANCY_VIEW}
  WHERE channel = 'PHONE'
    AND contact_value = $1
    AND ${CONTACT_VALID_TODAY}
    AND ${TENANCY_ACTIVE_TODAY}
    AND is_service_contact
  ORDER BY unit_id
`;

// **Q1 — who lives in unit 12 today?** The workbook's four hops, and DISTINCT because the view fans
// a party out over their contact rows and this question is about people, not about numbers.
//
// It deliberately does **not** filter on `is_service_contact`: the unit screen shows a guarantor as
// a guarantor, greyed and marked unreachable (ADMIN VIEWS, Panel 1), where Q2 must not resolve one
// at all. Two questions, one view, opposite readings of the same column.
const OCCUPANTS_SQL = `
  SELECT DISTINCT tenancy_id, party_id, full_name, preferred_language, role, is_service_contact
  FROM ${OCCUPANCY_VIEW}
  WHERE unit_id = $1
    AND ${TENANCY_ACTIVE_TODAY}
  ORDER BY full_name, role
`;

// **Q1 for a screen full of units, which is a different query from Q1 for one.** Slice 2.6.
//
// `resolvePartiesInUnit` answers "who lives in unit 12 today" and the unit grid asks it of every
// card on the page. At a hundred units that is a hundred round trips **and a hundred audit rows for
// one page load** — an access log in which one browse is indistinguishable from a hundred lookups is
// worse than useless in the review it exists for. So the grid asks once, for the units it is about
// to draw, and the audit line says so.
//
// **It returns no name and no number**, and that is a rule rather than an economy: `/estate` has no
// session until week 5 (SPEC-estate.md), so what a screen may show today is a state and a count.
// `resolvePartiesInUnit` is still the call for the unit screen, where the people are the subject.
//
// A null `unitIds` is the whole portfolio, which is the buildings list asking how much of the estate
// is let today. That is an administrator's question and not a tenant scope — the tenant-facing
// question is Q2, which takes a phone number and frequently answers with nothing.
//
// **A guarantor is not an occupant.** They are on the lease and not in the apartment (foundation
// rule 7, and E8's own note), so they are excluded from the count while the tenancy still counts as
// let. That is the same reading Q1 gives them, from the other side: shown, and marked unreachable.
const OCCUPIED_UNITS_SQL = `
  SELECT unit_id,
         min(tenancy_id::text) AS tenancy_id,
         count(DISTINCT party_id) FILTER (WHERE role <> 'GUARANTOR')::int AS occupants
  FROM ${OCCUPANCY_VIEW}
  WHERE ($1::uuid[] IS NULL OR unit_id = ANY($1))
    AND ${TENANCY_ACTIVE_TODAY}
  GROUP BY unit_id
`;

export interface OccupiedUnit {
  unit_id: string;
  tenancy_id: string;
  occupants: number;
}

function day(today: Date): string {
  return today.toISOString().slice(0, 10);
}

// Every scoped read of tenant data is logged, not only every command (SPEC.md, Security defaults).
// The line is written on the caller's own connection, so it is in the caller's transaction: an audit
// row that survives a rolled-back read would describe something that did not happen, and one written
// on a separate pool could be lost while the read succeeded.
//
// **It records what was reached, not what was asked**, and that is a rule rather than an oversight.
// SPEC.md also says PII never in logs. An Israeli mobile number carries about seven digits of
// entropy, so a bare hash of one is reversible by anybody willing to run a loop, and an HMAC needs a
// secret this module would have to own and rotate. So the line names the party that was reached and
// how many rows came back — which is what an access review and a dispute both ask. The number that
// was asked belongs to the channel module's message log, where an inbound message legitimately lives
// with its sender, and it arrives at week 9.
//
// **The line is written after the read succeeds, and a failed read is not logged here.** It was
// written in a `finally` first, which is the reflex, and slice 2.3's own probe showed what that
// costs: renaming the view aborted the transaction with 42P01, the audit INSERT then failed on the
// poisoned connection with 25P02, and *that* was the error the caller saw. An audit line that can
// replace the error it was meant to describe is worse than an absent one — it would have turned
// every pending policy case in weeks 5 and 6 into an unrelated failure. A read that raised returned
// no tenant data, so there is no access to record; a read that legitimately resolved nobody is
// `matched: 0` and is logged, which is the case an access review actually asks about.
async function audited<T>(
  db: Queryable,
  options: ScopeOptions,
  action: string,
  subjectId: string | null,
  read: () => Promise<T[]>,
): Promise<T[]> {
  const rows = await read();
  await createAuditLog(db, options.clock).write(
    {
      ...(options.actor ?? SYSTEM),
      action,
      // The unconstrained T is deliberate: a caller whose rows carry no party at all -- the grid
      // asking which units are let -- is a legitimate scoped read, and a type constraint that forced
      // a party onto it would push that caller out of the audit rather than into it.
      subjectId:
        subjectId ?? (rows[0] as { party_id?: string } | undefined)?.party_id,
      inputs: { matched: rows.length },
    },
    { outcome: 'ok' },
  );
  return rows;
}

export async function resolveUnitsByPhone(
  db: Queryable,
  phone: string,
  today: Date,
  options: ScopeOptions = {},
): Promise<ScopedUnit[]> {
  // Validation at the edge, and the reason it is here rather than at each caller: a number stored in
  // one format and asked for in another resolves to nobody, and a scope of nothing is exactly what
  // correct isolation looks like. `normalisePhone` raises `invalid` rather than guessing.
  const value = normalisePhone(phone);
  return audited(db, options, 'scope.resolve_by_phone', null, async () => {
    const result = await db.query<ScopedUnit>(ISOLATION_JOIN_SQL, [
      value,
      day(today),
    ]);
    return result.rows;
  });
}

export async function resolvePartiesInUnit(
  db: Queryable,
  unitId: string,
  today: Date,
  options: ScopeOptions = {},
): Promise<OccupantRow[]> {
  return audited(
    db,
    options,
    'scope.resolve_unit_occupants',
    unitId,
    async () => {
      const result = await db.query<OccupantRow>(OCCUPANTS_SQL, [
        unitId,
        day(today),
      ]);
      return result.rows;
    },
  );
}

/**
 * Which of these units are let today, and by how many residents.
 *
 * `unitIds` is the units the caller is about to draw, or `null` for the whole portfolio. One query
 * and one audit line either way.
 */
export async function resolveOccupiedUnits(
  db: Queryable,
  unitIds: readonly string[] | null,
  today: Date,
  options: ScopeOptions = {},
): Promise<OccupiedUnit[]> {
  return audited(
    db,
    options,
    'scope.resolve_occupied_units',
    null,
    async () => {
      const result = await db.query<OccupiedUnit>(OCCUPIED_UNITS_SQL, [
        unitIds === null ? null : [...unitIds],
        day(today),
      ]);
      return result.rows;
    },
  );
}
