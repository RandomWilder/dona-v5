// The guards' own tests. docs/pipeline.md §6 requires each guard to be proved by a commit that trips
// it — slice 1.7 did that in CI, on a branch, which is the proof that the *wiring* works. This file
// is the other half: a later refactor of scripts/guards.ts cannot quietly defang them.
//
// Every fixture is built in os.tmpdir(), outside the repository, so the violating content the guards
// are asked to catch is never content the guards scan for real. The violating join is not written
// out by hand either — it is `ISOLATION_JOIN_SQL` itself, copied to a file outside src/scope/, which
// is precisely the drift guard two exists to stop.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import {
  guardMigrations,
  guardScopeJoin,
  MIGRATIONS_DIR,
} from '../../scripts/guards.ts';
import { ISOLATION_JOIN_SQL } from '../../src/scope/contract.ts';

function fixture(files: Record<string, string>): string {
  const root = mkdtempSync(path.join(tmpdir(), 'dona-guards-'));
  for (const [relative, content] of Object.entries(files)) {
    const file = path.join(root, relative);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, content);
  }
  return root;
}

describe('guard · no migration introduces a current_tenant column', () => {
  it('passes a migration set that does not name it', (t) => {
    const root = fixture({
      [path.join(MIGRATIONS_DIR, '0001_init.sql')]:
        'CREATE TABLE unit (unit_id uuid);',
    });
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const result = guardMigrations(root);
    assert.equal(result.scanned, 1);
    assert.deepEqual(result.violations, []);
  });

  it('trips on the column, and on the column named in a comment', (t) => {
    const column = ['current', 'tenant'].join('_');
    const root = fixture({
      [path.join(MIGRATIONS_DIR, '0004_estate.sql')]:
        `ALTER TABLE unit ADD COLUMN ${column} uuid;`,
      [path.join(MIGRATIONS_DIR, '0005_note.sql')]:
        `-- someday we could denormalise ${column}\n`,
    });
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const result = guardMigrations(root);
    assert.equal(result.scanned, 2);
    assert.equal(result.violations.length, 2);
  });

  it('fails when it scanned nothing, which is what a wrong path looks like', (t) => {
    // The exact defect this guard was carried into 1.7 to fix: docs/pipeline.md §6 and tasks/todo.md
    // both pointed it at `migrations/*.sql`, which has never existed in this repository.
    const root = fixture({
      'migrations/0001_init.sql': 'CREATE TABLE unit ();',
    });
    t.after(() => rmSync(root, { recursive: true, force: true }));
    assert.equal(guardMigrations(root).scanned, 0);
  });
});

describe('guard · only src/scope may construct the isolation join', () => {
  it('allows the join where it lives', (t) => {
    const root = fixture({
      [path.join('src', 'scope', 'internal', 'isolation-join.ts')]:
        ISOLATION_JOIN_SQL,
      [path.join('src', 'app.ts')]: 'export const version = 1;\n',
    });
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const result = guardScopeJoin(root);
    assert.equal(result.scanned, 1);
    assert.deepEqual(result.violations, []);
  });

  it('trips on a second copy of the real join anywhere else', (t) => {
    const root = fixture({
      [path.join('src', 'channel', 'lookup.ts')]:
        `const q = \`${ISOLATION_JOIN_SQL}\`;\n`,
    });
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const result = guardScopeJoin(root);
    assert.equal(result.violations.length, 2, 'both temporal predicates');
    assert.equal(
      result.violations[0]?.file,
      path.join('src', 'channel', 'lookup.ts'),
    );
  });

  it('trips on a reformatted copy — the predicate, not the layout', (t) => {
    // A copy that drifts is reformatted by definition. The guard collapses whitespace before it
    // matches, so wrapping the predicate across lines is not an escape.
    const root = fixture({
      [path.join('src', 'calls', 'scope.sql')]: ISOLATION_JOIN_SQL.replace(
        /\s+/g,
        '\n  ',
      ),
    });
    t.after(() => rmSync(root, { recursive: true, force: true }));
    assert.ok(guardScopeJoin(root).violations.length > 0);
  });

  it('fails when it scanned nothing', (t) => {
    const root = fixture({ 'README.md': 'no code here' });
    t.after(() => rmSync(root, { recursive: true, force: true }));
    assert.equal(guardScopeJoin(root).scanned, 0);
  });
});
