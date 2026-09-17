// POLICY CASE — an office roll of lettings in a Building is not a dump of identifiers,
// and it is not a roll of ערבים.
//
// #122. The command is tenancy's; the constraints are not judgements a model may make.
// Written red first: the first run failed because `listActiveLettingsInBuilding` was not
// on the contract.
//
// **Its own Building**, never the policy fixture's shared Rakefet 12. That address is where
// every isolation seed lands, and a roll of who is let there today would be a count of the
// local portfolio rather than of this case.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { PoolClient } from 'pg';
import { fixedClock } from '../../src/kernel/clock.ts';
import { hasIdentifierRun } from '../../src/kernel/identifier.ts';
import { newId } from '../../src/kernel/ids.ts';
import { listActiveLettingsInBuilding } from '../../src/tenancy/contract.ts';
import { seedExtractedIdentifier } from './fixtures.ts';
import {
  inRolledBackTransaction,
  POLICY_RELATIONS,
  pendingUntilSchema,
  policyPool,
  skipReason,
} from './support.ts';

const TODAY = fixedClock(new Date('2026-09-17T09:00:00.000Z'));
const TENANT_PHONE = '+972501221001';
const GUARANTOR_PHONE = '+972501221002';

function anIdentifier(): string {
  const digits = crypto.randomUUID().replace(/\D/g, '');
  return digits.slice(-9).padStart(9, '7');
}

const SHAPE = ['end_date', 'party_names', 'start_date', 'unit_name'];

async function seedRollBuilding(
  db: PoolClient,
): Promise<{ buildingId: string; unitId: string; tenancyId: string }> {
  const buildingId = newId();
  const unitId = newId();
  const profileId = newId();
  const tenancyId = newId();
  await db.query(
    `INSERT INTO building (building_id, name, address_line, city, handover_date,
                           warranty_end_date, status)
     VALUES ($1, 'roll-building', $2, 'Shoham', '2020-01-01', '2022-01-01', 'ACTIVE')`,
    [buildingId, `Roll ${buildingId}`],
  );
  await db.query(
    `INSERT INTO space (space_id, building_id, space_kind, name)
     VALUES ($1, $2, 'UNIT', 'דירה 1')`,
    [unitId, buildingId],
  );
  await db.query(
    `INSERT INTO unit (unit_id, unit_number, rooms, has_mamad, condition_status)
     VALUES ($1, '1', 3.5, true, 'READY')`,
    [unitId],
  );
  await db.query(
    `INSERT INTO terms_profile (terms_profile_id, name) VALUES ($1, $2)`,
    [profileId, `roll-${profileId}`],
  );
  await db.query(
    `INSERT INTO tenancy (tenancy_id, unit_id, start_date, end_date, status, terms_profile_id)
     VALUES ($1, $2, '2026-01-01', '2027-01-01', 'ACTIVE', $3)`,
    [tenancyId, unitId, profileId],
  );
  return { buildingId, unitId, tenancyId };
}

async function addPerson(
  db: PoolClient,
  tenancyId: string,
  name: string,
  role: string,
  isServiceContact: boolean,
  extras: { nationalId?: string; phone?: string } = {},
): Promise<string> {
  const partyId = newId();
  await db.query(
    `INSERT INTO party (party_id, party_kind, full_name, national_id, preferred_language)
     VALUES ($1, 'PERSON', $2, $3, 'he')`,
    [partyId, name, extras.nationalId ?? null],
  );
  if (extras.phone) {
    await db.query(
      `INSERT INTO party_contact (contact_id, party_id, channel, value, is_primary,
                                  valid_from, valid_to)
       VALUES ($1, $2, 'PHONE', $3, true, '2026-01-01', NULL)`,
      [newId(), partyId, extras.phone],
    );
  }
  await db.query(
    `INSERT INTO tenancy_party (tenancy_id, party_id, role, is_service_contact)
     VALUES ($1, $2, $3, $4)`,
    [tenancyId, partyId, role, isServiceContact],
  );
  return partyId;
}

describe('policy · active lettings in a Building carry no identifier', () => {
  it('is a shape the identifier guard actually recognises', () => {
    for (let i = 0; i < 200; i++) {
      const value = anIdentifier();
      assert.equal(value.length, 9);
      assert.ok(hasIdentifierRun(value), value);
    }
  });

  it('returns names and dates, never a ת.ז., phone, rent or captured field', async (t) => {
    const pool = await policyPool();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await pendingUntilSchema(t, POLICY_RELATIONS, () =>
        inRolledBackTransaction(pool, async (db) => {
          const onParty = anIdentifier();
          const onPaper = anIdentifier();
          const { buildingId, unitId, tenancyId } = await seedRollBuilding(db);
          await addPerson(db, tenancyId, 'יעל כהן', 'PRIMARY_TENANT', true, {
            nationalId: onParty,
            phone: TENANT_PHONE,
          });
          await seedExtractedIdentifier(db, unitId, onPaper);

          const rows = await listActiveLettingsInBuilding(
            db,
            buildingId,
            TODAY,
          );
          assert.equal(rows.length, 1);
          const body = JSON.stringify(rows);
          assert.equal(hasIdentifierRun(body), false, body);
          assert.equal(body.includes(onParty), false);
          assert.equal(body.includes(onPaper), false);
          assert.equal(body.includes(TENANT_PHONE), false);
          assert.equal(body.includes('rent'), false);
          assert.deepEqual(Object.keys(rows[0] ?? {}).sort(), SHAPE);
        }),
      );
    } finally {
      await pool.end();
    }
  });
});

describe('policy · an ערב is not a name on the Building roll', () => {
  it('names every other role and omits the guarantor', async (t) => {
    const pool = await policyPool();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await pendingUntilSchema(t, POLICY_RELATIONS, () =>
        inRolledBackTransaction(pool, async (db) => {
          const { buildingId, tenancyId } = await seedRollBuilding(db);
          await addPerson(db, tenancyId, 'יעל כהן', 'PRIMARY_TENANT', true, {
            phone: TENANT_PHONE,
          });
          await addPerson(db, tenancyId, 'שותף בדירה', 'CO_TENANT', true);
          await addPerson(db, tenancyId, 'דייר נוסף', 'OCCUPANT', false);
          await addPerson(db, tenancyId, 'רותם ערב', 'GUARANTOR', false, {
            phone: GUARANTOR_PHONE,
          });

          const rows = await listActiveLettingsInBuilding(
            db,
            buildingId,
            TODAY,
          );
          assert.equal(rows.length, 1);
          const names = rows[0]?.party_names ?? [];
          assert.deepEqual(names, ['יעל כהן', 'שותף בדירה', 'דייר נוסף']);
          assert.equal(JSON.stringify(rows).includes(GUARANTOR_PHONE), false);
        }),
      );
    } finally {
      await pool.end();
    }
  });
});
