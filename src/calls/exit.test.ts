// #184. An office worker closes a call before any visit, by one of four exits.
// The reason and the staff account are on the call afterwards. A closed call
// leaves the open list and the rail count, and a closed filter still finds it.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fixedClock } from '../kernel/clock.ts';
import { KernelError } from '../kernel/errors.ts';
import { newId } from '../kernel/ids.ts';
import {
  inRolledBackTransaction,
  migratedPoolOrNull,
  skipReason,
} from '../kernel/pg-support.ts';
import { createParty } from '../parties/contract.ts';
import { addOperator } from '../staff/contract.ts';
import {
  exitCall,
  getCall,
  identifyCall,
  listCategories,
  listOpenCalls,
  openCall,
  setCallCategory,
} from './contract.ts';

const AT = new Date('2026-10-06T12:00:00.000Z');
const HOUR = 60 * 60 * 1000;

async function staff(
  db: Parameters<typeof addOperator>[0],
  clock: ReturnType<typeof fixedClock>,
  email: string,
) {
  const { account } = await addOperator(db, clock, {
    email,
    role: 'OPERATOR',
  });
  return account.staffAccountId;
}

describe('calls · close by an exit', () => {
  it('records an answered, forwarded, duplicate or cancelled exit from each open state', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await inRolledBackTransaction(pool, async (db) => {
        const clock = fixedClock(AT);
        const opener = await staff(db, clock, 'open@calls-exit.test');
        const closer = await staff(db, clock, 'close@calls-exit.test');
        const party = await createParty(db, {
          kind: 'PERSON',
          givenName: 'יעל',
          familyName: 'כהן',
          preferredLanguage: 'he',
        });
        const plumbing = (await listCategories(db)).find(
          (category) => category.code === 'PLUMBING',
        );
        const categoryId = plumbing?.id;
        if (categoryId === undefined) {
          throw new Error('plumbing category is missing');
        }
        const trade: string = categoryId;

        async function atState(
          description: string,
          state: 'NEW' | 'IDENTIFIED' | 'TRIAGED',
        ): Promise<string> {
          const call = await openCall(db, clock, {
            sourceChannel: 'PHONE',
            description,
            sender: { kind: 'unknown' },
            openedBy: opener,
          });
          if (state === 'NEW') return call.id;
          await identifyCall(db, clock, {
            callId: call.id,
            partyId: party.id,
            actorId: opener,
          });
          if (state === 'IDENTIFIED') return call.id;
          await setCallCategory(db, clock, {
            callId: call.id,
            categoryId: trade,
            actorId: opener,
          });
          return call.id;
        }

        const original = await atState('הקריאה המקורית', 'NEW');
        clock.advance(HOUR);

        const answered = await exitCall(db, clock, {
          callId: await atState('שאלה שנענתה', 'NEW'),
          kind: 'ANSWERED',
          note: 'עניתי בטלפון',
          actorId: closer,
          actorRole: 'OPERATOR',
        });
        const forwarded = await exitCall(db, clock, {
          callId: await atState('חשבונית', 'IDENTIFIED'),
          kind: 'FORWARDED',
          note: 'שייך לכספים',
          department: 'כספים',
          actorId: closer,
          actorRole: 'OPERATOR',
        });
        const duplicate = await exitCall(db, clock, {
          callId: await atState('נזילה שוב', 'TRIAGED'),
          kind: 'DUPLICATE',
          duplicateOf: original,
          actorId: closer,
          actorRole: 'OPERATOR',
        });
        const cancelled = await exitCall(db, clock, {
          callId: await atState('ביטול', 'NEW'),
          kind: 'CANCELLED',
          note: 'הפונה ביטל',
          actorId: closer,
        });

        assert.equal(answered.state, 'CLOSED');
        assert.equal(answered.exit?.kind, 'ANSWERED');
        assert.equal(answered.exit?.note, 'עניתי בטלפון');
        assert.equal(answered.exit?.department, null);
        assert.equal(answered.exit?.actorId, closer);
        assert.equal(answered.exit?.actorLabel, 'close@calls-exit.test');
        assert.equal(answered.timeline.at(-1)?.kind, 'ANSWERED');
        assert.equal(answered.timeline.at(-1)?.actorId, closer);
        assert.equal(answered.timeline.at(-1)?.note, 'עניתי בטלפון');

        assert.equal(forwarded.state, 'CLOSED');
        assert.equal(forwarded.exit?.kind, 'FORWARDED');
        assert.equal(forwarded.exit?.department, 'כספים');
        assert.equal(forwarded.exit?.note, 'שייך לכספים');
        assert.equal(forwarded.exit?.actorId, closer);
        assert.equal(forwarded.timeline.at(-1)?.kind, 'FORWARDED');

        assert.equal(duplicate.state, 'CLOSED');
        assert.equal(duplicate.exit?.kind, 'DUPLICATE');
        assert.deepEqual(duplicate.exit?.duplicateOf, {
          id: original,
          description: 'הקריאה המקורית',
        });
        assert.equal(duplicate.exit?.actorId, closer);
        const kept = await getCall(db, original);
        assert.deepEqual(kept?.repeatedBy, [
          { id: duplicate.id, description: 'נזילה שוב' },
        ]);

        assert.equal(cancelled.state, 'CLOSED');
        assert.equal(cancelled.exit?.kind, 'CANCELLED');
        assert.equal(cancelled.exit?.note, 'הפונה ביטל');
        assert.equal(cancelled.timeline.at(-1)?.actorId, closer);

        const open = await listOpenCalls(db);
        const openIds = open.map((call) => call.id);
        assert.equal(openIds.includes(original), true);
        assert.equal(openIds.includes(answered.id), false);
        assert.equal(openIds.includes(forwarded.id), false);
        assert.equal(openIds.includes(duplicate.id), false);
        assert.equal(openIds.includes(cancelled.id), false);
        const closed = await listOpenCalls(db, { state: 'CLOSED' });
        const closedIds = closed.map((call) => call.id);
        assert.equal(closedIds.includes(answered.id), true);
        assert.equal(closedIds.includes(original), false);

        const { rows } = await db.query<{ actor_id: string | null }>(
          `SELECT actor_id FROM audit_log
            WHERE subject_id = $1 AND action = 'calls.exit'`,
          [answered.id],
        );
        assert.equal(rows.length, 1);
        assert.equal(rows[0]?.actor_id, closer);
      });
    } finally {
      await pool.end();
    }
  });

  it('also closes the other two states for the exits above', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await inRolledBackTransaction(pool, async (db) => {
        const clock = fixedClock(AT);
        const actor = await staff(db, clock, 'more@calls-exit.test');
        const party = await createParty(db, {
          kind: 'PERSON',
          givenName: 'דנה',
          familyName: 'לוי',
          preferredLanguage: 'he',
        });
        const plumbing = (await listCategories(db)).find(
          (category) => category.code === 'PLUMBING',
        );
        const categoryId = plumbing?.id;
        if (categoryId === undefined) {
          throw new Error('plumbing category is missing');
        }
        const trade: string = categoryId;

        async function atState(
          description: string,
          state: 'NEW' | 'IDENTIFIED' | 'TRIAGED',
        ): Promise<string> {
          const call = await openCall(db, clock, {
            sourceChannel: 'WALK_IN',
            description,
            sender: { kind: 'named', name: 'אורח' },
            openedBy: actor,
          });
          if (state === 'NEW') return call.id;
          await identifyCall(db, clock, {
            callId: call.id,
            partyId: party.id,
            actorId: actor,
          });
          if (state === 'IDENTIFIED') return call.id;
          await setCallCategory(db, clock, {
            callId: call.id,
            categoryId: trade,
            actorId: actor,
          });
          return call.id;
        }

        const answeredId = await exitCall(db, clock, {
          callId: await atState('תשובה אחרי זיהוי', 'IDENTIFIED'),
          kind: 'ANSWERED',
          note: 'הסברתי את החיוב',
          actorId: actor,
        });
        const answeredLater = await exitCall(db, clock, {
          callId: await atState('תשובה אחרי מיון', 'TRIAGED'),
          kind: 'ANSWERED',
          note: 'השאלה נסגרה',
          actorId: actor,
        });
        const forwarded = await exitCall(db, clock, {
          callId: await atState('העברה מחדשה', 'NEW'),
          kind: 'FORWARDED',
          note: 'לטיפול משפטי',
          department: 'משפטי',
          actorId: actor,
        });
        const forwardedLater = await exitCall(db, clock, {
          callId: await atState('העברה אחרי מיון', 'TRIAGED'),
          kind: 'FORWARDED',
          note: 'לגבייה',
          department: 'גבייה',
          actorId: actor,
        });
        const other = await atState('המקור השני', 'IDENTIFIED');
        const duplicate = await exitCall(db, clock, {
          callId: await atState('כפילות מחדשה', 'NEW'),
          kind: 'DUPLICATE',
          duplicateOf: other,
          actorId: actor,
        });
        const cancelled = await exitCall(db, clock, {
          callId: await atState('ביטול אחרי זיהוי', 'IDENTIFIED'),
          kind: 'CANCELLED',
          note: 'כבר לא רלוונטי',
          actorId: actor,
        });
        const cancelledLater = await exitCall(db, clock, {
          callId: await atState('ביטול אחרי מיון', 'TRIAGED'),
          kind: 'CANCELLED',
          note: 'הפונה ויתר',
          actorId: actor,
        });

        assert.equal(answeredId.exit?.note, 'הסברתי את החיוב');
        assert.equal(answeredLater.exit?.note, 'השאלה נסגרה');
        assert.equal(forwarded.exit?.department, 'משפטי');
        assert.equal(forwardedLater.exit?.department, 'גבייה');
        assert.equal(duplicate.exit?.duplicateOf?.id, other);
        assert.equal(
          (await getCall(db, other))?.repeatedBy.some(
            (link) => link.id === duplicate.id,
          ),
          true,
        );
        assert.equal(cancelled.exit?.note, 'כבר לא רלוונטי');
        assert.equal(cancelledLater.exit?.note, 'הפונה ויתר');
        for (const closed of [
          answeredId,
          answeredLater,
          forwarded,
          forwardedLater,
          duplicate,
          cancelled,
          cancelledLater,
        ]) {
          assert.equal(closed.state, 'CLOSED');
          assert.equal(closed.exit?.actorId, actor);
        }
      });
    } finally {
      await pool.end();
    }
  });

  it('refuses an exit that is missing its reason and leaves the call open', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await inRolledBackTransaction(pool, async (db) => {
        const clock = fixedClock(AT);
        const actor = await staff(db, clock, 'refuse@calls-exit.test');
        const call = await openCall(db, clock, {
          sourceChannel: 'PHONE',
          description: 'בלי סיבה',
          sender: { kind: 'unknown' },
          openedBy: actor,
        });
        const other = await openCall(db, clock, {
          sourceChannel: 'PHONE',
          description: 'אחרת',
          sender: { kind: 'unknown' },
          openedBy: actor,
        });

        const attempts: Array<{
          spec: {
            kind: string;
            note?: string;
            department?: string;
            duplicateOf?: string;
          };
          field: string;
        }> = [
          { spec: { kind: 'ANSWERED', note: '   ' }, field: 'note' },
          { spec: { kind: 'CANCELLED' }, field: 'note' },
          {
            spec: { kind: 'FORWARDED', note: 'שייך למישהו' },
            field: 'department',
          },
          {
            spec: { kind: 'FORWARDED', department: 'כספים' },
            field: 'note',
          },
          { spec: { kind: 'DUPLICATE' }, field: 'duplicate' },
          {
            spec: { kind: 'DUPLICATE', duplicateOf: call.id },
            field: 'duplicate',
          },
          {
            spec: { kind: 'DUPLICATE', duplicateOf: newId() },
            field: 'duplicate',
          },
        ];

        for (const attempt of attempts) {
          await assert.rejects(
            () =>
              exitCall(db, clock, {
                callId: call.id,
                actorId: actor,
                ...attempt.spec,
              }),
            (error: unknown) =>
              error instanceof KernelError &&
              error.code !== 'not_allowed' &&
              error.details?.field === attempt.field,
          );
          assert.equal((await getCall(db, call.id))?.state, 'NEW');
        }

        const closed = await exitCall(db, clock, {
          callId: other.id,
          kind: 'ANSWERED',
          note: 'נסגר',
          actorId: actor,
        });
        const late = await createParty(db, {
          kind: 'PERSON',
          familyName: 'מאוחר',
          preferredLanguage: 'he',
        });
        const plumbing = (await listCategories(db)).find(
          (category) => category.code === 'PLUMBING',
        );
        const categoryId = plumbing?.id;
        if (categoryId === undefined) {
          throw new Error('plumbing category is missing');
        }
        const trade: string = categoryId;
        await assert.rejects(
          () =>
            identifyCall(db, clock, {
              callId: closed.id,
              partyId: late.id,
              actorId: actor,
            }),
          (error: unknown) =>
            error instanceof KernelError && error.details?.field === 'state',
        );
        await assert.rejects(
          () =>
            setCallCategory(db, clock, {
              callId: closed.id,
              categoryId: trade,
              actorId: actor,
            }),
          (error: unknown) =>
            error instanceof KernelError && error.details?.field === 'state',
        );
        await assert.rejects(
          () =>
            exitCall(db, clock, {
              callId: closed.id,
              kind: 'CANCELLED',
              note: 'שוב',
              actorId: actor,
            }),
          (error: unknown) =>
            error instanceof KernelError && error.details?.reason === 'closed',
        );
        assert.equal((await getCall(db, closed.id))?.state, 'CLOSED');
        assert.equal((await getCall(db, closed.id))?.exit?.kind, 'ANSWERED');
      });
    } finally {
      await pool.end();
    }
  });
});
