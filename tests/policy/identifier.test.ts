// POLICY CASE — an identifier never reaches something an agent is served.
//
// SPEC.md's security defaults have said since week 1 that `national_id` is **admin-only,
// unreachable by any agent tool and access-logged**, and that *the policy suite asserts this*. Until
// this file the suite did not: `src/scope/scope.test.ts` asserts the occupancy view's column list,
// which is the shape of the query and not the shape of the answer, and every fixture in this suite
// seeded a party with no identifier at all — so *nothing carried one* was true of a database that
// held none.
//
// **Slice 6.6**, and it is the carried row week 5 wrote as *`national_id` never in an agent tool's
// response shape*. 6.4 gave the identifier a **second home** — `extracted_field`, where a ת.ז.
// printed on a lease is stored — so this case names the table and not only the column, and seeds a
// row in each before it asks.
//
// Deterministic by construction, which is why it is here and not in `evals/`: SPEC.md's *never test
// a deterministic constraint through the agent*. A model that declines to repeat a ת.ז. has proved
// the model behaved.
import assert from 'node:assert/strict';
import { glob, readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { fixedClock } from '../../src/kernel/clock.ts';
import { hasIdentifierRun } from '../../src/kernel/identifier.ts';
import {
  ISOLATION_JOIN_SQL,
  resolveOccupiedUnits,
  resolvePartiesInUnit,
  resolveUnitsByPhone,
} from '../../src/scope/contract.ts';
import { seedExtractedIdentifier, seedOccupancy } from './fixtures.ts';
import {
  inRolledBackTransaction,
  POLICY_RELATIONS,
  pendingUntilSchema,
  policyPool,
  skipReason,
} from './support.ts';

const TODAY = fixedClock(new Date('2026-09-14T00:00:00Z'));
const TENANT_PHONE = '+972501112233';

/**
 * **Derived per run, never hard-coded.** 6.5 learned this twice in one session: a fixed ת.ז. in a
 * fixture collides with somebody else's row, and `id.slice(0, 8)` is a UUIDv7 timestamp rather than
 * randomness. Nine digits off the random tail of a fresh id.
 */
function anIdentifier(): string {
  const digits = crypto.randomUUID().replace(/\D/g, '');
  return digits.slice(-9).padStart(9, '7');
}

describe('policy · an identifier reaches nothing an agent is served', () => {
  it('is a shape the guard actually recognises', () => {
    // The case's own probe, checked first. Every assertion below is `hasIdentifierRun(...) === false`
    // and each of them would pass on a value nothing could ever match — which is how a guard ends up
    // green having tested that its fixture was unrecognisable.
    for (let i = 0; i < 500; i++) {
      const value = anIdentifier();
      assert.equal(value.length, 9);
      assert.ok(hasIdentifierRun(value), value);
    }
  });

  it('is in neither of its two homes when the join answers', async (t) => {
    const pool = await policyPool();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await pendingUntilSchema(t, POLICY_RELATIONS, () =>
        inRolledBackTransaction(pool, async (db) => {
          // Home one: the column. Home two: the row 6.4 put on the paper's way in.
          const onParty = anIdentifier();
          const onPaper = anIdentifier();
          const tenant = await seedOccupancy(db, '12', {
            phone: TENANT_PHONE,
            contactFrom: '2026-01-01',
            contactTo: null,
            tenancyFrom: '2026-01-01',
            tenancyTo: '2027-01-01',
            nationalId: onParty,
          });
          await seedExtractedIdentifier(db, tenant.unitId, onPaper);

          // The three questions this module answers. Serialised whole rather than field by field:
          // the rule is about the *response shape*, so a column added to the view in six months is
          // caught by this case without anybody remembering to add an assertion for it.
          const answers: Array<[string, unknown]> = [
            [
              'resolveUnitsByPhone',
              await resolveUnitsByPhone(db, TENANT_PHONE, TODAY),
            ],
            [
              'resolvePartiesInUnit',
              await resolvePartiesInUnit(db, tenant.unitId, TODAY),
            ],
            [
              'resolveOccupiedUnits',
              await resolveOccupiedUnits(db, [tenant.unitId], TODAY),
            ],
          ];
          for (const [name, answer] of answers) {
            const body = JSON.stringify(answer);
            // An answer that resolved nothing carries no identifier for the reason it carries
            // nothing, which proves the seed and not the rule.
            assert.ok(body.length > 2, `${name} resolved nothing`);
            assert.equal(hasIdentifierRun(body), false, `${name}: ${body}`);
            assert.equal(body.includes(onParty), false, name);
            assert.equal(body.includes(onPaper), false, name);
          }
        }),
      );
    } finally {
      await pool.end();
    }
  });

  it('is in neither home the join reads from', () => {
    // The other side of the same rule, and the cheap half: a query that never names the column
    // cannot return it however the data is shaped. `ISOLATION_JOIN_SQL` is the constant
    // `scripts/guards.ts` guard two already forbids anyone outside `src/scope/` from restating.
    assert.equal(ISOLATION_JOIN_SQL.includes('national_id'), false);
    assert.equal(ISOLATION_JOIN_SQL.includes('extracted_field'), false);
  });
});

const srcRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'src',
);

describe('policy · the copy sent to the embedder', () => {
  it('embeds the stored passage as printed, identifiers included', async () => {
    // ADR-0006 decision 1 used to mean "mask before the embedder". #103 / #99 reversed that for
    // the passage store: one store, one embedding run, text as printed; tenant-stance masking is
    // a later read. Decision 1 still binds tenant-facing model output. This case names the caller
    // rather than asserting there is none.
    const files: string[] = [];
    for await (const entry of glob('**/*.ts', { cwd: srcRoot })) {
      files.push(entry);
    }
    assert.ok(files.length > 50, `only found ${files.length} files under src/`);

    const callers: string[] = [];
    for (const file of files) {
      if (file.startsWith(`kernel${path.sep}embeddings`)) continue;
      const source = await readFile(path.join(srcRoot, file), 'utf8');
      if (/embedder\.embed\(/.test(source)) callers.push(file);
    }
    const expected = [
      `evidence${path.sep}internal${path.sep}passages.ts`,
      `evidence${path.sep}internal${path.sep}search.ts`,
    ];
    assert.deepEqual(
      callers.sort(),
      expected,
      `${callers.join(', ')} also calls embedder.embed; add them here only if they embed the stored copy unmasked`,
    );
    const writer = await readFile(
      path.join(srcRoot, expected[0] ?? ''),
      'utf8',
    );
    assert.equal(writer.includes('identifier.ts'), false);
    assert.match(writer, /pageText\(page\)/);
    assert.match(writer, /embedder\.embed\(bodies\)/);
    const reader = await readFile(
      path.join(srcRoot, expected[1] ?? ''),
      'utf8',
    );
    assert.match(reader, /maskIdentifierRuns/);
    assert.match(reader, /embedder\.embed\(\[question\]\)/);
    assert.match(reader, /stance: RetrievalStance/);
    assert.doesNotMatch(reader, /stance\?:/);
    assert.doesNotMatch(reader, /stance\s*=\s*['"]/);
  });
});
