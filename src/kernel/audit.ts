import type { Pool, PoolClient } from 'pg';
import { type Clock, systemClock } from './clock.ts';
import { KernelError } from './errors.ts';
import { newId } from './ids.ts';

export type ActorKind = 'tenant' | 'staff' | 'agent' | 'system';

export interface AuditEntry {
  actorKind: ActorKind;
  actorId?: string;
  // What permitted the action, when the actor holds one — staff roles today.
  // Unconstrained here on purpose: the kernel does not know any module's role
  // vocabulary, and a tenant or agent has none.
  actorRole?: string;
  action: string;
  subjectId?: string;
  inputs: Record<string, unknown>;
}

export interface AuditLog {
  write(entry: AuditEntry, outcome: AuditOutcome): Promise<void>;
  around<T>(entry: AuditEntry, work: () => Promise<T>): Promise<T>;
}

export type AuditOutcome =
  | { outcome: 'ok' }
  | { outcome: 'error'; code?: string; message?: string };

// A pool or a checked-out client. Widened at slice 2.3, when src/scope/ became the first caller that
// has to write its line **inside the caller's transaction**: an audit row written on a separate
// connection can survive a read that rolled back, and would then describe something that did not
// happen. Nothing else changes -- this function only ever calls .query, which both types have.
export type AuditTarget = Pool | PoolClient;

/**
 * How many times one actor did one thing since a moment. **Slice 5.2**, whose per-caller upload cap
 * is its first caller.
 *
 * A cap needs a count, and the choice is between a new counter column and the log that already
 * records exactly the event being counted. The column would be a second place the same fact lives,
 * and it would drift the first time a write path forgot it; the log cannot drift, because the row
 * being counted *is* the record of the thing happening. It costs an index-supported COUNT on a
 * bounded window rather than a single-row read, which is the right price for not keeping two
 * truths.
 *
 * **Both outcomes count.** The caller asks about attempts. A refusal still consumed the work the
 * bound exists to bound, and counting only successes would let a caller hammer a route for free by
 * being wrong on purpose.
 */
export async function countActions(
  db: AuditTarget,
  filter: { action: string; actorId: string; since: Date },
): Promise<number> {
  const { rows } = await db.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM audit_log
      WHERE action = $1 AND actor_id = $2 AND at >= $3`,
    [filter.action, filter.actorId, filter.since],
  );
  return Number(rows[0]?.n ?? 0);
}

export function createAuditLog(
  db: AuditTarget,
  clock: Clock = systemClock,
): AuditLog {
  async function write(entry: AuditEntry, result: AuditOutcome): Promise<void> {
    await db.query(
      `INSERT INTO audit_log
         (id, at, actor_kind, actor_id, actor_role, action, subject_id, inputs,
          outcome, error_code, error_message)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11)`,
      [
        newId(clock),
        clock.now(),
        entry.actorKind,
        entry.actorId ?? null,
        entry.actorRole ?? null,
        entry.action,
        entry.subjectId ?? null,
        JSON.stringify(entry.inputs),
        result.outcome,
        result.outcome === 'error' ? (result.code ?? null) : null,
        result.outcome === 'error' ? (result.message ?? null) : null,
      ],
    );
  }

  return {
    write,
    async around<T>(entry: AuditEntry, work: () => Promise<T>): Promise<T> {
      try {
        const value = await work();
        await write(entry, { outcome: 'ok' });
        return value;
      } catch (error) {
        await write(entry, {
          outcome: 'error',
          code: error instanceof KernelError ? error.code : 'unavailable',
          message: error instanceof Error ? error.message : undefined,
        });
        throw error;
      }
    },
  };
}
