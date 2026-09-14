// Slice 6.5. `countIdentifierOverlap` — which of a flat's lettings already hold one of the people
// this lease names, asked of a declared identifier and never of a name (SPEC-flows.md A2 step 5).
//
// **Written red first**, before `0027_party_national_id_key.sql` existed: the first run failed with
// `42883 function party_national_id_key(unknown, text) does not exist`, which is the failure that
// proves the normalisation is the database's and not this file's.
//
// The cases that matter are the ones a spreadsheet and a person produce: a hyphen, a space, a
// leading zero somebody's export dropped. All three must find the same party, because that is what
// `party.national_id_key` was generated for at 2.4 and this read is the second caller of that fold.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { PoolClient } from 'pg';
import { newId } from '../kernel/ids.ts';
import {
  inRolledBackTransaction,
  migratedPoolOrNull,
  skipReason,
} from '../kernel/pg-support.ts';
import { countIdentifierOverlap } from './contract.ts';

/**
 * **A ת.ז. no other run is holding.** Slice 6.5.
 *
 * `party_natural_key` is a UNIQUE index, so a fixture that hard-codes an identifier is a fixture
 * that fails the moment anything else in the database already holds it — which is exactly what
 * happened here, against rows a walk on `:3000` had left behind. Nine digits derived from a fresh
 * UUIDv7's random half are unique per run and still fold the way a real one does.
 */
function idNumber(): string {
  const digits = newId().replace(/\D/g, '');
  return digits.slice(-9).padStart(9, '1');
}

async function seedFlat(db: PoolClient): Promise<string> {
  const buildingId = newId();
  const unitId = newId();
  await db.query(
    `INSERT INTO building (building_id, name, address_line, city, handover_date,
                           warranty_end_date, status)
     VALUES ($1, 'overlap-building', $2, 'Shoham', '2020-01-01', '2022-01-01', 'ACTIVE')`,
    [buildingId, `Overlap ${buildingId}`],
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
  return unitId;
}

async function seedLetting(
  db: PoolClient,
  unitId: string,
  startDate: string,
): Promise<string> {
  const profileId = newId();
  const tenancyId = newId();
  await db.query(
    `INSERT INTO terms_profile (terms_profile_id, name) VALUES ($1, $2)`,
    [profileId, `overlap-${profileId}`],
  );
  await db.query(
    `INSERT INTO tenancy (tenancy_id, unit_id, start_date, end_date, status, terms_profile_id)
     VALUES ($1, $2, $3, '2099-01-01', 'DRAFT', $4)`,
    [tenancyId, unitId, startDate, profileId],
  );
  return tenancyId;
}

async function seedPerson(
  db: PoolClient,
  tenancyId: string,
  nationalId: string | null,
): Promise<string> {
  const partyId = newId();
  await db.query(
    `INSERT INTO party (party_id, party_kind, full_name, national_id, preferred_language)
     VALUES ($1, 'PERSON', 'פלוני אלמוני', $2, 'he')`,
    [partyId, nationalId],
  );
  await db.query(
    `INSERT INTO tenancy_party (tenancy_id, party_id, role, is_service_contact)
     VALUES ($1, $2, 'PRIMARY_TENANT', true)`,
    [tenancyId, partyId],
  );
  return partyId;
}

describe('tenancy · countIdentifierOverlap', () => {
  it('counts people, not rows, and normalises the probe the way the column was generated', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await inRolledBackTransaction(pool, async (db) => {
        const unitId = await seedFlat(db);
        const other = await seedFlat(db);
        const letting = await seedLetting(db, unitId, '2026-03-01');
        const second = await seedLetting(db, unitId, '2024-03-01');
        const elsewhere = await seedLetting(db, other, '2026-03-01');
        const first = idNumber();
        const yael = await seedPerson(db, letting, first);
        const alsoHere = idNumber();
        await seedPerson(db, letting, alsoHere);
        const elsewhereId = idNumber();
        await seedPerson(db, second, elsewhereId);
        // The same person, in a second flat — which is the whole point of keying on the identifier,
        // and the case that proves this read filters by unit rather than by party.
        await db.query(
          `INSERT INTO tenancy_party (tenancy_id, party_id, role, is_service_contact)
           VALUES ($1, $2, 'PRIMARY_TENANT', true)`,
          [elsewhere, yael],
        );

        // Both people on the first letting, one on the second, and the flat next door is not asked.
        const both = await countIdentifierOverlap(db, unitId, [
          first,
          alsoHere,
          elsewhereId,
        ]);
        assert.equal(both.get(letting), 2);
        assert.equal(both.get(second), 1);
        assert.equal(both.get(elsewhere), undefined);

        // The shapes a real document and a real export produce, all the same one person: the
        // separators somebody typed, and the leading zero a spreadsheet dropped.
        const zeroLed = await seedLetting(db, unitId, '2022-03-01');
        const dropped = `0${idNumber().slice(1)}`;
        await seedPerson(db, zeroLed, dropped);
        const spaced = `${first.slice(0, 3)}-${first.slice(3, 6)}-${first.slice(6)}`;
        for (const [probe, expected] of [
          [spaced, letting],
          [spaced.replaceAll('-', ' '), letting],
          [spaced.replaceAll('-', '.'), letting],
          [dropped.slice(1), zeroLed],
        ] as const) {
          const hit = await countIdentifierOverlap(db, unitId, [probe]);
          assert.equal(hit.get(expected), 1, `probe ${probe}`);
          assert.equal(
            hit.size,
            1,
            `probe ${probe} matched more than one letting`,
          );
        }

        // A ח.פ. is a different registry, so the same nine digits are a different legal person
        // and this read — which asks about people on a lease — must not find it.
        const company = newId();
        const companyId = idNumber();
        await db.query(
          `INSERT INTO party (party_id, party_kind, full_name, national_id, preferred_language)
           VALUES ($1, 'COMPANY', 'חברה בע״מ', $2, 'he')`,
          [company, companyId],
        );
        await db.query(
          `INSERT INTO tenancy_party (tenancy_id, party_id, role, is_service_contact)
           VALUES ($1, $2, 'GUARANTOR', false)`,
          [second, company],
        );
        const asPerson = await countIdentifierOverlap(db, unitId, [companyId]);
        assert.equal(asPerson.size, 0);
      });
    } finally {
      await pool.end();
    }
  });

  it('asks nothing when the lease declared no identifier', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await inRolledBackTransaction(pool, async (db) => {
        const unitId = await seedFlat(db);
        const letting = await seedLetting(db, unitId, '2026-03-01');
        const only = idNumber();
        await seedPerson(db, letting, null);
        await seedPerson(db, letting, only);

        const none = await countIdentifierOverlap(db, unitId, []);
        assert.equal(none.size, 0);
        // A party with no identifier has no natural key, so it can never be an overlap.
        const some = await countIdentifierOverlap(db, unitId, [only]);
        assert.equal(some.get(letting), 1);
      });
    } finally {
      await pool.end();
    }
  });
});
