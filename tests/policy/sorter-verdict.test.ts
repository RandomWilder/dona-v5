// POLICY — the sorter's reply is a proposal. It does not choose a Category
// the office has not listed, and a translation is not a decision.
//
// SPEC-channel.md: a Category not on the active list is stored as none, and
// translate timing out leaves the Hebrew text empty and does not change the
// verdict. #187.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { getCall } from '../../src/calls/contract.ts';
import {
  listMessagesOnCall,
  receiveIncoming,
} from '../../src/channel/contract.ts';
import { fixedClock } from '../../src/kernel/clock.ts';
import { inRolledBackTransaction, policyPool, skipReason } from './support.ts';

const AT = new Date('2026-10-06T12:00:00.000Z');

describe('policy · a sorter verdict decides nothing', () => {
  it('stores no category when the reply names one that is not active', async (t) => {
    const pool = await policyPool();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await inRolledBackTransaction(pool, async (db) => {
        const outcome = await receiveIncoming(
          db,
          fixedClock(AT),
          {
            sorter: {
              async sort() {
                return {
                  label: 'call' as const,
                  categoryCode: 'NOT_A_TRADE',
                  summary: 'משהו בבית',
                };
              },
              async translate() {
                return { bodyHe: 'תרגום שאינו החלטה' };
              },
            },
            matchesEmergency: async () => false,
          },
          {
            sourceChannel: 'EMAIL',
            externalMessageId: 'policy-cat',
            externalThreadId: 'policy-cat',
            senderAddress: 'tenant@policy-sorter.test',
            receivedAt: AT,
            body: 'The tap is leaking',
          },
        );
        assert.equal(outcome.kind, 'call');
        if (outcome.kind !== 'call') return;
        const call = await getCall(db, outcome.callId);
        assert.equal(call?.proposal, null);
        assert.equal(call?.state, 'NEW');
        assert.equal(call?.summary, 'משהו בבית');
        const messages = await listMessagesOnCall(db, outcome.callId);
        assert.equal(messages[0]?.bodyHe, 'תרגום שאינו החלטה');
        assert.notEqual(call?.description, messages[0]?.bodyHe);
      });
    } finally {
      await pool.end();
    }
  });

  it('keeps the verdict when translation fails, and drops the summary when sorting fails', async (t) => {
    const pool = await policyPool();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await inRolledBackTransaction(pool, async (db) => {
        const clock = fixedClock(AT);
        const translated = await receiveIncoming(
          db,
          clock,
          {
            sorter: {
              async sort() {
                return {
                  label: 'call' as const,
                  categoryCode: 'PLUMBING',
                  summary: 'נזילה בברז',
                };
              },
              async translate() {
                throw new Error('timed out');
              },
            },
            matchesEmergency: async () => false,
          },
          {
            sourceChannel: 'EMAIL',
            externalMessageId: 'policy-tr',
            externalThreadId: 'policy-tr',
            senderAddress: 'tenant@policy-sorter.test',
            receivedAt: AT,
            body: 'The tap is leaking',
          },
        );
        assert.equal(translated.kind, 'call');
        if (translated.kind !== 'call') return;
        const kept = await getCall(db, translated.callId);
        assert.equal(kept?.toReview, false);
        assert.equal(kept?.summary, 'נזילה בברז');
        assert.equal(kept?.proposal?.code, 'PLUMBING');
        const quiet = await listMessagesOnCall(db, translated.callId);
        assert.equal(quiet[0]?.bodyHe, null);

        const failed = await receiveIncoming(
          db,
          clock,
          {
            sorter: {
              async sort() {
                throw new Error('timed out');
              },
              async translate() {
                return { bodyHe: 'הברז דולף' };
              },
            },
            matchesEmergency: async () => false,
          },
          {
            sourceChannel: 'EMAIL',
            externalMessageId: 'policy-down',
            externalThreadId: 'policy-down',
            senderAddress: 'tenant@policy-sorter.test',
            receivedAt: AT,
            subject: 'Tap',
            body: 'The tap is leaking',
          },
        );
        assert.equal(failed.kind, 'call');
        if (failed.kind !== 'call') return;
        const review = await getCall(db, failed.callId);
        assert.equal(review?.toReview, true);
        assert.equal(review?.summary, null);
        assert.equal(review?.sorterModel, null);
        assert.equal(review?.state, 'NEW');
      });
    } finally {
      await pool.end();
    }
  });
});
