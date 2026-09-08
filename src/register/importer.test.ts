// The register importer's two properties, asserted against a real Postgres. Slice 2.4.
//
//   1. **The same file applied twice leaves the same rows, with the same ids.**
//   2. **A malformed row is reported with its line number, and the file continues.**
//
// Shaped like src/estate/importer.test.ts (1.11) and for its reasons: these cases run in a
// rolled-back transaction against a database other suites are using at the same moment, so
// **nothing here counts a whole table**. Every query is scoped to the fixture's own cities, which no
// other suite uses. The first version of the estate suite counted tables, passed locally, and went
// red in CI within the hour.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { PoolClient } from 'pg';
import {
  inRolledBackTransaction,
  migratedPoolOrNull,
  skipReason,
} from '../kernel/pg-support.ts';
import type { ScopeActor } from '../scope/contract.ts';
import { resolveUnitsByPhone } from '../scope/contract.ts';
import { importRegister } from './contract.ts';
import {
  BROKEN_CITY,
  brokenFixture,
  REGISTER_CITIES,
  registerFixture,
} from './fixtures/load.ts';

const CITIES = [...REGISTER_CITIES];

// Named, so the audit rows this suite writes are its own. src/kernel/audit.test.ts writes committed
// rows on a pool concurrently, and 2.3's evidence records a probe finding assertions that read the
// whole table (tasks/evidence/2.3.md).
const ACTOR: ScopeActor = { actorKind: 'staff', actorId: 'register-test' };

/** Every id the fixture creates, in one ordered list. The strong half of "the re-run changed nothing". */
async function idsIn(db: PoolClient, cities: string[]): Promise<string[]> {
  const result = await db.query<{ id: string }>(
    `SELECT b.building_id AS id FROM building b WHERE b.city = ANY($1)
     UNION ALL
     SELECT u.unit_id FROM unit u
       JOIN space s ON s.space_id = u.unit_id
       JOIN building b ON b.building_id = s.building_id
      WHERE b.city = ANY($1)
     UNION ALL
     SELECT t.tenancy_id FROM tenancy t
       JOIN space s ON s.space_id = t.unit_id
       JOIN building b ON b.building_id = s.building_id
      WHERE b.city = ANY($1)
     UNION ALL
     SELECT DISTINCT tp.party_id FROM tenancy_party tp
       JOIN tenancy t ON t.tenancy_id = tp.tenancy_id
       JOIN space s ON s.space_id = t.unit_id
       JOIN building b ON b.building_id = s.building_id
      WHERE b.city = ANY($1)
     ORDER BY id`,
    [cities],
  );
  return result.rows.map((row) => row.id);
}

async function scalar(
  db: PoolClient,
  sql: string,
  params: unknown[],
): Promise<string> {
  const result = await db.query<{ n: string }>(sql, params);
  return result.rows[0]?.n ?? '';
}

describe('register · the file runs twice', () => {
  it('is a no-op the second time, down to the ids', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await t.test('the first run creates and rejects nothing', async () => {
        await inRolledBackTransaction(pool, async (db) => {
          const first = await importRegister(db, registerFixture());
          assert.deepEqual(first.rejects, []);
          assert.equal(first.lines, 9);
          assert.equal(first.accepted, 9);
          // Nine lines, and the row counts are not nine: buildings and units repeat across lines
          // and converge through their natural keys, which is the whole reason the keys exist.
          assert.deepEqual(first.counts, {
            project: { created: 1, updated: 6 },
            building: { created: 2, updated: 7 },
            space: { created: 15, updated: 12 },
            unit: { created: 5, updated: 4 },
            terms_profile: { created: 2, updated: 7 },
            party: { created: 8, updated: 1 },
            party_contact: { created: 8, updated: 1 },
            tenancy: { created: 6, updated: 3 },
            tenancy_party: { created: 9, updated: 0 },
          });
        });
      });

      await t.test('the second run creates nothing at all', async () => {
        await inRolledBackTransaction(pool, async (db) => {
          await importRegister(db, registerFixture());
          const before = await idsIn(db, CITIES);

          const second = await importRegister(db, registerFixture());
          assert.deepEqual(second.rejects, []);
          for (const [table, count] of Object.entries(second.counts)) {
            assert.equal(count.created, 0, `${table} created ${count.created}`);
          }
          // `created: 0` is the weak half. The ids staying still is the strong half: a re-import
          // that renumbered every unit would satisfy a count and break everything that ever
          // pointed at one.
          assert.deepEqual(await idsIn(db, CITIES), before);
        });
      });

      // The key this slice chose, doing the work it was chosen for. Row 2 and row 9 are the same
      // person under the two spellings a spreadsheet produces, in two cities, on two tenancies.
      await t.test(
        'one ת.ז. under two spellings is one party on two tenancies',
        async () => {
          await inRolledBackTransaction(pool, async (db) => {
            await importRegister(db, registerFixture());
            const parties = await scalar(
              db,
              `SELECT count(*)::text AS n FROM party
                WHERE national_id_key = 'PERSON:071500001'`,
              [],
            );
            assert.equal(parties, '1', 'one person, not two');
            const tenancies = await scalar(
              db,
              `SELECT count(*)::text AS n FROM tenancy_party tp
                 JOIN party p ON p.party_id = tp.party_id
                WHERE p.national_id_key = 'PERSON:071500001'`,
              [],
            );
            assert.equal(tenancies, '2', 'on two tenancies');
          });
        },
      );

      // The case the whole system exists to make representable, arriving through an import rather
      // than through a hand-written fixture: one number, two people, in turn and never at once.
      //
      // **The first draft of this case asserted the wrong thing** and the database said so: it
      // expected the earlier holder to resolve to their own unit on a day inside their contact
      // period, and got nothing. The earlier tenancy is `ENDED`, and the isolation join reads
      // `status = 'ACTIVE'` — so a number whose only tenancy has ended resolves to **nobody**, which
      // is the property, not a gap. Asserting it the wrong way round would have made this case pass
      // for a reason that has nothing to do with recycling.
      await t.test(
        'a recycled number reaches the right household',
        async () => {
          await inRolledBackTransaction(pool, async (db) => {
            await importRegister(db, registerFixture());
            const holders = await scalar(
              db,
              `SELECT count(*)::text AS n FROM party_contact
              WHERE channel = 'PHONE' AND value = '+972582010005'`,
              [],
            );
            assert.equal(holders, '2', 'two parties held it in turn');

            // Asked through src/scope/'s own join and never through a copy of it (guard two).
            const ask = (on: string) =>
              resolveUnitsByPhone(
                db,
                '058-201-0005',
                new Date(`${on}T00:00:00Z`),
                {
                  actor: ACTOR,
                },
              );

            // Inside the first holder's contact period, on a tenancy that has ended: a vacancy, and
            // the number reaches nothing. This is the row 2.5's *Done when* calls "one ended tenancy
            // reading as a vacancy", arriving here through the importer that will carry it.
            assert.deepEqual(await ask('2024-06-01'), []);

            // After the number was reassigned: exactly one unit, and it is the new holder's own.
            const now = await ask('2026-06-01');
            assert.equal(now.length, 1);
            assert.equal(now[0]?.unit_number, '5');
            const holder = await scalar(
              db,
              `SELECT p.national_id_key AS n FROM party p WHERE p.party_id = $1`,
              [now[0]?.party_id],
            );
            assert.equal(
              holder,
              'PERSON:071500006',
              'the new holder, and never the previous one',
            );

            // And the previous holder is still reachable as history — the row was not overwritten,
            // which is R5: a unit accumulates tenancies and never overwrites them.
            const previous = await scalar(
              db,
              `SELECT count(*)::text AS n FROM party WHERE national_id_key = 'PERSON:071500005'`,
              [],
            );
            assert.equal(previous, '1', 'and the leading zero was restored');
          });
        },
      );

      // Foundation rule 7, arriving through the import path that does not exist. The row is stored
      // — a guarantor is on the lease — and resolves to nothing at the front door.
      await t.test('a guarantor is imported and reaches no unit', async () => {
        await inRolledBackTransaction(pool, async (db) => {
          await importRegister(db, registerFixture());
          const guarantors = await scalar(
            db,
            `SELECT count(*)::text AS n FROM tenancy_party
              WHERE role = 'GUARANTOR' AND is_service_contact = false`,
            [],
          );
          assert.equal(guarantors >= '1', true);
          const reached = await resolveUnitsByPhone(
            db,
            '0582010003',
            new Date('2026-01-01T00:00:00Z'),
            { actor: ACTOR },
          );
          assert.deepEqual(reached, []);
        });
      });
    } finally {
      await pool.end();
    }
  });
});

describe('register · a broken file is reported, not refused', () => {
  it('names the line and imports everything else', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await inRolledBackTransaction(pool, async (db) => {
        const report = await importRegister(db, brokenFixture());

        // Every reject, by the line of the file it came from. Line 2 and line 12 are the good rows
        // that bracket the defects, and their absence here is the claim: **the file continued.**
        const byLine = new Map<number, string[]>();
        for (const reject of report.rejects) {
          byLine.set(reject.line, [
            ...(byLine.get(reject.line) ?? []),
            reject.reason,
          ]);
        }
        assert.deepEqual(
          [...byLine.keys()].sort((a, b) => a - b),
          [3, 4, 5, 6, 7, 8, 9, 10, 11],
        );
        assert.equal(report.lines, 11);
        assert.equal(report.accepted, 2);

        const reasonOn = (line: number): string =>
          (byLine.get(line) ?? []).join(' | ');
        assert.match(reasonOn(3), /national_id is required/);
        assert.match(reasonOn(4), /phone is not a number/);
        assert.match(reasonOn(5), /tenancy_end .* is before tenancy_start/);
        assert.match(reasonOn(6), /role .* is not one of/);
        assert.match(reasonOn(7), /terms_profile is required/);
        assert.match(reasonOn(8), /expected 22 columns, found 21/);
        assert.match(reasonOn(9), /guarantor_is_never_a_service_contact/);
        assert.match(reasonOn(10), /one_active_tenancy_per_unit/);
        assert.match(reasonOn(11), /contact_value_resolves_to_one_party/);

        // The four the database refused, which are the ones the savepoint exists for. Without it
        // the first of them poisons the transaction and lines 10 to 12 fail with 25P02 — a report
        // that says "failing whole" in nine different ways.
        const fromTheDatabase = report.rejects.filter(
          (reject) => reject.stage === 'write',
        );
        assert.deepEqual(
          fromTheDatabase.map((reject) => reject.line),
          [9, 10, 11],
        );
        assert.deepEqual(
          fromTheDatabase.map((reject) => reject.sqlstate),
          ['23514', '23P01', '23P01'],
        );

        // And the rows that were fine are in the database, including the last one.
        const landed = await db.query<{ unit_number: string }>(
          `SELECT u.unit_number FROM unit u
             JOIN space s ON s.space_id = u.unit_id
             JOIN building b ON b.building_id = s.building_id
            WHERE b.city = $1
            ORDER BY u.unit_number`,
          [BROKEN_CITY],
        );
        assert.deepEqual(
          landed.rows.map((row) => row.unit_number),
          ['1', '9'],
        );
      });
    } finally {
      await pool.end();
    }
  });

  // A reject is a log line the moment anything reads it, so SPEC.md's "PII never in logs" applies
  // to one. The line number is how a row is pointed at; the person on it is never quoted back.
  it('never echoes a person into a reason', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await inRolledBackTransaction(pool, async (db) => {
        const report = await importRegister(db, brokenFixture());
        const text = report.rejects.map((reject) => reject.reason).join('\n');
        for (const secret of [
          'בלי תעודה',
          'ערב ששומע הכל',
          '072600001',
          '582600003',
          '058-260-0001',
        ]) {
          assert.equal(
            text.includes(secret),
            false,
            `a reject quoted ${secret.slice(0, 3)}…`,
          );
        }
      });
    } finally {
      await pool.end();
    }
  });
});
