// #185. A description that contains an emergency term is flagged at creation,
// and the flag says the terms set it.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fixedClock } from '../kernel/clock.ts';
import {
  inRolledBackTransaction,
  migratedPoolOrNull,
  skipReason,
} from '../kernel/pg-support.ts';
import { addOperator } from '../staff/contract.ts';
import {
  clearEmergency,
  flagEmergency,
  getCall,
  listOpenCalls,
  openCall,
  saveEmergencySettings,
} from './contract.ts';

const AT = new Date('2026-10-06T12:00:00.000Z');

describe('calls · an emergency term flags the call', () => {
  it('flags a manual call whose description contains a term, recorded as set by the terms', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await inRolledBackTransaction(pool, async (db) => {
        const clock = fixedClock(AT);
        const { account } = await addOperator(db, clock, {
          email: 'ops@calls-emergency.test',
          role: 'OPERATOR',
        });
        await saveEmergencySettings(db, clock, {
          termsText: 'שריפה\ngas',
          phone: '000-000-0000',
          hours: 'טרם נקבעו',
          actorId: account.staffAccountId,
          actorRole: 'OPERATOR',
        });

        const flagged = await openCall(db, clock, {
          sourceChannel: 'PHONE',
          description: 'יש השריפה בדירה',
          sender: { kind: 'unknown' },
          openedBy: account.staffAccountId,
        });
        const plain = await openCall(db, clock, {
          sourceChannel: 'WALK_IN',
          description: 'נזילה במטבח',
          sender: { kind: 'unknown' },
          openedBy: account.staffAccountId,
        });

        const flaggedDetail = await getCall(db, flagged.id);
        const plainDetail = await getCall(db, plain.id);
        assert.deepEqual(flaggedDetail?.emergency, {
          flagged: true,
          by: 'terms',
        });
        assert.deepEqual(plainDetail?.emergency, { flagged: false });
        assert.equal(
          flaggedDetail?.timeline.some(
            (event) => event.kind === 'FLAGGED' && event.flagBy === 'terms',
          ),
          true,
        );
      });
    } finally {
      await pool.end();
    }
  });

  it('flags and clears by hand, and records the staff account', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await inRolledBackTransaction(pool, async (db) => {
        const clock = fixedClock(AT);
        const { account } = await addOperator(db, clock, {
          email: 'hand@calls-emergency.test',
          role: 'OPERATOR',
        });
        await saveEmergencySettings(db, clock, {
          termsText: 'שריפה',
          phone: '000-000-0000',
          hours: 'טרם נקבעו',
          actorId: account.staffAccountId,
        });
        const call = await openCall(db, clock, {
          sourceChannel: 'PHONE',
          description: 'נזילה במטבח',
          sender: { kind: 'unknown' },
          openedBy: account.staffAccountId,
        });

        const flagged = await flagEmergency(db, clock, {
          callId: call.id,
          actorId: account.staffAccountId,
          actorRole: 'OPERATOR',
        });
        assert.deepEqual(flagged.emergency, {
          flagged: true,
          by: 'staff',
          actorId: account.staffAccountId,
          actorLabel: 'hand@calls-emergency.test',
        });

        const cleared = await clearEmergency(db, clock, {
          callId: call.id,
          actorId: account.staffAccountId,
          actorRole: 'OPERATOR',
        });
        assert.deepEqual(cleared.emergency, { flagged: false });
        assert.equal(
          cleared.timeline.some(
            (event) =>
              event.kind === 'CLEARED' &&
              event.actorId === account.staffAccountId,
          ),
          true,
        );

        const { rows } = await db.query<{ action: string; actor_id: string }>(
          `SELECT action, actor_id FROM audit_log
            WHERE subject_id = $1
              AND action IN ('calls.emergency.flag', 'calls.emergency.clear')
            ORDER BY action`,
          [call.id],
        );
        assert.deepEqual(
          rows.map((row) => row.action),
          ['calls.emergency.clear', 'calls.emergency.flag'],
        );
        assert.equal(rows[0]?.actor_id, account.staffAccountId);
        assert.equal(rows[1]?.actor_id, account.staffAccountId);
      });
    } finally {
      await pool.end();
    }
  });

  it('pins a flagged call ahead of a newer one, and the list can show only flagged calls', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await inRolledBackTransaction(pool, async (db) => {
        const earlier = fixedClock(new Date('2026-10-06T08:00:00.000Z'));
        const later = fixedClock(new Date('2026-10-06T18:00:00.000Z'));
        const { account } = await addOperator(db, earlier, {
          email: 'list@calls-emergency.test',
          role: 'OPERATOR',
        });
        await saveEmergencySettings(db, earlier, {
          termsText: 'שריפה',
          phone: '000-000-0000',
          hours: 'טרם נקבעו',
          actorId: account.staffAccountId,
        });
        const emergency = await openCall(db, earlier, {
          sourceChannel: 'PHONE',
          description: 'יש השריפה בדירה',
          sender: { kind: 'unknown' },
          openedBy: account.staffAccountId,
        });
        const plain = await openCall(db, later, {
          sourceChannel: 'WALK_IN',
          description: 'נזילה במטבח',
          sender: { kind: 'unknown' },
          openedBy: account.staffAccountId,
        });

        const open = await listOpenCalls(db);
        const emergencyAt = open.findIndex((call) => call.id === emergency.id);
        const plainAt = open.findIndex((call) => call.id === plain.id);
        assert.ok(emergencyAt >= 0 && plainAt > emergencyAt);

        const only = await listOpenCalls(db, { emergency: true });
        assert.equal(
          only.some((call) => call.id === emergency.id),
          true,
        );
        assert.equal(
          only.some((call) => call.id === plain.id),
          false,
        );
        assert.equal(
          only.every((call) => call.emergency.flagged),
          true,
        );
      });
    } finally {
      await pool.end();
    }
  });
});
