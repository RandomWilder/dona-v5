// #189. One party from the address moves the new call to IDENTIFIED. None, or
// more than one, leaves it in NEW. Saving the address is a separate act: the
// next message is then identified, and identifying by hand alone is not.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { seedOccupancy, seedUnit } from '../../tests/policy/fixtures.ts';
import {
  getCall,
  identifyCall,
  openIntakeCall,
  saveSenderContact,
} from '../calls/contract.ts';
import { linkProvider } from '../estate/contract.ts';
import { fixedClock } from '../kernel/clock.ts';
import { newId } from '../kernel/ids.ts';
import {
  inRolledBackTransaction,
  migratedPoolOrNull,
  skipReason,
} from '../kernel/pg-support.ts';
import { addPartyContact, createParty } from '../parties/contract.ts';
import { addOperator } from '../staff/contract.ts';
import {
  type IncomingMessage,
  receiveIncoming,
  type Sorter,
  type SortVerdict,
} from './contract.ts';

const AT = new Date('2026-10-06T12:00:00.000Z');
const CALL: SortVerdict = {
  label: 'call',
  categoryCode: 'PLUMBING',
  summary: 'נזילה בצינור',
};

function sorter(): Sorter {
  return {
    async sort() {
      return CALL;
    },
    async translate() {
      return { bodyHe: null };
    },
  };
}

function incoming(over: Partial<IncomingMessage> = {}): IncomingMessage {
  return {
    sourceChannel: 'EMAIL',
    externalMessageId: 'msg-189',
    externalThreadId: 'thread-189',
    senderAddress: 'one@door-189.test',
    receivedAt: AT,
    subject: 'נזילה',
    body: 'יש נזילה במטבח',
    ...over,
  };
}

const OCCUPANCY = {
  contactFrom: '2026-01-01',
  contactTo: null,
  tenancyFrom: '2026-01-01',
  tenancyTo: '2027-01-01',
} as const;

describe('channel · identify the sender', () => {
  it('identifies the call when one address matches', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await inRolledBackTransaction(pool, async (db) => {
        const clock = fixedClock(AT);
        const tenant = await seedOccupancy(db, '1894', {
          phone: '+972501890401',
          email: 'one@door-189.test',
          ...OCCUPANCY,
        });
        const outcome = await receiveIncoming(
          db,
          clock,
          { sorter: sorter(), matchesEmergency: async () => false },
          incoming({ senderAddress: 'One@Door-189.test' }),
        );
        assert.equal(outcome.kind, 'call');
        if (outcome.kind !== 'call') return;
        const call = await getCall(db, outcome.callId);
        assert.equal(call?.state, 'IDENTIFIED');
        assert.equal(call?.requester?.id, tenant.partyId);
        const identified = call?.timeline.find(
          (event) => event.kind === 'IDENTIFIED',
        );
        assert.equal(identified?.actorId, null);
        assert.equal(identified?.actorLabel, 'הכתובת');
      });
    } finally {
      await pool.end();
    }
  });

  it('leaves the call NEW when the address matches nobody', async (t) => {
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
          { sorter: sorter(), matchesEmergency: async () => false },
          incoming({
            externalMessageId: 'msg-none',
            externalThreadId: 'thread-none',
            senderAddress: 'nobody@door-189.test',
          }),
        );
        assert.equal(outcome.kind, 'call');
        if (outcome.kind !== 'call') return;
        const call = await getCall(db, outcome.callId);
        assert.equal(call?.state, 'NEW');
        assert.equal(call?.requester, null);
        assert.equal(
          call?.sender.kind === 'named' && call.sender.name,
          'nobody@door-189.test',
        );
      });
    } finally {
      await pool.end();
    }
  });

  it('leaves the call NEW when two parties share the address', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await inRolledBackTransaction(pool, async (db) => {
        // The exclusion constraint is what makes two parties impossible. Dropped
        // only inside this transaction, which rolls back, so the door's refusal
        // is proven against the real join.
        await db.query(
          `ALTER TABLE party_contact
             DROP CONSTRAINT contact_value_resolves_to_one_party`,
        );
        await seedOccupancy(db, '1895', {
          phone: '+972501890402',
          email: 'two@door-189.test',
          ...OCCUPANCY,
        });
        await seedOccupancy(db, '1896', {
          phone: '+972501890403',
          email: 'two@door-189.test',
          ...OCCUPANCY,
        });
        const outcome = await receiveIncoming(
          db,
          fixedClock(AT),
          { sorter: sorter(), matchesEmergency: async () => false },
          incoming({
            externalMessageId: 'msg-two',
            externalThreadId: 'thread-two',
            senderAddress: 'two@door-189.test',
          }),
        );
        assert.equal(outcome.kind, 'call');
        if (outcome.kind !== 'call') return;
        const call = await getCall(db, outcome.callId);
        assert.equal(call?.state, 'NEW');
        assert.equal(call?.requester, null);
      });
    } finally {
      await pool.end();
    }
  });

  it('does not identify a guarantor’s address', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await inRolledBackTransaction(pool, async (db) => {
        await seedOccupancy(db, '1897', {
          phone: '+972501890404',
          email: 'parent@door-189.test',
          role: 'GUARANTOR',
          isServiceContact: false,
          ...OCCUPANCY,
        });
        const outcome = await receiveIncoming(
          db,
          fixedClock(AT),
          { sorter: sorter(), matchesEmergency: async () => false },
          incoming({
            externalMessageId: 'msg-guarantor',
            externalThreadId: 'thread-guarantor',
            senderAddress: 'parent@door-189.test',
          }),
        );
        assert.equal(outcome.kind, 'call');
        if (outcome.kind !== 'call') return;
        const call = await getCall(db, outcome.callId);
        assert.equal(call?.state, 'NEW');
        assert.equal(call?.requester, null);
      });
    } finally {
      await pool.end();
    }
  });

  it('identifies one party who is on two units', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await inRolledBackTransaction(pool, async (db) => {
        const tenant = await seedOccupancy(db, '1898', {
          phone: '+972501890405',
          email: 'units@door-189.test',
          ...OCCUPANCY,
        });
        const other = await seedUnit(db, '1899');
        const profile = await db.query<{ terms_profile_id: string }>(
          `SELECT terms_profile_id FROM terms_profile WHERE name = 'standard'`,
        );
        const tenancyId = newId();
        await db.query(
          `INSERT INTO tenancy
             (tenancy_id, unit_id, start_date, end_date, status, terms_profile_id)
           VALUES ($1, $2, '2026-01-01', '2027-01-01', 'ACTIVE', $3)`,
          [tenancyId, other, profile.rows[0]?.terms_profile_id],
        );
        await db.query(
          `INSERT INTO tenancy_party (tenancy_id, party_id, role, is_service_contact)
           VALUES ($1, $2, 'PRIMARY_TENANT', true)`,
          [tenancyId, tenant.partyId],
        );
        const outcome = await receiveIncoming(
          db,
          fixedClock(AT),
          { sorter: sorter(), matchesEmergency: async () => false },
          incoming({
            externalMessageId: 'msg-units',
            externalThreadId: 'thread-units',
            senderAddress: 'units@door-189.test',
          }),
        );
        assert.equal(outcome.kind, 'call');
        if (outcome.kind !== 'call') return;
        const call = await getCall(db, outcome.callId);
        assert.equal(call?.state, 'IDENTIFIED');
        assert.equal(call?.requester?.id, tenant.partyId);
      });
    } finally {
      await pool.end();
    }
  });

  it('identifies a service provider from its phone, and not a party on no lease', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await inRolledBackTransaction(pool, async (db) => {
        const clock = fixedClock(AT);
        const { account } = await addOperator(db, clock, {
          email: 'ops@door-208.test',
          role: 'OPERATOR',
        });
        const company = await createParty(db, {
          kind: 'COMPANY',
          legalName: 'קבלן דלת208',
          preferredLanguage: 'he',
        });
        await linkProvider(db, clock, {
          partyId: company.id,
          kind: 'CONTRACTOR',
          actorId: account.staffAccountId,
          actorRole: 'OPERATOR',
        });
        await addPartyContact(db, {
          partyId: company.id,
          channel: 'PHONE',
          value: '+972501890499',
          label: null,
          validFrom: '2026-01-01',
        });
        const neighbour = await createParty(db, {
          kind: 'PERSON',
          givenName: 'שכן',
          familyName: 'דלת208',
          preferredLanguage: 'he',
        });
        await addPartyContact(db, {
          partyId: neighbour.id,
          channel: 'PHONE',
          value: '+972501890498',
          label: null,
          validFrom: '2026-01-01',
        });

        const providerCall = await receiveIncoming(
          db,
          clock,
          { sorter: sorter(), matchesEmergency: async () => false },
          incoming({
            sourceChannel: 'WHATSAPP',
            externalMessageId: 'msg-provider-208',
            externalThreadId: 'thread-provider-208',
            senderAddress: '050-189-0499',
          }),
        );
        assert.equal(providerCall.kind, 'call');
        if (providerCall.kind !== 'call') return;
        const identified = await getCall(db, providerCall.callId);
        assert.equal(identified?.state, 'IDENTIFIED');
        assert.equal(identified?.requester?.id, company.id);

        const neighbourCall = await receiveIncoming(
          db,
          clock,
          { sorter: sorter(), matchesEmergency: async () => false },
          incoming({
            sourceChannel: 'WHATSAPP',
            externalMessageId: 'msg-neighbour-208',
            externalThreadId: 'thread-neighbour-208',
            senderAddress: '050-189-0498',
          }),
        );
        assert.equal(neighbourCall.kind, 'call');
        if (neighbourCall.kind !== 'call') return;
        const waiting = await getCall(db, neighbourCall.callId);
        assert.equal(waiting?.state, 'NEW');
        assert.equal(waiting?.requester, null);
      });
    } finally {
      await pool.end();
    }
  });

  it('leaves a guarantor who is also a provider in NEW', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await inRolledBackTransaction(pool, async (db) => {
        const clock = fixedClock(AT);
        const { account } = await addOperator(db, clock, {
          email: 'ops-g@door-208.test',
          role: 'OPERATOR',
        });
        const company = await createParty(db, {
          kind: 'COMPANY',
          legalName: 'ערב דלת208',
          preferredLanguage: 'he',
        });
        await linkProvider(db, clock, {
          partyId: company.id,
          kind: 'CONTRACTOR',
          actorId: account.staffAccountId,
          actorRole: 'OPERATOR',
        });
        await addPartyContact(db, {
          partyId: company.id,
          channel: 'PHONE',
          value: '+972501890497',
          label: null,
          validFrom: '2026-01-01',
        });
        const tenancy = await seedOccupancy(db, '1893', {
          phone: '+972501890496',
          ...OCCUPANCY,
        });
        await db.query(
          `INSERT INTO tenancy_party (tenancy_id, party_id, role, is_service_contact)
           VALUES ($1, $2, 'GUARANTOR', false)`,
          [tenancy.tenancyId, company.id],
        );
        const outcome = await receiveIncoming(
          db,
          clock,
          { sorter: sorter(), matchesEmergency: async () => false },
          incoming({
            sourceChannel: 'WHATSAPP',
            externalMessageId: 'msg-guarantor-provider-208',
            externalThreadId: 'thread-guarantor-provider-208',
            senderAddress: '050-189-0497',
          }),
        );
        assert.equal(outcome.kind, 'call');
        if (outcome.kind !== 'call') return;
        const call = await getCall(db, outcome.callId);
        assert.equal(call?.state, 'NEW');
        assert.equal(call?.requester, null);
      });
    } finally {
      await pool.end();
    }
  });

  it('identifies a WhatsApp number the same way', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await inRolledBackTransaction(pool, async (db) => {
        const tenant = await seedOccupancy(db, '1900', {
          phone: '+972501890406',
          ...OCCUPANCY,
        });
        const outcome = await receiveIncoming(
          db,
          fixedClock(AT),
          { sorter: sorter(), matchesEmergency: async () => false },
          incoming({
            sourceChannel: 'WHATSAPP',
            externalMessageId: 'msg-wa',
            externalThreadId: 'thread-wa',
            senderAddress: '050-189-0406',
          }),
        );
        assert.equal(outcome.kind, 'call');
        if (outcome.kind !== 'call') return;
        const call = await getCall(db, outcome.callId);
        assert.equal(call?.state, 'IDENTIFIED');
        assert.equal(call?.requester?.id, tenant.partyId);
      });
    } finally {
      await pool.end();
    }
  });

  it('keeps a call in NEW when the address is not one', async (t) => {
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
          { sorter: sorter(), matchesEmergency: async () => false },
          incoming({
            externalMessageId: 'msg-bad',
            externalThreadId: 'thread-bad',
            senderAddress: 'not-an-address',
          }),
        );
        assert.equal(outcome.kind, 'call');
        if (outcome.kind !== 'call') return;
        const call = await getCall(db, outcome.callId);
        assert.equal(call?.state, 'NEW');
      });
    } finally {
      await pool.end();
    }
  });

  it('identifies the next message after the address is saved, and not before', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await inRolledBackTransaction(pool, async (db) => {
        const clock = fixedClock(AT);
        const tenant = await seedOccupancy(db, '1901', {
          phone: '+972501890407',
          ...OCCUPANCY,
        });
        const { account } = await addOperator(db, clock, {
          email: 'save@door-189.test',
          role: 'OPERATOR',
        });
        const deps = {
          sorter: sorter(),
          matchesEmergency: async () => false,
        };
        const first = await receiveIncoming(
          db,
          clock,
          deps,
          incoming({
            externalMessageId: 'msg-save-1',
            externalThreadId: 'thread-save-1',
            senderAddress: 'Save@Door-189.test',
          }),
        );
        assert.equal(first.kind, 'call');
        if (first.kind !== 'call') return;
        const waiting = await getCall(db, first.callId);
        assert.equal(waiting?.state, 'NEW');

        await identifyCall(db, clock, {
          callId: first.callId,
          partyId: tenant.partyId,
          actorId: account.staffAccountId,
          actorRole: 'OPERATOR',
        });
        const unsaved = await receiveIncoming(
          db,
          clock,
          deps,
          incoming({
            externalMessageId: 'msg-save-2',
            externalThreadId: 'thread-save-2',
            senderAddress: 'save@door-189.test',
          }),
        );
        assert.equal(unsaved.kind, 'call');
        if (unsaved.kind !== 'call') return;
        const stillNew = await getCall(db, unsaved.callId);
        assert.equal(stillNew?.state, 'NEW');

        await saveSenderContact(db, clock, {
          callId: first.callId,
          actorId: account.staffAccountId,
          actorRole: 'OPERATOR',
        });
        const { rows } = await db.query<{ actor_id: string | null }>(
          `SELECT actor_id FROM audit_log
            WHERE subject_id = $1 AND action = 'calls.save_contact'`,
          [first.callId],
        );
        assert.equal(rows.length, 1);
        assert.equal(rows[0]?.actor_id, account.staffAccountId);

        const next = await receiveIncoming(
          db,
          clock,
          deps,
          incoming({
            externalMessageId: 'msg-save-3',
            externalThreadId: 'thread-save-3',
            senderAddress: 'SAVE@door-189.test',
          }),
        );
        assert.equal(next.kind, 'call');
        if (next.kind !== 'call') return;
        const identified = await getCall(db, next.callId);
        assert.equal(identified?.state, 'IDENTIFIED');
        assert.equal(identified?.requester?.id, tenant.partyId);
      });
    } finally {
      await pool.end();
    }
  });

  it('identifies the next WhatsApp after the number is saved', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await inRolledBackTransaction(pool, async (db) => {
        const clock = fixedClock(AT);
        const tenant = await seedOccupancy(db, '1902', {
          phone: '+972501890410',
          ...OCCUPANCY,
        });
        const { account } = await addOperator(db, clock, {
          email: 'wa-save@door-189.test',
          role: 'OPERATOR',
        });
        const deps = {
          sorter: sorter(),
          matchesEmergency: async () => false,
        };
        const first = await receiveIncoming(
          db,
          clock,
          deps,
          incoming({
            sourceChannel: 'WHATSAPP',
            externalMessageId: 'msg-wa-save-1',
            externalThreadId: 'thread-wa-save-1',
            senderAddress: '050-189-0411',
          }),
        );
        assert.equal(first.kind, 'call');
        if (first.kind !== 'call') return;
        assert.equal((await getCall(db, first.callId))?.state, 'NEW');
        await identifyCall(db, clock, {
          callId: first.callId,
          partyId: tenant.partyId,
          actorId: account.staffAccountId,
        });
        await saveSenderContact(db, clock, {
          callId: first.callId,
          actorId: account.staffAccountId,
        });
        const next = await receiveIncoming(
          db,
          clock,
          deps,
          incoming({
            sourceChannel: 'WHATSAPP',
            externalMessageId: 'msg-wa-save-2',
            externalThreadId: 'thread-wa-save-2',
            senderAddress: '+972501890411',
          }),
        );
        assert.equal(next.kind, 'call');
        if (next.kind !== 'call') return;
        const identified = await getCall(db, next.callId);
        assert.equal(identified?.state, 'IDENTIFIED');
        assert.equal(identified?.requester?.id, tenant.partyId);
      });
    } finally {
      await pool.end();
    }
  });

  it('leaves an address the requester already holds', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await inRolledBackTransaction(pool, async (db) => {
        const clock = fixedClock(AT);
        const tenant = await seedOccupancy(db, '1903', {
          phone: '+972501890412',
          email: 'held@door-189.test',
          ...OCCUPANCY,
        });
        const { account } = await addOperator(db, clock, {
          email: 'held@staff-189.test',
          role: 'OPERATOR',
        });
        const call = await openIntakeCall(db, clock, {
          sourceChannel: 'EMAIL',
          description: 'נזילה',
          senderAddress: 'held@door-189.test',
          emergency: false,
          toReview: false,
          sorterLabel: 'call',
          summary: null,
          proposedCategoryId: null,
          predecessorId: null,
          openedBy: null,
          sorterModel: null,
          sorterPrompt: null,
        });
        await identifyCall(db, clock, {
          callId: call.id,
          partyId: tenant.partyId,
          actorId: account.staffAccountId,
        });
        const before = await db.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM party_contact
            WHERE party_id = $1 AND channel = 'EMAIL'`,
          [tenant.partyId],
        );
        await saveSenderContact(db, clock, {
          callId: call.id,
          actorId: account.staffAccountId,
        });
        const after = await db.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM party_contact
            WHERE party_id = $1 AND channel = 'EMAIL'`,
          [tenant.partyId],
        );
        assert.equal(before.rows[0]?.n, 1);
        assert.equal(after.rows[0]?.n, 1);
      });
    } finally {
      await pool.end();
    }
  });
});
