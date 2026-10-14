// #192. Filtered messages older than 6 months are deleted. The seam is the
// channel contract, against Postgres, the same way the intake door is tested.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import {
  getCall,
  listReturnedCalls,
  returnToFiltered,
} from '../calls/contract.ts';
import { fixedClock } from '../kernel/clock.ts';
import {
  inRolledBackTransaction,
  migratedPoolOrNull,
  skipReason,
} from '../kernel/pg-support.ts';
import { addOperator } from '../staff/contract.ts';
import {
  type IncomingMessage,
  listMessagesOnCall,
  listNoiseMessages,
  receiveIncoming,
  rescueNoise,
  type Sorter,
  sweepFilteredMessages,
} from './contract.ts';

const NOW = new Date('2026-10-08T12:00:00.000Z');
// Six calendar months before NOW is 2026-04-08T12:00:00.000Z. One second
// earlier has passed the line; the instant itself has not.
const OLD = new Date('2026-04-08T11:59:59.000Z');
const EDGE = new Date('2026-04-08T12:00:00.000Z');
const YOUNG = new Date('2026-09-01T12:00:00.000Z');

function incoming(over: Partial<IncomingMessage> = {}): IncomingMessage {
  return {
    sourceChannel: 'EMAIL',
    externalMessageId: 'msg-1',
    externalThreadId: 'thread-1',
    senderAddress: 'tenant@retention.test',
    receivedAt: NOW,
    subject: null,
    body: 'מבצע',
    ...over,
  };
}

function sorter(label: 'noise' | 'call'): Sorter {
  return {
    async sort() {
      return {
        label,
        categoryCode: label === 'call' ? 'PLUMBING' : null,
        summary: null,
      };
    },
    async translate() {
      return { bodyHe: null };
    },
  };
}

describe('channel · filtered-message retention', () => {
  it('deletes a filtered message older than 6 months and keeps a younger one', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await inRolledBackTransaction(pool, async (db) => {
        const clock = fixedClock(NOW);
        const deps = {
          sorter: sorter('noise'),
          matchesEmergency: async () => false,
        };
        const old = await receiveIncoming(
          db,
          clock,
          deps,
          incoming({
            externalMessageId: 'old',
            externalThreadId: 'old',
            receivedAt: OLD,
            body: 'ישן',
          }),
        );
        const edge = await receiveIncoming(
          db,
          clock,
          deps,
          incoming({
            externalMessageId: 'edge',
            externalThreadId: 'edge',
            receivedAt: EDGE,
            body: 'בדיוק',
          }),
        );
        const young = await receiveIncoming(
          db,
          clock,
          deps,
          incoming({
            externalMessageId: 'young',
            externalThreadId: 'young',
            receivedAt: YOUNG,
            body: 'חדש',
          }),
        );
        const call = await receiveIncoming(
          db,
          clock,
          {
            sorter: sorter('call'),
            matchesEmergency: async () => false,
          },
          incoming({
            externalMessageId: 'call',
            externalThreadId: 'call',
            receivedAt: OLD,
            body: 'נזילה אמיתית',
          }),
        );
        assert.equal(old.kind, 'filtered');
        assert.equal(edge.kind, 'filtered');
        assert.equal(young.kind, 'filtered');
        assert.equal(call.kind, 'call');
        if (call.kind !== 'call') return;

        const first = await sweepFilteredMessages(db, clock);
        assert.equal(first.deleted, 1);
        const left = await listNoiseMessages(db);
        assert.equal(
          left.some((row) => row.body === 'ישן'),
          false,
        );
        assert.equal(
          left.some((row) => row.body === 'בדיוק'),
          true,
        );
        assert.equal(
          left.some((row) => row.body === 'חדש'),
          true,
        );
        const onCall = await listMessagesOnCall(db, call.callId);
        assert.equal(onCall[0]?.body, 'נזילה אמיתית');

        const second = await sweepFilteredMessages(db, clock);
        assert.equal(second.deleted, 0);
        // Other files commit filtered messages of their own while this runs, so the list is
        // compared on this case's rows, not on its length.
        const ours = [old, edge, young].map((outcome) => outcome.messageId);
        const mine = (rows: { id: string }[]) =>
          rows
            .map((row) => row.id)
            .filter((id) => ours.includes(id))
            .sort();
        assert.deepEqual(mine(await listNoiseMessages(db)), mine(left));
      });
    } finally {
      await pool.end();
    }
  });

  it('keeps a message that is still inside 6 months when that day does not exist', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await inRolledBackTransaction(pool, async (db) => {
        const clock = fixedClock(new Date('2026-08-31T12:00:00.000Z'));
        const deps = {
          sorter: sorter('noise'),
          matchesEmergency: async () => false,
        };
        await receiveIncoming(
          db,
          clock,
          deps,
          incoming({
            externalMessageId: 'march',
            externalThreadId: 'march',
            receivedAt: new Date('2026-03-01T12:00:00.000Z'),
            body: 'מרץ',
          }),
        );
        await receiveIncoming(
          db,
          clock,
          deps,
          incoming({
            externalMessageId: 'feb',
            externalThreadId: 'feb',
            receivedAt: new Date('2026-02-27T12:00:00.000Z'),
            body: 'פברואר',
          }),
        );

        const report = await sweepFilteredMessages(db, clock);
        assert.equal(report.deleted, 1);
        const left = await listNoiseMessages(db);
        assert.equal(
          left.some((row) => row.body === 'מרץ'),
          true,
        );
        assert.equal(
          left.some((row) => row.body === 'פברואר'),
          false,
        );
      });
    } finally {
      await pool.end();
    }
  });

  it('keeps a rescued message', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await inRolledBackTransaction(pool, async (db) => {
        const clock = fixedClock(NOW);
        const outcome = await receiveIncoming(
          db,
          clock,
          {
            sorter: sorter('noise'),
            matchesEmergency: async () => false,
          },
          incoming({
            externalMessageId: 'rescued',
            externalThreadId: 'rescued',
            receivedAt: OLD,
            body: 'ניוזלטר שהוצל',
          }),
        );
        assert.equal(outcome.kind, 'filtered');
        if (outcome.kind !== 'filtered') return;
        const { account } = await addOperator(db, clock, {
          email: 'ops@retention-rescue.test',
          role: 'OPERATOR',
        });
        const rescued = await rescueNoise(db, clock, {
          messageId: outcome.messageId,
          actorId: account.staffAccountId,
        });

        const report = await sweepFilteredMessages(db, clock);
        assert.equal(report.deleted, 0);
        const messages = await listMessagesOnCall(db, rescued.callId);
        assert.equal(messages[0]?.body, 'ניוזלטר שהוצל');
        const call = await getCall(db, rescued.callId);
        assert.equal(call?.returned, false);
      });
    } finally {
      await pool.end();
    }
  });

  it('deletes the messages of a call returned to filtered and keeps the call', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await inRolledBackTransaction(pool, async (db) => {
        const now = fixedClock(NOW);
        const { account } = await addOperator(db, now, {
          email: 'ops@retention-return.test',
          role: 'OPERATOR',
        });
        const oldReturn = await receiveIncoming(
          db,
          now,
          {
            sorter: sorter('call'),
            matchesEmergency: async () => false,
          },
          incoming({
            externalMessageId: 'returned-old',
            externalThreadId: 'returned-old',
            receivedAt: YOUNG,
            body: 'הוחזר מזמן',
          }),
        );
        const youngReturn = await receiveIncoming(
          db,
          now,
          {
            sorter: sorter('call'),
            matchesEmergency: async () => false,
          },
          incoming({
            externalMessageId: 'returned-young',
            externalThreadId: 'returned-young',
            receivedAt: OLD,
            body: 'הוחזר עכשיו',
          }),
        );
        assert.equal(oldReturn.kind, 'call');
        assert.equal(youngReturn.kind, 'call');
        if (oldReturn.kind !== 'call' || youngReturn.kind !== 'call') return;
        await returnToFiltered(db, fixedClock(OLD), {
          callId: oldReturn.callId,
          actorId: account.staffAccountId,
        });
        await returnToFiltered(db, now, {
          callId: youngReturn.callId,
          actorId: account.staffAccountId,
        });

        const report = await sweepFilteredMessages(db, now);
        assert.equal(report.deleted, 1);
        assert.equal(
          (await listMessagesOnCall(db, oldReturn.callId)).length,
          0,
        );
        const kept = await getCall(db, oldReturn.callId);
        assert.equal(kept?.returned, true);
        assert.equal(kept?.description, 'הוחזר מזמן');
        const still = await listReturnedCalls(db);
        assert.equal(
          still.some((row) => row.id === oldReturn.callId),
          true,
        );
        const recent = await listMessagesOnCall(db, youngReturn.callId);
        assert.equal(recent[0]?.body, 'הוחזר עכשיו');
      });
    } finally {
      await pool.end();
    }
  });

  it('schedules the sweep once a day on staging only', () => {
    const staging = readFileSync('.github/workflows/deploy.yml', 'utf8');
    const prod = readFileSync('.github/workflows/release.yml', 'utf8');
    assert.match(staging, /src\/filtered-sweep\.ts/);
    assert.match(staging, /0 4 \* \* \*/);
    assert.match(staging, /Asia\/Jerusalem/);
    assert.doesNotMatch(prod, /filtered-sweep/);
  });
});
