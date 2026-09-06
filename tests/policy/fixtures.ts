// The fixture builder for the isolation cases. **One place**, because the slices that create these
// tables extend it once rather than five call sites: 1.9 brings building · space · unit, 2.1 brings
// party · party_contact, 2.2 brings terms_profile · tenancy · tenancy_party.
//
// Column lists are the workbook's (docs/model/, E1–E8), which is a specification and not a
// description. Only the columns these cases actually turn on are named — with one exception, and it
// is the one this file predicted: `Tenancy.terms_profile_id` is a NOT NULL foreign key in the
// workbook and was deliberately absent until TermsProfile was modelled. 2.2 landed the table, so the
// builder now creates a profile and names the column, **in one place** rather than in each of the
// seven cases, which is exactly what "the slice that creates the table adds it here" was for.
import { newId } from '../../src/kernel/ids.ts';
import type { Queryable } from '../../src/scope/contract.ts';

// The relations these fixtures write, in dependency order. The policy cases need this alongside the
// join's own list: a case is pending while *anything* it touches is missing, and the seed reaches
// building and space, which the join reads through unit rather than by name.
export const SEEDED_RELATIONS = [
  'building',
  'space',
  'unit',
  'party',
  'party_contact',
  'terms_profile',
  'tenancy',
  'tenancy_party',
] as const;

export type TenancyStatus = 'DRAFT' | 'ACTIVE' | 'ENDED' | 'TERMINATED_EARLY';
export type TenancyRole =
  | 'PRIMARY_TENANT'
  | 'CO_TENANT'
  | 'GUARANTOR'
  | 'OCCUPANT';

export interface OccupancySpec {
  phone: string;
  /** PartyContact.valid_from — the first temporal predicate's lower bound. */
  contactFrom: string;
  /** PartyContact.valid_to. Null is "still current", which is the whole hazard. */
  contactTo: string | null;
  tenancyFrom: string;
  tenancyTo: string;
  status?: TenancyStatus;
  role?: TenancyRole;
  isServiceContact?: boolean;
  /** Reuse a unit across two seeds, which is what makes a *recycled* number recycled. */
  unitId?: string;
}

export interface SeededOccupancy {
  unitId: string;
  unitNumber: string;
  partyId: string;
  tenancyId: string;
}

// One address for the whole suite, and every seeded unit is a flat in it. **Not decoration.** A
// case that seeds two occupancies seeds two units, and 1.11's `building_address_unique` rejects the
// second building at the same address — which is correct, and which this builder was violating
// silently. It surfaced at 2.2 rather than at 1.11 because until `tenancy` existed the first
// seedOccupancy raised 42P01 and aborted the transaction before a second building was ever
// attempted: the pending branch was masking a broken fixture. Making the building shared is also
// the truer model — the neighbour in the isolation case lives next door, not in a second building
// at the same address.
const ADDRESS = { line: 'Rakefet 12', city: 'Shoham' };

export async function seedUnit(
  db: Queryable,
  unitNumber: string,
): Promise<string> {
  const unitId = newId();
  await db.query(
    `INSERT INTO building (building_id, name, address_line, city, handover_date,
                           warranty_end_date, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (address_key) DO NOTHING`,
    [
      newId(),
      'Shoham — Rakefet 12',
      ADDRESS.line,
      ADDRESS.city,
      '2026-01-01',
      '2027-01-01',
      'ACTIVE',
    ],
  );
  // Read the key back rather than composing `address_key` here: it is GENERATED ALWAYS from these
  // two columns, and a second copy of that expression is a second thing to keep in step.
  const building = await db.query<{ building_id: string }>(
    'SELECT building_id FROM building WHERE city = $1 AND address_line = $2',
    [ADDRESS.city, ADDRESS.line],
  );
  const buildingId = building.rows[0]?.building_id;
  await db.query(
    `INSERT INTO space (space_id, building_id, space_kind, name)
     VALUES ($1, $2, 'UNIT', $3)`,
    [unitId, buildingId, `Apartment ${unitNumber}`],
  );
  await db.query(
    `INSERT INTO unit (unit_id, unit_number, rooms, has_mamad, condition_status)
     VALUES ($1, $2, 3.5, true, 'READY')`,
    [unitId, unitNumber],
  );
  return unitId;
}

/** One party, reachable on one phone over one period, on one tenancy of one unit. */
export async function seedOccupancy(
  db: Queryable,
  unitNumber: string,
  spec: OccupancySpec,
): Promise<SeededOccupancy> {
  const unitId = spec.unitId ?? (await seedUnit(db, unitNumber));
  const partyId = newId();
  const tenancyId = newId();
  await db.query(
    `INSERT INTO party (party_id, party_kind, full_name) VALUES ($1, 'PERSON', $2)`,
    [partyId, `Tenant of ${unitNumber}`],
  );
  await db.query(
    `INSERT INTO party_contact (contact_id, party_id, channel, value, is_primary,
                                valid_from, valid_to)
     VALUES ($1, $2, 'PHONE', $3, true, $4, $5)`,
    [newId(), partyId, spec.phone, spec.contactFrom, spec.contactTo],
  );
  // Which maintenance annex governs this lease. A NOT NULL foreign key in the workbook, so every
  // seeded tenancy needs one.
  //
  // **Shared rather than one per seed, from 2.4** — for the reason the building above is shared, and
  // it arrived the same way. 2.2 wrote a profile per seed and said "nothing in these cases turns on
  // two tenancies naming the same profile"; 2.4 gave `terms_profile` the natural key
  // `UNIQUE (name)`, which made that false, and every case seeding two occupancies went red with
  // `23505` on `terms_profile_natural_key`. That is the constraint doing its job on a fixture, which
  // is the second time in three slices this builder has been the thing that was wrong — and it is
  // also the truer model: one maintenance annex governs many leases, which is what a name being a
  // key means.
  const profile = await db.query<{ terms_profile_id: string }>(
    `INSERT INTO terms_profile (terms_profile_id, name) VALUES ($1, 'standard')
     ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
     RETURNING terms_profile_id`,
    [newId()],
  );
  const termsProfileId = profile.rows[0]?.terms_profile_id;
  await db.query(
    `INSERT INTO tenancy (tenancy_id, unit_id, start_date, end_date, status, terms_profile_id)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      tenancyId,
      unitId,
      spec.tenancyFrom,
      spec.tenancyTo,
      spec.status ?? 'ACTIVE',
      termsProfileId,
    ],
  );
  await db.query(
    `INSERT INTO tenancy_party (tenancy_id, party_id, role, is_service_contact)
     VALUES ($1, $2, $3, $4)`,
    [
      tenancyId,
      partyId,
      spec.role ?? 'PRIMARY_TENANT',
      spec.isServiceContact ?? true,
    ],
  );
  return { unitId, unitNumber, partyId, tenancyId };
}
