// Slice 1.2 — the guardrails' own tests. Every case here was red before the hook existed.
//
// The hooks are tested the way Claude Code actually calls them: spawned as a process, fed the
// tool payload as JSON on stdin, judged on their exit code and stderr. Testing the exported
// regexes instead would prove the regexes match, not that the guard blocks.
//
// Run: node --test .claude/hooks/hooks.test.mjs
import { deepStrictEqual, match, ok, strictEqual } from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const hooks = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(hooks, '..', '..');

// Two variables are scrubbed from every spawned hook's environment, for opposite reasons.
//
// NODE_TEST_CONTEXT=child-v8 is set by this runner and inherited all the way down: the hook's own
// `node --test` grandchild would report over *this* runner's IPC channel and exit 0, so a failing
// module test would look green to the hook. Claude Code never spawns a hook from inside a test
// runner, so that is the harness lying to itself, not a defect in the hook.
//
// DONA_SESSION_START is session-start.mjs's own re-entry marker (slice 1.3). Inherited, it would
// make the session-start cases behave differently under `npm test` than under `node --test` —
// green or red depending on who ran them. The cases that care set it explicitly instead.
const { NODE_TEST_CONTEXT: _dropped, DONA_SESSION_START: _alsoDropped, ...cleanEnv } = process.env;

/** Call a hook the way Claude Code does: JSON on stdin, exit code out. */
const fire = (script, payload, cwd = repoRoot, env = {}) =>
  spawnSync(process.execPath, [join(hooks, script)], {
    input: typeof payload === 'string' ? payload : JSON.stringify(payload),
    encoding: 'utf8',
    cwd,
    env: { ...cleanEnv, ...env },
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

describe('after-write: Biome formats and lints the touched file', () => {
  // The other half of pipeline §4's PostToolUse rule, unbuildable until slice 1.3 installed Biome.
  // §4 states two rules, not one: format-and-lint on *any* touched file, and the module's tests on
  // a file under src/<module>/. The hook conflated them, so src/serve.ts — a file with no module —
  // was never formatted at all.
  const fixtures = [];
  after(() => {
    for (const dir of fixtures) rmSync(dir, { recursive: true, force: true });
  });

  /** A throwaway repo Biome can actually run in: its own config, and the real binary in reach. */
  const withBiome = (relPath, contents) => {
    const dir = mkdtempSync(join(tmpdir(), 'dona-v5-hook-'));
    fixtures.push(dir);
    // `npx --no-install biome` resolves through ./node_modules/.bin. Symlinking the repo's is what
    // lets a temp checkout exercise the format step instead of silently skipping it, which is the
    // state this branch of the hook sat in for the whole of slice 1.2.
    symlinkSync(join(repoRoot, 'node_modules'), join(dir, 'node_modules'), 'dir');
    cpSync(join(repoRoot, 'biome.json'), join(dir, 'biome.json'));
    const file = join(dir, relPath);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, contents);
    return { dir, file };
  };

  it('formats a src file that belongs to no module', () => {
    // src/serve.ts and src/app.ts are exactly this shape, and are the whole of the skeleton in 1.3.
    const { dir, file } = withBiome('src/serve.ts', 'export function serve() {\n    return "up";\n}\n');
    const r = write(file, dir);
    strictEqual(r.status, 0, `expected silence, got status ${r.status}: ${r.stderr}`);
    strictEqual(readFileSync(file, 'utf8'), "export function serve() {\n  return 'up';\n}\n");
  });

  it('exits 2 with Biome\'s own output when it cannot clean the file', () => {
    // An unused variable: Biome's only fix for it is unsafe, so --write leaves it and the
    // --error-on-warnings in the hook turns "noticed" into "blocked". Exit 2 is the only code a
    // PostToolUse hook can use to put anything in front of the agent (slice 1.2).
    const { dir, file } = withBiome('src/app.ts', 'export function app() {\n  const unused = 1;\n  return 2;\n}\n');
    const r = write(file, dir);
    strictEqual(r.status, 2, `expected exit 2, got ${r.status}. stderr: ${r.stderr}`);
    // The rule by name, not just "could not clean": a Biome that processed no files at all also
    // exits non-zero, and asserting the generic line lets that pass as a lint failure.
    match(r.stderr, /noUnusedVariables/);
  });

  it('stays silent for a file Biome has nothing to say about', () => {
    const clean = "export function app() {\n  return 'ok';\n}\n";
    const { dir, file } = withBiome('src/app.ts', clean);
    const r = write(file, dir);
    strictEqual(r.stderr, '', `expected silence, got: ${r.stderr}`);
    strictEqual(r.status, 0);
    strictEqual(readFileSync(file, 'utf8'), clean);
  });

  it('leaves a .ts file outside Biome\'s configured scope alone', () => {
    // biome.json includes src/**, tests/** and evals/** and nothing else. Running Biome on a file
    // it is configured to ignore reports zero files processed, which is noise, not feedback.
    const { dir, file } = withBiome('scratch/probe.ts', 'export function p() {\n    return "x";\n}\n');
    const r = write(file, dir);
    strictEqual(r.status, 0);
    strictEqual(readFileSync(file, 'utf8'), 'export function p() {\n    return "x";\n}\n');
  });
});

describe('session-start: no session starts blind', () => {
  // The repo-root cases below set DONA_SESSION_START so the hook prints its banner without running
  // the suite. Without it each of them would run npm inside `npm test` — see the nested case.
  const nested = { DONA_SESSION_START: '1' };

  /** A throwaway git repo whose test:code script does exactly what the case needs. */
  const repoWithTests = (script) => {
    const dir = mkdtempSync(join(tmpdir(), 'dona-v5-hook-'));
    spawnSync('git', ['init', '-q'], { cwd: dir });
    if (script !== null) {
      writeFileSync(join(dir, 'package.json'), JSON.stringify({ scripts: { 'test:code': script } }));
    }
    return dir;
  };

  it('prints the current branch', () => {
    const r = fire('session-start.mjs', {}, repoRoot, nested);
    strictEqual(r.status, 0);
    // Not the branch's name: this suite runs on a different one every slice, and a case that has
    // to be edited every slice is a case that gets edited without being read.
    match(r.stdout, /^## \S/m);
  });

  it('says nothing is there to run rather than printing an npm error', () => {
    // A checkout with no package.json — what a fresh `git init` looks like, and what this whole
    // repo looked like before slice 1.3. The honest output is that fact, not
    // `npm ERR! Missing script: "test:code"`.
    const dir = repoWithTests(null);
    try {
      const r = fire('session-start.mjs', {}, dir);
      strictEqual(r.status, 0);
      ok(!/npm ERR!/.test(r.stdout + r.stderr), `leaked an npm error: ${r.stdout}${r.stderr}`);
      match(r.stdout, /tests: no package\.json with a test:code script/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('runs the code tests and reports green', () => {
    // The branch that had never once executed before slice 1.3, because no package.json existed.
    const dir = repoWithTests('node -e "process.exit(0)"');
    try {
      const r = fire('session-start.mjs', {}, dir);
      strictEqual(r.status, 0);
      match(r.stdout, /tests: green/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reports FAILING with the tail of the output when the code tests are red', () => {
    const dir = repoWithTests('node -e "console.error(\'space kinds are six, not five\'); process.exit(1)"');
    try {
      const r = fire('session-start.mjs', {}, dir);
      strictEqual(r.status, 0, 'the banner reports; it never blocks the session');
      match(r.stdout, /tests: FAILING/);
      match(r.stdout, /space kinds are six, not five/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('does not run the suite again when it is already inside one', () => {
    // `npm test` runs this suite, which spawns this hook. Without the guard the hook runs `npm
    // test`, which runs this suite, with no bound: slice 1.3 measured 4:07, four timed-out spawns,
    // an unrelated guard-bash case red for want of process room, and orphans still forking twenty
    // minutes later. The scripts are split so it cannot happen; this is the belt.
    const dir = repoWithTests('node -e "process.exit(1)"');
    try {
      const r = fire('session-start.mjs', {}, dir, nested);
      strictEqual(r.status, 0);
      match(r.stdout, /tests: not run — nested inside npm test/);
      ok(!/FAILING/.test(r.stdout), 'it must not have run the script it was told to skip');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('names the loaded guardrails, so a session running without them looks different', () => {
    // A session that declines .claude/settings.json has no hooks and is otherwise identical to one
    // that has them. Nothing in the repo can detect that — the detector would itself be a hook. The
    // banner makes it an absence a human can see. Slice 1.2 evidence, raised item 3.
    const r = fire('session-start.mjs', {}, repoRoot, nested);
    strictEqual(r.status, 0);
    match(r.stdout, /guardrails: armed — guard-bash · after-write/);
  });

  it('says INCOMPLETE when a hook is registered but its file is gone', () => {
    // The failure a rebase produces: settings.json still registers the hook, the file does not exist.
    const dir = mkdtempSync(join(tmpdir(), 'dona-v5-hook-'));
    try {
      spawnSync('git', ['init', '-q'], { cwd: dir });
      mkdirSync(join(dir, '.claude', 'hooks'), { recursive: true });
      cpSync(join(hooks, 'guard-bash.mjs'), join(dir, '.claude', 'hooks', 'guard-bash.mjs'));
      cpSync(join(repoRoot, '.claude', 'settings.json'), join(dir, '.claude', 'settings.json'));
      const r = fire('session-start.mjs', {}, dir);
      strictEqual(r.status, 0);
      match(r.stdout, /guardrails: INCOMPLETE — guard-bash loaded/);
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
