// Slice 1.2 — the guardrails' own tests. Every case here was red before the hook existed.
//
// The hooks are tested the way Claude Code actually calls them: spawned as a process, fed the
// tool payload as JSON on stdin, judged on their exit code and stderr. Testing the exported
// regexes instead would prove the regexes match, not that the guard blocks.
//
// Run: node --test .claude/hooks/hooks.test.mjs
import { deepStrictEqual, match, ok, strictEqual } from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const hooks = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(hooks, '..', '..');

// This runner sets NODE_TEST_CONTEXT=child-v8, and it is inherited all the way down: the hook's
// own `node --test` grandchild would report over *this* runner's IPC channel and exit 0, so a
// failing module test would look green to the hook. Claude Code never spawns a hook from inside a
// test runner, so this is the harness lying to itself, not a defect in the hook.
const { NODE_TEST_CONTEXT: _dropped, ...cleanEnv } = process.env;

/** Call a hook the way Claude Code does: JSON on stdin, exit code out. */
const fire = (script, payload, cwd = repoRoot) =>
  spawnSync(process.execPath, [join(hooks, script)], {
    input: typeof payload === 'string' ? payload : JSON.stringify(payload),
    encoding: 'utf8',
    cwd,
    env: cleanEnv,
    timeout: 120_000,
  });

const bash = (command, cwd) => fire('guard-bash.mjs', { tool_name: 'Bash', tool_input: { command } }, cwd);
const write = (filePath, cwd) => fire('after-write.mjs', { tool_name: 'Write', tool_input: { file_path: filePath } }, cwd);

describe('guard-bash: the four the slice names', () => {
  // tasks/todo.md 1.2 — "rm -rf /, force push, raw psql against prod and DROP DATABASE are each
  // blocked with exit 2". Exit 2 is the only code Claude Code reads as "blocked"; 1 is an error
  // the model is shown and may work around.
  const blocked = [
    ['rm -rf /', 'rm -rf /'],
    ['rm -rf /*', 'rm -rf /*'],
    ['sudo rm -rf --no-preserve-root /', 'rm -rf / with the safety off'],
    ['git push --force origin main', 'force push'],
    ['git push -f origin main', 'force push, short flag'],
    ['psql "$DATABASE_URL_PROD" -c "select 1"', 'raw psql against prod'],
    ['psql -h dona-prod.internal -U app dona', 'raw psql against prod, by hostname'],
    ['psql dona-v5-prod', 'raw psql against prod, by database name'],
    ['dropdb --if-exists dona || psql -c "DROP DATABASE dona"', 'DROP DATABASE'],
    ['psql -c "drop schema public cascade"', 'DROP SCHEMA'],
    ['gcloud sql instances delete dona-v5-staging', 'destructive gcloud'],
  ];

  for (const [command, why] of blocked) {
    it(`blocks with exit 2: ${why} — ${command}`, () => {
      const r = bash(command);
      strictEqual(r.status, 2, `expected exit 2, got ${r.status}. stderr: ${r.stderr}`);
      match(r.stderr, /Blocked by guard-bash/);
    });
  }
});

describe('guard-bash: what it must not block', () => {
  // A guard that blocks the day's work gets disabled, and then it guards nothing.
  const allowed = [
    'npm test',
    'npm run test:policy',
    'git push origin slice/1.2-guardrails',
    'git status -sb',
    'rm -rf node_modules',
    'rm -rf ./dist',
    'psql -h 127.0.0.1 -U dona dona_dev -c "select 1"',
    'gcloud run services list --region me-west1',
  ];

  for (const command of allowed) {
    it(`allows: ${command}`, () => {
      const r = bash(command);
      strictEqual(r.status, 0, `expected exit 0, got ${r.status}. stderr: ${r.stderr}`);
    });
  }
});

describe('guard-bash: accepted false positives', () => {
  // Pinned rather than discovered at 2am. The guard matches the string, not the intent, and that
  // is the deliberate trade: a false positive costs one rephrase, a false negative costs a
  // database. If one of these starts costing real time, widen the guard in a slice, not in a hurry.
  const falsePositives = [
    ['grep -rn "DROP DATABASE" migrations/', 'searching for the phrase reads as executing it'],
    ['git push --force-with-lease origin slice/1.2', 'the safe force push is blocked with the unsafe one'],
    ['psql -h 127.0.0.1 dona_dev -f seed-production-catalogue.sql', '"prod" anywhere on the line'],
  ];

  for (const [command, why] of falsePositives) {
    it(`blocks, knowingly: ${why}`, () => {
      strictEqual(bash(command).status, 2);
    });
  }
});

describe('guard-bash: the payload contract', () => {
  it('fails open on a payload it cannot parse', () => {
    // Deliberate: a hook that blocks every command when the harness changes its payload shape
    // bricks the session. The guard is a net over known-destructive commands, not an allowlist.
    strictEqual(fire('guard-bash.mjs', 'not json at all').status, 0);
  });

  it('ignores a payload with no command', () => {
    strictEqual(fire('guard-bash.mjs', { tool_name: 'Bash', tool_input: {} }).status, 0);
  });
});

describe('after-write: a write under src/<module>/ runs that module\'s tests', () => {
  const fixtures = [];
  after(() => {
    for (const dir of fixtures) rmSync(dir, { recursive: true, force: true });
  });

  /** A throwaway repo with one module, whose test passes or fails as asked. */
  const fixture = (moduleName, testBody) => {
    const dir = mkdtempSync(join(tmpdir(), 'dona-v5-hook-'));
    fixtures.push(dir);
    const moduleDir = join(dir, 'src', moduleName);
    mkdirSync(moduleDir, { recursive: true });
    writeFileSync(join(moduleDir, 'contract.ts'), 'export const spaceKinds = ["UNIT"] as const;\n');
    writeFileSync(
      join(moduleDir, 'contract.test.ts'),
      `import { strictEqual } from 'node:assert/strict';\nimport { test } from 'node:test';\ntest('${moduleName}', () => { ${testBody} });\n`,
    );
    return { dir, file: join(moduleDir, 'contract.ts') };
  };

  it('reports the module by name when its tests fail after the edit', () => {
    const { dir, file } = fixture('estate', 'strictEqual(1, 2);');
    const r = write(file, dir);
    match(r.stderr, /Focused tests failing in src\/estate/);
    // Exit 2, not 0: a PostToolUse hook that exits 0 has its stderr hidden from the agent, so
    // v3's report was written and never read. The write itself already happened either way.
    strictEqual(r.status, 2, 'exit 2 is what puts the failure in front of the agent');
  });

  it('says nothing when the module\'s tests pass', () => {
    const { dir, file } = fixture('parties', 'strictEqual(1, 1);');
    const r = write(file, dir);
    ok(!/Focused tests failing/.test(r.stderr), `expected silence, got: ${r.stderr}`);
    strictEqual(r.status, 0);
  });

  it('is a silent no-op for a module with no tests yet', () => {
    // The ordinary state of a module in week 1. v3's `node --test src/<module>` reported this as
    // a failure under Node 24; a hook that cries wolf on every new file is a hook you turn off.
    const dir = mkdtempSync(join(tmpdir(), 'dona-v5-hook-'));
    fixtures.push(dir);
    mkdirSync(join(dir, 'src', 'scope'), { recursive: true });
    writeFileSync(join(dir, 'src', 'scope', 'contract.ts'), 'export const hops = 5;\n');
    const r = write(join(dir, 'src', 'scope', 'contract.ts'), dir);
    strictEqual(r.stderr, '', `expected silence, got: ${r.stderr}`);
    strictEqual(r.status, 0);
  });

  it('runs nothing for a file outside src/', () => {
    const { dir } = fixture('tenancy', 'strictEqual(1, 2);');
    const r = write(join(dir, 'docs', 'notes.md'), dir);
    ok(!/Focused tests failing/.test(r.stderr), `expected silence, got: ${r.stderr}`);
    strictEqual(r.status, 0);
  });

  it('runs nothing for a src file belonging to a different checkout', () => {
    // The hook runs `node --test src/<module>` relative to cwd. Without this check an edit to
    // /Users/asafwilder/dona-v3/src/kernel/db.ts would run *this* repo's kernel tests and
    // report on a file it never saw.
    const { dir } = fixture('kernel', 'strictEqual(1, 2);');
    const r = write('/Users/asafwilder/dona-v3/src/kernel/db.ts', dir);
    ok(!/Focused tests failing/.test(r.stderr), `expected silence, got: ${r.stderr}`);
    strictEqual(r.status, 0);
  });
});

describe('session-start: no session starts blind', () => {
  it('prints the current branch', () => {
    const r = fire('session-start.mjs', {});
    strictEqual(r.status, 0);
    match(r.stdout, /## slice\/1\.2-guardrails|## main|branch/i);
  });

  it('says the toolchain is missing rather than printing an npm error', () => {
    // AGENTS.md: the toolchain lands in 1.3. Until then "failing tests" has no answer, and the
    // honest output is that fact — not `npm ERR! Missing script: "test"`.
    const dir = mkdtempSync(join(tmpdir(), 'dona-v5-hook-'));
    try {
      spawnSync('git', ['init', '-q'], { cwd: dir });
      const r = fire('session-start.mjs', {}, dir);
      strictEqual(r.status, 0);
      ok(!/npm ERR!/.test(r.stdout + r.stderr), `leaked an npm error: ${r.stdout}${r.stderr}`);
      match(r.stdout, /slice 1\.3/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('settings.json: the guardrails are actually wired', () => {
  it('registers all three hooks against the events pipeline §4 names', async () => {
    const settings = JSON.parse(
      await import('node:fs/promises').then((fs) => fs.readFile(join(repoRoot, '.claude', 'settings.json'), 'utf8')),
    );
    deepStrictEqual(Object.keys(settings.hooks).sort(), ['PostToolUse', 'PreToolUse', 'SessionStart']);
    match(JSON.stringify(settings.hooks.PreToolUse), /guard-bash\.mjs/);
    match(JSON.stringify(settings.hooks.PostToolUse), /after-write\.mjs/);
    match(JSON.stringify(settings.hooks.SessionStart), /session-start\.mjs/);
    ok(settings.permissions.allow.length > 0, 'the allowlist is the other half of §4');
  });
});
