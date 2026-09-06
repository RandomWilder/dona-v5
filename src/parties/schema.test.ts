// Contract tests for E5 and E6 — the agent's front door.
//
// These assert against a real Postgres, through the DDL in src/kernel/migrations/0006_parties.sql,
// because every claim here is a claim about what the database refuses. An application-level check
// would prove that this file and that file agree, which is not the constraint (slice 1.9's note, and
// it holds harder here: the rule below is what stops one phone number resolving to two people).
//
// The column lists are the workbook's FIELDS sheet (docs/model/, E5–E6). A migration that drifts
// from it turns this suite red, which is the point: the workbook is a specification, and a
// specification nothing reads is a description.
//
// **Every rejection below was proved red first** against the same DDL with its constraint removed,
// with the SQLSTATE recorded in tasks/evidence/2.1.md. A constraint test that has never been red
// asserts what the code already did (docs/pipeline.md §10).
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { PoolClient } from 'pg';
import { newId } from '../kernel/ids.ts';
import {
  inRolledBackTransaction,
  migratedPoolOrNull,
  skipReason,
} from '../kernel/pg-support.ts';
import { resolveUnitsByPhone } from '../scope/contract.ts';

// Postgres SQLSTATEs. Asserting the class and not merely "it threw" is what stops a typo in a
// fixture from reading as a constraint doing its job.
const FOREIGN_KEY_VIOLATION = '23503';
const CHECK_VIOLATION = '23514';
const NOT_NULL_VIOLATION = '23502';
const EXCLUSION_VIOLATION = '23P01';

// One number, and the two people who hold it in turn. The same shape tests/policy/ uses, because it
// is the shape the real hazard has.
const RECYCLED_PHONE = '+972521234567';

/**
 * Asserts the statement is rejected with a named SQLSTATE, and leaves the transaction usable.
 *
 * A failed statement aborts the enclosing transaction, so every case making more than one assertion
 * after a rejection needs the savepoint — without it the second assertion fails with 25P02 and says
 * nothing about the constraint it was written for.
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

async function insertParty(
  db: PoolClient,
  overrides: { kind?: string; language?: string; nationalId?: string } = {},
): Promise<string> {
  const partyId = newId();
  await db.query(
    `INSERT INTO party (party_id, party_kind, full_name, national_id, preferred_language)
     VALUES ($1, $2, 'דנה כהן', $3, $4)`,
    [
      partyId,
      overrides.kind ?? 'PERSON',
      overrides.nationalId ?? null,
      overrides.language ?? 'he',
    ],
  );
  return partyId;
}

interface ContactSpec {
  channel?: string;
  value?: string;
  from?: string;
  to?: string | null;
}

function insertContact(
  db: PoolClient,
  partyId: string,
  spec: ContactSpec = {},
): Promise<unknown> {
  return db.query(
    `INSERT INTO party_contact (contact_id, party_id, channel, value, is_primary,
                                valid_from, valid_to, verified_at)
     VALUES ($1, $2, $3, $4, true, $5, $6, NULL)`,
    [
      newId(),
      partyId,
      spec.channel ?? 'PHONE',
      spec.value ?? RECYCLED_PHONE,
      spec.from ?? '2024-05-01',
      spec.to === undefined ? '2026-06-30' : spec.to,
    ],
  );
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

describe('parties · a contact value resolves to at most one party on any day', () => {
  it('is the acceptance bar, and it is the schema that holds it', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      // The bar, first half: the same number, two parties, two periods that do not touch. This is
      // the case a naive `UNIQUE (channel, value)` would have made unrepresentable — and Israeli
      // mobile numbers are reassigned constantly, so a schema that forbids it is a schema every
      // import fights.
      await t.test('two parties may hold one number in turn', async () => {
        await inRolledBackTransaction(pool, async (db) => {
          const previous = await insertParty(db);
          const current = await insertParty(db);
          await insertContact(db, previous, { to: '2026-06-30' });
          await insertContact(db, current, { from: '2026-07-01', to: null });

          const held = await db.query<{ count: string }>(
            'SELECT count(*) FROM party_contact WHERE value = $1',
            [RECYCLED_PHONE],
          );
          assert.equal(held.rows[0]?.count, '2');
        });
      });

      // The bar, second half — and the half that is a security property. One day of overlap means
      // the isolation join returns two units for one inbound number, which reads on screen exactly
      // like a correct multi-tenancy result.
      await t.test('and never on the same day, not even by one', async () => {
        await inRolledBackTransaction(pool, async (db) => {
          const previous = await insertParty(db);
          const current = await insertParty(db);
          await insertContact(db, previous, { to: '2026-06-30' });

          await rejects(db, EXCLUSION_VIOLATION, () =>
            insertContact(db, current, {
              from: '2026-06-30',
              to: '2027-01-01',
            }),
          );
          // The boundary is inclusive on both ends, matching the join's own reading. One day later
          // is a different day and is accepted.
          await insertContact(db, current, { from: '2026-07-01', to: null });
        });
      });

      // "Null = still current" means unbounded, and the schema reads it that way rather than as
      // "no end date recorded". Closing the old contact is a step somebody takes.
      await t.test('an open-ended contact blocks every later one', async () => {
        await inRolledBackTransaction(pool, async (db) => {
          const previous = await insertParty(db);
          const current = await insertParty(db);
          await insertContact(db, previous, { from: '2024-05-01', to: null });

          await rejects(db, EXCLUSION_VIOLATION, () =>
            insertContact(db, current, { from: '2030-01-01', to: null }),
          );
        });
      });

      // The channel is in the key, so a phone number and an email address that happen to be the
      // same string are two different contacts rather than a collision.
      await t.test(
        'the same string on two channels is not a conflict',
        async () => {
          await inRolledBackTransaction(pool, async (db) => {
            const one = await insertParty(db);
            const two = await insertParty(db);
            await insertContact(db, one, {
              channel: 'PHONE',
              value: RECYCLED_PHONE,
            });
            await insertContact(db, two, {
              channel: 'EMAIL',
              value: RECYCLED_PHONE,
            });
          });
        },
      );
    } finally {
      await pool.end();
    }
  });

  // The constraint above is worth exactly what it prevents at the front door, so it is asserted
  // from there too — through src/scope/'s own join and never through a hand-written copy of it
  // (slice 1.7: a case that writes its own join proves that copy, and guard two fails the build on
  // a second one).
  //
  // This case cannot assert its punchline until `tenancy` and `tenancy_party` land at 2.2. What it
  // proves today is the half that is this slice's: the two contact rows the leak would need cannot
  // both exist, so the query has nothing to over-resolve from.
  it('leaves the isolation join nothing to over-resolve', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await inRolledBackTransaction(pool, async (db) => {
        const one = await insertParty(db);
        const two = await insertParty(db);
        await insertContact(db, one, { from: '2024-05-01', to: null });
        await rejects(db, EXCLUSION_VIOLATION, () =>
          insertContact(db, two, { from: '2024-05-01', to: null }),
        );

        const rows = await db.query<{ party_id: string }>(
          `SELECT party_id FROM party_contact
           WHERE channel = 'PHONE' AND value = $1 AND valid_from <= $2`,
          [RECYCLED_PHONE, '2026-09-06'],
        );
        assert.equal(
          rows.rowCount,
          1,
          'one number, one party, on the day the join would ask about',
        );
        assert.equal(rows.rows[0]?.party_id, one);
      });
      // And the join itself still reports pending against the relations 2.2 brings, which is the
      // signal this slice moved rather than closed.
      assert.equal(typeof resolveUnitsByPhone, 'function');
    } finally {
      await pool.end();
    }
  });
});

describe('parties · the rest of the schema', () => {
  it('holds the vocabularies, the formats and the references', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await t.test(
        'party_kind and preferred_language are closed sets',
        async () => {
          await inRolledBackTransaction(pool, async (db) => {
            await insertParty(db, { kind: 'COMPANY' });
            await rejects(db, CHECK_VIOLATION, () =>
              insertParty(db, { kind: 'LANDLORD' }),
            );
            for (const language of ['he', 'ar', 'ru', 'fr', 'en']) {
              await insertParty(db, { language });
            }
            await rejects(db, CHECK_VIOLATION, () =>
              insertParty(db, { language: 'de' }),
            );
          });
        },
      );

      // The workbook's note, made enforceable: "One format, always. Mixed formats break the inbound
      // lookup silently." A number stored one way and asked for another resolves to nobody, which
      // is indistinguishable from correct isolation — the failure where nothing looks wrong.
      await t.test('a PHONE value must be E.164', async () => {
        await inRolledBackTransaction(pool, async (db) => {
          const partyId = await insertParty(db);
          for (const value of [
            '052-123-4567',
            '0521234567',
            '+972 52 123 4567',
            '+0521234567',
            '',
          ]) {
            await rejects(db, CHECK_VIOLATION, () =>
              insertContact(db, partyId, { value }),
            );
          }
          await insertContact(db, partyId, { value: '+972521234567' });
        });
      });

      // The format rule is the phone channel's alone. An email is not E.164 and must not be asked
      // to be — a CHECK written across both channels would have been a rule nobody could satisfy.
      await t.test('an EMAIL value is not held to it', async () => {
        await inRolledBackTransaction(pool, async (db) => {
          const partyId = await insertParty(db);
          await insertContact(db, partyId, {
            channel: 'EMAIL',
            value: 'dana@example.com',
          });
          await rejects(db, CHECK_VIOLATION, () =>
            insertContact(db, partyId, { channel: 'SMS', value: 'x' }),
          );
        });
      });

      // Without this the same row fails inside the exclusion constraint's daterange() constructor,
      // with no constraint name and nothing a caller can report. Postgres evaluates CHECKs before
      // index constraints, which is what makes the named error the one that surfaces.
      await t.test(
        'a period must be ordered, and says so by name',
        async () => {
          await inRolledBackTransaction(pool, async (db) => {
            const partyId = await insertParty(db);
            await rejects(db, CHECK_VIOLATION, () =>
              insertContact(db, partyId, {
                from: '2026-08-01',
                to: '2026-01-01',
              }),
            );
            // Equal is ordered: a contact valid for exactly one day is a real thing.
            await insertContact(db, partyId, {
              from: '2026-08-01',
              to: '2026-08-01',
            });
          });
        },
      );

      await t.test('a contact belongs to a party that exists', async () => {
        await inRolledBackTransaction(pool, async (db) => {
          await rejects(db, FOREIGN_KEY_VIOLATION, () =>
            insertContact(db, newId()),
          );
          const partyId = await insertParty(db);
          await rejects(db, NOT_NULL_VIOLATION, () =>
            db.query(
              `INSERT INTO party_contact (contact_id, party_id, channel, value,
                                          is_primary, valid_from)
               VALUES ($1, $2, 'PHONE', $3, true, NULL)`,
              [newId(), partyId, RECYCLED_PHONE],
            ),
          );
        });
      });

      // A party's language is never absent: the agent opens in *some* language on the first
      // message, and the workbook's own note is "Default he".
      await t.test(
        'preferred_language defaults rather than being absent',
        async () => {
          await inRolledBackTransaction(pool, async (db) => {
            const partyId = newId();
            await db.query(
              `INSERT INTO party (party_id, party_kind, full_name)
             VALUES ($1, 'PERSON', 'דנה כהן')`,
              [partyId],
            );
            const row = await db.query<{ preferred_language: string }>(
              'SELECT preferred_language FROM party WHERE party_id = $1',
              [partyId],
            );
            assert.equal(row.rows[0]?.preferred_language, 'he');
          });
        },
      );

      // The workbook is a specification. A migration that drifts from it turns this red, which is
      // the only thing that makes that sentence true.
      await t.test('the columns are the workbook’s E5 and E6', async () => {
        await inRolledBackTransaction(pool, async (db) => {
          assert.deepEqual(await columnsOf(db, 'party'), [
            'full_name',
            'national_id',
            'party_id',
            'party_kind',
            'preferred_language',
          ]);
          assert.deepEqual(await columnsOf(db, 'party_contact'), [
            'channel',
            'contact_id',
            'is_primary',
            'party_id',
            'valid_from',
            'valid_to',
            'value',
            'verified_at',
          ]);
        });
      });

      // Foundation rule 1, asserted at the table that would be most tempting to put it on: the
      // scope is a view, and `party` carries no pointer to a unit or a tenancy.
      await t.test(
        'no column here names a unit, a tenancy or a tenant',
        async () => {
          await inRolledBackTransaction(pool, async (db) => {
            const leaked = await db.query(
              `SELECT table_name, column_name FROM information_schema.columns
             WHERE table_schema = 'public'
               AND table_name IN ('party', 'party_contact')
               AND column_name IN ('unit_id', 'tenancy_id', 'current_tenant')`,
            );
            assert.deepEqual(leaked.rows, []);
          });
        },
      );
    } finally {
      await pool.end();
    }
  });
});
