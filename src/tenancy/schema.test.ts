// Contract tests for E7 and E8 — the join between a unit and the people in it, in time.
//
// These assert against a real Postgres, through the DDL in src/kernel/migrations/0007_tenancy.sql,
// because every claim here is a claim about what the database refuses. An application-level check
// would prove that this file and that file agree, which is not the constraint (1.9's note, and it
// holds hardest for the guarantor rule: `is_service_contact` is a database constraint precisely so
// there is no code path anybody can be persuaded to change).
//
// The column lists are the workbook's FIELDS sheet (docs/model/, E7–E8). A migration that drifts
// from it turns this suite red, which is the point: the workbook is a specification, and a
// specification nothing reads is a description.
//
// **Every rejection below was proved red first** against the same DDL with only its own constraint
// removed, with the SQLSTATE recorded in tasks/evidence/2.2.md. A constraint test that has never
// been red asserts what the code already did (docs/pipeline.md §10).
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { PoolClient } from 'pg';
import { newId } from '../kernel/ids.ts';
import {
  inRolledBackTransaction,
  migratedPoolOrNull,
  skipReason,
} from '../kernel/pg-support.ts';
import { listTermsProfiles } from './contract.ts';

// Postgres SQLSTATEs. Asserting the class and not merely "it threw" is what stops a typo in a
// fixture from reading as a constraint doing its job.
const FOREIGN_KEY_VIOLATION = '23503';
const CHECK_VIOLATION = '23514';
const UNIQUE_VIOLATION = '23505';
const EXCLUSION_VIOLATION = '23P01';
const RESTRICT_VIOLATION = '23001';

/**
 * Asserts the statement is rejected with a named SQLSTATE, and leaves the transaction usable.
 *
 * A failed statement aborts the enclosing transaction, so every case making more than one assertion
 * after a rejection needs the savepoint — without it the second assertion fails with 25P02 and says
 * nothing about the constraint it was written for. Copied in shape from src/parties/schema.test.ts;
 * a shared helper is worth extracting when a third module needs it.
 */
async function rejects(
  db: PoolClient,
  sqlstate: string,
  statement: () => Promise<unknown>,
): Promise<void> {
  await db.query('SAVEPOINT attempt');
  try {
    await statement();
    await db.query('ROLLBACK TO SAVEPOINT attempt');
    assert.fail(`expected SQLSTATE ${sqlstate}, but the statement succeeded`);
  } catch (error) {
    await db.query('ROLLBACK TO SAVEPOINT attempt');
    const code = (error as { code?: string }).code;
    assert.equal(
      code,
      sqlstate,
      `expected SQLSTATE ${sqlstate}, got ${code ?? 'no code'}: ${(error as Error).message}`,
    );
  }
}

interface Estate {
  unitId: string;
  profileId: string;
}

/** One building, one unit, one terms profile — the minimum a tenancy needs to exist. */
async function seedEstate(db: PoolClient): Promise<Estate> {
  const buildingId = newId();
  const unitId = newId();
  const profileId = newId();
  await db.query(
    `INSERT INTO building (building_id, name, address_line, city, handover_date,
                           warranty_end_date, status)
     VALUES ($1, 'Shoham — Rakefet 12', 'Rakefet 12', 'Shoham', '2026-01-01',
             '2027-01-01', 'ACTIVE')`,
    [buildingId],
  );
  await db.query(
    `INSERT INTO space (space_id, building_id, space_kind, name)
     VALUES ($1, $2, 'UNIT', 'Apartment 12')`,
    [unitId, buildingId],
  );
  await db.query(
    `INSERT INTO unit (unit_id, unit_number, rooms, has_mamad, condition_status)
     VALUES ($1, '12', 3.5, true, 'READY')`,
    [unitId],
  );
  await db.query(
    `INSERT INTO terms_profile (terms_profile_id, name) VALUES ($1, 'דירה להשכיר — standard annex')`,
    [profileId],
  );
  return { unitId, profileId };
}

interface TenancySpec {
  unitId: string;
  profileId: string;
  from: string;
  to: string;
  status?: string;
  moveOut?: string;
}

function insertTenancy(db: PoolClient, spec: TenancySpec): Promise<unknown> {
  return db.query(
    `INSERT INTO tenancy (tenancy_id, unit_id, start_date, end_date, status,
                          terms_profile_id, notice_date, actual_move_out)
     VALUES ($1, $2, $3, $4, $5, $6, NULL, $7)`,
    [
      newId(),
      spec.unitId,
      spec.from,
      spec.to,
      spec.status ?? 'ACTIVE',
      spec.profileId,
      spec.moveOut ?? null,
    ],
  );
}

async function seedTenancy(db: PoolClient, spec: TenancySpec): Promise<string> {
  const tenancyId = newId();
  await db.query(
    `INSERT INTO tenancy (tenancy_id, unit_id, start_date, end_date, status, terms_profile_id)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      tenancyId,
      spec.unitId,
      spec.from,
      spec.to,
      spec.status ?? 'ACTIVE',
      spec.profileId,
    ],
  );
  return tenancyId;
}

async function insertParty(db: PoolClient, name: string): Promise<string> {
  const partyId = newId();
  await db.query(
    `INSERT INTO party (party_id, party_kind, full_name) VALUES ($1, 'PERSON', $2)`,
    [partyId, name],
  );
  return partyId;
}

async function columnsOf(db: PoolClient, table: string): Promise<string[]> {
  const result = await db.query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1
     ORDER BY column_name`,
    [table],
  );
  return result.rows.map((row) => row.column_name);
}

describe('tenancy · a guarantor is never a service contact', () => {
  it('is the rule this table exists for, and the schema holds it', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      // The gate for this rule is tests/policy/guarantor.test.ts — it is a thing no model may
      // decide, so it is a required check and not a module test. What is asserted here is the
      // schema's half: the constraint is on the table, and it is spelled the way E8 says.
      await t.test('the insert is rejected, not defaulted', async () => {
        await inRolledBackTransaction(pool, async (db) => {
          const estate = await seedEstate(db);
          const tenancyId = await seedTenancy(db, {
            ...estate,
            from: '2026-01-01',
            to: '2027-01-01',
          });
          const guarantorId = await insertParty(db, 'ערב');
          await rejects(db, CHECK_VIOLATION, () =>
            db.query(
              `INSERT INTO tenancy_party (tenancy_id, party_id, role, is_service_contact)
               VALUES ($1, $2, 'GUARANTOR', true)`,
              [tenancyId, guarantorId],
            ),
          );
          // And the ordinary case is representable: an ערב on the lease, unreachable.
          await db.query(
            `INSERT INTO tenancy_party (tenancy_id, party_id, role, is_service_contact)
             VALUES ($1, $2, 'GUARANTOR', false)`,
            [tenancyId, guarantorId],
          );
        });
      });

      await t.test('and an update cannot flip it either', async () => {
        await inRolledBackTransaction(pool, async (db) => {
          // The way a CHECK differs from a form default: there is no later moment at which it
          // stops applying. A co-tenant promoted to guarantor takes the rule with them.
          const estate = await seedEstate(db);
          const tenancyId = await seedTenancy(db, {
            ...estate,
            from: '2026-01-01',
            to: '2027-01-01',
          });
          const partyId = await insertParty(
            db,
            'a co-tenant who becomes an ערב',
          );
          await db.query(
            `INSERT INTO tenancy_party (tenancy_id, party_id, role, is_service_contact)
             VALUES ($1, $2, 'CO_TENANT', true)`,
            [tenancyId, partyId],
          );
          await rejects(db, CHECK_VIOLATION, () =>
            db.query(
              `UPDATE tenancy_party SET role = 'GUARANTOR' WHERE party_id = $1`,
              [partyId],
            ),
          );
        });
      });
    } finally {
      await pool.end();
    }
  });
});

describe('tenancy · the occupancy window', () => {
  it('lets one unit have one active household at a time', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      // Two active tenancies overlapping means Q1 — who lives in unit 12 today — returns two
      // households for one apartment, which is the mirror of 2.1's two-units-for-one-number.
      await t.test('and rejects an overlap of even one day', async () => {
        await inRolledBackTransaction(pool, async (db) => {
          const estate = await seedEstate(db);
          await insertTenancy(db, {
            ...estate,
            from: '2026-01-01',
            to: '2026-06-30',
          });
          await rejects(db, EXCLUSION_VIOLATION, () =>
            insertTenancy(db, {
              ...estate,
              from: '2026-06-30',
              to: '2027-01-01',
            }),
          );
          // One day later is a different day, and the handover is the ordinary case.
          await insertTenancy(db, {
            ...estate,
            from: '2026-07-01',
            to: '2027-01-01',
          });
        });
      });

      // **The reason the constraint is partial, and the case that decided it.** A tenant who leaves
      // in June on a lease running to December keeps the contractual end_date; actual_move_out is
      // where reality goes. The next tenancy starting in August is correct history, and a blanket
      // constraint would reject it.
      await t.test('while a history may overlap, because it must', async () => {
        await inRolledBackTransaction(pool, async (db) => {
          const estate = await seedEstate(db);
          await insertTenancy(db, {
            ...estate,
            from: '2026-01-01',
            to: '2026-12-31',
            status: 'TERMINATED_EARLY',
            moveOut: '2026-06-30',
          });
          await insertTenancy(db, {
            ...estate,
            from: '2026-08-01',
            to: '2027-08-01',
          });
          // An ENDED tenancy is the same argument, and a DRAFT one is a lease being negotiated for
          // dates the current tenant has not vacated yet.
          await insertTenancy(db, {
            ...estate,
            from: '2027-01-01',
            to: '2027-06-30',
            status: 'DRAFT',
          });
        });
      });

      // The importer's key (slice 2.4). It covers every status, where the exclusion constraint
      // covers only ACTIVE — so a re-run cannot duplicate a draft or an ended lease either.
      await t.test(
        'one lease per unit per start date, in any status',
        async () => {
          await inRolledBackTransaction(pool, async (db) => {
            const estate = await seedEstate(db);
            await insertTenancy(db, {
              ...estate,
              from: '2026-01-01',
              to: '2026-06-30',
              status: 'DRAFT',
            });
            await rejects(db, UNIQUE_VIOLATION, () =>
              insertTenancy(db, {
                ...estate,
                from: '2026-01-01',
                to: '2027-01-01',
                status: 'DRAFT',
              }),
            );
          });
        },
      );
    } finally {
      await pool.end();
    }
  });
});

describe('tenancy · the rest of the schema', () => {
  it('holds the vocabularies, the periods and the references', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await t.test('status and role are closed sets', async () => {
        await inRolledBackTransaction(pool, async (db) => {
          const estate = await seedEstate(db);
          for (const status of ['DRAFT', 'ENDED', 'TERMINATED_EARLY']) {
            await insertTenancy(db, {
              ...estate,
              from: `2020-01-0${['DRAFT', 'ENDED', 'TERMINATED_EARLY'].indexOf(status) + 1}`,
              to: '2021-01-01',
              status,
            });
          }
          await rejects(db, CHECK_VIOLATION, () =>
            insertTenancy(db, {
              ...estate,
              from: '2026-01-01',
              to: '2027-01-01',
              status: 'HOLDING_OVER',
            }),
          );

          const tenancyId = await seedTenancy(db, {
            ...estate,
            from: '2026-01-01',
            to: '2027-01-01',
          });
          for (const role of ['PRIMARY_TENANT', 'CO_TENANT', 'OCCUPANT']) {
            const partyId = await insertParty(db, `a ${role}`);
            await db.query(
              `INSERT INTO tenancy_party (tenancy_id, party_id, role, is_service_contact)
               VALUES ($1, $2, $3, true)`,
              [tenancyId, partyId, role],
            );
          }
          const subletter = await insertParty(db, 'a subletter');
          await rejects(db, CHECK_VIOLATION, () =>
            db.query(
              `INSERT INTO tenancy_party (tenancy_id, party_id, role, is_service_contact)
               VALUES ($1, $2, 'SUBLETTER', true)`,
              [tenancyId, subletter],
            ),
          );
        });
      });

      // **The CHECK earns its place twice, and the probe found the second one.** On an ACTIVE row
      // an inverted period fails inside the exclusion constraint's daterange() constructor as a
      // bare 22000 with no constraint name — the CHECK is what makes it a named 23514 an importer
      // can report against a line number. On a DRAFT or ENDED row the partial index does not apply
      // at all, so the CHECK is the *only* thing standing between the table and a lease that ends
      // before it starts. Measured at 2.2, not assumed.
      await t.test(
        'a period must be ordered, whatever its status',
        async () => {
          await inRolledBackTransaction(pool, async (db) => {
            const estate = await seedEstate(db);
            for (const status of ['ACTIVE', 'DRAFT', 'ENDED']) {
              await rejects(db, CHECK_VIOLATION, () =>
                insertTenancy(db, {
                  ...estate,
                  from: '2027-01-01',
                  to: '2026-01-01',
                  status,
                }),
              );
            }
            // Equal is ordered: a tenancy of exactly one day is a real thing.
            await insertTenancy(db, {
              ...estate,
              from: '2026-08-01',
              to: '2026-08-01',
            });
          });
        },
      );

      await t.test('reality may not precede the lease', async () => {
        await inRolledBackTransaction(pool, async (db) => {
          const estate = await seedEstate(db);
          await rejects(db, CHECK_VIOLATION, () =>
            insertTenancy(db, {
              ...estate,
              from: '2026-01-01',
              to: '2027-01-01',
              moveOut: '2025-12-31',
            }),
          );
          // A move-out *after* the contractual end is ordinary — a tenant who overstays — so only
          // the lower bound is stated.
          await insertTenancy(db, {
            ...estate,
            from: '2026-01-01',
            to: '2027-01-01',
            moveOut: '2027-03-01',
          });
        });
      });

      await t.test(
        'a tenancy hangs on a unit and a terms profile',
        async () => {
          await inRolledBackTransaction(pool, async (db) => {
            const estate = await seedEstate(db);
            await rejects(db, FOREIGN_KEY_VIOLATION, () =>
              insertTenancy(db, {
                ...estate,
                unitId: newId(),
                from: '2026-01-01',
                to: '2027-01-01',
              }),
            );
            await rejects(db, FOREIGN_KEY_VIOLATION, () =>
              insertTenancy(db, {
                ...estate,
                profileId: newId(),
                from: '2026-01-01',
                to: '2027-01-01',
              }),
            );
          });
        },
      );

      await t.test('a role on a lease names a party that exists', async () => {
        await inRolledBackTransaction(pool, async (db) => {
          const estate = await seedEstate(db);
          const tenancyId = await seedTenancy(db, {
            ...estate,
            from: '2026-01-01',
            to: '2027-01-01',
          });
          await rejects(db, FOREIGN_KEY_VIOLATION, () =>
            db.query(
              `INSERT INTO tenancy_party (tenancy_id, party_id, role, is_service_contact)
               VALUES ($1, $2, 'PRIMARY_TENANT', true)`,
              [tenancyId, newId()],
            ),
          );
          const partyId = await insertParty(db, 'דנה כהן');
          await db.query(
            `INSERT INTO tenancy_party (tenancy_id, party_id, role, is_service_contact)
             VALUES ($1, $2, 'PRIMARY_TENANT', true)`,
            [tenancyId, partyId],
          );
          // One party holds one role on one tenancy: the workbook's composite key.
          await rejects(db, UNIQUE_VIOLATION, () =>
            db.query(
              `INSERT INTO tenancy_party (tenancy_id, party_id, role, is_service_contact)
               VALUES ($1, $2, 'CO_TENANT', true)`,
              [tenancyId, partyId],
            ),
          );
        });
      });

      // The workbook is a specification. A migration that drifts from it turns this red, which is
      // the only thing that makes that sentence true.
      await t.test('the columns are the workbook’s E7 and E8', async () => {
        await inRolledBackTransaction(pool, async (db) => {
          assert.deepEqual(await columnsOf(db, 'tenancy'), [
            'actual_move_out',
            'end_date',
            'notice_date',
            'option_end_date',
            'parking_kind',
            'parking_space_id',
            'rent_amount',
            'rent_currency',
            'start_date',
            'status',
            'storage_kind',
            'storage_space_id',
            'tenancy_id',
            'terms_profile_id',
            'unit_id',
          ]);
          assert.deepEqual(await columnsOf(db, 'tenancy_party'), [
            'is_service_contact',
            'party_id',
            'role',
            'tenancy_id',
          ]);
          assert.deepEqual(await columnsOf(db, 'terms_profile'), [
            'name',
            'terms_profile_id',
          ]);
        });
      });

      // **There was a money case here, and it is deleted.** It asserted that no column on
      // `tenancy`, `tenancy_party` or `terms_profile` was named for an amount, under foundation
      // rule 2. That rule is retired (docs/decisions/ADR-0008-money-is-ordinary-data.md) and
      // nothing replaces the case. Track B (#132) adds `rent_amount`, `rent_currency` and
      // `option_end_date` because code will branch on them; the `columnsOf` assertions directly
      // above are exact, so a fourth column arriving here is still a red build whatever it is named.

      // Foundation rule 1: the scope is a view, never a column. Guard one greps the migrations for
      // `current_tenant`; this asserts the shipped schema from the other side.
      await t.test('and no column names the current tenant', async () => {
        await inRolledBackTransaction(pool, async (db) => {
          const leaked = await db.query(
            `SELECT table_name, column_name FROM information_schema.columns
             WHERE table_schema = 'public'
               AND table_name IN ('tenancy', 'tenancy_party', 'terms_profile', 'unit')
               AND column_name IN ('current_tenant', 'current_party_id', 'occupancy')`,
          );
          assert.deepEqual(leaked.rows, []);
        });
      });

      await t.test(
        'D3 · the assigned bay points at a PARKING space, never a lobby',
        async () => {
          await inRolledBackTransaction(pool, async (db) => {
            const estate = await seedEstate(db);
            const lobby = newId();
            const bay = newId();
            const building = await db.query<{ building_id: string }>(
              `SELECT s.building_id FROM space s WHERE s.space_id = $1`,
              [estate.unitId],
            );
            const buildingId = building.rows[0]?.building_id ?? '';
            await db.query(
              `INSERT INTO space (space_id, building_id, space_kind, name)
               VALUES ($1, $2, 'COMMON', 'לובי'), ($3, $2, 'PARKING', '574')`,
              [lobby, buildingId, bay],
            );
            const tenancyId = await seedTenancy(db, {
              ...estate,
              from: '2026-01-01',
              to: '2027-01-01',
            });
            await rejects(db, FOREIGN_KEY_VIOLATION, () =>
              db.query(
                `UPDATE tenancy SET parking_space_id = $2 WHERE tenancy_id = $1`,
                [tenancyId, lobby],
              ),
            );
            await db.query(
              `UPDATE tenancy SET parking_space_id = $2 WHERE tenancy_id = $1`,
              [tenancyId, bay],
            );
            const row = await db.query<{ parking_space_id: string }>(
              'SELECT parking_space_id FROM tenancy WHERE tenancy_id = $1',
              [tenancyId],
            );
            assert.equal(row.rows[0]?.parking_space_id, bay);
          });
        },
      );

      await t.test(
        'D3 · assigned storage points at a STORAGE space, never a lobby',
        async () => {
          await inRolledBackTransaction(pool, async (db) => {
            const estate = await seedEstate(db);
            const lobby = newId();
            const room = newId();
            const building = await db.query<{ building_id: string }>(
              `SELECT s.building_id FROM space s WHERE s.space_id = $1`,
              [estate.unitId],
            );
            const buildingId = building.rows[0]?.building_id ?? '';
            await db.query(
              `INSERT INTO space (space_id, building_id, space_kind, name)
               VALUES ($1, $2, 'COMMON', 'לובי'), ($3, $2, 'STORAGE', '601')`,
              [lobby, buildingId, room],
            );
            const tenancyId = await seedTenancy(db, {
              ...estate,
              from: '2026-01-01',
              to: '2027-01-01',
            });
            await rejects(db, FOREIGN_KEY_VIOLATION, () =>
              db.query(
                `UPDATE tenancy SET storage_space_id = $2 WHERE tenancy_id = $1`,
                [tenancyId, lobby],
              ),
            );
            await db.query(
              `UPDATE tenancy SET storage_space_id = $2 WHERE tenancy_id = $1`,
              [tenancyId, room],
            );
            const row = await db.query<{ storage_space_id: string }>(
              'SELECT storage_space_id FROM tenancy WHERE tenancy_id = $1',
              [tenancyId],
            );
            assert.equal(row.rows[0]?.storage_space_id, room);
          });
        },
      );
    } finally {
      await pool.end();
    }
  });
});

// ------------------------------------------------------------------------------------------------
// `terms_profile`'s natural key — `0009_import_natural_keys.sql`, slice 2.4.
//
// 2.2 landed the table with identity and one column, E1 `project`'s move at 1.9, and left the key to
// the slice with an importer that has to look a profile up idempotently. **Written red first**
// against `0008`, where the second insert is accepted and the register grows a second profile named
// `standard` on every run.
//
// Choosing the key is not the same question as *how many profiles are in force*, which is week 5's
// and is deliberately still open. What identifies one is all that was owed here.
// ------------------------------------------------------------------------------------------------

describe('tenancy · a terms profile is identified by its name', () => {
  it('is what makes a re-import find the profile rather than add one', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await t.test('one name is one profile', async () => {
        await inRolledBackTransaction(pool, async (db) => {
          await db.query(
            `INSERT INTO terms_profile (terms_profile_id, name) VALUES ($1, $2)`,
            [newId(), 'נספח תחזוקה — בדיקת סכימה'],
          );
          await rejects(db, UNIQUE_VIOLATION, () =>
            db.query(
              `INSERT INTO terms_profile (terms_profile_id, name) VALUES ($1, $2)`,
              [newId(), 'נספח תחזוקה — בדיקת סכימה'],
            ),
          );
        });
      });

      // Two profiles genuinely differ by name, and the key must not stand in the way of the second
      // one arriving at week 5.
      await t.test('two names are two profiles', async () => {
        await inRolledBackTransaction(pool, async (db) => {
          await db.query(
            `INSERT INTO terms_profile (terms_profile_id, name) VALUES ($1, $2)`,
            [newId(), 'נספח תחזוקה — בדיקת סכימה'],
          );
          await db.query(
            `INSERT INTO terms_profile (terms_profile_id, name) VALUES ($1, $2)`,
            [newId(), 'נספח תחזוקה — בדיקת סכימה מורחב'],
          );
        });
      });

      await t.test('listTermsProfiles returns names that exist', async () => {
        await inRolledBackTransaction(pool, async (db) => {
          const name = `נספח רשימה — ${newId().slice(24)}`;
          await db.query(
            `INSERT INTO terms_profile (terms_profile_id, name) VALUES ($1, $2)`,
            [newId(), name],
          );
          const names = await listTermsProfiles(db);
          assert.ok(names.includes(name));
        });
      });
    } finally {
      await pool.end();
    }
  });
});

describe('tenancy_event — append-only promotion log', () => {
  const EVENT_COLUMNS = [
    'tenancy_event_id',
    'tenancy_id',
    'at',
    'actor',
    'kind',
    'field',
    'old_value',
    'new_value',
    'source_document_id',
    'extracted_field_id',
  ];

  it('is a relation with the published log columns and no DEFAULT now()', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await inRolledBackTransaction(pool, async (db) => {
        await db.query('SELECT 1 FROM tenancy_event LIMIT 0');
        const result = await db.query<{ column_name: string }>(
          `SELECT column_name FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'tenancy_event'
            ORDER BY ordinal_position`,
        );
        assert.deepEqual(
          result.rows.map((row) => row.column_name),
          EVENT_COLUMNS,
        );
        const defaults = await db.query<{ column_default: string | null }>(
          `SELECT column_default FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'tenancy_event'
              AND column_name = 'at'`,
        );
        assert.equal(defaults.rows[0]?.column_default, null);
      });
    } finally {
      await pool.end();
    }
  });

  it('accepts terminated without paper and still refuses amended without paper', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await inRolledBackTransaction(pool, async (db) => {
        const estate = await seedEstate(db);
        const tenancyId = await seedTenancy(db, {
          ...estate,
          from: '2026-01-01',
          to: '2027-01-01',
        });
        await rejects(db, CHECK_VIOLATION, () =>
          db.query(
            `INSERT INTO tenancy_event (
               tenancy_event_id, tenancy_id, at, actor, kind, field,
               old_value, new_value, source_document_id, extracted_field_id
             ) VALUES ($1, $2, $3, 'אסף', 'amended', 'end_date',
                       '2027-01-01', '2028-01-01', NULL, NULL)`,
            [newId(), tenancyId, new Date('2026-09-07T09:00:00.000Z')],
          ),
        );
        await db.query(
          `INSERT INTO tenancy_event (
             tenancy_event_id, tenancy_id, at, actor, kind, field,
             old_value, new_value, source_document_id, extracted_field_id
           ) VALUES ($1, $2, $3, 'system', 'terminated', 'status',
                     'ACTIVE', 'ENDED', NULL, NULL)`,
          [newId(), tenancyId, new Date('2026-09-07T09:00:00.000Z')],
        );
        const typeId = newId();
        const documentId = newId();
        await db.query(
          `INSERT INTO document_type (
             document_type_id, type_key, label_he, label_en, verification_terms, is_active
           ) VALUES ($1, $2, 'חוזה', NULL, NULL, true)`,
          [typeId, `t43-event-${typeId.slice(24)}`],
        );
        await db.query(
          `INSERT INTO document (
             document_id, document_type_id, storage_uri, file_hash,
             ingested_at, verification_verdict
           ) VALUES ($1, $2, 'gs://x/a.pdf', $3, $4, 'unguarded')`,
          [
            documentId,
            typeId,
            `hash-${documentId}`,
            new Date('2026-09-07T09:00:00.000Z'),
          ],
        );
        await rejects(db, CHECK_VIOLATION, () =>
          db.query(
            `INSERT INTO tenancy_event (
               tenancy_event_id, tenancy_id, at, actor, kind, field,
               old_value, new_value, source_document_id, extracted_field_id
             ) VALUES ($1, $2, $3, 'system', 'terminated', 'status',
                       'ACTIVE', 'ENDED', $4, NULL)`,
            [
              newId(),
              tenancyId,
              new Date('2026-09-07T09:00:00.000Z'),
              documentId,
            ],
          ),
        );
        await db.query(
          `INSERT INTO tenancy_event (
             tenancy_event_id, tenancy_id, at, actor, kind, field,
             old_value, new_value, source_document_id, extracted_field_id
           ) VALUES ($1, $2, $3, 'אסף', 'activated', 'status',
                     'DRAFT', 'ACTIVE', NULL, NULL)`,
          [newId(), tenancyId, new Date('2026-09-07T09:00:00.000Z')],
        );
        await rejects(db, CHECK_VIOLATION, () =>
          db.query(
            `INSERT INTO tenancy_event (
               tenancy_event_id, tenancy_id, at, actor, kind, field,
               old_value, new_value, source_document_id, extracted_field_id
             ) VALUES ($1, $2, $3, 'אסף', 'activated', 'status',
                       'DRAFT', 'ACTIVE', $4, NULL)`,
            [
              newId(),
              tenancyId,
              new Date('2026-09-07T09:00:00.000Z'),
              documentId,
            ],
          ),
        );
        const eventId = newId();
        await db.query(
          `INSERT INTO tenancy_event (
             tenancy_event_id, tenancy_id, at, actor, kind, field,
             old_value, new_value, source_document_id, extracted_field_id
           ) VALUES ($1, $2, $3, 'אסף', 'amended', 'end_date',
                     '2027-01-01', '2028-01-01', $4, NULL)`,
          [
            eventId,
            tenancyId,
            new Date('2026-09-07T09:00:00.000Z'),
            documentId,
          ],
        );
        await rejects(db, RESTRICT_VIOLATION, () =>
          db.query(
            'UPDATE tenancy_event SET actor = $2 WHERE tenancy_event_id = $1',
            [eventId, 'לא'],
          ),
        );
        await rejects(db, RESTRICT_VIOLATION, () =>
          db.query('DELETE FROM tenancy_event WHERE tenancy_event_id = $1', [
            eventId,
          ]),
        );
      });
    } finally {
      await pool.end();
    }
  });

  it('accepts extended with or without paper, and still refuses amended without paper', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await inRolledBackTransaction(pool, async (db) => {
        const estate = await seedEstate(db);
        const tenancyId = await seedTenancy(db, {
          ...estate,
          from: '2026-01-01',
          to: '2027-01-01',
        });
        await db.query(
          `INSERT INTO tenancy_event (
             tenancy_event_id, tenancy_id, at, actor, kind, field,
             old_value, new_value, source_document_id, extracted_field_id
           ) VALUES ($1, $2, $3, 'אסף', 'extended', 'end_date',
                     '2027-01-01', '2030-01-01', NULL, NULL)`,
          [newId(), tenancyId, new Date('2026-09-21T09:00:00.000Z')],
        );
        const typeId = newId();
        const documentId = newId();
        await db.query(
          `INSERT INTO document_type (
             document_type_id, type_key, label_he, label_en, verification_terms, is_active
           ) VALUES ($1, $2, 'הודעה', NULL, NULL, true)`,
          [typeId, `t135-event-${typeId.slice(24)}`],
        );
        await db.query(
          `INSERT INTO document (
             document_id, document_type_id, storage_uri, file_hash,
             ingested_at, verification_verdict
           ) VALUES ($1, $2, 'gs://x/notice.pdf', $3, $4, 'unguarded')`,
          [
            documentId,
            typeId,
            `hash-${documentId}`,
            new Date('2026-09-21T09:00:00.000Z'),
          ],
        );
        await db.query(
          `INSERT INTO tenancy_event (
             tenancy_event_id, tenancy_id, at, actor, kind, field,
             old_value, new_value, source_document_id, extracted_field_id
           ) VALUES ($1, $2, $3, 'אסף', 'extended', 'end_date',
                     '2027-01-01', '2030-01-01', $4, NULL)`,
          [
            newId(),
            tenancyId,
            new Date('2026-09-21T09:01:00.000Z'),
            documentId,
          ],
        );
        await rejects(db, CHECK_VIOLATION, () =>
          db.query(
            `INSERT INTO tenancy_event (
               tenancy_event_id, tenancy_id, at, actor, kind, field,
               old_value, new_value, source_document_id, extracted_field_id
             ) VALUES ($1, $2, $3, 'אסף', 'amended', 'end_date',
                       '2027-01-01', '2030-01-01', NULL, NULL)`,
            [newId(), tenancyId, new Date('2026-09-21T09:02:00.000Z')],
          ),
        );
      });
    } finally {
      await pool.end();
    }
  });

  it('accepts reassigned without paper and still refuses amended without paper', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await inRolledBackTransaction(pool, async (db) => {
        const estate = await seedEstate(db);
        const tenancyId = await seedTenancy(db, {
          ...estate,
          from: '2026-01-01',
          to: '2027-01-01',
        });
        await db.query(
          `INSERT INTO tenancy_event (
             tenancy_event_id, tenancy_id, at, actor, kind, field,
             old_value, new_value, source_document_id, extracted_field_id
           ) VALUES ($1, $2, $3, 'אסף', 'reassigned', 'parking_space_id',
                     NULL, '574', NULL, NULL)`,
          [newId(), tenancyId, new Date('2026-09-22T09:00:00.000Z')],
        );
        const typeId = newId();
        const documentId = newId();
        await db.query(
          `INSERT INTO document_type (
             document_type_id, type_key, label_he, label_en, verification_terms, is_active
           ) VALUES ($1, $2, 'חוזה', NULL, NULL, true)`,
          [typeId, `t146-event-${typeId.slice(24)}`],
        );
        await db.query(
          `INSERT INTO document (
             document_id, document_type_id, storage_uri, file_hash,
             ingested_at, verification_verdict
           ) VALUES ($1, $2, 'gs://x/a.pdf', $3, $4, 'unguarded')`,
          [
            documentId,
            typeId,
            `hash-${documentId}`,
            new Date('2026-09-22T09:00:00.000Z'),
          ],
        );
        await rejects(db, CHECK_VIOLATION, () =>
          db.query(
            `INSERT INTO tenancy_event (
               tenancy_event_id, tenancy_id, at, actor, kind, field,
               old_value, new_value, source_document_id, extracted_field_id
             ) VALUES ($1, $2, $3, 'אסף', 'reassigned', 'parking_space_id',
                       NULL, '574', $4, NULL)`,
            [
              newId(),
              tenancyId,
              new Date('2026-09-22T09:01:00.000Z'),
              documentId,
            ],
          ),
        );
        await rejects(db, CHECK_VIOLATION, () =>
          db.query(
            `INSERT INTO tenancy_event (
               tenancy_event_id, tenancy_id, at, actor, kind, field,
               old_value, new_value, source_document_id, extracted_field_id
             ) VALUES ($1, $2, $3, 'אסף', 'amended', 'parking_space_id',
                       NULL, '574', NULL, NULL)`,
            [newId(), tenancyId, new Date('2026-09-22T09:02:00.000Z')],
          ),
        );
      });
    } finally {
      await pool.end();
    }
  });
});

describe('tenancy_completeness_exception — A4 exception row, not a status', () => {
  it('has the published columns and no DEFAULT now() on at', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await inRolledBackTransaction(pool, async (db) => {
        assert.deepEqual(
          await columnsOf(db, 'tenancy_completeness_exception'),
          ['actor', 'at', 'reason', 'rule', 'tenancy_id'],
        );
        const defaults = await db.query<{ column_default: string | null }>(
          `SELECT column_default FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'tenancy_completeness_exception'
              AND column_name = 'at'`,
        );
        assert.equal(defaults.rows[0]?.column_default, null);
      });
    } finally {
      await pool.end();
    }
  });
});

// ------------------------------------------------------------------------------------------------
// E9 / E10 — Obligation and ObligationType. Slice 5.7, `0026_obligation.sql`.
// ------------------------------------------------------------------------------------------------

const TYPE_COLUMNS = [
  'obligation_type_id',
  'code',
  'label_he',
  'label_en',
  'default_responsible_party',
  'requires_evidence',
  'is_active',
];

const OBLIGATION_COLUMNS = [
  'obligation_id',
  'tenancy_id',
  'obligation_type_id',
  'responsible_party',
  'valid_from',
  'valid_to',
  'evidence_document_id',
];

async function insertType(
  db: PoolClient,
  spec: {
    code?: string;
    responsible?: string;
    requiresEvidence?: boolean;
    active?: boolean;
  } = {},
): Promise<string> {
  const id = newId();
  await db.query(
    `INSERT INTO obligation_type (
       obligation_type_id, code, label_he, label_en,
       default_responsible_party, requires_evidence, is_active
     ) VALUES ($1, $2, 'ארנונה', NULL, $3, $4, $5)`,
    [
      id,
      spec.code ?? `oblt-${id.slice(24)}`,
      spec.responsible ?? 'TENANT',
      spec.requiresEvidence ?? true,
      spec.active ?? true,
    ],
  );
  return id;
}

describe('tenancy · ObligationType and Obligation', () => {
  it('the columns are the workbook’s E9 and E10, with no status and no DEFAULT now()', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await inRolledBackTransaction(pool, async (db) => {
        const types = await db.query<{ column_name: string }>(
          `SELECT column_name FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'obligation_type'
            ORDER BY ordinal_position`,
        );
        assert.deepEqual(
          types.rows.map((row) => row.column_name),
          TYPE_COLUMNS,
        );
        const obligations = await db.query<{ column_name: string }>(
          `SELECT column_name FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'obligation'
            ORDER BY ordinal_position`,
        );
        assert.deepEqual(
          obligations.rows.map((row) => row.column_name),
          OBLIGATION_COLUMNS,
        );
        // The money case that stood here is deleted with foundation rule 2
        // (docs/decisions/ADR-0008-money-is-ordinary-data.md). The two column lists asserted just
        // above are exact, so an amount column arriving on either table is still a red build.
      });
    } finally {
      await pool.end();
    }
  });

  it('refuses a DELETE of a type even with no children', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await inRolledBackTransaction(pool, async (db) => {
        const typeId = await insertType(db);
        await rejects(db, RESTRICT_VIOLATION, () =>
          db.query(
            'DELETE FROM obligation_type WHERE obligation_type_id = $1',
            [typeId],
          ),
        );
      });
    } finally {
      await pool.end();
    }
  });

  it('copies nothing from the type on a later edit — the row already holds responsible_party', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await inRolledBackTransaction(pool, async (db) => {
        const estate = await seedEstate(db);
        const tenancyId = await seedTenancy(db, {
          ...estate,
          from: '2026-01-01',
          to: '2027-01-01',
        });
        const typeId = await insertType(db, { responsible: 'TENANT' });
        const obligationId = newId();
        await db.query(
          `INSERT INTO obligation (
             obligation_id, tenancy_id, obligation_type_id, responsible_party,
             valid_from, valid_to, evidence_document_id
           ) VALUES ($1, $2, $3, 'TENANT', NULL, NULL, NULL)`,
          [obligationId, tenancyId, typeId],
        );
        await db.query(
          `UPDATE obligation_type
              SET default_responsible_party = 'OPERATOR', is_active = false
            WHERE obligation_type_id = $1`,
          [typeId],
        );
        const row = await db.query<{ responsible_party: string }>(
          'SELECT responsible_party FROM obligation WHERE obligation_id = $1',
          [obligationId],
        );
        assert.equal(row.rows[0]?.responsible_party, 'TENANT');
      });
    } finally {
      await pool.end();
    }
  });

  it('refuses an unknown responsible_party and an inverted period', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await inRolledBackTransaction(pool, async (db) => {
        const estate = await seedEstate(db);
        const tenancyId = await seedTenancy(db, {
          ...estate,
          from: '2026-01-01',
          to: '2027-01-01',
        });
        await rejects(db, CHECK_VIOLATION, () =>
          insertType(db, { responsible: 'CONTRACTOR' }),
        );
        const typeId = await insertType(db);
        await rejects(db, CHECK_VIOLATION, () =>
          db.query(
            `INSERT INTO obligation (
               obligation_id, tenancy_id, obligation_type_id, responsible_party,
               valid_from, valid_to, evidence_document_id
             ) VALUES ($1, $2, $3, 'LANDLORD', NULL, NULL, NULL)`,
            [newId(), tenancyId, typeId],
          ),
        );
        await rejects(db, CHECK_VIOLATION, () =>
          db.query(
            `INSERT INTO obligation (
               obligation_id, tenancy_id, obligation_type_id, responsible_party,
               valid_from, valid_to, evidence_document_id
             ) VALUES ($1, $2, $3, 'TENANT', '2027-01-01', '2026-01-01', NULL)`,
            [newId(), tenancyId, typeId],
          ),
        );
        await rejects(db, FOREIGN_KEY_VIOLATION, () =>
          db.query(
            `INSERT INTO obligation (
               obligation_id, tenancy_id, obligation_type_id, responsible_party,
               valid_from, valid_to, evidence_document_id
             ) VALUES ($1, $2, $3, 'TENANT', NULL, NULL, $4)`,
            [newId(), tenancyId, typeId, newId()],
          ),
        );
      });
    } finally {
      await pool.end();
    }
  });
});
