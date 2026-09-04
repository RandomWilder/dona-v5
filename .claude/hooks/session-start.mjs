// SessionStart: print the branch and any failing tests, so no session starts blind (pipeline §4).
//
// v3 ran this inline as `git status -sb | head -5 && npm test --silent | tail -2`. The toolchain
// landed in slice 1.3, so the test line is real now; the no-package.json branch stays because
// `npm ERR! Missing script: "test"` on every session start is worse than useless — it is a hook you
// learn to scroll past. Say what is true instead.
//
// It also prints one line naming the guardrails that are loaded. A session that declines
// `.claude/settings.json` runs with no hooks at all and is otherwise indistinguishable from one that
// has them — nothing inside the repo can detect that state, because the detector would be a hook.
// The banner turns it into an absence a human can see. A tell, not an enforcement.
import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const cwd = process.cwd();
const capture = (cmd, env) => {
  try {
    return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 120_000, env });
  } catch (e) {
    return { failed: true, output: String(e.stdout || '') + String(e.stderr || '') };
  }
};

const status = capture('git status -sb');
process.stdout.write(typeof status === 'string' ? status.split('\n').slice(0, 5).join('\n') : 'branch: unknown\n');
process.stdout.write('\n');

let pkg = null;
try {
  pkg = JSON.parse(readFileSync(resolve(cwd, 'package.json'), 'utf8'));
} catch {
  /* no package.json here, or unreadable — the branch below says so */
}

// This hook runs `test:code`, not `test`. `npm test` also runs .claude/hooks/hooks.test.mjs, which
// spawns *this hook*, which would run `npm test` again — with no bound. Slice 1.3 found it by
// running it: the suite took 4:07, four spawns hit their 120s timeout, an unrelated guard-bash case
// went red for want of process room, and the orphans were still forking twenty minutes later. The
// split is the structural fix; DONA_SESSION_START is the belt for the day someone points this line
// back at `npm test`. Naming the narrower script is also the honest banner — a session start that
// silently runs less than it claims is worse than one that claims less.
if (process.env.DONA_SESSION_START === '1') {
  process.stdout.write('tests: not run — nested inside npm test.\n');
} else if (!pkg?.scripts?.['test:code']) {
  process.stdout.write('tests: no package.json with a test:code script here — nothing to run.\n');
} else {
  const tests = capture('npm run --silent test:code 2>&1', { ...process.env, DONA_SESSION_START: '1' });
  if (typeof tests === 'string') {
    process.stdout.write('tests: green — src · tests · evals (`npm test` adds the hooks suite)\n');
  } else {
    process.stdout.write('tests: FAILING\n');
    process.stdout.write(tests.output.trimEnd().split('\n').slice(-10).join('\n'));
    process.stdout.write('\n');
  }
}

// Name the hooks that are both registered in settings.json and present on disk. Registered-but-
// missing is the interesting failure — settings.json survives a rebase that dropped the file.
const armed = [];
try {
  const settings = JSON.parse(readFileSync(resolve(cwd, '.claude/settings.json'), 'utf8'));
  const registered = JSON.stringify(settings.hooks ?? {});
  for (const name of ['guard-bash', 'after-write']) {
    if (registered.includes(`${name}.mjs`) && existsSync(resolve(cwd, `.claude/hooks/${name}.mjs`))) {
      armed.push(name);
    }
  }
} catch {
  /* no settings file, or unreadable — armed stays empty and the line says so */
}
process.stdout.write(
  armed.length === 2
    ? `guardrails: armed — ${armed.join(' · ')}\n`
    : `guardrails: INCOMPLETE — ${armed.length ? armed.join(' · ') : 'none'} loaded (AGENTS.md Boundaries)\n`,
);
process.exit(0);
