// PostToolUse (Write|Edit): format the touched src file, then run its module's focused tests.
// Feedback in seconds, not at push time.
//
// **Exit 2 is how the feedback arrives.** A PostToolUse hook that exits 0 has its stderr hidden
// from the agent — v3's hook wrote a failing-test report that nothing ever read, which is a
// guardrail with no teeth. Exit 2 does not undo the write (the tool has already run); it is the
// only exit code that puts the output in front of the model that just made the edit.
//
// Lifted from dona-v3 (slice 1.2, docs/from-v3.md Tier 1). Five changes for v5:
//   0. Exit 2 rather than 0 when there is something to say, per the paragraph above.
//   1. `node --test src/<module>` no longer walks a directory under Node 24 — a positional
//      argument is a file or a glob, so v3's form failed with MODULE_NOT_FOUND on every edit and
//      would have reported "tests failing" for a module whose tests were green. The test files are
//      collected here instead, which also makes "this module has no tests yet" a silent no-op
//      rather than an error — the ordinary state of a module in week 1.
//   2. The file must resolve, through symlinks, to somewhere inside *this* checkout: the module
//      tests run relative to cwd, so an edit in dona-v3 would otherwise run v5's tests and report
//      on a file it never saw.
//   3. Biome is skipped, silently, until it is installed. The toolchain lands in slice 1.3, and a
//      hook that prints an npx error on every write until then trains you to ignore hook output.
//   4. Slice 1.3: §4 states **two** rules, and 1.2 collapsed them into one. Format-and-lint applies
//      to any touched file Biome is configured to see; the module's focused tests apply to a file
//      under src/<module>/. Under 1.2's single `^src/<module>/` gate, src/app.ts and src/serve.ts —
//      the whole of the walking skeleton — were formatted by nothing. Biome's scope is read out of
//      biome.json rather than repeated here, so the two cannot drift apart.
import { execFileSync, execSync } from 'node:child_process';
import { existsSync, globSync, readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';

let raw = '';
for await (const chunk of process.stdin) raw += chunk;
let file = '';
try {
  file = JSON.parse(raw)?.tool_input?.file_path ?? '';
} catch {
  process.exit(0);
}
if (!file || !file.endsWith('.ts')) process.exit(0);

const real = (p) => {
  try {
    return realpathSync(p);
  } catch {
    return resolve(p);
  }
};

const cwd = real(process.cwd());
const withinRepo = relative(cwd, real(isAbsolute(file) ? file : resolve(cwd, file)));
if (withinRepo.startsWith('..') || isAbsolute(withinRepo)) process.exit(0);

const problems = [];
const run = (cmd, args) => {
  try {
    if (args) execFileSync(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], timeout: 120_000 });
    else execSync(cmd, { cwd, stdio: ['ignore', 'pipe', 'pipe'], timeout: 120_000 });
    return true;
  } catch (e) {
    problems.push(String(e.stdout || '') + String(e.stderr || ''));
    return false;
  }
};

// Rule one — format and lint, for any file inside Biome's own scope. The prefixes come from
// biome.json's `files.includes`, so widening Biome widens the hook and neither has to remember the
// other. Running Biome on a file it is configured to ignore reports zero files processed, which is
// noise rather than feedback.
const biomeScope = (() => {
  try {
    const includes = JSON.parse(readFileSync(resolve(cwd, 'biome.json'), 'utf8')).files?.includes ?? [];
    return includes.filter((p) => !p.startsWith('!')).map((p) => p.replace(/\*.*$/, ''));
  } catch {
    return []; // No Biome config here — the toolchain's absence is not a problem to report.
  }
})();

// --error-on-warnings is deliberate. Biome's default for an unused variable is a warning and exit
// 0, so without it the hook would notice and stay silent — decoration, which is the exact defect
// slice 1.2 found in this file's exit code. `npm run lint` carries the same flag.
if (
  biomeScope.some((prefix) => withinRepo.startsWith(prefix)) &&
  existsSync(resolve(cwd, 'node_modules/.bin/biome')) &&
  // The repo-relative path, not the payload's. Biome resolves its project root through symlinks
  // and then matches `includes` against the path it was handed, so an absolute path that reaches
  // the repo through a symlink (every macOS temp directory, and any checkout under one) is
  // reported as "no files were processed" — the hook would then claim it could not clean a file
  // Biome never looked at. Caught by the fixtures in hooks.test.mjs, which live in /var/folders.
  !run(`npx --no-install biome check --write --error-on-warnings "${withinRepo}"`)
) {
  problems.push(`Biome could not clean ${withinRepo} on its own.`);
}

// Rule two — the module's focused tests, for a file under src/<module>/ and only there. Feedback in
// seconds, not at push time.
const m = withinRepo.match(/^src\/([^/]+)\//);
if (m) {
  const moduleDir = `src/${m[1]}`;
  const tests = globSync(`${moduleDir}/**/*.test.ts`, { cwd });
  if (tests.length > 0 && !run(process.execPath, ['--test', ...tests])) {
    problems.push(`Focused tests failing in ${moduleDir} after this edit.`);
  }
}

if (problems.length === 0) process.exit(0);
console.error(problems.join('\n'));
process.exit(2);
