// The instrument beside the gate, for the questions a row count answers. Slice 2.6.
//
// `npm run measure` decides what a ranking change should *be* and `npm run evals` decides whether it
// may merge (docs/pipeline.md §7). This is the same relationship for the schema: **it decides what
// an index should be, and it is not a gate.** A timing is weather — the container, the page cache,
// what else the laptop is doing — so nothing here is ever asserted. The numbers live in
// `tasks/evidence/`, exactly as embedding distances do, and the reason is the same one: a committed
// number that moves for reasons unrelated to the change is a test that fails on a Tuesday.
//
// It explains and times **the strings the screens run** (`MEASURED_QUERIES`, `ISOLATION_JOIN_SQL`),
// never a copy typed in here. A measurement of a query the application does not run is worth less
// than no measurement at all, because it is believed.
//
// Two questions were held open for it, each deliberately, each with the same rule attached: decided
// at full row count with a timing in front of it, never at a few thousand rows on a hunch.
//
//   - **`tenancy (end_date)`** — left out at 2.2. Q5 is the query that wants it.
//   - **a btree on `party_contact (channel, value)`** — left out at 2.1. The exclusion constraint's
//     GiST index already covers that lookup and GiST is slower than btree at plain equality; it is
//     the isolation join's first hop and the hottest query in the system once the agent is live.
import type { Pool, PoolClient } from 'pg';
import {
  countUnitsByBuilding,
  listExpiringLeases,
  MEASURED_QUERIES,
  searchEstate,
} from '../src/estate/contract.ts';
import { createPool } from '../src/kernel/db.ts';
import {
  ISOLATION_JOIN_SQL,
  resolveOccupiedUnits,
  resolvePartiesInUnit,
  resolveUnitsByPhone,
} from '../src/scope/contract.ts';

const RUNS = Number(process.env.MEASURE_RUNS ?? 25);
const today = new Date();

interface Timing {
  name: string;
  rows: number;
  min: number;
  median: number;
  p95: number;
}

const timings: Timing[] = [];

function summarise(name: string, rows: number, samples: number[]): void {
  const sorted = [...samples].sort((a, b) => a - b);
  const at = (q: number): number =>
    sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0;
  timings.push({
    name,
    rows,
    min: sorted[0] ?? 0,
    median: at(0.5),
    p95: at(0.95),
  });
}

/** One warm-up run, then RUNS timed ones. The first is the plan cache and the page cache, not the query. */
async function time(
  name: string,
  run: () => Promise<number>,
  runs = RUNS,
): Promise<void> {
  await run();
  const samples: number[] = [];
  let rows = 0;
  for (let at = 0; at < runs; at += 1) {
    const started = performance.now();
    rows = await run();
    samples.push(performance.now() - started);
  }
  summarise(name, rows, samples);
}

async function explain(
  db: PoolClient,
  name: string,
  sql: string,
  params: unknown[],
): Promise<void> {
  const result = await db.query<{ 'QUERY PLAN': string }>(
    `EXPLAIN (ANALYZE, BUFFERS) ${sql}`,
    params,
  );
  console.log(`\n--- ${name}`);
  for (const row of result.rows) console.log(`    ${row['QUERY PLAN']}`);
}

async function counts(db: PoolClient): Promise<void> {
  const tables = [
    'building',
    'space',
    'unit',
    'tenancy',
    'tenancy_party',
    'party',
    'party_contact',
  ];
  console.log('rows');
  for (const table of tables) {
    const result = await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM ${table}`,
    );
    console.log(`  ${table.padEnd(16)} ${result.rows[0]?.n}`);
  }
  const view = await db.query<{ n: string }>(
    'SELECT count(*)::text AS n FROM occupancy',
  );
  console.log(`  ${'occupancy (view)'.padEnd(16)} ${view.rows[0]?.n}`);
}

async function main(pool: Pool): Promise<void> {
  const db = await pool.connect();
  try {
    await counts(db);

    // A phone that resolves, and a building with units on it, taken from the data rather than
    // typed in: a measurement against a value that matches nothing measures an empty result.
    const phone = await db.query<{ contact_value: string }>(
      `SELECT contact_value FROM occupancy
        WHERE channel = 'PHONE' AND is_service_contact AND status = 'ACTIVE'
        LIMIT 1`,
    );
    // The busiest building **that has leases on it**. The week-1 seed fixture is the largest
    // building in the database and carries no tenancy at all, so "the most units" alone measures
    // the occupancy chip against a building where the answer is always none.
    const busiest = await db.query<{ building_id: string; n: string }>(
      `SELECT s.building_id, count(*)::text AS n
         FROM unit u
         JOIN space s ON s.space_id = u.unit_id
        WHERE EXISTS (SELECT 1 FROM tenancy t WHERE t.unit_id = u.unit_id)
        GROUP BY s.building_id ORDER BY count(*) DESC LIMIT 1`,
    );
    const buildingId = busiest.rows[0]?.building_id ?? '';
    const unitIds = (
      await db.query<{ unit_id: string }>(
        `SELECT u.unit_id FROM unit u JOIN space s ON s.space_id = u.unit_id
          WHERE s.building_id = $1`,
        [buildingId],
      )
    ).rows.map((row) => row.unit_id);
    const number = phone.rows[0]?.contact_value ?? '+972000000000';
    console.log(
      `\nprobe: the busiest building has ${busiest.rows[0]?.n} units; ${RUNS} runs each\n`,
    );

    // --- the screens ---------------------------------------------------------------------------
    await time('estate · buildings list', async () => {
      const rows = await db.query(MEASURED_QUERIES['estate · buildings list']);
      return rows.rowCount ?? 0;
    });
    // A term that matches a street, and a term that matches almost everything: the second is the
    // one a search box actually receives at 16:00 on a Thursday.
    for (const term of ['רקפת', '12', 'א']) {
      await time(`estate · search "${term}"`, async () => {
        const found = await searchEstate(db, term);
        return found.buildings.length + found.units.length;
      });
    }
    await time('estate · Q5, leases ending in 60 days', async () => {
      const rows = await listExpiringLeases(db, today);
      return rows.length;
    });

    // --- the occupancy chip, both shapes ------------------------------------------------------
    await time('scope · occupied units, one building (batched)', async () => {
      const rows = await resolveOccupiedUnits(db, unitIds, today);
      return rows.length;
    });
    await time('scope · occupied units, whole portfolio', async () => {
      const rows = await resolveOccupiedUnits(db, null, today);
      return rows.length;
    });
    await time(
      'estate · units per building for those ids',
      async () => (await countUnitsByBuilding(db, unitIds)).size,
    );
    // The shape tasks/todo.md named, kept as the comparison it is: one call per card.
    await time(
      'scope · resolvePartiesInUnit, once per unit (N+1)',
      async () => {
        let rows = 0;
        for (const unitId of unitIds) {
          rows += (await resolvePartiesInUnit(db, unitId, today)).length;
        }
        return rows;
      },
      3,
    );

    // --- the isolation join, which is the hottest query once the agent is live ------------------
    await time('scope · Q2 join alone (no audit line)', async () => {
      const rows = await db.query(ISOLATION_JOIN_SQL, [
        number,
        today.toISOString().slice(0, 10),
      ]);
      return rows.rowCount ?? 0;
    });
    await time(
      'scope · resolveUnitsByPhone (join + audit line)',
      async () => (await resolveUnitsByPhone(db, number, today)).length,
      5,
    );

    console.log('\ntimings, ms');
    console.log(
      `  ${'query'.padEnd(46)} ${'rows'.padStart(6)} ${'min'.padStart(8)} ${'median'.padStart(8)} ${'p95'.padStart(8)}`,
    );
    for (const timing of timings) {
      console.log(
        `  ${timing.name.padEnd(46)} ${String(timing.rows).padStart(6)} ${timing.min.toFixed(2).padStart(8)} ${timing.median.toFixed(2).padStart(8)} ${timing.p95.toFixed(2).padStart(8)}`,
      );
    }

    console.log('\nplans');
    const day = today.toISOString().slice(0, 10);
    await explain(
      db,
      'estate · Q5 — the tenancy (end_date) question',
      MEASURED_QUERIES['estate · Q5, leases ending inside the window'],
      [day, 60],
    );
    await explain(
      db,
      'estate · search, units',
      MEASURED_QUERIES['estate · search, units'],
      ['%רקפת%', 61],
    );
    await explain(
      db,
      'scope · Q2 — the party_contact (channel, value) question',
      ISOLATION_JOIN_SQL,
      [number, day],
    );
  } finally {
    db.release();
  }
}

const pool = createPool();
try {
  await main(pool);
} catch (error) {
  console.error(
    `measure:scale failed — ${error instanceof Error ? error.message : 'unknown error'}`,
  );
  process.exitCode = 1;
} finally {
  await pool.end();
}
