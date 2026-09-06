// The generated register, asserted twice over: once without a database and once through the real
// importer. Slice 2.6.
//
// **The pure half is the stronger one.** Every row of a generated file is read by the same
// `readRow` the importer reads it with, so "this generator emits a file this format accepts" is
// proved over hundreds of units in milliseconds, with no container running. What the database half
// adds is the part validation cannot see: the constraints. Zero rejects is the claim, and a reject
// there is a defect in the generator rather than a fact about anybody's data (SPEC-register.md).
//
// **This suite's block is `7`.** A generated register may be sitting in the same database — that is
// the whole point of the slice — and two files sharing a phone block claim one contact value on
// overlapping days, which the exclusion constraint rejects and which two parallel transactions
// deadlock over (2.4).
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  inRolledBackTransaction,
  migratedPoolOrNull,
  skipReason,
} from '../kernel/pg-support.ts';
import { importRegister } from './contract.ts';
import { generateRegister } from './fixtures/generate.ts';
import { parseCsv } from './internal/csv.ts';
import { REGISTER_COLUMNS, readRow } from './internal/row.ts';

/** Fixed, so a case that fails names a file anybody can reproduce byte for byte. */
const TODAY = '2026-09-06';
const CITIES = ['נס ציונה — מרשם מדגם', 'גדרה — מרשם מדגם'] as const;

const sample = (units: number, seed = 2026) =>
  generateRegister({ units, today: TODAY, seed, cities: CITIES, block: '7' });

describe('register · the generated file', () => {
  it('is the format its own reader accepts, row for row', () => {
    const { csv, summary } = sample(200);
    const records = parseCsv(csv);
    assert.deepEqual(records[0]?.fields, [...REGISTER_COLUMNS]);

    const rows = records.slice(1).filter((record) => record.fields.length > 1);
    assert.equal(rows.length, summary.rows);
    const reasons: string[] = [];
    for (const record of rows) {
      const read = readRow(record.fields);
      if ('errors' in read) {
        for (const error of read.errors) {
          reasons.push(`line ${record.line}: ${error.reason}`);
        }
      }
    }
    assert.deepEqual(reasons, [], 'a generated row the format rejects');
  });

  it('is the same bytes for the same seed and the same day', () => {
    assert.equal(sample(120).csv, sample(120).csv);
    assert.notEqual(sample(120).csv, sample(120, 7).csv);
  });

  it('carries every case that breaks an importer, at volume', () => {
    const { csv, summary } = sample(400);
    assert.equal(summary.units, 400);
    assert.ok(summary.buildings >= 7, `${summary.buildings} buildings`);
    // One row per party on a tenancy, so rows outnumber units and the two are not the same fact.
    assert.ok(summary.rows > summary.units, `${summary.rows} rows`);
    for (const [name, count] of Object.entries({
      occupiedToday: summary.occupiedToday,
      expiringWithin60: summary.expiringWithin60,
      recycledNumbers: summary.recycledNumbers,
      splitIdentifiers: summary.splitIdentifiers,
      guarantors: summary.guarantors,
      companies: summary.companies,
      buildingsWithoutProject: summary.buildingsWithoutProject,
    })) {
      assert.ok(count > 0, `${name} is ${count} — the case is missing`);
    }
    // Vacancies exist, or the occupancy chip has nothing to say.
    assert.ok(summary.occupiedToday < summary.units, 'every unit is occupied');
    // The quotation mark in a company name, which is the CSV rule most exports get wrong.
    assert.match(csv, /""מ/);
    // A split apartment, which is why unit_number is text.
    assert.match(csv, /,\d+A,/);
  });
});

describe('register · the generated file, through the importer', () => {
  it('is accepted whole, and a re-run creates nothing', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    await inRolledBackTransaction(pool, async (db) => {
      const { csv, summary } = sample(24);
      const first = await importRegister(db, csv);
      // A generated register that loses a row measures the generator. The count of rows a real
      // register loses to `one_active_tenancy_per_unit` is 2.5's, against the client's own file.
      assert.deepEqual(
        first.rejects,
        [],
        'a generated row the database refused',
      );
      assert.equal(first.accepted, summary.rows);
      assert.equal(first.counts.unit.created, summary.units);
      assert.equal(first.counts.tenancy.created, summary.tenancies);

      const second = await importRegister(db, csv);
      assert.deepEqual(second.rejects, []);
      for (const [table, count] of Object.entries(second.counts)) {
        assert.equal(count.created, 0, `${table} created ${count.created}`);
      }
    });
  });
});
