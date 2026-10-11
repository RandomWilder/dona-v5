// #186. The door's contract, against Postgres, with the sorter injected.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  exitCall,
  flagEmergency,
  getCall,
  listCategories,
  listOpenCalls,
  openCall,
  saveEmergencySettings,
} from '../calls/contract.ts';
import { fixedClock } from '../kernel/clock.ts';
import {
  inRolledBackTransaction,
  migratedPoolOrNull,
  skipReason,
} from '../kernel/pg-support.ts';
import { addOperator } from '../staff/contract.ts';
import {
  emergencyMatch,
  type IncomingMessage,
  listMessagesOnCall,
  listNoiseMessages,
  receiveIncoming,
  rescueNoise,
  type Sorter,
  type SortVerdict,
} from './contract.ts';

const AT = new Date('2026-10-06T12:00:00.000Z');

const CALL: SortVerdict = {
  label: 'call',
  categoryCode: 'PLUMBING',
  summary: 'נזילה בצינור',
};

function incoming(over: Partial<IncomingMessage> = {}): IncomingMessage {
  return {
    sourceChannel: 'EMAIL',
    externalMessageId: 'msg-1',
    externalThreadId: 'thread-1',
    senderAddress: 'tenant@door.test',
    receivedAt: AT,
    subject: 'נזילה',
    body: 'יש נזילה במטבח',
    ...over,
  };
}

function counting(verdict: SortVerdict | 'throw', seen: string[]): Sorter {
  return {
    async sort(input) {
      seen.push('sorter');
      assert.deepEqual(Object.keys(input).sort(), [
        'body',
        'categories',
        'subject',
      ]);
      if (verdict === 'throw') throw new Error('sorter down');
      return verdict;
    },
    async translate(input) {
      assert.deepEqual(Object.keys(input).sort(), ['body', 'subject']);
      return { bodyHe: null };
    },
  };
}

describe('channel · the intake door', () => {
  it('stores one message when the same external id arrives twice', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await inRolledBackTransaction(pool, async (db) => {
        const clock = fixedClock(AT);
        const seen: string[] = [];
        const deps = {
          sorter: counting(CALL, seen),
          matchesEmergency: async () => false,
        };
        const first = await receiveIncoming(db, clock, deps, incoming());
        const second = await receiveIncoming(db, clock, deps, incoming());
        assert.equal(first.kind, 'call');
        assert.equal(second.kind, 'duplicate');
        if (first.kind !== 'call' || second.kind !== 'duplicate') return;
        assert.equal(second.callId, first.callId);
        assert.deepEqual(seen, ['sorter']);
        const messages = await listMessagesOnCall(db, first.callId);
        assert.equal(messages.length, 1);
        assert.equal(messages[0]?.body, 'יש נזילה במטבח');
        assert.equal(messages[0]?.attachments.length, 0);
      });
    } finally {
      await pool.end();
    }
  });

  it('flags an emergency before the sorter is called', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await inRolledBackTransaction(pool, async (db) => {
        const clock = fixedClock(AT);
        const seen: string[] = [];
        const outcome = await receiveIncoming(
          db,
          clock,
          {
            sorter: counting(CALL, seen),
            matchesEmergency: async () => {
              seen.push('emergency');
              return true;
            },
          },
          incoming({
            externalMessageId: 'em-order',
            body: 'יש שריפה בדירה',
          }),
        );
        assert.deepEqual(seen, ['emergency', 'sorter']);
        assert.equal(outcome.kind, 'call');
        if (outcome.kind !== 'call') return;
        const call = await getCall(db, outcome.callId);
        assert.equal(call?.emergency.flagged, true);
        if (call?.emergency.flagged) assert.equal(call.emergency.by, 'terms');
        assert.equal(call?.state, 'NEW');
        assert.equal(call?.toReview, false);
        assert.equal(call?.requester, null);
      });
    } finally {
      await pool.end();
    }
  });

  it('keeps the message when the emergency check throws, and the next delivery finishes it', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await inRolledBackTransaction(pool, async (db) => {
        const clock = fixedClock(AT);
        const seen: string[] = [];
        let checks = 0;
        const message = incoming({
          externalMessageId: 'keep-1',
          externalThreadId: 'keep-t',
          body: 'יש נזילה במטבח',
        });
        const deps = {
          sorter: counting(CALL, seen),
          matchesEmergency: async () => {
            checks += 1;
            if (checks === 1) throw new Error('terms unread');
            return false;
          },
        };
        await assert.rejects(
          () => receiveIncoming(db, clock, deps, message),
          /terms unread/,
        );
        const held = await db.query<{
          service_call_id: string | null;
        }>(
          `SELECT service_call_id FROM message
            WHERE source_channel = 'EMAIL' AND external_message_id = 'keep-1'`,
        );
        assert.equal(held.rows.length, 1);
        assert.equal(held.rows[0]?.service_call_id, null);
        assert.deepEqual(seen, []);

        const finished = await receiveIncoming(db, clock, deps, message);
        assert.equal(finished.kind, 'call');
        if (finished.kind !== 'call') return;
        assert.deepEqual(seen, ['sorter']);
        const messages = await listMessagesOnCall(db, finished.callId);
        assert.equal(messages.length, 1);
        assert.equal(messages[0]?.body, 'יש נזילה במטבח');
        const again = await receiveIncoming(db, clock, deps, message);
        assert.equal(again.kind, 'duplicate');
        assert.deepEqual(seen, ['sorter']);
      });
    } finally {
      await pool.end();
    }
  });

  it('flags a real emergency term, and the sorter still runs after', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await inRolledBackTransaction(pool, async (db) => {
        const clock = fixedClock(AT);
        const { account } = await addOperator(db, clock, {
          email: 'ops@door-emergency.test',
          role: 'OPERATOR',
        });
        await saveEmergencySettings(db, clock, {
          termsText: 'שריפה',
          phone: '000-000-0000',
          hours: 'תמיד',
          actorId: account.staffAccountId,
        });
        const seen: string[] = [];
        const outcome = await receiveIncoming(
          db,
          clock,
          {
            sorter: counting(CALL, seen),
            matchesEmergency: emergencyMatch(db),
          },
          incoming({
            externalMessageId: 'em-real',
            body: 'יש שריפה בדירה',
          }),
        );
        assert.deepEqual(seen, ['sorter']);
        assert.equal(outcome.kind, 'call');
        if (outcome.kind !== 'call') return;
        const call = await getCall(db, outcome.callId);
        assert.equal(call?.emergency.flagged, true);
        if (call?.emergency.flagged) assert.equal(call.emergency.by, 'terms');
        assert.equal(call?.summary, 'נזילה בצינור');
        assert.equal(call?.proposal?.code, 'PLUMBING');
        assert.equal(call?.proposal?.labelHe, 'אינסטלציה');
        assert.equal(call?.category, null);
        assert.equal(call?.state, 'NEW');
      });
    } finally {
      await pool.end();
    }
  });

  it('attaches to an open call, and opens a linked call when that call is closed', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await inRolledBackTransaction(pool, async (db) => {
        const clock = fixedClock(AT);
        const { account } = await addOperator(db, clock, {
          email: 'ops@door-thread.test',
          role: 'OPERATOR',
        });
        const seen: string[] = [];
        const deps = {
          sorter: counting(CALL, seen),
          matchesEmergency: async () => false,
        };
        const first = await receiveIncoming(
          db,
          clock,
          deps,
          incoming({ externalMessageId: 'th-1', externalThreadId: 'thread-a' }),
        );
        const second = await receiveIncoming(
          db,
          clock,
          deps,
          incoming({
            externalMessageId: 'th-2',
            externalThreadId: 'thread-a',
            body: 'עוד תמונה של הנזילה',
            receivedAt: new Date(AT.getTime() + 60_000),
          }),
        );
        assert.equal(first.kind, 'call');
        assert.equal(second.kind, 'attached');
        if (first.kind !== 'call' || second.kind !== 'attached') return;
        assert.equal(second.callId, first.callId);
        assert.deepEqual(seen, ['sorter']);
        const onFirst = await listMessagesOnCall(db, first.callId);
        assert.deepEqual(
          onFirst.map((message) => message.body),
          ['יש נזילה במטבח', 'עוד תמונה של הנזילה'],
        );

        await exitCall(db, clock, {
          callId: first.callId,
          kind: 'ANSWERED',
          note: 'טופל',
          actorId: account.staffAccountId,
        });
        const third = await receiveIncoming(
          db,
          clock,
          deps,
          incoming({
            externalMessageId: 'th-3',
            externalThreadId: 'thread-a',
            body: 'חזרו המים',
            receivedAt: new Date(AT.getTime() + 120_000),
          }),
        );
        assert.equal(third.kind, 'call');
        if (third.kind !== 'call') return;
        assert.notEqual(third.callId, first.callId);
        const opened = await getCall(db, third.callId);
        assert.equal(opened?.predecessor?.id, first.callId);
        assert.equal(opened?.state, 'NEW');
        assert.deepEqual(seen, ['sorter', 'sorter']);
      });
    } finally {
      await pool.end();
    }
  });

  it('lands a call, an unsure verdict, noise, and a sorter that throws', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await inRolledBackTransaction(pool, async (db) => {
        const clock = fixedClock(AT);
        const call = await receiveIncoming(
          db,
          clock,
          {
            sorter: counting(CALL, []),
            matchesEmergency: async () => false,
          },
          incoming({ externalMessageId: 'v-call', externalThreadId: 't-call' }),
        );
        assert.equal(call.kind, 'call');
        if (call.kind !== 'call') return;
        const opened = await getCall(db, call.callId);
        assert.equal(opened?.state, 'NEW');
        assert.equal(opened?.toReview, false);
        assert.equal(opened?.sorterLabel, 'call');
        assert.equal(opened?.summary, 'נזילה בצינור');

        const unsure = await receiveIncoming(
          db,
          clock,
          {
            sorter: counting(
              { label: 'unsure', categoryCode: 'LOCKS', summary: 'אולי מנעול' },
              [],
            ),
            matchesEmergency: async () => false,
          },
          incoming({
            externalMessageId: 'v-unsure',
            externalThreadId: 't-unsure',
          }),
        );
        assert.equal(unsure.kind, 'call');
        if (unsure.kind !== 'call') return;
        const review = await getCall(db, unsure.callId);
        assert.equal(review?.toReview, true);
        assert.equal(review?.state, 'NEW');
        assert.equal(review?.summary, 'אולי מנעול');
        assert.equal(review?.proposal?.code, 'LOCKS');

        const noise = await receiveIncoming(
          db,
          clock,
          {
            sorter: counting(
              { label: 'noise', categoryCode: null, summary: null },
              [],
            ),
            matchesEmergency: async () => false,
          },
          incoming({
            externalMessageId: 'v-noise',
            externalThreadId: 't-noise',
            body: 'מבצע השבוע',
          }),
        );
        assert.equal(noise.kind, 'filtered');
        if (noise.kind !== 'filtered') return;
        const listed = await listOpenCalls(db);
        assert.equal(
          listed.some((row) => row.description === 'מבצע השבוע'),
          false,
        );
        const aside = await listNoiseMessages(db);
        const mine = aside.find((row) => row.id === noise.messageId);
        assert.equal(mine?.body, 'מבצע השבוע');

        const thrown = await receiveIncoming(
          db,
          clock,
          {
            sorter: counting('throw', []),
            matchesEmergency: async () => false,
          },
          incoming({
            externalMessageId: 'v-throw',
            externalThreadId: 't-throw',
            subject: 'לא ברור',
            body: 'משהו קרה',
          }),
        );
        assert.equal(thrown.kind, 'call');
        if (thrown.kind !== 'call') return;
        const recovered = await getCall(db, thrown.callId);
        assert.equal(recovered?.toReview, true);
        assert.equal(recovered?.summary, null);
        assert.equal(recovered?.state, 'NEW');
        assert.equal(recovered?.description, 'לא ברור');
        const kept = await listMessagesOnCall(db, thrown.callId);
        assert.equal(kept[0]?.body, 'משהו קרה');
      });
    } finally {
      await pool.end();
    }
  });

  it('does not filter a message that matches an emergency term', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await inRolledBackTransaction(pool, async (db) => {
        const clock = fixedClock(AT);
        const outcome = await receiveIncoming(
          db,
          clock,
          {
            sorter: counting(
              { label: 'noise', categoryCode: null, summary: null },
              [],
            ),
            matchesEmergency: async () => true,
          },
          incoming({
            externalMessageId: 'em-noise',
            externalThreadId: 't-em-noise',
            body: 'שריפה בבניין',
          }),
        );
        assert.equal(outcome.kind, 'call');
        if (outcome.kind !== 'call') return;
        const call = await getCall(db, outcome.callId);
        assert.equal(call?.emergency.flagged, true);
        assert.equal(call?.toReview, true);
        const aside = await listNoiseMessages(db);
        assert.equal(
          aside.some((row) => row.body === 'שריפה בבניין'),
          false,
        );
      });
    } finally {
      await pool.end();
    }
  });

  it('stores an echo on the open call and never opens one', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await inRolledBackTransaction(pool, async (db) => {
        const clock = fixedClock(AT);
        const seen: string[] = [];
        const deps = {
          sorter: counting(CALL, seen),
          matchesEmergency: async () => {
            seen.push('emergency');
            return true;
          },
        };
        const opened = await receiveIncoming(
          db,
          clock,
          deps,
          incoming({
            externalMessageId: 'echo-open',
            externalThreadId: 'thread-echo',
          }),
        );
        assert.equal(opened.kind, 'call');
        if (opened.kind !== 'call') return;
        const echo = await receiveIncoming(
          db,
          clock,
          deps,
          incoming({
            externalMessageId: 'echo-1',
            externalThreadId: 'thread-echo',
            body: 'שריפה? לא, נסגר.',
            echo: true,
          }),
        );
        assert.equal(echo.kind, 'echo');
        if (echo.kind !== 'echo') return;
        assert.equal(echo.callId, opened.callId);
        const messages = await listMessagesOnCall(db, opened.callId);
        const echoed = messages.find(
          (message) => message.body === 'שריפה? לא, נסגר.',
        );
        assert.equal(echoed?.echo, true);
        const alone = await receiveIncoming(
          db,
          clock,
          deps,
          incoming({
            externalMessageId: 'echo-2',
            externalThreadId: 'thread-echo-new',
            echo: true,
            body: 'שריפה',
          }),
        );
        assert.equal(alone.kind, 'echo');
        if (alone.kind !== 'echo') return;
        assert.equal(alone.callId, null);
        const open = await listOpenCalls(db);
        assert.equal(
          open.some(
            (call) =>
              call.id !== opened.callId &&
              call.summary === 'נזילה בצינור' &&
              call.description.includes('שריפה'),
          ),
          false,
        );
        assert.deepEqual(seen, ['emergency', 'sorter']);
      });
    } finally {
      await pool.end();
    }
  });

  it('moves a duplicate call’s messages onto the call it repeats', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await inRolledBackTransaction(pool, async (db) => {
        const clock = fixedClock(AT);
        const { account } = await addOperator(db, clock, {
          email: 'ops@door-dup.test',
          role: 'OPERATOR',
        });
        const deps = {
          sorter: counting(CALL, []),
          matchesEmergency: async () => false,
        };
        const kept = await receiveIncoming(
          db,
          clock,
          deps,
          incoming({
            externalMessageId: 'dup-kept',
            externalThreadId: 'thread-kept',
            body: 'הקריאה שנשארת',
          }),
        );
        const copy = await receiveIncoming(
          db,
          clock,
          deps,
          incoming({
            externalMessageId: 'dup-copy',
            externalThreadId: 'thread-copy',
            body: 'הקריאה הכפולה',
            receivedAt: new Date(AT.getTime() + 60_000),
            attachments: [{ fileName: 'leak.jpg' }],
          }),
        );
        assert.equal(kept.kind, 'call');
        assert.equal(copy.kind, 'call');
        if (kept.kind !== 'call' || copy.kind !== 'call') return;
        await exitCall(db, clock, {
          callId: copy.callId,
          kind: 'DUPLICATE',
          duplicateOf: kept.callId,
          actorId: account.staffAccountId,
        });
        const onKept = await listMessagesOnCall(db, kept.callId);
        const onCopy = await listMessagesOnCall(db, copy.callId);
        assert.deepEqual(
          onKept.map((message) => message.body),
          ['הקריאה שנשארת', 'הקריאה הכפולה'],
        );
        assert.equal(onKept[1]?.attachments[0]?.fileName, 'leak.jpg');
        assert.equal(onCopy.length, 0);
      });
    } finally {
      await pool.end();
    }
  });

  it('stores no category when the verdict names one that is not active', async (t) => {
    const pool = await migratedPoolOrNull();
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
                  modelId: 'gpt-test',
                  promptVersion: 'sorter-1',
                };
              },
              async translate() {
                return { bodyHe: null };
              },
            },
            matchesEmergency: async () => false,
          },
          incoming({ externalMessageId: 'bad-cat', externalThreadId: 't-bad' }),
        );
        assert.equal(outcome.kind, 'call');
        if (outcome.kind !== 'call') return;
        const call = await getCall(db, outcome.callId);
        assert.equal(call?.proposal, null);
        assert.equal(call?.summary, 'משהו בבית');
        assert.equal(call?.sorterModel, 'gpt-test');
        assert.equal(call?.sorterPrompt, 'sorter-1');
      });
    } finally {
      await pool.end();
    }
  });

  it('records the model and the prompt, and keeps them when a filtered message is rescued', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await inRolledBackTransaction(pool, async (db) => {
        const clock = fixedClock(AT);
        const active = await listCategories(db, { activeOnly: true });
        const outcome = await receiveIncoming(
          db,
          clock,
          {
            sorter: {
              async sort(input) {
                assert.deepEqual(
                  input.categories.map((row) => row.code),
                  active.map((row) => row.code),
                );
                return {
                  label: 'noise' as const,
                  categoryCode: null,
                  summary: null,
                  modelId: 'gpt-test',
                  promptVersion: 'sorter-1',
                };
              },
              async translate(input) {
                assert.deepEqual(Object.keys(input).sort(), [
                  'body',
                  'subject',
                ]);
                return { bodyHe: null };
              },
            },
            matchesEmergency: async () => false,
          },
          incoming({
            externalMessageId: 'noise-stamp',
            externalThreadId: 't-stamp',
            body: 'מבצע של החנות',
          }),
        );
        assert.equal(outcome.kind, 'filtered');
        if (outcome.kind !== 'filtered') return;
        const aside = await listNoiseMessages(db);
        const mine = aside.find((row) => row.id === outcome.messageId);
        assert.equal(mine?.sorterModel, 'gpt-test');
        assert.equal(mine?.sorterPrompt, 'sorter-1');

        const { account } = await addOperator(db, clock, {
          email: 'ops@door-stamp.test',
          role: 'OPERATOR',
        });
        const rescued = await rescueNoise(db, clock, {
          messageId: outcome.messageId,
          actorId: account.staffAccountId,
        });
        const call = await getCall(db, rescued.callId);
        assert.equal(call?.sorterLabel, 'noise');
        assert.equal(call?.sorterModel, 'gpt-test');
        assert.equal(call?.sorterPrompt, 'sorter-1');
      });
    } finally {
      await pool.end();
    }
  });

  it('keeps a Hebrew translation beside the original', async (t) => {
    const pool = await migratedPoolOrNull();
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
                  categoryCode: 'PLUMBING',
                  summary: 'נזילה בברז',
                };
              },
              async translate() {
                return { bodyHe: 'הברז במטבח מטפטף' };
              },
            },
            matchesEmergency: async () => false,
          },
          incoming({
            externalMessageId: 'ru-1',
            externalThreadId: 't-ru',
            subject: null,
            body: 'На кухне течёт кран',
          }),
        );
        assert.equal(outcome.kind, 'call');
        if (outcome.kind !== 'call') return;
        const call = await getCall(db, outcome.callId);
        assert.equal(call?.summary, 'נזילה בברז');
        assert.equal(call?.toReview, false);
        const messages = await listMessagesOnCall(db, outcome.callId);
        assert.equal(messages[0]?.body, 'На кухне течёт кран');
        assert.equal(messages[0]?.bodyHe, 'הברז במטבח מטפטף');
      });
    } finally {
      await pool.end();
    }
  });

  it('opens a call to review with no summary when sorting fails, and still keeps a translation', async (t) => {
    const pool = await migratedPoolOrNull();
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
                throw new Error('timed out');
              },
              async translate() {
                return { bodyHe: 'הברז במטבח מטפטף' };
              },
            },
            matchesEmergency: async () => false,
          },
          incoming({
            externalMessageId: 'timeout-1',
            externalThreadId: 't-timeout',
            subject: 'Кран',
            body: 'На кухне течёт кран',
          }),
        );
        assert.equal(outcome.kind, 'call');
        if (outcome.kind !== 'call') return;
        const call = await getCall(db, outcome.callId);
        assert.equal(call?.toReview, true);
        assert.equal(call?.summary, null);
        assert.equal(call?.sorterModel, null);
        assert.equal(call?.sorterPrompt, null);
        assert.equal(call?.state, 'NEW');
        const messages = await listMessagesOnCall(db, outcome.callId);
        assert.equal(messages[0]?.bodyHe, 'הברז במטבח מטפטף');
      });
    } finally {
      await pool.end();
    }
  });

  it('does not change the verdict when translation fails', async (t) => {
    const pool = await migratedPoolOrNull();
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
                return CALL;
              },
              async translate() {
                throw new Error('timed out');
              },
            },
            matchesEmergency: async () => false,
          },
          incoming({
            externalMessageId: 'tr-fail',
            externalThreadId: 't-tr-fail',
          }),
        );
        assert.equal(outcome.kind, 'call');
        if (outcome.kind !== 'call') return;
        const call = await getCall(db, outcome.callId);
        assert.equal(call?.toReview, false);
        assert.equal(call?.summary, 'נזילה בצינור');
        const messages = await listMessagesOnCall(db, outcome.callId);
        assert.equal(messages[0]?.bodyHe, null);
      });
    } finally {
      await pool.end();
    }
  });

  it('sends the duty sentence on a flagged WhatsApp message before any model, once', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await inRolledBackTransaction(pool, async (db) => {
        const clock = fixedClock(AT);
        const { account } = await addOperator(db, clock, {
          email: 'duty@door-reply.test',
          role: 'OPERATOR',
        });
        await saveEmergencySettings(db, clock, {
          termsText: 'שריפה',
          phone: '050-194-0000',
          hours: 'א׳–ה׳ 08:00–20:00',
          actorId: account.staffAccountId,
        });
        const seen: string[] = [];
        const sent: { to: string; body: string }[] = [];
        const deps = {
          sorter: {
            async sort() {
              seen.push('sorter');
              return {
                label: 'call' as const,
                categoryCode: null,
                summary: 'סיכום מהמודל',
              };
            },
            async translate() {
              seen.push('translate');
              return { bodyHe: null };
            },
          },
          matchesEmergency: emergencyMatch(db),
          replyOnWhatsapp: async (reply: { to: string; body: string }) => {
            seen.push('reply');
            sent.push(reply);
            return { externalMessageId: 'wamid.duty.194' };
          },
        };
        const outcome = await receiveIncoming(
          db,
          clock,
          deps,
          incoming({
            sourceChannel: 'WHATSAPP',
            externalMessageId: 'wa-194-1',
            externalThreadId: '972599001194',
            senderAddress: '+972599001194',
            subject: null,
            body: 'יש שריפה בדירה',
          }),
        );
        assert.equal(outcome.kind, 'call');
        if (outcome.kind !== 'call') return;
        assert.deepEqual(seen, ['reply', 'translate', 'sorter']);
        assert.deepEqual(sent, [
          {
            to: '972599001194',
            body: 'קריאת חירום. להתקשר לכונן: 050-194-0000. שעות כונן: א׳–ה׳ 08:00–20:00.',
          },
        ]);
        const messages = await listMessagesOnCall(db, outcome.callId);
        const reply = messages.find((message) => message.echo);
        assert.equal(
          reply?.body,
          'קריאת חירום. להתקשר לכונן: 050-194-0000. שעות כונן: א׳–ה׳ 08:00–20:00.',
        );
        const { rows } = await db.query<{ action: string }>(
          `SELECT action FROM audit_log
            WHERE subject_id = $1 AND action = 'channel.duty_reply'`,
          [outcome.callId],
        );
        assert.deepEqual(
          rows.map((row) => row.action),
          ['channel.duty_reply'],
        );

        await receiveIncoming(
          db,
          clock,
          deps,
          incoming({
            sourceChannel: 'WHATSAPP',
            externalMessageId: 'wa-194-2',
            externalThreadId: '972599001194',
            senderAddress: '+972599001194',
            subject: null,
            body: 'עדיין שריפה',
          }),
        );
        assert.equal(sent.length, 1);
      });
    } finally {
      await pool.end();
    }
  });

  it('sends nothing for a hand flag or a phone or walk-in call', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await inRolledBackTransaction(pool, async (db) => {
        const clock = fixedClock(AT);
        const { account } = await addOperator(db, clock, {
          email: 'hand@door-reply.test',
          role: 'OPERATOR',
        });
        await saveEmergencySettings(db, clock, {
          termsText: 'שריפה',
          phone: '050-194-0000',
          hours: 'א׳–ה׳ 08:00–20:00',
          actorId: account.staffAccountId,
        });
        const sent: string[] = [];
        const deps = {
          sorter: counting(CALL, []),
          matchesEmergency: emergencyMatch(db),
          replyOnWhatsapp: async () => {
            sent.push('sent');
            return { externalMessageId: 'wamid.duty.no' };
          },
        };

        const opened = await receiveIncoming(
          db,
          clock,
          deps,
          incoming({
            sourceChannel: 'WHATSAPP',
            externalMessageId: 'wa-hand-1',
            externalThreadId: '972599001195',
            senderAddress: '+972599001195',
            subject: null,
            body: 'נזילה רגילה',
          }),
        );
        assert.equal(opened.kind, 'call');
        if (opened.kind !== 'call') return;
        await flagEmergency(db, clock, {
          callId: opened.callId,
          actorId: account.staffAccountId,
          actorRole: 'OPERATOR',
        });
        await receiveIncoming(
          db,
          clock,
          deps,
          incoming({
            sourceChannel: 'WHATSAPP',
            externalMessageId: 'wa-hand-2',
            externalThreadId: '972599001195',
            senderAddress: '+972599001195',
            subject: null,
            body: 'יש שריפה בדירה',
          }),
        );

        const emailed = await receiveIncoming(
          db,
          clock,
          deps,
          incoming({
            sourceChannel: 'EMAIL',
            externalMessageId: 'mail-194',
            externalThreadId: 'mail-thread-194',
            senderAddress: 'tenant@door-reply.test',
            body: 'יש שריפה בדירה',
          }),
        );
        assert.equal(emailed.kind, 'call');
        if (emailed.kind !== 'call') return;
        const emailedCall = await getCall(db, emailed.callId);
        assert.equal(emailedCall?.emergency.flagged, true);

        for (const sourceChannel of ['PHONE', 'WALK_IN'] as const) {
          const call = await openCall(db, clock, {
            sourceChannel,
            description: 'יש שריפה בדירה',
            sender: { kind: 'unknown' },
            openedBy: account.staffAccountId,
          });
          const { rows } = await db.query<{ n: string }>(
            `SELECT count(*)::text AS n FROM audit_log
              WHERE subject_id = $1 AND action = 'channel.duty_reply'`,
            [call.id],
          );
          assert.equal(rows[0]?.n, '0');
          assert.equal((await listMessagesOnCall(db, call.id)).length, 0);
        }

        assert.deepEqual(sent, []);
        const { rows } = await db.query<{ n: string }>(
          `SELECT count(*)::text AS n FROM audit_log
            WHERE action = 'channel.duty_reply'
              AND subject_id IN ($1, $2)`,
          [opened.callId, emailed.callId],
        );
        assert.equal(rows[0]?.n, '0');
      });
    } finally {
      await pool.end();
    }
  });

  it('sends the duty reply when a later WhatsApp message flags the open call', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await inRolledBackTransaction(pool, async (db) => {
        const clock = fixedClock(AT);
        const { account } = await addOperator(db, clock, {
          email: 'later@door-reply.test',
          role: 'OPERATOR',
        });
        await saveEmergencySettings(db, clock, {
          termsText: 'שריפה',
          phone: '050-194-0000',
          hours: 'א׳–ה׳ 08:00–20:00',
          actorId: account.staffAccountId,
        });
        const sent: { to: string; body: string }[] = [];
        const deps = {
          sorter: counting(CALL, []),
          matchesEmergency: emergencyMatch(db),
          replyOnWhatsapp: async (reply: { to: string; body: string }) => {
            sent.push(reply);
            return { externalMessageId: 'wamid.duty.later' };
          },
        };
        const opened = await receiveIncoming(
          db,
          clock,
          deps,
          incoming({
            sourceChannel: 'WHATSAPP',
            externalMessageId: 'wa-later-1',
            externalThreadId: '972599001196',
            senderAddress: '+972599001196',
            subject: null,
            body: 'נזילה רגילה',
          }),
        );
        assert.equal(opened.kind, 'call');
        if (opened.kind !== 'call') return;
        assert.deepEqual(sent, []);
        const flagged = await receiveIncoming(
          db,
          clock,
          deps,
          incoming({
            sourceChannel: 'WHATSAPP',
            externalMessageId: 'wa-later-2',
            externalThreadId: '972599001196',
            senderAddress: '+972599001196',
            subject: null,
            body: 'יש שריפה בדירה',
          }),
        );
        assert.equal(flagged.kind, 'attached');
        if (flagged.kind !== 'attached') return;
        assert.equal(flagged.callId, opened.callId);
        assert.deepEqual(sent, [
          {
            to: '972599001196',
            body: 'קריאת חירום. להתקשר לכונן: 050-194-0000. שעות כונן: א׳–ה׳ 08:00–20:00.',
          },
        ]);
        const call = await getCall(db, opened.callId);
        assert.equal(call?.emergency.flagged, true);
        if (call?.emergency.flagged) assert.equal(call.emergency.by, 'terms');
        const messages = await listMessagesOnCall(db, opened.callId);
        assert.equal(messages.filter((message) => message.echo).length, 1);
      });
    } finally {
      await pool.end();
    }
  });

  it('sends again when Meta refused the first reply', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await inRolledBackTransaction(pool, async (db) => {
        const clock = fixedClock(AT);
        const { account } = await addOperator(db, clock, {
          email: 'retry@door-reply.test',
          role: 'OPERATOR',
        });
        await saveEmergencySettings(db, clock, {
          termsText: 'שריפה',
          phone: '050-194-0000',
          hours: 'א׳–ה׳ 08:00–20:00',
          actorId: account.staffAccountId,
        });
        let attempts = 0;
        const message = incoming({
          sourceChannel: 'WHATSAPP',
          externalMessageId: 'wa-retry-1',
          externalThreadId: '972599001198',
          senderAddress: '+972599001198',
          subject: null,
          body: 'יש שריפה בדירה',
        });
        const deps = {
          sorter: counting(CALL, []),
          matchesEmergency: emergencyMatch(db),
          replyOnWhatsapp: async () => {
            attempts += 1;
            if (attempts === 1) throw new Error('meta down');
            return { externalMessageId: 'wamid.duty.retry' };
          },
        };
        await assert.rejects(
          () => receiveIncoming(db, clock, deps, message),
          /meta down/,
        );
        const outcome = await receiveIncoming(db, clock, deps, message);
        assert.equal(outcome.kind, 'call');
        if (outcome.kind !== 'call') return;
        assert.equal(attempts, 2);
        const messages = await listMessagesOnCall(db, outcome.callId);
        assert.equal(messages.filter((row) => row.echo).length, 1);
        const { rows } = await db.query<{ n: string }>(
          `SELECT count(*)::text AS n FROM audit_log
            WHERE subject_id = $1 AND action = 'channel.duty_reply'`,
          [outcome.callId],
        );
        assert.equal(rows[0]?.n, '1');
      });
    } finally {
      await pool.end();
    }
  });

  it('sends one reply on a flagged email thread, and not a second', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await inRolledBackTransaction(pool, async (db) => {
        const clock = fixedClock(AT);
        const { account } = await addOperator(db, clock, {
          email: 'mail@door-reply.test',
          role: 'OPERATOR',
        });
        await saveEmergencySettings(db, clock, {
          termsText: 'שריפה',
          phone: '050-195-0000',
          hours: 'א׳–ה׳ 08:00–20:00',
          actorId: account.staffAccountId,
        });
        const seen: string[] = [];
        const sent: { messageId: string; body: string }[] = [];
        const deps = {
          sorter: {
            async sort() {
              seen.push('sorter');
              return {
                label: 'call' as const,
                categoryCode: null,
                summary: 'סיכום מהמודל',
              };
            },
            async translate() {
              seen.push('translate');
              return { bodyHe: null };
            },
          },
          matchesEmergency: emergencyMatch(db),
          replyOnEmail: async (reply: { messageId: string; body: string }) => {
            seen.push('reply');
            sent.push(reply);
            return { externalMessageId: `reply:${reply.messageId}` };
          },
        };
        const outcome = await receiveIncoming(
          db,
          clock,
          deps,
          incoming({
            externalMessageId: 'AAMkAG-195-1',
            externalThreadId: 'AAQkAG-thread-195',
            senderAddress: 'tenant@door-reply.test',
            subject: 'שריפה',
            body: 'יש שריפה בדירה',
          }),
        );
        assert.equal(outcome.kind, 'call');
        if (outcome.kind !== 'call') return;
        assert.deepEqual(seen, ['reply', 'translate', 'sorter']);
        assert.deepEqual(sent, [
          {
            messageId: 'AAMkAG-195-1',
            body: 'קריאת חירום. להתקשר לכונן: 050-195-0000. שעות כונן: א׳–ה׳ 08:00–20:00.',
          },
        ]);
        const messages = await listMessagesOnCall(db, outcome.callId);
        const reply = messages.find((message) => message.echo);
        assert.equal(
          reply?.body,
          'קריאת חירום. להתקשר לכונן: 050-195-0000. שעות כונן: א׳–ה׳ 08:00–20:00.',
        );
        const { rows } = await db.query<{ action: string; channel: string }>(
          `SELECT action, inputs->>'channel' AS channel FROM audit_log
            WHERE subject_id = $1 AND action = 'channel.duty_reply'`,
          [outcome.callId],
        );
        assert.deepEqual(
          rows.map((row) => row.action),
          ['channel.duty_reply'],
        );
        assert.deepEqual(
          rows.map((row) => row.channel),
          ['EMAIL'],
        );

        await receiveIncoming(
          db,
          clock,
          deps,
          incoming({
            externalMessageId: 'AAMkAG-195-2',
            externalThreadId: 'AAQkAG-thread-195',
            senderAddress: 'tenant@door-reply.test',
            subject: 'שריפה',
            body: 'עדיין שריפה',
          }),
        );
        assert.equal(sent.length, 1);
        assert.equal(
          (await listMessagesOnCall(db, outcome.callId)).filter(
            (message) => message.echo,
          ).length,
          1,
        );
      });
    } finally {
      await pool.end();
    }
  });

  it('sends nothing when an email call was flagged by hand', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await inRolledBackTransaction(pool, async (db) => {
        const clock = fixedClock(AT);
        const { account } = await addOperator(db, clock, {
          email: 'mail-hand@door-reply.test',
          role: 'OPERATOR',
        });
        await saveEmergencySettings(db, clock, {
          termsText: 'שריפה',
          phone: '050-195-0000',
          hours: 'א׳–ה׳ 08:00–20:00',
          actorId: account.staffAccountId,
        });
        const sent: string[] = [];
        const deps = {
          sorter: counting(CALL, []),
          matchesEmergency: emergencyMatch(db),
          replyOnEmail: async () => {
            sent.push('sent');
            return { externalMessageId: 'reply:hand' };
          },
        };
        const opened = await receiveIncoming(
          db,
          clock,
          deps,
          incoming({
            externalMessageId: 'AAMkAG-hand-1',
            externalThreadId: 'AAQkAG-thread-hand',
            senderAddress: 'tenant@door-reply.test',
            body: 'נזילה רגילה',
          }),
        );
        assert.equal(opened.kind, 'call');
        if (opened.kind !== 'call') return;
        await flagEmergency(db, clock, {
          callId: opened.callId,
          actorId: account.staffAccountId,
          actorRole: 'OPERATOR',
        });
        await receiveIncoming(
          db,
          clock,
          deps,
          incoming({
            externalMessageId: 'AAMkAG-hand-2',
            externalThreadId: 'AAQkAG-thread-hand',
            senderAddress: 'tenant@door-reply.test',
            body: 'יש שריפה בדירה',
          }),
        );
        assert.deepEqual(sent, []);
        const messages = await listMessagesOnCall(db, opened.callId);
        assert.equal(messages.filter((message) => message.echo).length, 0);
        const { rows } = await db.query<{ n: string }>(
          `SELECT count(*)::text AS n FROM audit_log
            WHERE subject_id = $1 AND action = 'channel.duty_reply'`,
          [opened.callId],
        );
        assert.equal(rows[0]?.n, '0');
      });
    } finally {
      await pool.end();
    }
  });

  it('sends the duty reply when a later email flags the open call', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await inRolledBackTransaction(pool, async (db) => {
        const clock = fixedClock(AT);
        const { account } = await addOperator(db, clock, {
          email: 'mail-later@door-reply.test',
          role: 'OPERATOR',
        });
        await saveEmergencySettings(db, clock, {
          termsText: 'שריפה',
          phone: '050-195-0000',
          hours: 'א׳–ה׳ 08:00–20:00',
          actorId: account.staffAccountId,
        });
        const sent: string[] = [];
        const deps = {
          sorter: counting(CALL, []),
          matchesEmergency: emergencyMatch(db),
          replyOnEmail: async (reply: { messageId: string; body: string }) => {
            sent.push(reply.messageId);
            return { externalMessageId: `reply:${reply.messageId}` };
          },
        };
        const opened = await receiveIncoming(
          db,
          clock,
          deps,
          incoming({
            externalMessageId: 'AAMkAG-later-1',
            externalThreadId: 'AAQkAG-thread-later',
            senderAddress: 'tenant@door-reply.test',
            body: 'נזילה רגילה',
          }),
        );
        assert.equal(opened.kind, 'call');
        if (opened.kind !== 'call') return;
        assert.deepEqual(sent, []);
        const flagged = await receiveIncoming(
          db,
          clock,
          deps,
          incoming({
            externalMessageId: 'AAMkAG-later-2',
            externalThreadId: 'AAQkAG-thread-later',
            senderAddress: 'tenant@door-reply.test',
            body: 'יש שריפה בדירה',
          }),
        );
        assert.equal(flagged.kind, 'attached');
        assert.deepEqual(sent, ['AAMkAG-later-2']);
        const messages = await listMessagesOnCall(db, opened.callId);
        assert.equal(messages.filter((message) => message.echo).length, 1);
      });
    } finally {
      await pool.end();
    }
  });

  it('sends the email reply again when the first send was refused', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await inRolledBackTransaction(pool, async (db) => {
        const clock = fixedClock(AT);
        const { account } = await addOperator(db, clock, {
          email: 'mail-retry@door-reply.test',
          role: 'OPERATOR',
        });
        await saveEmergencySettings(db, clock, {
          termsText: 'שריפה',
          phone: '050-195-0000',
          hours: 'א׳–ה׳ 08:00–20:00',
          actorId: account.staffAccountId,
        });
        let attempts = 0;
        const message = incoming({
          externalMessageId: 'AAMkAG-retry',
          externalThreadId: 'AAQkAG-thread-retry',
          senderAddress: 'tenant@door-reply.test',
          body: 'יש שריפה בדירה',
        });
        const deps = {
          sorter: counting(CALL, []),
          matchesEmergency: emergencyMatch(db),
          replyOnEmail: async () => {
            attempts += 1;
            if (attempts === 1) throw new Error('graph down');
            return { externalMessageId: 'reply:AAMkAG-retry' };
          },
        };
        await assert.rejects(
          () => receiveIncoming(db, clock, deps, message),
          /graph down/,
        );
        const outcome = await receiveIncoming(db, clock, deps, message);
        assert.equal(outcome.kind, 'call');
        if (outcome.kind !== 'call') return;
        assert.equal(attempts, 2);
        const messages = await listMessagesOnCall(db, outcome.callId);
        assert.equal(messages.filter((row) => row.echo).length, 1);
      });
    } finally {
      await pool.end();
    }
  });
});
