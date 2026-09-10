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
  guardMockups,
  guardPiiComments,
  guardScopeJoin,
  MIGRATIONS_DIR,
  MOCKUPS_DIR,
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

  // Slice 2.1, and the first time this guard fired on work that was not a violation. `0006_`'s
  // `validity_is_ordered` CHECK is a null-guarded comparison of `valid_to` against the other date
  // column of the same row, and the pattern could not tell it apart from the join's own null-guarded
  // comparison of `valid_to` against the day being asked about. (Neither is quoted here: this file
  // is scanned, and a comment that spells the predicate is the second copy.)
  //
  // They are different questions. The join asks *is this contact valid on the day being asked
  // about* and compares `valid_to` to a parameter; the CHECK asks *is this row's period ordered*
  // and compares it to the other column of the same row. The exception is provably safe rather than
  // merely convenient: `valid_to >= valid_from` is true for every well-formed row, so it cannot
  // express "valid on day D" no matter who writes it or where.
  //
  // Resolved by making the pattern say what it means, which is what guard three's qualified name did
  // in the same slice — never by rephrasing the CHECK to slip past it (docs/pipeline.md §6).
  it('allows a same-row ordering check outside src/scope', (t) => {
    const root = fixture({
      [path.join('src', 'kernel', 'migrations', '0006_parties.sql')]:
        'CONSTRAINT validity_is_ordered CHECK (valid_to IS NULL OR valid_to >= valid_from),\n',
    });
    t.after(() => rmSync(root, { recursive: true, force: true }));
    assert.deepEqual(guardScopeJoin(root).violations, []);
  });

  it('still trips when valid_to is compared to anything else', (t) => {
    // Derived from the real join rather than typed out, for the same reason the cases above are:
    // a test that spells the predicate is itself the second copy, and this file is scanned.
    for (const right of ['$2', "'2026-09-06'", 'CURRENT_DATE', 'asked_on']) {
      const root = fixture({
        [path.join('src', 'channel', 'lookup.ts')]: ISOLATION_JOIN_SQL.replace(
          /valid_to >= \$2/,
          `valid_to >= ${right}`,
        ),
      });
      t.after(() => rmSync(root, { recursive: true, force: true }));
      assert.ok(
        guardScopeJoin(root).violations.some((violation) =>
          violation.detail.includes('contact-validity'),
        ),
        `a copy comparing valid_to to ${right} must still trip the guard`,
      );
    }
  });

  it('fails when it scanned nothing', (t) => {
    const root = fixture({ 'README.md': 'no code here' });
    t.after(() => rmSync(root, { recursive: true, force: true }));
    assert.equal(guardScopeJoin(root).scanned, 0);
  });
});

describe('guard · a person-shaped column carries -- pii', () => {
  const migration = (body: string): Record<string, string> => ({
    [path.join(MIGRATIONS_DIR, '0006_parties.sql')]:
      `CREATE TABLE party_contact (\n${body}\n);\n`,
  });

  it('passes the estate migrations, which have no person in them', (t) => {
    const root = fixture(
      migration(
        '  space_id uuid PRIMARY KEY,\n  name text NOT NULL,\n  floor text',
      ),
    );
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const result = guardPiiComments(root);
    assert.equal(result.scanned, 1);
    assert.deepEqual(result.violations, []);
  });

  it('trips on an unmarked person-shaped column', (t) => {
    const root = fixture(
      migration('  phone text NOT NULL,\n  national_id text,\n  email text'),
    );
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const result = guardPiiComments(root);
    assert.equal(result.violations.length, 3);
    assert.match(result.violations[0]?.detail ?? '', /phone/);
  });

  it('accepts the marker on the line and in the comment block above it', (t) => {
    const root = fixture(
      migration(
        [
          '  phone text NOT NULL, -- pii',
          "  -- pii -- the tenant's own address, and the reason a technician can find them",
          '  full_name text,',
        ].join('\n'),
      ),
    );
    t.after(() => rmSync(root, { recursive: true, force: true }));
    assert.deepEqual(guardPiiComments(root).violations, []);
  });

  // The escape exists so the guard never has to be worked around by renaming a column. It costs a
  // sentence, which is exactly what makes it reviewable.
  it('accepts -- not-pii with a reason, and refuses it without one', (t) => {
    const withReason = fixture(
      migration(
        "  -- not-pii: the operator's switchboard, printed on the door\n  phone text",
      ),
    );
    t.after(() => rmSync(withReason, { recursive: true, force: true }));
    assert.deepEqual(guardPiiComments(withReason).violations, []);

    const bare = fixture(migration('  -- not-pii:\n  phone text'));
    t.after(() => rmSync(bare, { recursive: true, force: true }));
    assert.equal(guardPiiComments(bare).violations.length, 1);
  });

  it('trips on an ALTER TABLE that adds one later', (t) => {
    const root = fixture({
      [path.join(MIGRATIONS_DIR, '0007_add.sql')]:
        'ALTER TABLE party ADD COLUMN IF NOT EXISTS birth_date date;\n',
    });
    t.after(() => rmSync(root, { recursive: true, force: true }));
    assert.equal(guardPiiComments(root).violations.length, 1);
  });

  it('fails when it scanned nothing', (t) => {
    const root = fixture({
      'migrations/0001_init.sql': 'CREATE TABLE party ();',
    });
    t.after(() => rmSync(root, { recursive: true, force: true }));
    assert.equal(guardPiiComments(root).scanned, 0);
  });

  // Slice 2.1. `party_contact.value` holds a phone number or an email address and is the most
  // person-shaped column in the system, and a bare name could not reach it: `value` on the list
  // would fire on `config_settings.value` in 0002_kernel_durability.sql, and a guard with a false
  // positive is one people learn to work around. The guard now tracks the enclosing CREATE TABLE, so
  // the list can carry a qualified entry for exactly the column that needs one.
  //
  // Both directions are asserted, because only the pair is the constraint: the qualified name must
  // fire where it belongs **and** stay silent where the same bare name is ordinary.
  it('trips on an unmarked party_contact.value', (t) => {
    const root = fixture(
      migration('  channel text NOT NULL,\n  value text NOT NULL'),
    );
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const result = guardPiiComments(root);
    assert.equal(result.violations.length, 1);
    assert.match(result.violations[0]?.detail ?? '', /party_contact\.value/);
  });

  it('accepts party_contact.value when it is marked', (t) => {
    const root = fixture(
      migration('  channel text NOT NULL,\n  value text NOT NULL, -- pii'),
    );
    t.after(() => rmSync(root, { recursive: true, force: true }));
    assert.deepEqual(guardPiiComments(root).violations, []);
  });

  it('leaves config_settings.value alone — the same bare name, and not a person', (t) => {
    const root = fixture({
      [path.join(MIGRATIONS_DIR, '0002_kernel_durability.sql')]:
        'CREATE TABLE config_settings (\n  key text PRIMARY KEY,\n  value jsonb NOT NULL\n);\n',
    });
    t.after(() => rmSync(root, { recursive: true, force: true }));
    assert.deepEqual(guardPiiComments(root).violations, []);
  });

  // The table name has to survive to the column line for the qualified entry to mean anything, and
  // it has to stop at the end of the statement or every later `value` in the file inherits it.
  it('forgets the table once the CREATE TABLE statement ends', (t) => {
    const root = fixture({
      [path.join(MIGRATIONS_DIR, '0006_parties.sql')]: [
        'CREATE TABLE party_contact (',
        '  value text NOT NULL -- pii',
        ');',
        'CREATE TABLE unrelated (',
        '  value text NOT NULL',
        ');',
      ].join('\n'),
    });
    t.after(() => rmSync(root, { recursive: true, force: true }));
    assert.deepEqual(guardPiiComments(root).violations, []);
  });
});

describe('guard · a mockup does not outlive its evidence', () => {
  it('passes when a mockup has no evidence yet', (t) => {
    const root = fixture({
      [path.join(MOCKUPS_DIR, 'ia.html')]: '<!-- ia -->\n',
    });
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const result = guardMockups(root);
    assert.equal(result.scanned, 1);
    assert.deepEqual(result.violations, []);
  });

  it('trips when the owner slice has already closed', (t) => {
    const root = fixture({
      [path.join(MOCKUPS_DIR, 'ia.html')]: '<!-- ia -->\n',
      [path.join('tasks', 'evidence', '5.3.md')]: '# closed\n',
    });
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const result = guardMockups(root);
    assert.equal(result.violations.length, 1);
  });

  it('trips on a flow with no owner', (t) => {
    const root = fixture({
      [path.join(MOCKUPS_DIR, 'mystery.html')]: '<!-- ? -->\n',
    });
    t.after(() => rmSync(root, { recursive: true, force: true }));
    assert.equal(guardMockups(root).violations.length, 1);
  });

  it('treats an empty mockups directory as idle, not a dead path', (t) => {
    const root = fixture({
      [path.join(MOCKUPS_DIR, '.gitkeep')]: '',
    });
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const result = guardMockups(root);
    assert.equal(result.scanned, 0);
    assert.equal(result.allowEmpty, true);
    assert.deepEqual(result.violations, []);
  });
});
