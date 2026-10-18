// POLICY — sending a reply on an EMAIL call. #256.
//
// The server sends only when the actor holds calls.reply, the call is
// IDENTIFIED or later and still open, and the channel is EMAIL. A recipient
// posted by the client is ignored: the thread is the call's own inbound message.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  exitCall,
  getCall,
  identifyCall,
  openCall,
  sendCallReply,
} from '../../src/calls/contract.ts';
import {
  receiveIncoming,
  replyOnInboundEmail,
} from '../../src/channel/contract.ts';
import { fixedClock } from '../../src/kernel/clock.ts';
import { KernelError } from '../../src/kernel/errors.ts';
import { addOperator } from '../../src/staff/contract.ts';
import { seedOccupancy } from './fixtures.ts';
import { inRolledBackTransaction, policyPool, skipReason } from './support.ts';

const AT = new Date('2026-10-18T09:00:00.000Z');
const DRAFT = 'שלום, הנזילה בטיפול.';

function deliver(
  db: Parameters<typeof replyOnInboundEmail>[0],
  sent: { messageId: string; body: string }[],
) {
  return (callId: string, body: string) =>
    replyOnInboundEmail(db, callId, body, async (reply) => {
      sent.push(reply);
      return { externalMessageId: `reply:${reply.messageId}` };
    });
}

function door() {
  return {
    sorter: {
      async sort() {
        return {
          label: 'call' as const,
          categoryCode: null,
          summary: 'נזילה',
        };
      },
      async translate() {
        return { bodyHe: null };
      },
    },
    matchesEmergency: async () => false,
  };
}

async function emailCall(
  db: Parameters<typeof receiveIncoming>[0],
  clock: ReturnType<typeof fixedClock>,
  externalMessageId: string,
) {
  const outcome = await receiveIncoming(db, clock, door(), {
    sourceChannel: 'EMAIL',
    externalMessageId,
    externalThreadId: `thread-${externalMessageId}`,
    senderAddress: 'tenant@call-reply.policy',
    receivedAt: AT,
    subject: 'נזילה',
    body: 'יש נזילה במטבח',
  });
  assert.equal(outcome.kind, 'call');
  if (outcome.kind !== 'call') throw new Error('expected a call');
  return outcome.callId;
}

describe('policy · an email reply is refused unless every condition holds', () => {
  it('refuses a send without calls.reply', async (t) => {
    const pool = await policyPool();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await inRolledBackTransaction(pool, async (db) => {
        const clock = fixedClock(AT);
        const tenancy = await seedOccupancy(db, '256-perm', {
          phone: '+972501256001',
          contactFrom: '2026-01-01',
          contactTo: null,
          tenancyFrom: '2026-01-01',
          tenancyTo: '2027-01-01',
        });
        const { account } = await addOperator(db, clock, {
          email: 'view@call-reply-perm.policy',
          role: 'VIEWER',
        });
        const callId = await emailCall(db, clock, 'msg-256-perm');
        await identifyCall(db, clock, {
          callId,
          partyId: tenancy.partyId,
          actorId: account.staffAccountId,
          actorRole: 'VIEWER',
        });
        const sent: { messageId: string; body: string }[] = [];
        await assert.rejects(
          () =>
            sendCallReply(
              db,
              clock,
              {
                callId,
                body: DRAFT,
                actorId: account.staffAccountId,
                actorRole: 'VIEWER',
              },
              deliver(db, sent),
            ),
          (error: unknown) =>
            error instanceof KernelError && error.code === 'not_allowed',
        );
        assert.deepEqual(sent, []);
      });
    } finally {
      await pool.end();
    }
  });

  it('refuses a send before the call is identified', async (t) => {
    const pool = await policyPool();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await inRolledBackTransaction(pool, async (db) => {
        const clock = fixedClock(AT);
        const { account } = await addOperator(db, clock, {
          email: 'ops@call-reply-new.policy',
          role: 'OPERATOR',
        });
        const callId = await emailCall(db, clock, 'msg-256-new');
        const sent: { messageId: string; body: string }[] = [];
        await assert.rejects(
          () =>
            sendCallReply(
              db,
              clock,
              {
                callId,
                body: DRAFT,
                actorId: account.staffAccountId,
                actorRole: 'OPERATOR',
              },
              deliver(db, sent),
            ),
          (error: unknown) =>
            error instanceof KernelError &&
            error.code === 'invalid' &&
            error.details?.reason === 'new',
        );
        assert.deepEqual(sent, []);
      });
    } finally {
      await pool.end();
    }
  });

  it('refuses a send on a closed call', async (t) => {
    const pool = await policyPool();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await inRolledBackTransaction(pool, async (db) => {
        const clock = fixedClock(AT);
        const tenancy = await seedOccupancy(db, '256-closed', {
          phone: '+972501256002',
          contactFrom: '2026-01-01',
          contactTo: null,
          tenancyFrom: '2026-01-01',
          tenancyTo: '2027-01-01',
        });
        const { account } = await addOperator(db, clock, {
          email: 'ops@call-reply-closed.policy',
          role: 'OPERATOR',
        });
        const callId = await emailCall(db, clock, 'msg-256-closed');
        await identifyCall(db, clock, {
          callId,
          partyId: tenancy.partyId,
          actorId: account.staffAccountId,
          actorRole: 'OPERATOR',
        });
        await exitCall(db, clock, {
          callId,
          kind: 'ANSWERED',
          note: 'נענה בטלפון',
          actorId: account.staffAccountId,
          actorRole: 'OPERATOR',
        });
        const sent: { messageId: string; body: string }[] = [];
        await assert.rejects(
          () =>
            sendCallReply(
              db,
              clock,
              {
                callId,
                body: DRAFT,
                actorId: account.staffAccountId,
                actorRole: 'OPERATOR',
              },
              deliver(db, sent),
            ),
          (error: unknown) =>
            error instanceof KernelError &&
            error.code === 'invalid' &&
            error.details?.reason === 'closed',
        );
        assert.deepEqual(sent, []);
      });
    } finally {
      await pool.end();
    }
  });

  it('refuses a send on a channel that is not email', async (t) => {
    const pool = await policyPool();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await inRolledBackTransaction(pool, async (db) => {
        const clock = fixedClock(AT);
        const tenancy = await seedOccupancy(db, '256-phone', {
          phone: '+972501256003',
          contactFrom: '2026-01-01',
          contactTo: null,
          tenancyFrom: '2026-01-01',
          tenancyTo: '2027-01-01',
        });
        const { account } = await addOperator(db, clock, {
          email: 'ops@call-reply-phone.policy',
          role: 'OPERATOR',
        });
        const call = await openCall(db, clock, {
          sourceChannel: 'PHONE',
          description: 'נזילה',
          sender: { kind: 'unknown' },
          openedBy: account.staffAccountId,
          actorRole: 'OPERATOR',
        });
        await identifyCall(db, clock, {
          callId: call.id,
          partyId: tenancy.partyId,
          actorId: account.staffAccountId,
          actorRole: 'OPERATOR',
        });
        const sent: { messageId: string; body: string }[] = [];
        await assert.rejects(
          () =>
            sendCallReply(
              db,
              clock,
              {
                callId: call.id,
                body: DRAFT,
                actorId: account.staffAccountId,
                actorRole: 'OPERATOR',
              },
              deliver(db, sent),
            ),
          (error: unknown) =>
            error instanceof KernelError &&
            error.code === 'invalid' &&
            error.details?.field === 'reply' &&
            error.details?.reason === 'channel',
        );
        assert.deepEqual(sent, []);
      });
    } finally {
      await pool.end();
    }
  });

  it('ignores a recipient the client supplied and replies on the inbound message', async (t) => {
    const pool = await policyPool();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await inRolledBackTransaction(pool, async (db) => {
        const clock = fixedClock(AT);
        const tenancy = await seedOccupancy(db, '256-to', {
          phone: '+972501256004',
          contactFrom: '2026-01-01',
          contactTo: null,
          tenancyFrom: '2026-01-01',
          tenancyTo: '2027-01-01',
        });
        const { account } = await addOperator(db, clock, {
          email: 'ops@call-reply-to.policy',
          role: 'OPERATOR',
        });
        const callId = await emailCall(db, clock, 'msg-256-to');
        await identifyCall(db, clock, {
          callId,
          partyId: tenancy.partyId,
          actorId: account.staffAccountId,
          actorRole: 'OPERATOR',
        });
        const sent: { messageId: string; body: string }[] = [];
        await sendCallReply(
          db,
          clock,
          {
            callId,
            body: DRAFT,
            actorId: account.staffAccountId,
            actorRole: 'OPERATOR',
            recipient: 'stranger@evil.test',
          },
          deliver(db, sent),
        );
        assert.deepEqual(sent, [{ messageId: 'msg-256-to', body: DRAFT }]);
        assert.equal(
          JSON.stringify(sent).includes('stranger@evil.test'),
          false,
        );
        const detail = await getCall(db, callId);
        const row = detail?.timeline.find((event) => event.kind === 'REPLIED');
        assert.equal(row?.replyMark, 'edited');
        assert.equal(row?.actorId, account.staffAccountId);
        assert.equal(row?.note, DRAFT);
      });
    } finally {
      await pool.end();
    }
  });
});
