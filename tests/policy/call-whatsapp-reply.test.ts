// POLICY — a WhatsApp reply is refused when the 24-hour window has closed. #257.
//
// The window opens on the requester's last inbound message and closes on that
// same minute the next day. An echo does not open it. A number the client
// posts is ignored.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  getCall,
  identifyCall,
  sendCallReply,
} from '../../src/calls/contract.ts';
import {
  receiveIncoming,
  replyOnInboundWhatsapp,
} from '../../src/channel/contract.ts';
import { fixedClock } from '../../src/kernel/clock.ts';
import { KernelError } from '../../src/kernel/errors.ts';
import { addOperator } from '../../src/staff/contract.ts';
import { seedOccupancy } from './fixtures.ts';
import { inRolledBackTransaction, policyPool, skipReason } from './support.ts';

const AT = new Date('2026-10-17T09:00:00.000Z');
const BOUNDARY = new Date('2026-10-18T09:00:00.000Z');
const TEXT = 'נבדוק את הנזילה מחר.';
const NUMBER = '+972501257001';

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

describe('policy · a WhatsApp reply is refused at the boundary minute', () => {
  it('refuses a send 24 hours after the last inbound, and an echo does not extend it', async (t) => {
    const pool = await policyPool();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await inRolledBackTransaction(pool, async (db) => {
        const clock = fixedClock(BOUNDARY);
        const tenancy = await seedOccupancy(db, '257-window', {
          phone: '+972501257099',
          contactFrom: '2026-01-01',
          contactTo: null,
          tenancyFrom: '2026-01-01',
          tenancyTo: '2027-01-01',
        });
        const { account } = await addOperator(db, clock, {
          email: 'ops@call-wa-window.policy',
          role: 'OPERATOR',
        });
        const opened = await receiveIncoming(db, fixedClock(AT), door(), {
          sourceChannel: 'WHATSAPP',
          externalMessageId: 'wa-257-window',
          externalThreadId: '972501257001',
          senderAddress: NUMBER,
          receivedAt: AT,
          subject: null,
          body: 'יש נזילה במטבח',
        });
        assert.equal(opened.kind, 'call');
        if (opened.kind !== 'call') return;
        await receiveIncoming(db, clock, door(), {
          sourceChannel: 'WHATSAPP',
          externalMessageId: 'wa-257-echo',
          externalThreadId: '972501257001',
          senderAddress: '+972501000000',
          receivedAt: new Date('2026-10-18T08:00:00.000Z'),
          subject: null,
          body: 'הודעה מהמשרד',
          echo: true,
        });
        await identifyCall(db, clock, {
          callId: opened.callId,
          partyId: tenancy.partyId,
          actorId: account.staffAccountId,
          actorRole: 'OPERATOR',
        });
        const sent: { to: string; body: string }[] = [];
        await assert.rejects(
          () =>
            sendCallReply(
              db,
              clock,
              {
                callId: opened.callId,
                body: TEXT,
                actorId: account.staffAccountId,
                actorRole: 'OPERATOR',
                recipient: '972500000000',
              },
              (callId, body) =>
                replyOnInboundWhatsapp(
                  db,
                  clock,
                  callId,
                  body,
                  async (reply) => {
                    sent.push(reply);
                    return { externalMessageId: `reply:${reply.to}` };
                  },
                ),
            ),
          (error: unknown) =>
            error instanceof KernelError &&
            error.code === 'invalid' &&
            error.details?.field === 'reply' &&
            error.details?.reason === 'window',
        );
        assert.deepEqual(sent, []);
      });
    } finally {
      await pool.end();
    }
  });

  it('sends to the last inbound number after the earlier window has closed', async (t) => {
    const pool = await policyPool();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await inRolledBackTransaction(pool, async (db) => {
        const clock = fixedClock(BOUNDARY);
        const tenancy = await seedOccupancy(db, '257-inside', {
          phone: '+972501257098',
          contactFrom: '2026-01-01',
          contactTo: null,
          tenancyFrom: '2026-01-01',
          tenancyTo: '2027-01-01',
        });
        const { account } = await addOperator(db, clock, {
          email: 'ops@call-wa-inside.policy',
          role: 'OPERATOR',
        });
        const opened = await receiveIncoming(db, fixedClock(AT), door(), {
          sourceChannel: 'WHATSAPP',
          externalMessageId: 'wa-257-first',
          externalThreadId: '972501257001',
          senderAddress: NUMBER,
          receivedAt: AT,
          subject: null,
          body: 'יש נזילה במטבח',
        });
        assert.equal(opened.kind, 'call');
        if (opened.kind !== 'call') return;
        const attached = await receiveIncoming(db, clock, door(), {
          sourceChannel: 'WHATSAPP',
          externalMessageId: 'wa-257-later',
          externalThreadId: '972501257001',
          senderAddress: NUMBER,
          receivedAt: new Date('2026-10-18T08:59:00.000Z'),
          subject: null,
          body: 'עדיין נזילה',
        });
        assert.equal(attached.kind, 'attached');
        await identifyCall(db, clock, {
          callId: opened.callId,
          partyId: tenancy.partyId,
          actorId: account.staffAccountId,
          actorRole: 'OPERATOR',
        });
        const sent: { to: string; body: string }[] = [];
        await sendCallReply(
          db,
          clock,
          {
            callId: opened.callId,
            body: TEXT,
            actorId: account.staffAccountId,
            actorRole: 'OPERATOR',
            recipient: '972500000000',
          },
          (callId, body) =>
            replyOnInboundWhatsapp(db, clock, callId, body, async (reply) => {
              sent.push(reply);
              return { externalMessageId: `reply:${reply.to}` };
            }),
        );
        assert.deepEqual(sent, [{ to: '972501257001', body: TEXT }]);
        const detail = await getCall(db, opened.callId);
        const row = detail?.timeline.find((event) => event.kind === 'REPLIED');
        assert.equal(row?.replyMark, 'as_written');
        assert.equal(row?.actorId, account.staffAccountId);
        assert.equal(row?.note, TEXT);
        const { rows } = await db.query<{
          actor_id: string;
          inputs: { mark: string; text: string };
        }>(
          `SELECT actor_id, inputs
             FROM audit_log
            WHERE action = 'calls.reply' AND subject_id = $1`,
          [opened.callId],
        );
        assert.equal(rows.length, 1);
        assert.equal(rows[0]?.actor_id, account.staffAccountId);
        assert.equal(rows[0]?.inputs.mark, 'as_written');
        assert.equal(rows[0]?.inputs.text, TEXT);
        assert.equal(JSON.stringify(rows).includes('972500000000'), false);
      });
    } finally {
      await pool.end();
    }
  });
});
