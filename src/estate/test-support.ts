// One seam, used by estate's suites and by nothing that ships. Slice 1.11.
//
// `inRolledBackTransaction` gives a case a database it cannot dirty. It does not give it a database
// that is *empty*, and these cases count rows: a developer who has run `npm run seed` has a building
// at רקפת 12 committed, and the importer suite would then report that its first run created nothing
// — a failure with no defect behind it, on a machine that did what the README told it to.
//
// So the estate tables are emptied at the top of the transaction that is about to be rolled back.
// Nothing is lost, because nothing is committed, and the case starts from the only starting point it
// can reason about. It lives here rather than in kernel/pg-support.ts because it names domain
// tables, and the kernel knows no module's vocabulary.
import type { Pool, PoolClient } from 'pg';
import { inRolledBackTransaction } from '../kernel/pg-support.ts';

// Dependency order. `space` before `building`, `unit` before `space`.
const TABLES = ['unit', 'space', 'building', 'project'] as const;

export async function inEmptyEstate(
  pool: Pool,
  body: (db: PoolClient) => Promise<void>,
): Promise<void> {
  await inRolledBackTransaction(pool, async (db) => {
    for (const table of TABLES) {
      await db.query(`DELETE FROM ${table}`);
    }
    await body(db);
  });
}
