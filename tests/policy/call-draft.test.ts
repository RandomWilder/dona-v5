// POLICY — the draft reply's exclusions. #255.
//
// A guarantor, a WhatsApp call, and a switch that is off never reach the model.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  identifyCall,
  openCall,
  startCallBrief,
  writeCallDraft,
} from '../../src/calls/contract.ts';
import { fixedClock } from '../../src/kernel/clock.ts';
import { embeddingColumnDimensions } from '../../src/kernel/config.ts';
import { createFakeEmbedder } from '../../src/kernel/embeddings.ts';
import { KernelError } from '../../src/kernel/errors.ts';
import { createFakeExtractor } from '../../src/kernel/extraction.ts';
import { newId } from '../../src/kernel/ids.ts';
import { createParty } from '../../src/parties/contract.ts';
import { addOperator, loadCallThread } from '../../src/staff/contract.ts';
import { seedOccupancy } from './fixtures.ts';
import { inRolledBackTransaction, policyPool, skipReason } from './support.ts';

const AT = new Date('2026-10-18T09:00:00.000Z');

function throwingExtractor() {
  return createFakeExtractor(() => {
    throw new Error('the model was called');
  });
}

function runner(
  db: Parameters<typeof startCallBrief>[0]['db'],
  clock: ReturnType<typeof fixedClock>,
  extractor: ReturnType<typeof throwingExtractor>,
) {
  return {
    db,
    clock,
    extractor,
    embedder: createFakeEmbedder(embeddingColumnDimensions),
    schedule: () => {
      throw new Error('a brief was scheduled');
    },
  };
}

describe('policy · the draft reply is not written where it must not be', () => {
  it('writes nothing for a guarantor-only requester', async (t) => {
    const pool = await policyPool();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await inRolledBackTransaction(pool, async (db) => {
        const clock = fixedClock(AT);
        const tenancy = await seedOccupancy(db, '255-g', {
          phone: '+972501255001',
          contactFrom: '2026-01-01',
          contactTo: null,
          tenancyFrom: '2026-01-01',
          tenancyTo: '2027-01-01',
        });
        const guarantorId = newId();
        await db.query(
          `INSERT INTO party (party_id, party_kind, family_name)
           VALUES ($1, 'PERSON', 'ערב בלבד')`,
          [guarantorId],
        );
        await db.query(
          `INSERT INTO tenancy_party (tenancy_id, party_id, role, is_service_contact)
           VALUES ($1, $2, 'GUARANTOR', false)`,
          [tenancy.tenancyId, guarantorId],
        );
        const { account } = await addOperator(db, clock, {
          email: 'ops@call-draft-guarantor.policy',
          role: 'OPERATOR',
        });
        const call = await openCall(db, clock, {
          sourceChannel: 'PHONE',
          description: 'נזילה',
          sender: { kind: 'unknown' },
          openedBy: account.staffAccountId,
          actorRole: 'OPERATOR',
        });
        await assert.rejects(
          () =>
            identifyCall(db, clock, {
              callId: call.id,
              partyId: guarantorId,
              actorId: account.staffAccountId,
              actorRole: 'OPERATOR',
            }),
          (error: unknown) =>
            error instanceof KernelError &&
            error.details?.reason === 'guarantor',
        );
        const extractor = throwingExtractor();
        await writeCallDraft(runner(db, clock, extractor), call.id);
        assert.equal(extractor.calls.length, 0);
        assert.equal(await loadCallThread(db, call.id), null);
      });
    } finally {
      await pool.end();
    }
  });

  it('does not call the model when the switch is off', async (t) => {
    const pool = await policyPool();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await inRolledBackTransaction(pool, async (db) => {
        const clock = fixedClock(AT);
        await db.query(
          `INSERT INTO config_settings (key, value, updated_at)
           VALUES ('calls.brief', '"off"', $1)
           ON CONFLICT (key) DO UPDATE SET value = '"off"'`,
          [AT],
        );
        const { account } = await addOperator(db, clock, {
          email: 'ops@call-draft-off.policy',
          role: 'OPERATOR',
        });
        const party = await createParty(db, {
          kind: 'PERSON',
          givenName: 'יעל',
          familyName: 'כבוי',
          preferredLanguage: 'he',
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
          partyId: party.id,
          actorId: account.staffAccountId,
          actorRole: 'OPERATOR',
        });
        const extractor = throwingExtractor();
        const held = runner(db, clock, extractor);
        await startCallBrief(held, call.id);
        await writeCallDraft(held, call.id);
        assert.equal(extractor.calls.length, 0);
        const thread = await loadCallThread(db, call.id);
        assert.equal(thread?.status, 'skipped');
        assert.equal(thread?.turns.length, 0);
      });
    } finally {
      await pool.end();
    }
  });

  it('does not call the model for a WhatsApp call', async (t) => {
    const pool = await policyPool();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await inRolledBackTransaction(pool, async (db) => {
        const clock = fixedClock(AT);
        const { account } = await addOperator(db, clock, {
          email: 'ops@call-draft-wa.policy',
          role: 'OPERATOR',
        });
        const party = await createParty(db, {
          kind: 'PERSON',
          givenName: 'יעל',
          familyName: 'וואטסאפ',
          preferredLanguage: 'he',
        });
        const callId = newId();
        await db.query(
          `INSERT INTO service_call
             (service_call_id, source_channel, state, description, sender_label,
              sender_unknown, opened_at, opened_by)
           VALUES ($1, 'WHATSAPP', 'NEW', 'נזילה', NULL, true, $2, $3)`,
          [callId, AT, account.staffAccountId],
        );
        await identifyCall(db, clock, {
          callId,
          partyId: party.id,
          actorId: account.staffAccountId,
          actorRole: 'OPERATOR',
        });
        const extractor = throwingExtractor();
        const held = runner(db, clock, extractor);
        await startCallBrief(held, callId);
        await writeCallDraft(held, callId);
        assert.equal(extractor.calls.length, 0);
        const thread = await loadCallThread(db, callId);
        assert.equal(thread?.status, 'skipped');
        assert.equal(thread?.skipReason, 'whatsapp');
        assert.equal(thread?.turns.length, 0);
      });
    } finally {
      await pool.end();
    }
  });
});
