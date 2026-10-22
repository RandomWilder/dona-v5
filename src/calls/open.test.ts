// #182. A phone call and a walk-in, opened by hand, are open calls in NEW.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { PoolClient } from 'pg';
import { fixedClock } from '../kernel/clock.ts';
import { KernelError } from '../kernel/errors.ts';
import {
  inRolledBackTransaction,
  migratedPoolOrNull,
  skipReason,
} from '../kernel/pg-support.ts';
import { addOperator } from '../staff/contract.ts';
import { listOpenCalls, openCall } from './contract.ts';

const RESTRICT_VIOLATION = '23001';

const AT = new Date('2026-10-06T12:00:00.000Z');

describe('calls · opening a phone or walk-in call', () => {
  it('lists a phone call and a walk-in in NEW, each with its channel and sender', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await inRolledBackTransaction(pool, async (db) => {
        const clock = fixedClock(AT);
        const { account } = await addOperator(db, clock, {
          email: 'ops@calls-open.test',
          role: 'OPERATOR',
        });
        const phone = await openCall(db, clock, {
          sourceChannel: 'PHONE',
          description: 'נזילה במטבח',
          sender: { kind: 'named', name: 'יעל כהן' },
          openedBy: account.staffAccountId,
        });
        const walkIn = await openCall(db, clock, {
          sourceChannel: 'WALK_IN',
          description: 'מפתח תקוע',
          sender: { kind: 'unknown' },
          openedBy: account.staffAccountId,
        });

        const open = await listOpenCalls(db);
        const byId = new Map(open.map((call) => [call.id, call]));
        const listedPhone = byId.get(phone.id);
        const listedWalkIn = byId.get(walkIn.id);

        assert.equal(listedPhone?.state, 'NEW');
        assert.equal(listedPhone?.sourceChannel, 'PHONE');
        assert.equal(listedPhone?.description, 'נזילה במטבח');
        assert.deepEqual(listedPhone?.sender, {
          kind: 'named',
          name: 'יעל כהן',
        });
        assert.equal(listedWalkIn?.state, 'NEW');
        assert.equal(listedWalkIn?.sourceChannel, 'WALK_IN');
        assert.deepEqual(listedWalkIn?.sender, { kind: 'unknown' });
      });
    } finally {
      await pool.end();
    }
  });

  it('refuses a call missing the channel, the description, or a real sender', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await inRolledBackTransaction(pool, async (db) => {
        const clock = fixedClock(AT);
        const { account } = await addOperator(db, clock, {
          email: 'ops@calls-open.test',
          role: 'OPERATOR',
        });
        const openedBy = account.staffAccountId;

        await assert.rejects(
          () =>
            openCall(db, clock, {
              sourceChannel: 'EMAIL',
              description: 'נזילה',
              sender: { kind: 'unknown' },
              openedBy,
            }),
          (error: unknown) =>
            error instanceof KernelError &&
            error.code === 'invalid' &&
            error.details?.field === 'channel',
        );
        await assert.rejects(
          () =>
            openCall(db, clock, {
              sourceChannel: 'PHONE',
              description: '   ',
              sender: { kind: 'unknown' },
              openedBy,
            }),
          (error: unknown) =>
            error instanceof KernelError &&
            error.code === 'invalid' &&
            error.details?.field === 'description',
        );
        await assert.rejects(
          () =>
            openCall(db, clock, {
              sourceChannel: 'WALK_IN',
              description: 'מפתח',
              sender: { kind: 'named', name: '  ' },
              openedBy,
            }),
          (error: unknown) =>
            error instanceof KernelError &&
            error.code === 'invalid' &&
            error.details?.field === 'sender',
        );

        const stored = await db.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM service_call WHERE opened_by = $1`,
          [openedBy],
        );
        assert.equal(stored.rows[0]?.n, 0);
      });
    } finally {
      await pool.end();
    }
  });

  it('keeps the source channel that was set when the call was opened', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await inRolledBackTransaction(pool, async (db) => {
        const clock = fixedClock(AT);
        const { account } = await addOperator(db, clock, {
          email: 'ops@calls-open.test',
          role: 'OPERATOR',
        });
        const phone = await openCall(db, clock, {
          sourceChannel: 'PHONE',
          description: 'נזילה במטבח',
          sender: { kind: 'unknown' },
          openedBy: account.staffAccountId,
        });

        await rejectsChannelChange(db, phone.id);
        const listed = (await listOpenCalls(db)).find(
          (call) => call.id === phone.id,
        );
        assert.equal(listed?.sourceChannel, 'PHONE');
      });
    } finally {
      await pool.end();
    }
  });

  it('audits the create with the staff account that made it', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await inRolledBackTransaction(pool, async (db) => {
        const clock = fixedClock(AT);
        const { account } = await addOperator(db, clock, {
          email: 'ops@calls-open.test',
          role: 'OPERATOR',
        });
        const phone = await openCall(db, clock, {
          sourceChannel: 'PHONE',
          description: 'נזילה במטבח',
          sender: { kind: 'named', name: 'יעל כהן' },
          openedBy: account.staffAccountId,
          actorRole: 'OPERATOR',
        });
        const { rows } = await db.query<{
          actor_kind: string;
          actor_id: string | null;
          actor_role: string | null;
          action: string;
          outcome: string;
        }>(
          `SELECT actor_kind, actor_id, actor_role, action, outcome
             FROM audit_log
            WHERE subject_id = $1 AND action = 'calls.open'`,
          [phone.id],
        );
        assert.equal(rows.length, 1);
        assert.equal(rows[0]?.actor_kind, 'staff');
        assert.equal(rows[0]?.actor_id, account.staffAccountId);
        assert.equal(rows[0]?.actor_role, 'OPERATOR');
        assert.equal(rows[0]?.outcome, 'ok');
      });
    } finally {
      await pool.end();
    }
  });
});

async function rejectsChannelChange(
  db: PoolClient,
  callId: string,
): Promise<void> {
  await db.query('SAVEPOINT channel');
  try {
    await db.query(
      `UPDATE service_call SET source_channel = 'WALK_IN' WHERE service_call_id = $1`,
      [callId],
    );
    await db.query('ROLLBACK TO SAVEPOINT channel');
    assert.fail('the source channel was changed');
  } catch (error) {
    await db.query('ROLLBACK TO SAVEPOINT channel');
    const code = (error as { code?: string }).code;
    assert.equal(code, RESTRICT_VIOLATION);
  }
}
