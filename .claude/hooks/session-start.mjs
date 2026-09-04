// SessionStart: print the branch and any failing tests, so no session starts blind (pipeline §4).
//
// v3 ran this inline as `git status -sb | head -5 && npm test --silent | tail -2`. In v5 there is
// no package.json until slice 1.3, and `npm ERR! Missing script: "test"` on every session start is
// worse than useless — it is a hook you learn to scroll past. Say what is true instead.
//
// It also prints one line naming the guardrails that are loaded. A session that declines
// `.claude/settings.json` runs with no hooks at all and is otherwise indistinguishable from one that
// has them — nothing inside the repo can detect that state, because the detector would be a hook.
// The banner turns it into an absence a human can see. A tell, not an enforcement.
import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const cwd = process.cwd();
const capture = (cmd) => {
  try {
    return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 120_000 });
  } catch (e) {
    return { failed: true, output: String(e.stdout || '') + String(e.stderr || '') };
  }
};

const status = capture('git status -sb');
process.stdout.write(typeof status === 'string' ? status.split('\n').slice(0, 5).join('\n') : 'branch: unknown\n');
process.stdout.write('\n');

const pkgPath = resolve(cwd, 'package.json');
const hasTestScript =
  existsSync(pkgPath) && Boolean(JSON.parse(readFileSync(pkgPath, 'utf8')).scripts?.test);

if (!hasTestScript) {
  process.stdout.write('tests: no toolchain yet — `npm test` lands in slice 1.3 (AGENTS.md status line).\n');
} else {
  const tests = capture('npm test --silent 2>&1');
  if (typeof tests === 'string') {
    process.stdout.write('tests: green\n');
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
