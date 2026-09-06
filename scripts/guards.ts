// The grep guards. docs/pipeline.md §6: cheap, blunt, and impossible to argue with at 2am.
//
// Two of them are §6's own — no `current_tenant` column, and the isolation join in one file. The
// third is slice 1.12's: `-- pii` had been a sentence in SPEC.md since 1.1 with nothing behind it,
// and the slice whose whole thesis is *controls before data* is the one that owes it a mechanism.
//
// They run as a step of the `gate` job, which is a **required** check on `main` with
// `enforce_admins: true` — so a guard that fires blocks every merge, including an admin's. That is
// the point, and it is also why each one was tripped deliberately on a branch at slice 1.7 rather
// than discovered on `main`.
//
// **Every guard fails when it scanned nothing.** A guard pointed at a path that matches no files
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

// The one thing `valid_to` may be compared to outside src/scope, and the reason it is safe rather
// than convenient. Slice 2.1's `validity_is_ordered` CHECK in `0006_parties.sql` reads
// `valid_to IS NULL OR valid_to >= valid_from`, which is a different question from the join's: it
// asks whether a row's own period is ordered, not whether a contact is valid on the day being asked
// about. `valid_to >= valid_from` is true of every well-formed row, so it cannot express "valid on
// day D" no matter who writes it or where — which is what makes this an exception the guard can
// carry without being weakened. Anything else on the right-hand side — a parameter, a literal,
// `CURRENT_DATE` — still trips it.
const SAME_ROW_ORDERING = 'valid_from';

const JOIN_PREDICATES: ReadonlyArray<{ name: string; pattern: RegExp }> = [
  {
    name: 'contact-validity',
    pattern: new RegExp(
      `valid_to\\s+is\\s+null\\s+or\\s+(?:[a-z_]+\\.)?valid_to\\s*>=(?!\\s*${SAME_ROW_ORDERING}\\b)`,
      'i',
    ),
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

// ---------------------------------------------------------------------------------------------
// Guard three — a person-shaped column carries `-- pii`.
//
// SPEC.md has said "PII columns are commented `-- pii`" since slice 1.1 and nothing enforced it,
// which is the same standing the `current_tenant` rule had before guard one. The comment is not
// decoration: it is what a deletion request, a retention rule and an access review are read against,
// and the one moment anybody knows a column holds personal data is the moment they add it.
//
// Built at 1.12, **before** the migration that needs it. `party` and `party_contact` arrive at 2.1
// and they are the first tables in this system with a person in them — so this guard is written
// against zero violations today and fires on `0006_` the day it lands, which is the whole point of
// building a control before its data.
//
// The escape is `-- not-pii: <why>`, on the column's line or in the comment block above it. A
// sentence somebody had to write and a reviewer can read; silence is not one of the options.
// ---------------------------------------------------------------------------------------------

// Names, not patterns over names: `like '%phone%'` would fire on `telephone_policy` and teach people
// to work around the guard. A column this list misses is added to it when it is met.
const PII_COLUMNS = new Set([
  'national_id',
  'id_number',
  'passport_number',
  'phone',
  'phone_number',
  'mobile',
  'email',
  'email_address',
  'first_name',
  'last_name',
  'full_name',
  'contact_name',
  'birth_date',
  'date_of_birth',
  'iban',
  'bank_account',
  'account_number',
]);

// **Qualified names, for the columns a bare name cannot reach.** Slice 2.1 met the first one:
// `party_contact.value` holds a phone number or an email address and is the most person-shaped
// column in the system, and `value` on the list above would fire on `config_settings.value` in
// `0002_kernel_durability.sql`. A guard with a false positive is one people learn to work around,
// which is worse than the gap — so the guard learned the table instead of the list learning a name
// it cannot qualify.
//
// This set stays small on purpose. A column that needs its table named is a column whose name does
// not say what it holds, and that is worth noticing rather than automating away.
const PII_QUALIFIED_COLUMNS = new Set(['party_contact.value']);

// Two shapes, because a column arrives two ways. A definition inside CREATE TABLE starts the line;
// an ALTER TABLE ... ADD COLUMN carries the table name in front of it. Both are anchored on a type
// keyword after the name, so a mention inside a comment or a constraint body is not a definition —
// and the ALTER form was written wrong first, anchored at the line start, which is what its own test
// caught before the guard ever ran against a real migration.
const COLUMN_DEFINITION: readonly RegExp[] = [
  /^\s*([a-z_][a-z0-9_]*)\s+(?:text|uuid|integer|bigint|numeric|boolean|date|timestamptz|timestamp|jsonb|vector)\b/i,
  /\badd\s+column\s+(?:if\s+not\s+exists\s+)?([a-z_][a-z0-9_]*)\s+(?:text|uuid|integer|bigint|numeric|boolean|date|timestamptz|timestamp|jsonb|vector)\b/i,
];

const MARKED = /--\s*(pii|not-pii\s*:\s*\S)/i;
const COMMENT = /^\s*--/;

// What table a column line is inside, tracked as the file is read. `CREATE TABLE x (` opens one and
// `ALTER TABLE x` opens one too — 0005 puts the ADD COLUMN on the line after it, so the name has to
// survive the line break. A `;` closes whichever is open, which is what stops a later `value` in the
// same file inheriting a table it is not in.
const CREATE_TABLE =
  /^\s*create\s+table\s+(?:if\s+not\s+exists\s+)?([a-z_][a-z0-9_]*)/i;
const ALTER_TABLE =
  /^\s*alter\s+table\s+(?:if\s+exists\s+)?([a-z_][a-z0-9_]*)/i;
const STATEMENT_END = /;/;

export function guardPiiComments(root: string): GuardResult {
  const dir = path.join(root, MIGRATIONS_DIR);
  const files = existsSync(dir)
    ? readdirSync(dir)
        .filter((name) => name.endsWith('.sql'))
        .sort()
    : [];
  const violations: Violation[] = [];
  for (const name of files) {
    const lines = readFileSync(path.join(dir, name), 'utf8').split('\n');
    let table: string | null = null;
    lines.forEach((line, index) => {
      const opened =
        CREATE_TABLE.exec(line)?.[1] ?? ALTER_TABLE.exec(line)?.[1] ?? null;
      if (opened) table = opened.toLowerCase();
      // Read on the same line the statement ends on, then close it: `ALTER TABLE party ADD COLUMN
      // birth_date date;` is one line and all three things happen on it.
      const closes = STATEMENT_END.test(line);

      const column = COLUMN_DEFINITION.map((pattern) => pattern.exec(line)?.[1])
        .find((name) => name !== undefined)
        ?.toLowerCase();
      const qualified = table && column ? `${table}.${column}` : null;
      const named =
        column !== undefined &&
        (PII_COLUMNS.has(column) ||
          (qualified !== null && PII_QUALIFIED_COLUMNS.has(qualified)));
      if (closes) table = null;
      if (!column || !named) return;
      if (MARKED.test(line)) return;
      // The comment block directly above, walked upwards until a line that is not a comment. That
      // is where `space.access_note`'s marker lives, and it is where a two-line explanation of why
      // a column is marked naturally goes.
      for (
        let at = index - 1;
        at >= 0 && COMMENT.test(lines[at] ?? '');
        at -= 1
      ) {
        if (MARKED.test(lines[at] ?? '')) return;
      }
      violations.push({
        guard: 'pii-columns-are-commented',
        file: path.join(MIGRATIONS_DIR, name),
        detail: `line ${index + 1}: \`${qualified !== null && PII_QUALIFIED_COLUMNS.has(qualified) ? qualified : column}\` holds personal data and carries no \`-- pii\` (or \`-- not-pii: <why>\`)`,
      });
    });
  }
  return {
    guard: 'pii-columns-are-commented',
    scanned: files.length,
    violations,
  };
}

// ---------------------------------------------------------------------------------------------

export function runGuards(root: string): GuardResult[] {
  return [guardMigrations(root), guardScopeJoin(root), guardPiiComments(root)];
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
