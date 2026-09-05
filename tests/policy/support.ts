// tests/policy/ is the gate for everything no model may decide (docs/pipeline.md §6). Two things it
// needs that nothing else does.
import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import type { Pool } from 'pg';
import {
  inRolledBackTransaction,
  migratedPoolOrNull,
  skipReason,
} from '../../src/kernel/pg-support.ts';
import { ISOLATION_JOIN_RELATIONS } from '../../src/scope/contract.ts';
import { SEEDED_RELATIONS } from './fixtures.ts';

export { inRolledBackTransaction, skipReason };

// The kernel already owns the skip-vs-fail decision: absent a database this returns null locally and
// throws under REQUIRE_POSTGRES=1, which is what stops a CI job going green having queried nothing.
export async function policyPool(): Promise<Pool | null> {
  return migratedPoolOrNull();
}

// Postgres SQLSTATE 42P01, undefined_table.
const UNDEFINED_TABLE = '42P01';
const relationInMessage = /relation "([^"]+)" does not exist/;

/**
 * Runs a policy case whose schema does not exist yet — and disarms itself the moment it does.
 *
 * SPEC.md's rule: a policy case written before its schema is **pending**, never skipped and never
 * `todo`. Both of those stay quiet after the tables land and have to be remembered; this branch
 * becomes unreachable on its own, and the case starts asserting for real with no edit.
 *
 * The tolerance is deliberately narrow. Only 42P01, and only on a relation the query *declares* it
 * reads — so a typo'd table name, a wrong column, a wrong row count or any other error fails the
 * build exactly as it would if the schema were complete.
 *
 * Returns true when the case actually ran.
 */
export async function pendingUntilSchema(
  t: TestContext,
  known: readonly string[],
  run: () => Promise<void>,
): Promise<boolean> {
  try {
    await run();
    return true;
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code !== UNDEFINED_TABLE) throw error;
    const message = (error as Error).message;
    const relation = relationInMessage.exec(message)?.[1];
    // A missing relation this query never names is not "pending", it is wrong.
    assert.ok(
      relation !== undefined && known.includes(relation),
      `42P01 on a relation this case does not declare: ${message}`,
    );
    t.diagnostic(`pending — relation "${relation}" does not exist yet`);
    return false;
  }
}

// Every relation a policy case may legitimately find missing before slices 1.9 / 2.1 / 2.2 have run:
// the five the join reads, plus the two the fixtures have to create to reach them. Anything else
// raising 42P01 is a typo, not a schedule.
export const POLICY_RELATIONS: readonly string[] = [
  ...new Set<string>([...ISOLATION_JOIN_RELATIONS, ...SEEDED_RELATIONS]),
];
