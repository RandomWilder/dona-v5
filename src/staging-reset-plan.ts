// The staging reset: every row of data goes, the catalogue and the people who can sign in stay.
//
// Mock leases, made-up buildings and test calls were the material staging was built on through
// October 2026. The three pilot projects arrive as real data, and they arrive into an empty system so
// that nothing they meet was invented. This is the database half of that; the bytes are
// infra/docs-delete.sh --all, and infra/staging-reset.sh runs the two in order.
//
// **The list is of what stays, not of what goes.** A table added after this file was written is
// data unless someone says otherwise, and a reset that quietly skipped it would leave mock rows
// behind in the one place nobody thought to look. Kept: the migration ledger, settings, the three
// catalogues migrations and seed scripts own, and the staff accounts — without those nobody can sign
// in to enter the first real building. Sessions and invites go with the data.
//
// **TRUNCATE without CASCADE, on purpose.** All wiped tables go in one statement, so foreign keys
// between them are fine. A kept table that references a wiped one makes Postgres refuse the whole
// statement, where CASCADE would have emptied the kept table to satisfy it. Failing is the right
// outcome there: it means the keep list is wrong.

import type { Queryable } from './kernel/db.ts';
import { KernelError } from './kernel/errors.ts';

export const KEEP_TABLES: readonly string[] = [
  'schema_migrations',
  'config_settings',
  'document_type',
  'document_type_field',
  'obligation_type',
  'call_category',
  'staff_account',
];

export interface TableCount {
  table: string;
  rows: number;
}

export interface ResetPlan {
  keep: TableCount[];
  wipe: TableCount[];
}

// Positive match, not a prod refusal: the reset runs only where the URL names the staging instance
// or the laptop's own database. An unrecognised URL is refused, the same as prod. The building seed
// (src/estate-seed.ts) holds itself to the same rule, and names itself in the refusal.
export function refuseUnlessStagingDatabase(
  databaseUrl: string | undefined,
  what = 'staging reset',
): void {
  if (databaseUrl === undefined) {
    throw new KernelError('not_allowed', `${what}: DATABASE_URL is not set`);
  }
  if (/dona-prod\b/.test(databaseUrl)) {
    throw new KernelError('not_allowed', `${what} refuses prod`);
  }
  const staging = /dona-staging\b/.test(databaseUrl);
  const local = /@(127\.0\.0\.1|localhost)[:/]/.test(databaseUrl);
  if (!staging && !local) {
    throw new KernelError(
      'not_allowed',
      `${what} runs only against dona-staging or a local database`,
    );
  }
}

export function parseStagingResetArgs(argv: string[]): {
  mode: 'list' | 'apply';
} {
  const [mode, ...rest] = argv;
  if ((mode !== 'list' && mode !== 'apply') || rest.length > 0) {
    throw new KernelError('invalid', 'usage: staging-reset list|apply');
  }
  return { mode };
}

export function partitionTables(counts: TableCount[]): ResetPlan {
  const keep = counts.filter((c) => KEEP_TABLES.includes(c.table));
  const wipe = counts.filter((c) => !KEEP_TABLES.includes(c.table));
  const missing = KEEP_TABLES.filter((t) => !keep.some((c) => c.table === t));
  if (missing.length > 0) {
    // A kept table that no longer exists is a rename this file did not hear about. Refuse rather
    // than guess, because the renamed table is now on the wipe side.
    throw new KernelError(
      'invalid',
      `staging reset: kept tables missing from the schema: ${missing.join(', ')}`,
    );
  }
  return { keep, wipe };
}

function quoteIdent(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

export async function countTables(db: Queryable): Promise<TableCount[]> {
  const { rows } = await db.query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      ORDER BY table_name`,
  );
  const counts: TableCount[] = [];
  for (const { table_name } of rows) {
    const result = await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM public.${quoteIdent(table_name)}`,
    );
    counts.push({ table: table_name, rows: Number(result.rows[0]?.n ?? 0) });
  }
  return counts;
}

export async function planStagingReset(db: Queryable): Promise<ResetPlan> {
  return partitionTables(await countTables(db));
}

// Runs inside the caller's transaction. Returns the counts as they stand afterwards, so the caller
// can print every wiped table at zero before it commits.
export async function applyStagingReset(db: Queryable): Promise<ResetPlan> {
  const plan = await planStagingReset(db);
  if (plan.wipe.length > 0) {
    const list = plan.wipe
      .map((t) => `public.${quoteIdent(t.table)}`)
      .join(', ');
    await db.query(`TRUNCATE ${list} RESTART IDENTITY`);
  }
  const after = await planStagingReset(db);
  const left = after.wipe.filter((t) => t.rows > 0);
  if (left.length > 0) {
    throw new KernelError(
      'invalid',
      `staging reset: rows survived: ${left.map((t) => t.table).join(', ')}`,
    );
  }
  return after;
}
