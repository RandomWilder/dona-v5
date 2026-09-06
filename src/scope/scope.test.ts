// Contract tests for src/scope/ — slice 2.3.
//
// The isolation join's own correctness is tests/policy/'s and is deliberately not restated here:
// isolation is one of the three things no model may decide, so it is gated in the policy suite
// against SQL (docs/pipeline.md §6). What this file asserts is the module 2.3 built *around* that
// join, and every claim in it is one the policy cases cannot make:
//
//   - Q1, which the policy suite has no reason to ask;
//   - that a number asked in one format finds a number stored in another, which is the failure that
//     looks exactly like correct isolation;
//   - that the scoped read leaves an audit line, and that the line carries no personal data;
//   - that `national_id` is not on the view an agent's scope is built from.
//
// The fixtures are written here rather than imported from tests/policy/fixtures.ts. src/ depending
// on tests/ is the wrong direction, and src/parties/schema.test.ts set the precedent at 2.1 by
// writing the same shape locally. Its city is its own, which is 1.11's lesson: `building_address_key`
// is unique, so two suites sharing an address are two suites that fail on each other.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { PoolClient } from 'pg';
import { KernelError } from '../kernel/errors.ts';
import { newId } from '../kernel/ids.ts';
import {
  inRolledBackTransaction,
  migratedPoolOrNull,
  skipReason,
} from '../kernel/pg-support.ts';
import {
  OCCUPANCY_VIEW,
  OCCUPANCY_VIEW_COLUMNS,
  resolveOccupiedUnits,
  resolvePartiesInUnit,
  resolveUnitsByPhone,
} from './contract.ts';

const TODAY = new Date('2026-09-06T00:00:00Z');
// **This suite's block is `0523…`**, and it is not decoration. `node --test` runs files in parallel
// against one database, so two suites inserting one contact value on overlapping days each wait on
// the other's speculative insertion — 2.4 met that as `40P01` and blocked its register fixtures, and
// 2.6 found that this file, src/parties/schema.test.ts and tests/policy/ had been sharing one number
// since week 2. The policy gate was the one that flaked.
const STORED_PHONE = '+972523000222';
const CITY = 'Scope suite';
// **Two globally unique keys this suite has to own, both found at 2.6.** `party.national_id_key`
// (0009) and `terms_profile.name` (0009) are unique across the whole database, so a fixture that
// hardcodes either can only ever create one row — the second `seed` in one transaction collided
// with the first — and a plausible name collides with a real register besides. The city was
// namespaced at 2.3 for exactly this reason; these two were missed because nothing had asked for a
// second party in one case yet.
const PROFILE = 'Scope suite profile';
let seeded = 0;

interface SeedSpec {
  unitNumber: string;
  name: string;
  phone?: string | null;
  contactFrom?: string;
  contactTo?: string | null;
  tenancyFrom?: string;
  tenancyTo?: string;
  status?: string;
  role?: string;
  isServiceContact?: boolean;
  unitId?: string;
}

interface Seeded {
  unitId: string;
  partyId: string;
  tenancyId: string;
}

async function seedUnit(db: PoolClient, unitNumber: string): Promise<string> {
  const unitId = newId();
  await db.query(
    `INSERT INTO building (building_id, name, address_line, city, handover_date,
                           warranty_end_date, status)
     VALUES ($1, $2, $3, $4, '2026-01-01', '2027-01-01', 'ACTIVE')
     ON CONFLICT (address_key) DO NOTHING`,
    [newId(), 'Scope suite building', 'Rakefet 12', CITY],
  );
  const building = await db.query<{ building_id: string }>(
    'SELECT building_id FROM building WHERE city = $1',
    [CITY],
  );
  await db.query(
    `INSERT INTO space (space_id, building_id, space_kind, name)
     VALUES ($1, $2, 'UNIT', $3)`,
    [unitId, building.rows[0]?.building_id, `Apartment ${unitNumber}`],
  );
  await db.query(
    `INSERT INTO unit (unit_id, unit_number, rooms, has_mamad, condition_status)
     VALUES ($1, $2, 3.5, true, 'READY')`,
    [unitId, unitNumber],
  );
  return unitId;
}

/** One party on one tenancy of one unit, optionally reachable on one number. */
async function seed(db: PoolClient, spec: SeedSpec): Promise<Seeded> {
  const unitId = spec.unitId ?? (await seedUnit(db, spec.unitNumber));
  const partyId = newId();
  const tenancyId = newId();
  seeded += 1;
  await db.query(
    `INSERT INTO party (party_id, party_kind, full_name, national_id) VALUES ($1, 'PERSON', $2, $3)`,
    [partyId, spec.name, `04${String(seeded).padStart(7, '0')}`],
  );
  if (spec.phone !== null) {
    await db.query(
      `INSERT INTO party_contact (contact_id, party_id, channel, value, is_primary,
                                  valid_from, valid_to)
       VALUES ($1, $2, 'PHONE', $3, true, $4, $5)`,
      [
        newId(),
        partyId,
        spec.phone ?? STORED_PHONE,
        spec.contactFrom ?? '2026-01-01',
        spec.contactTo ?? null,
      ],
    );
  }
  // One profile per transaction, found or created. `UNIQUE (name)` is global, so inserting a fresh
  // one per call fails the moment a case seeds twice.
  const profile = await db.query<{ terms_profile_id: string }>(
    `INSERT INTO terms_profile (terms_profile_id, name) VALUES ($1, $2)
     ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
     RETURNING terms_profile_id`,
    [newId(), PROFILE],
  );
  const termsProfileId = profile.rows[0]?.terms_profile_id;
  await db.query(
    `INSERT INTO tenancy (tenancy_id, unit_id, start_date, end_date, status, terms_profile_id)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      tenancyId,
      unitId,
      spec.tenancyFrom ?? '2026-01-01',
      spec.tenancyTo ?? '2027-01-01',
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
  return { unitId, partyId, tenancyId };
}

interface AuditRow {
  actor_kind: string;
  action: string;
  subject_id: string | null;
  inputs: { matched?: number };
  outcome: string;
}

// Read back by the actor that asked, and never by "everything in the table". src/kernel/audit.test.ts
// writes its rows on a **pool** rather than in a transaction, so they are committed and concurrent:
// an unfiltered SELECT here would make "exactly one line" a claim about the container, and clearing
// the table first — which is what this did first — takes a lock that blocks that suite's inserts
// for the length of this transaction. A unique actor per case costs nothing and is race-free.
async function auditLines(
  db: PoolClient,
  actorId: string,
): Promise<AuditRow[]> {
  const result = await db.query<AuditRow>(
    `SELECT actor_kind, action, subject_id, inputs, outcome FROM audit_log
     WHERE actor_id = $1 ORDER BY at, id`,
    [actorId],
  );
  return result.rows;
}

async function withDb(
  body: (db: PoolClient) => Promise<void>,
): Promise<'ran' | 'skipped'> {
  const pool = await migratedPoolOrNull();
  if (!pool) return 'skipped';
  try {
    await inRolledBackTransaction(pool, body);
  } finally {
    await pool.end();
  }
  return 'ran';
}

describe('scope · Q1, who lives in unit 12 today', () => {
  it('answers in one query, and shows the guarantor it will not resolve', async (t) => {
    const ran = await withDb(async (db) => {
      const tenant = await seed(db, {
        unitNumber: '12',
        name: 'Avigail Tenant',
      });
      // On the same lease, and the whole point of Panel 1: the guarantor is *shown* here, marked
      // unreachable, where Q2 must not resolve them at all. Two questions, one view, opposite
      // readings of the same column.
      await db.query(
        `INSERT INTO party (party_id, party_kind, full_name) VALUES ($1, 'PERSON', 'Boaz Guarantor')`,
        ['00000000-0000-4000-8000-00000000000b'],
      );
      await db.query(
        `INSERT INTO tenancy_party (tenancy_id, party_id, role, is_service_contact)
         VALUES ($1, $2, 'GUARANTOR', false)`,
        [tenant.tenancyId, '00000000-0000-4000-8000-00000000000b'],
      );

      const occupants = await resolvePartiesInUnit(db, tenant.unitId, TODAY);
      assert.deepEqual(
        occupants.map((row) => [
          row.full_name,
          row.role,
          row.is_service_contact,
        ]),
        [
          ['Avigail Tenant', 'PRIMARY_TENANT', true],
          ['Boaz Guarantor', 'GUARANTOR', false],
        ],
      );
    });
    if (ran === 'skipped') t.skip(skipReason);
  });

  it('returns one row per party, not one per number they can be reached on', async (t) => {
    const ran = await withDb(async (db) => {
      const tenant = await seed(db, {
        unitNumber: '13',
        name: 'Avigail Tenant',
      });
      // A second contact for the same person. The view fans a party out over their contact rows —
      // which is right for Q2 and wrong for Q1, and is why the question is asked DISTINCT.
      await db.query(
        `INSERT INTO party_contact (contact_id, party_id, channel, value, is_primary,
                                    valid_from, valid_to)
         VALUES ($1, $2, 'EMAIL', 'avigail@example.com', false, '2026-01-01', NULL)`,
        [newId(), tenant.partyId],
      );
      assert.equal(
        (await resolvePartiesInUnit(db, tenant.unitId, TODAY)).length,
        1,
      );
    });
    if (ran === 'skipped') t.skip(skipReason);
  });

  it('is empty for a unit whose tenancy ended, and does not fall back to the last one', async (t) => {
    const ran = await withDb(async (db) => {
      // R5: a unit accumulates tenancies and never overwrites them, so "who lives here" over an
      // ended lease is a vacancy and not the previous household.
      const past = await seed(db, {
        unitNumber: '14',
        name: 'Former Tenant',
        tenancyFrom: '2025-01-01',
        tenancyTo: '2026-06-30',
      });
      assert.deepEqual(await resolvePartiesInUnit(db, past.unitId, TODAY), []);
    });
    if (ran === 'skipped') t.skip(skipReason);
  });
});

// Slice 2.6. The grid's question, which is Q1 asked of a page rather than of a card.
describe('scope · which of these units are let today', () => {
  it('answers for a page of units in one query, and a vacancy is an absent row', async (t) => {
    const ran = await withDb(async (db) => {
      // Distinct numbers, because `contact_value_resolves_to_one_party` is a statement about
      // overlap and two seeded households sharing one number is exactly what it refuses (2.1).
      const letToday = await seed(db, {
        unitNumber: '20',
        name: 'Current Tenant',
        phone: '+972523000230',
      });
      // R5 again, from the grid's side: an ended lease is a vacancy, not the last household. This
      // is the property the occupancy chip exists to show and the one a stored column would drift.
      const vacant = await seed(db, {
        unitNumber: '21',
        name: 'Former Tenant',
        phone: '+972523000231',
        tenancyFrom: '2025-01-01',
        tenancyTo: '2026-06-30',
      });
      const rows = await resolveOccupiedUnits(
        db,
        [letToday.unitId, vacant.unitId],
        TODAY,
      );
      assert.deepEqual(
        rows.map((row) => [row.unit_id, row.occupants]),
        [[letToday.unitId, 1]],
      );
    });
    if (ran === 'skipped') t.skip(skipReason);
  });

  it('does not count a guarantor as a resident', async (t) => {
    const ran = await withDb(async (db) => {
      // Foundation rule 7's other face, and E8's own note: a guarantor is on the lease and is not in
      // the apartment. Q1 shows them, marked; the chip's count leaves them out, and the unit is
      // still let.
      const tenant = await seed(db, { unitNumber: '22', name: 'Real Tenant' });
      await db.query(
        `INSERT INTO party (party_id, party_kind, full_name) VALUES ($1, 'PERSON', 'Guarantor')`,
        ['00000000-0000-4000-8000-00000000002b'],
      );
      await db.query(
        `INSERT INTO tenancy_party (tenancy_id, party_id, role, is_service_contact)
         VALUES ($1, $2, 'GUARANTOR', false)`,
        [tenant.tenancyId, '00000000-0000-4000-8000-00000000002b'],
      );
      const rows = await resolveOccupiedUnits(db, [tenant.unitId], TODAY);
      assert.deepEqual(
        rows.map((row) => row.occupants),
        [1],
      );
    });
    if (ran === 'skipped') t.skip(skipReason);
  });

  it('counts a party once however many numbers they are reachable on', async (t) => {
    const ran = await withDb(async (db) => {
      // The view fans a party out over their contact rows. A count that forgot to be DISTINCT would
      // report a two-phone household as two people, which is a chip that lies quietly.
      const tenant = await seed(db, { unitNumber: '23', name: 'Two Numbers' });
      await db.query(
        `INSERT INTO party_contact (contact_id, party_id, channel, value, is_primary,
                                    valid_from, valid_to)
         VALUES ($1, $2, 'EMAIL', 'two@example.com', false, '2026-01-01', NULL)`,
        [newId(), tenant.partyId],
      );
      const rows = await resolveOccupiedUnits(db, [tenant.unitId], TODAY);
      assert.deepEqual(
        rows.map((row) => row.occupants),
        [1],
      );
    });
    if (ran === 'skipped') t.skip(skipReason);
  });

  it('writes one audit line for the page, not one per unit', async (t) => {
    const ran = await withDb(async (db) => {
      // The reason this call exists. `resolvePartiesInUnit` once per card is a hundred round trips
      // and a hundred audit rows for one page load, and an access log in which one browse looks like
      // a hundred lookups is worse than useless in the review it is kept for.
      const first = await seed(db, {
        unitNumber: '24',
        name: 'One',
        phone: '+972523000234',
      });
      const second = await seed(db, {
        unitNumber: '25',
        name: 'Two',
        phone: '+972523000235',
      });
      const before = await db.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM audit_log WHERE action = 'scope.resolve_occupied_units'`,
      );
      await resolveOccupiedUnits(db, [first.unitId, second.unitId], TODAY, {
        actor: { actorKind: 'staff', actorId: 'scope-suite' },
      });
      const after = await db.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM audit_log WHERE action = 'scope.resolve_occupied_units'`,
      );
      assert.equal(Number(after.rows[0]?.n) - Number(before.rows[0]?.n), 1);
    });
    if (ran === 'skipped') t.skip(skipReason);
  });
});

describe('scope · a number is asked in one format and stored in another', () => {
  it('resolves a national number against the E.164 row it belongs to', async (t) => {
    const ran = await withDb(async (db) => {
      const tenant = await seed(db, {
        unitNumber: '15',
        name: 'Avigail Tenant',
      });
      // The whole of what 2.1's CHECK could not do on its own. Stored +972523000222; asked the way
      // an ERP export and a person both write it. Without the conversion each of these resolves to
      // nobody — and nothing on any screen looks wrong, which is the hazard.
      for (const asked of ['052-300-0222', '052 300 0222', '00972523000222']) {
        const scope = await resolveUnitsByPhone(db, asked, TODAY);
        assert.equal(scope.length, 1, asked);
        assert.equal(scope[0]?.unit_id, tenant.unitId);
      }
    });
    if (ran === 'skipped') t.skip(skipReason);
  });

  it('refuses a number it cannot place rather than resolving to nobody', async (t) => {
    const ran = await withDb(async (db) => {
      // `invalid` and not an empty scope. An empty scope is a real answer — the recycled-number case
      // returns one — so a malformed input must not be able to imitate it.
      await assert.rejects(
        () =>
          resolveUnitsByPhone(db, '521234567', TODAY, {
            actor: { actorKind: 'agent', actorId: 'scope-refused' },
          }),
        KernelError,
      );
      // Nothing was read, so there is nothing to record an access to — and the value that was
      // refused is not written anywhere either.
      assert.deepEqual(await auditLines(db, 'scope-refused'), []);
    });
    if (ran === 'skipped') t.skip(skipReason);
  });
});

describe('scope · every scoped read is logged, and the log holds no person', () => {
  it('writes one line naming the party reached and the row count', async (t) => {
    const ran = await withDb(async (db) => {
      const tenant = await seed(db, {
        unitNumber: '16',
        name: 'Avigail Tenant',
      });
      await resolveUnitsByPhone(db, STORED_PHONE, TODAY, {
        actor: { actorKind: 'agent', actorId: 'wa:inbound' },
      });
      const lines = await auditLines(db, 'wa:inbound');
      assert.equal(lines.length, 1);
      assert.deepEqual(
        [
          lines[0]?.actor_kind,
          lines[0]?.action,
          lines[0]?.subject_id,
          lines[0]?.inputs.matched,
        ],
        ['agent', 'scope.resolve_by_phone', tenant.partyId, 1],
      );
    });
    if (ran === 'skipped') t.skip(skipReason);
  });

  it('logs the read that resolved nobody, which is the one worth having', async (t) => {
    const ran = await withDb(async (db) => {
      await seed(db, { unitNumber: '17', name: 'Avigail Tenant' });
      // A recycled number reaching nothing is the case an access review asks about. A log that only
      // records successful reads cannot answer it.
      await resolveUnitsByPhone(db, '+972509999999', TODAY, {
        actor: { actorKind: 'agent', actorId: 'scope-miss' },
      });
      const lines = await auditLines(db, 'scope-miss');
      assert.equal(lines.length, 1);
      assert.equal(lines[0]?.subject_id, null);
      assert.equal(lines[0]?.inputs.matched, 0);
    });
    if (ran === 'skipped') t.skip(skipReason);
  });

  it('logs Q1 too — a unit screen is a scoped read of tenant data', async (t) => {
    const ran = await withDb(async (db) => {
      const tenant = await seed(db, {
        unitNumber: '18',
        name: 'Avigail Tenant',
      });
      await resolvePartiesInUnit(db, tenant.unitId, TODAY, {
        actor: { actorKind: 'staff', actorId: 'staff-1', actorRole: 'ADMIN' },
      });
      const lines = await auditLines(db, 'staff-1');
      assert.equal(lines.length, 1);
      assert.deepEqual(
        [lines[0]?.action, lines[0]?.subject_id, lines[0]?.inputs.matched],
        ['scope.resolve_unit_occupants', tenant.unitId, 1],
      );
    });
    if (ran === 'skipped') t.skip(skipReason);
  });

  it('carries neither the number that was asked nor the name that was found', async (t) => {
    const ran = await withDb(async (db) => {
      const tenant = await seed(db, {
        unitNumber: '19',
        name: 'Avigail Tenant',
      });
      // No actor, so this also covers the default: an unnamed caller is `system`, never absent.
      await resolveUnitsByPhone(db, '052-300-0222', TODAY);
      // The whole audit row, every column, as text. SPEC.md: PII never in logs — and an Israeli
      // mobile number has too little entropy for a hash of one to be one-way, so the line names what
      // was reached and never what was asked (SPEC-scope.md). The number the sender used belongs to
      // the channel module's message log, at week 9.
      const raw = await db.query<{ line: string; actor_kind: string }>(
        'SELECT audit_log::text AS line, actor_kind FROM audit_log WHERE subject_id = $1',
        [tenant.partyId],
      );
      const line = raw.rows[0]?.line ?? '';
      assert.equal(raw.rows.length, 1);
      assert.equal(raw.rows[0]?.actor_kind, 'system');
      for (const secret of [
        '052-300-0222',
        STORED_PHONE,
        '523000222',
        'Avigail',
      ]) {
        assert.ok(
          !line.includes(secret),
          `the audit line leaks ${secret}: ${line}`,
        );
      }
    });
    if (ran === 'skipped') t.skip(skipReason);
  });
});

describe('scope · the view an agent’s scope is built from', () => {
  it('exposes exactly the columns this module names, and national_id is not one', async (t) => {
    const ran = await withDb(async (db) => {
      const result = await db.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = $1`,
        [OCCUPANCY_VIEW],
      );
      const columns = result.rows.map((row) => row.column_name);
      // SPEC.md's security defaults: national_id is admin-only, unreachable by any agent tool and
      // access-logged. This view is the surface a scope is built from, so its absence is asserted
      // rather than intended — and the whole list is compared, so a column added to the view without
      // being considered fails here instead of arriving in a response shape unnoticed.
      assert.ok(!columns.includes('national_id'));
      assert.deepEqual(columns.sort(), [...OCCUPANCY_VIEW_COLUMNS].sort());
    });
    if (ran === 'skipped') t.skip(skipReason);
  });
});
