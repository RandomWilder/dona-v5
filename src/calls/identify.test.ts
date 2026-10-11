// #183. Identifying a requester links that call and nothing else. Setting a
// category is the next command. A guarantor who is not a service contact is
// refused by the database.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { seedOccupancy } from '../../tests/policy/fixtures.ts';
import { fixedClock } from '../kernel/clock.ts';
import { KernelError } from '../kernel/errors.ts';
import {
  inRolledBackTransaction,
  migratedPoolOrNull,
  skipReason,
} from '../kernel/pg-support.ts';
import { createParty } from '../parties/contract.ts';
import { addOperator } from '../staff/contract.ts';
import {
  getCall,
  identifyCall,
  listCategories,
  listOpenCalls,
  openCall,
  setCallCategory,
  upsertCategory,
} from './contract.ts';

const AT = new Date('2026-10-06T12:00:00.000Z');
const HOUR = 60 * 60 * 1000;

describe('calls · identify the requester and set a category', () => {
  it('links one party, moves the call to IDENTIFIED, and writes no contact', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await inRolledBackTransaction(pool, async (db) => {
        const clock = fixedClock(AT);
        const opener = await addOperator(db, clock, {
          email: 'open@calls-identify.test',
          role: 'OPERATOR',
        });
        const identifier = await addOperator(db, clock, {
          email: 'id@calls-identify.test',
          role: 'OPERATOR',
        });
        const party = await createParty(db, {
          kind: 'PERSON',
          givenName: 'יעל',
          familyName: 'כהן',
          preferredLanguage: 'he',
        });
        const call = await openCall(db, clock, {
          sourceChannel: 'PHONE',
          description: 'נזילה במטבח',
          sender: { kind: 'unknown' },
          openedBy: opener.account.staffAccountId,
          actorRole: 'OPERATOR',
        });
        const before = await db.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM party_contact WHERE party_id = $1`,
          [party.id],
        );

        clock.advance(HOUR);
        const identified = await identifyCall(db, clock, {
          callId: call.id,
          partyId: party.id,
          actorId: identifier.account.staffAccountId,
          actorRole: 'OPERATOR',
        });

        const after = await db.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM party_contact WHERE party_id = $1`,
          [party.id],
        );
        assert.equal(before.rows[0]?.n, 0);
        assert.equal(after.rows[0]?.n, 0);
        assert.equal(identified.state, 'IDENTIFIED');
        assert.deepEqual(identified.requester, {
          id: party.id,
          name: 'יעל כהן',
        });
        assert.equal(identified.timeline[0]?.kind, 'OPENED');
        assert.equal(
          identified.timeline[0]?.actorId,
          opener.account.staffAccountId,
        );
        assert.equal(
          identified.timeline[0]?.actorLabel,
          'open@calls-identify.test',
        );
        assert.equal(identified.timeline[1]?.kind, 'IDENTIFIED');
        assert.equal(
          identified.timeline[1]?.actorId,
          identifier.account.staffAccountId,
        );
        assert.equal(identified.timeline[1]?.partyName, 'יעל כהן');
        assert.equal(
          identified.timeline[1]?.actorLabel,
          'id@calls-identify.test',
        );

        const { rows } = await db.query<{ actor_id: string | null }>(
          `SELECT actor_id FROM audit_log
            WHERE subject_id = $1 AND action = 'calls.identify'`,
          [call.id],
        );
        assert.equal(rows.length, 1);
        assert.equal(rows[0]?.actor_id, identifier.account.staffAccountId);
      });
    } finally {
      await pool.end();
    }
  });

  it('refuses a guarantor and leaves the call NEW', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await inRolledBackTransaction(pool, async (db) => {
        const clock = fixedClock(AT);
        const tenancy = await seedOccupancy(db, '1834', {
          phone: '+972501830201',
          contactFrom: '2026-01-01',
          contactTo: null,
          tenancyFrom: '2026-01-01',
          tenancyTo: '2027-01-01',
        });
        const guarantor = await createParty(db, {
          kind: 'PERSON',
          givenName: 'ערב',
          familyName: 'כהן',
          preferredLanguage: 'he',
        });
        await db.query(
          `INSERT INTO tenancy_party (tenancy_id, party_id, role, is_service_contact)
           VALUES ($1, $2, 'GUARANTOR', false)`,
          [tenancy.tenancyId, guarantor.id],
        );
        const { account } = await addOperator(db, clock, {
          email: 'ops@calls-identify.test',
          role: 'OPERATOR',
        });
        const call = await openCall(db, clock, {
          sourceChannel: 'WALK_IN',
          description: 'מפתח',
          sender: { kind: 'unknown' },
          openedBy: account.staffAccountId,
        });

        await assert.rejects(
          () =>
            identifyCall(db, clock, {
              callId: call.id,
              partyId: guarantor.id,
              actorId: account.staffAccountId,
            }),
          (error: unknown) =>
            error instanceof KernelError &&
            error.code === 'invalid' &&
            error.details?.reason === 'guarantor',
        );
        const after = await getCall(db, call.id);
        assert.equal(after?.state, 'NEW');
        assert.equal(after?.requester, null);
        assert.equal(after?.timeline.length, 1);
      });
    } finally {
      await pool.end();
    }
  });

  it('sets an active category and keeps a deactivated one on the call', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await inRolledBackTransaction(pool, async (db) => {
        const clock = fixedClock(AT);
        const { account } = await addOperator(db, clock, {
          email: 'ops@calls-category.test',
          role: 'OPERATOR',
        });
        const party = await createParty(db, {
          kind: 'PERSON',
          givenName: 'דנה',
          familyName: 'לוי',
          preferredLanguage: 'he',
        });
        const created = await upsertCategory(db, {
          code: 'test_locks_183',
          labelHe: 'מנעול בדיקה',
          labelEn: 'Test locks',
          isActive: true,
        });
        const call = await openCall(db, clock, {
          sourceChannel: 'PHONE',
          description: 'מנעול',
          sender: { kind: 'unknown' },
          openedBy: account.staffAccountId,
        });
        await assert.rejects(
          () =>
            setCallCategory(db, clock, {
              callId: call.id,
              categoryId: created.id,
              actorId: account.staffAccountId,
            }),
          (error: unknown) =>
            error instanceof KernelError &&
            error.details?.reason === 'category',
        );

        await identifyCall(db, clock, {
          callId: call.id,
          partyId: party.id,
          actorId: account.staffAccountId,
        });
        clock.advance(HOUR);
        const triaged = await setCallCategory(db, clock, {
          callId: call.id,
          categoryId: created.id,
          actorId: account.staffAccountId,
          actorRole: 'OPERATOR',
        });
        assert.equal(triaged.state, 'TRIAGED');
        assert.equal(triaged.category?.labelHe, 'מנעול בדיקה');
        assert.equal(triaged.category?.active, true);
        assert.equal(triaged.timeline.at(-1)?.kind, 'TRIAGED');
        assert.equal(triaged.timeline.at(-1)?.categoryLabel, 'מנעול בדיקה');
        assert.equal(triaged.timeline.at(-1)?.actorId, account.staffAccountId);

        const again = await upsertCategory(db, {
          code: 'TEST_LOCKS_183',
          labelHe: 'מנעול בדיקה',
          labelEn: null,
          isActive: false,
        });
        assert.equal(again.inserted, false);
        assert.equal(again.id, created.id);
        const kept = await getCall(db, call.id);
        assert.equal(kept?.state, 'TRIAGED');
        assert.equal(kept?.category?.labelHe, 'מנעול בדיקה');
        assert.equal(kept?.category?.active, false);
        const offered = await listCategories(db, { activeOnly: true });
        assert.equal(
          offered.some((row) => row.id === created.id),
          false,
        );

        const other = await createParty(db, {
          kind: 'PERSON',
          familyName: 'עמית',
          preferredLanguage: 'he',
        });
        const second = await openCall(db, clock, {
          sourceChannel: 'WALK_IN',
          description: 'שער',
          sender: { kind: 'unknown' },
          openedBy: account.staffAccountId,
        });
        await identifyCall(db, clock, {
          callId: second.id,
          partyId: other.id,
          actorId: account.staffAccountId,
        });
        await assert.rejects(
          () =>
            setCallCategory(db, clock, {
              callId: second.id,
              categoryId: created.id,
              actorId: account.staffAccountId,
            }),
          (error: unknown) =>
            error instanceof KernelError &&
            error.details?.reason === 'inactive',
        );
        assert.equal((await getCall(db, second.id))?.state, 'IDENTIFIED');

        const { rows } = await db.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM audit_log
            WHERE subject_id = $1 AND action = 'calls.triage'`,
          [call.id],
        );
        assert.equal(rows[0]?.n, 1);
      });
    } finally {
      await pool.end();
    }
  });

  it('filters the open list on state and on category', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await inRolledBackTransaction(pool, async (db) => {
        const clock = fixedClock(AT);
        const { account } = await addOperator(db, clock, {
          email: 'ops@calls-filter.test',
          role: 'OPERATOR',
        });
        const party = await createParty(db, {
          kind: 'PERSON',
          familyName: 'נועה',
          preferredLanguage: 'he',
        });
        const plumbing = (await listCategories(db)).find(
          (row) => row.code === 'PLUMBING',
        );
        assert.ok(plumbing, 'the placeholder plumbing category is seeded');
        const fresh = await openCall(db, clock, {
          sourceChannel: 'PHONE',
          description: 'עדיין חדשה',
          sender: { kind: 'unknown' },
          openedBy: account.staffAccountId,
        });
        const done = await openCall(db, clock, {
          sourceChannel: 'WALK_IN',
          description: 'כבר מוינה',
          sender: { kind: 'unknown' },
          openedBy: account.staffAccountId,
        });
        await identifyCall(db, clock, {
          callId: done.id,
          partyId: party.id,
          actorId: account.staffAccountId,
        });
        await setCallCategory(db, clock, {
          callId: done.id,
          categoryId: plumbing.id,
          actorId: account.staffAccountId,
        });

        const byState = await listOpenCalls(db, { state: 'NEW' });
        assert.equal(
          byState.some((call) => call.id === fresh.id),
          true,
        );
        assert.equal(
          byState.some((call) => call.id === done.id),
          false,
        );
        const byCategory = await listOpenCalls(db, {
          categoryId: plumbing.id,
        });
        assert.equal(
          byCategory.some((call) => call.id === done.id),
          true,
        );
        assert.equal(
          byCategory.some((call) => call.id === fresh.id),
          false,
        );
        assert.equal(
          byCategory.find((call) => call.id === done.id)?.category?.labelHe,
          'אינסטלציה',
        );
      });
    } finally {
      await pool.end();
    }
  });
});
