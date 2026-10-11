// POLICY — a call is closed only by an Exit that names its reason, and a closed
// call is never moved.
//
// SPEC-calls.md: the four Exits each require a reason, a call with no Exit
// reason is not closed, and a closed call is never reopened. #184.
//
// Written red first. The first run stored the close: `SET state = 'CLOSED'`
// with no reason succeeded, so the row was a closed call that named nothing.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { PoolClient } from 'pg';
import { fixedClock } from '../../src/kernel/clock.ts';
import { newId } from '../../src/kernel/ids.ts';
import { addOperator } from '../../src/staff/contract.ts';
import {
  inRolledBackTransaction,
  POLICY_RELATIONS,
  pendingUntilSchema,
  policyPool,
  skipReason,
} from './support.ts';

// Postgres SQLSTATE 23514, check_violation. The row is rejected, not stored.
const CHECK_VIOLATION = '23514';
// Postgres SQLSTATE 23503, foreign_key_violation. The other call is not there.
const FOREIGN_KEY_VIOLATION = '23503';
// Postgres SQLSTATE 23001, restrict_violation. Same class as the channel
// trigger: the update is refused, not rewritten.
const RESTRICT_VIOLATION = '23001';

const AT = fixedClock(new Date('2026-10-06T12:00:00.000Z'));

async function refused(
  db: PoolClient,
  sql: string,
  params: unknown[],
): Promise<string | undefined> {
  await db.query('SAVEPOINT call_exit');
  try {
    await db.query(sql, params);
    await db.query('RELEASE SAVEPOINT call_exit');
    return undefined;
  } catch (error) {
    await db.query('ROLLBACK TO SAVEPOINT call_exit');
    return (error as { code?: string }).code;
  }
}

async function insertCall(
  db: PoolClient,
  staffId: string,
  state: string,
  extra: { partyId?: string; categoryId?: string } = {},
): Promise<string> {
  const callId = newId();
  await db.query(
    `INSERT INTO service_call
       (service_call_id, source_channel, state, description, sender_label,
        sender_unknown, opened_at, opened_by, requester_party_id, category_id)
     VALUES ($1, 'PHONE', $2, 'נזילה', NULL, true, $3, $4, $5, $6)`,
    [
      callId,
      state,
      AT.now(),
      staffId,
      extra.partyId ?? null,
      extra.categoryId ?? null,
    ],
  );
  return callId;
}

describe('policy · a call closes only by an exit that names its reason', () => {
  it('refuses a close that has no exit reason', async (t) => {
    const pool = await policyPool();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await pendingUntilSchema(t, POLICY_RELATIONS, () =>
        inRolledBackTransaction(pool, async (db) => {
          const { account } = await addOperator(db, AT, {
            email: 'ops@call-exit.policy',
            role: 'OPERATOR',
          });
          const callId = await insertCall(db, account.staffAccountId, 'NEW');
          const otherId = await insertCall(db, account.staffAccountId, 'NEW');

          assert.equal(
            await refused(
              db,
              `UPDATE service_call SET state = 'CLOSED' WHERE service_call_id = $1`,
              [callId],
            ),
            CHECK_VIOLATION,
            'a close with no exit reason must be rejected, not stored',
          );

          assert.equal(
            await refused(
              db,
              `UPDATE service_call
                  SET state = 'CLOSED', exit_kind = 'ANSWERED',
                      exit_note = '   ', closed_at = $2, closed_by = $3
                WHERE service_call_id = $1`,
              [callId, AT.now(), account.staffAccountId],
            ),
            CHECK_VIOLATION,
            'a blank note is not a reason',
          );

          assert.equal(
            await refused(
              db,
              `UPDATE service_call
                  SET state = 'CLOSED', exit_kind = 'FORWARDED',
                      exit_note = 'שייך לכספים', closed_at = $2, closed_by = $3
                WHERE service_call_id = $1`,
              [callId, AT.now(), account.staffAccountId],
            ),
            CHECK_VIOLATION,
            'forwarded without a department is not a reason',
          );

          assert.equal(
            await refused(
              db,
              `UPDATE service_call
                  SET state = 'CLOSED', exit_kind = 'FORWARDED',
                      exit_department = 'כספים', closed_at = $2, closed_by = $3
                WHERE service_call_id = $1`,
              [callId, AT.now(), account.staffAccountId],
            ),
            CHECK_VIOLATION,
            'forwarded without a note is not a reason',
          );

          assert.equal(
            await refused(
              db,
              `UPDATE service_call
                  SET state = 'CLOSED', exit_kind = 'DUPLICATE',
                      closed_at = $2, closed_by = $3
                WHERE service_call_id = $1`,
              [callId, AT.now(), account.staffAccountId],
            ),
            CHECK_VIOLATION,
            'duplicate without the other call is not a reason',
          );

          assert.equal(
            await refused(
              db,
              `UPDATE service_call
                  SET state = 'CLOSED', exit_kind = 'DUPLICATE',
                      duplicate_of = $1, closed_at = $2, closed_by = $3
                WHERE service_call_id = $1`,
              [callId, AT.now(), account.staffAccountId],
            ),
            CHECK_VIOLATION,
            'a call cannot be a duplicate of itself',
          );

          assert.equal(
            await refused(
              db,
              `UPDATE service_call
                  SET state = 'CLOSED', exit_kind = 'DUPLICATE',
                      duplicate_of = $2, closed_at = $3, closed_by = $4
                WHERE service_call_id = $1`,
              [callId, newId(), AT.now(), account.staffAccountId],
            ),
            FOREIGN_KEY_VIOLATION,
            'the other call has to exist',
          );

          assert.equal(
            await refused(
              db,
              `UPDATE service_call
                  SET exit_note = 'סיבה בלי סגירה'
                WHERE service_call_id = $1`,
              [otherId],
            ),
            CHECK_VIOLATION,
            'a reason on an open call is not how a call closes',
          );

          const { rows } = await db.query<{ state: string }>(
            `SELECT state FROM service_call WHERE service_call_id = $1`,
            [callId],
          );
          assert.equal(rows[0]?.state, 'NEW');
        }),
      );
    } finally {
      await pool.end();
    }
  });

  it('refuses to move a closed call, and refuses an exit once it is scheduled', async (t) => {
    const pool = await policyPool();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await pendingUntilSchema(t, POLICY_RELATIONS, () =>
        inRolledBackTransaction(pool, async (db) => {
          const { account } = await addOperator(db, AT, {
            email: 'ops2@call-exit.policy',
            role: 'OPERATOR',
          });
          const callId = await insertCall(db, account.staffAccountId, 'NEW');
          await db.query(
            `UPDATE service_call
                SET state = 'CLOSED', exit_kind = 'ANSWERED',
                    exit_note = 'עניתי לפונה', closed_at = $2, closed_by = $3
              WHERE service_call_id = $1`,
            [callId, AT.now(), account.staffAccountId],
          );

          for (const state of ['NEW', 'IDENTIFIED', 'TRIAGED', 'SCHEDULED']) {
            assert.equal(
              await refused(
                db,
                `UPDATE service_call SET state = $2 WHERE service_call_id = $1`,
                [callId, state],
              ),
              RESTRICT_VIOLATION,
              `a closed call cannot move to ${state}`,
            );
          }

          const partyId = newId();
          await db.query(
            `INSERT INTO party (party_id, party_kind, full_name)
             VALUES ($1, 'PERSON', 'פונה לביקור')`,
            [partyId],
          );
          const { rows: categories } = await db.query<{ category_id: string }>(
            `SELECT category_id FROM call_category WHERE code = 'PLUMBING'`,
          );
          const categoryId = categories[0]?.category_id;
          assert.ok(categoryId);
          const scheduledId = await insertCall(
            db,
            account.staffAccountId,
            'SCHEDULED',
            { partyId, categoryId },
          );
          assert.equal(
            await refused(
              db,
              `UPDATE service_call
                  SET state = 'CLOSED', exit_kind = 'CANCELLED',
                      exit_note = 'מאוחר מדי', closed_at = $2, closed_by = $3
                WHERE service_call_id = $1`,
              [scheduledId, AT.now(), account.staffAccountId],
            ),
            RESTRICT_VIOLATION,
            'an exit is only from a state before scheduled',
          );
        }),
      );
    } finally {
      await pool.end();
    }
  });
});
