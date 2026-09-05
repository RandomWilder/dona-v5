// The fixture builder for the isolation cases. **One place**, because the slices that create these
// tables extend it once rather than five call sites: 1.9 brings building · space · unit, 2.1 brings
// party · party_contact, 2.2 brings tenancy · tenancy_party.
//
// Column lists are the workbook's (docs/model/, E1–E8), which is a specification and not a
// description. Only the columns these cases actually turn on are named; `Tenancy.terms_profile_id`
// is a NOT NULL foreign key in the workbook and is deliberately absent, because TermsProfile is not
// modelled anywhere yet — the slice that creates the table adds it here, and the failure until then
// is a not-null violation in one file rather than a mystery in four.
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

export async function seedUnit(
  db: Queryable,
  unitNumber: string,
): Promise<string> {
  const buildingId = newId();
  const unitId = newId();
  await db.query(
    `INSERT INTO building (building_id, name, address_line, city, handover_date,
                           warranty_end_date, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      buildingId,
      'Shoham — Rakefet 12',
      'Rakefet 12',
      'Shoham',
      '2026-01-01',
      '2027-01-01',
      'ACTIVE',
    ],
  );
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
  await db.query(
    `INSERT INTO tenancy (tenancy_id, unit_id, start_date, end_date, status)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      tenancyId,
      unitId,
      spec.tenancyFrom,
      spec.tenancyTo,
      spec.status ?? 'ACTIVE',
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
