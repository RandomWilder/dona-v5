// The two grep guards. docs/pipeline.md §6: cheap, blunt, and impossible to argue with at 2am.
//
// They run as a step of the `gate` job, which is a **required** check on `main` with
// `enforce_admins: true` — so a guard that fires blocks every merge, including an admin's. That is
// the point, and it is also why each one was tripped deliberately on a branch at slice 1.7 rather
// than discovered on `main`.
//
// **Both guards fail when they scanned nothing.** A guard pointed at a path that matches no files
// passes forever and reads like diligence: docs/pipeline.md §6 and tasks/todo.md both wrote guard one
// against `migrations/*.sql`, which has never been where migrations live in this repository. The
// count is the part of the guard that catches that, and it is not optional.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

export interface Violation {
  guard: string;
  file: string;
  detail: string;
}

export interface GuardResult {
  guard: string;
  scanned: number;
  violations: Violation[];
}

// ---------------------------------------------------------------------------------------------
// Guard one — no migration may introduce a `current_tenant` column.
//
// Foundation rule 1: the scope is a view, never a column. The constraint is absolute, so the guard
// is too — a match in a comment fails as readily as a match in DDL, because a column named in a
// comment today is a column added tomorrow.
// ---------------------------------------------------------------------------------------------

export const MIGRATIONS_DIR = path.join('src', 'kernel', 'migrations');
const CURRENT_TENANT = /current_tenant/i;

export function guardMigrations(root: string): GuardResult {
  const dir = path.join(root, MIGRATIONS_DIR);
  // A directory that is not there is the zero-files case, not a crash: the failure to report is
  // "this guard read nothing", which is exactly what a wrong path looks like.
  const files = existsSync(dir)
    ? readdirSync(dir)
        .filter((name) => name.endsWith('.sql'))
        .sort()
    : [];
  const violations: Violation[] = [];
  for (const name of files) {
    const text = readFileSync(path.join(dir, name), 'utf8');
    text.split('\n').forEach((line, index) => {
      if (CURRENT_TENANT.test(line)) {
        violations.push({
          guard: 'no-current-tenant-column',
          file: path.join(MIGRATIONS_DIR, name),
          detail: `line ${index + 1}: ${line.trim()}`,
        });
      }
    });
  }
  return {
    guard: 'no-current-tenant-column',
    scanned: files.length,
    violations,
  };
}

// ---------------------------------------------------------------------------------------------
// Guard two — only `src/scope/` may construct the isolation join.
//
// The join is written once, in one file, where it can be read and defended in a dispute a year
// later. The way that constraint dies is not a rewrite, it is a second copy that drifts, so the
// guard matches on **the join's temporal predicates** rather than on its table names: naming
// `party_contact` is ordinary — the fixtures in tests/policy/ insert into it — while re-deciding
// *when* a contact or a tenancy counts is the thing only one file may do.
//
// Two patterns, either of which fails on its own:
//
//   - the contact-validity predicate, which is the one v3 did not have and the reason a recycled
//     Israeli mobile number could reach someone else's apartment;
//   - the tenancy-active predicate.
//
// If a later module needs an active-today predicate for its own queries, it asks `src/scope/` for it
// or the constraint is revisited on the record. It is not worked around by rephrasing.
// ---------------------------------------------------------------------------------------------

const JOIN_PREDICATES: ReadonlyArray<{ name: string; pattern: RegExp }> = [
  {
    name: 'contact-validity',
    pattern: /valid_to\s+is\s+null\s+or\s+(?:[a-z_]+\.)?valid_to\s*>=/i,
  },
  {
    name: 'tenancy-active',
    pattern: /start_date\s*<=\s*\S+\s+and\s+(?:[a-z_]+\.)?end_date\s*>=/i,
  },
];

const SCANNED_EXTENSIONS = new Set(['.ts', '.sql', '.mjs', '.js']);
const SKIPPED_DIRS = new Set(['node_modules', '.git', 'dist', '.npm-cache']);
// The one file allowed to hold the join, and the one file that has to hold the patterns that match
// it. Nothing else is ever added here: an exclusion list that grows is how a guard dies.
const JOIN_HOME = path.join('src', 'scope');
const SELF = path.join('scripts', 'guards.ts');

function* walk(root: string, from = ''): Generator<string> {
  for (const entry of readdirSync(path.join(root, from))) {
    const relative = path.join(from, entry);
    if (statSync(path.join(root, relative)).isDirectory()) {
      if (!SKIPPED_DIRS.has(entry)) yield* walk(root, relative);
    } else if (SCANNED_EXTENSIONS.has(path.extname(entry))) {
      yield relative;
    }
  }
}

export function guardScopeJoin(root: string): GuardResult {
  const violations: Violation[] = [];
  let scanned = 0;
  for (const file of walk(root)) {
    if (file === SELF || file.startsWith(`${JOIN_HOME}${path.sep}`)) continue;
    scanned += 1;
    // Collapsed, because the predicates are formatted across lines in real SQL and a guard that
    // only matches one layout is a guard that matches the copy nobody made.
    const text = readFileSync(path.join(root, file), 'utf8').replace(
      /\s+/g,
      ' ',
    );
    for (const { name, pattern } of JOIN_PREDICATES) {
      if (pattern.test(text)) {
        violations.push({
          guard: 'isolation-join-lives-in-src-scope',
          file,
          detail: `the ${name} predicate belongs to ${JOIN_HOME} and nowhere else`,
        });
      }
    }
  }
  return {
    guard: 'isolation-join-lives-in-src-scope',
    scanned,
    violations,
  };
}

// ---------------------------------------------------------------------------------------------

export function runGuards(root: string): GuardResult[] {
  return [guardMigrations(root), guardScopeJoin(root)];
}

export function report(results: GuardResult[]): boolean {
  let ok = true;
  for (const result of results) {
    if (result.scanned === 0) {
      ok = false;
      console.error(
        `guard ${result.guard}: FAILED — scanned 0 files. A guard that reads nothing passes forever.`,
      );
      continue;
    }
    for (const violation of result.violations) {
      ok = false;
      console.error(
        `guard ${violation.guard}: ${violation.file} — ${violation.detail}`,
      );
    }
    if (result.violations.length === 0) {
      console.log(
        `guard ${result.guard}: ok — ${result.scanned} files scanned`,
      );
    }
  }
  return ok;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(import.meta.filename)
) {
  process.exit(report(runGuards(process.cwd())) ? 0 : 1);
}
