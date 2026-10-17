// POLICY — a follow-up may not widen the call's bound. #253.
//
// A question that names another unit, or another party, is the record refusal.
// That other record is not searched, and the model is not called.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { PoolClient } from 'pg';
import {
  askCallFollowUp,
  identifyCall,
  openCall,
  startCallBrief,
} from '../../src/calls/contract.ts';
import {
  applyDocumentTypeCatalogue,
  fileDocument,
  type IntakeDeps,
  OFFICE_TURN_RECORD_REFUSAL,
} from '../../src/evidence/contract.ts';
import { seedDocumentTypes } from '../../src/evidence/fixtures/document-types.ts';
import { createAuditLog } from '../../src/kernel/audit.ts';
import { fixedClock } from '../../src/kernel/clock.ts';
import { embeddingColumnDimensions } from '../../src/kernel/config.ts';
import { createFakeEmbedder } from '../../src/kernel/embeddings.ts';
import { createFakeExtractor } from '../../src/kernel/extraction.ts';
import { createMemoryStore } from '../../src/kernel/objects.ts';
import { createFakePdfText } from '../../src/kernel/pdf.ts';
import { addOperator, loadCallThread } from '../../src/staff/contract.ts';
import { seedOccupancy } from './fixtures.ts';
import { inRolledBackTransaction, policyPool, skipReason } from './support.ts';

const AT = new Date('2026-10-17T09:00:00.000Z');
const OTHER_RENT = 'MARKER-253-OTHER-RENT';

describe('policy · a call follow-up stays inside the bound', () => {
  it('refuses another unit and another tenant with the record sentence', async (t) => {
    const pool = await policyPool();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await inRolledBackTransaction(pool, async (db) => {
        const clock = fixedClock(AT);
        const home = await seedOccupancy(db, '41', {
          phone: '+972501253001',
          contactFrom: '2026-01-01',
          contactTo: null,
          tenancyFrom: '2026-01-01',
          tenancyTo: '2027-01-01',
        });
        const neighbour = await seedOccupancy(db, '42', {
          phone: '+972501253002',
          contactFrom: '2026-01-01',
          contactTo: null,
          tenancyFrom: '2026-01-01',
          tenancyTo: '2027-01-01',
        });
        await db.query(
          `UPDATE party SET given_name = 'רות', family_name = 'שכנה253'
            WHERE party_id = $1`,
          [neighbour.partyId],
        );
        await applyDocumentTypeCatalogue(db, seedDocumentTypes);
        const filed = await fileDocument(intake(db), {
          bytes: Buffer.from('%PDF-1.4\n% follow-up-253\n', 'latin1'),
          typeKey: 'lease',
          place: { kind: 'UNIT', id: neighbour.unitId },
          tenancyId: neighbour.tenancyId,
        });
        assert.equal(filed.filed, true);

        const { account } = await addOperator(db, clock, {
          email: 'ops@call-follow-up.policy',
          role: 'OPERATOR',
        });
        const call = await openCall(db, clock, {
          sourceChannel: 'PHONE',
          description: 'הדוד לא מחמם',
          sender: { kind: 'unknown' },
          openedBy: account.staffAccountId,
          actorRole: 'OPERATOR',
        });
        await identifyCall(db, clock, {
          callId: call.id,
          partyId: home.partyId,
          actorId: account.staffAccountId,
          actorRole: 'OPERATOR',
        });
        const extractor = createFakeExtractor((request) => ({
          answers: true,
          text: request.input.includes(OTHER_RENT)
            ? OTHER_RENT
            : 'תשובה מהמודל',
          hit_indexes: [1],
        }));
        const queued: Array<() => Promise<void>> = [];
        const runner = {
          db,
          clock,
          extractor,
          embedder: createFakeEmbedder(embeddingColumnDimensions),
          schedule: (work: () => Promise<void>) => {
            queued.push(work);
          },
        };
        await startCallBrief(runner, call.id);
        const run = queued[0];
        assert.ok(run);
        await run();
        assert.equal(extractor.calls.length, 0);

        await askCallFollowUp(runner, call.id, {
          staffAccountId: account.staffAccountId,
          question: 'מה דמי השכירות של דירה 42?',
        });
        clock.advance(60_000);
        await askCallFollowUp(runner, call.id, {
          staffAccountId: account.staffAccountId,
          question: 'כמה משלמת רות שכנה253?',
        });

        const thread = await loadCallThread(db, call.id);
        assert.equal(thread?.turns.length, 3);
        const unitTurn = thread?.turns[1];
        const tenantTurn = thread?.turns[2];
        assert.equal(unitTurn?.answer, OFFICE_TURN_RECORD_REFUSAL);
        assert.equal(tenantTurn?.answer, OFFICE_TURN_RECORD_REFUSAL);
        assert.equal(unitTurn?.refused, true);
        assert.equal(tenantTurn?.refused, true);
        assert.deepEqual(unitTurn?.citations, []);
        assert.deepEqual(tenantTurn?.citations, []);
        assert.equal(unitTurn?.answer.includes(OTHER_RENT), false);
        assert.equal(tenantTurn?.answer.includes(OTHER_RENT), false);
        assert.equal(unitTurn?.asker, 'ops@call-follow-up.policy');
        assert.equal(tenantTurn?.asker, 'ops@call-follow-up.policy');
        assert.equal(unitTurn?.askedAt.toISOString(), AT.toISOString());
        assert.equal(
          tenantTurn?.askedAt.toISOString(),
          new Date(AT.getTime() + 60_000).toISOString(),
        );
        assert.equal(extractor.calls.length, 0);
      });
    } finally {
      await pool.end();
    }
  });
});

function intake(db: PoolClient): IntakeDeps {
  return {
    db,
    objects: createMemoryStore(),
    pdf: createFakePdfText([
      `${OTHER_RENT} חוזה שכירות. המושכר. תקופת השכירות.`,
    ]),
    embedder: createFakeEmbedder(embeddingColumnDimensions),
    audit: createAuditLog(db, fixedClock(AT)),
    clock: fixedClock(AT),
    bucket: 'dona-v5-test-call-follow-up',
  };
}
