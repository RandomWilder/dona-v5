// POLICY — the call brief's exclusions. #252.
//
// A guarantor, a WhatsApp call, and a switch that is off never reach the model.
// A service provider is answered from their own record: a lease filed for
// someone else is not a fact the brief is given.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { PoolClient } from 'pg';
import {
  identifyCall,
  openCall,
  refreshCallBrief,
  startCallBrief,
} from '../../src/calls/contract.ts';
import { linkProvider } from '../../src/estate/contract.ts';
import {
  applyDocumentTypeCatalogue,
  fileDocument,
  type IntakeDeps,
  searchPassages,
} from '../../src/evidence/contract.ts';
import { seedDocumentTypes } from '../../src/evidence/fixtures/document-types.ts';
import { createAuditLog } from '../../src/kernel/audit.ts';
import { fixedClock } from '../../src/kernel/clock.ts';
import { embeddingColumnDimensions } from '../../src/kernel/config.ts';
import { createFakeEmbedder } from '../../src/kernel/embeddings.ts';
import { KernelError } from '../../src/kernel/errors.ts';
import { createFakeExtractor } from '../../src/kernel/extraction.ts';
import { newId } from '../../src/kernel/ids.ts';
import { createMemoryStore } from '../../src/kernel/objects.ts';
import { createFakePdfText } from '../../src/kernel/pdf.ts';
import { createParty } from '../../src/parties/contract.ts';
import { addOperator, loadCallThread } from '../../src/staff/contract.ts';
import { seedOccupancy } from './fixtures.ts';
import { inRolledBackTransaction, policyPool, skipReason } from './support.ts';

const AT = new Date('2026-10-17T09:00:00.000Z');
const LEASE_MARKER = 'MARKER-252-LEASE';
const PAPER_MARKER = 'MARKER-252-BUILDING';

function throwingExtractor() {
  return createFakeExtractor(() => {
    throw new Error('the model was called');
  });
}

describe('policy · the call brief is not sent where it must not be', () => {
  it('writes nothing for a guarantor-only requester', async (t) => {
    const pool = await policyPool();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await inRolledBackTransaction(pool, async (db) => {
        const clock = fixedClock(AT);
        const tenancy = await seedOccupancy(db, '252-g', {
          phone: '+972501252001',
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
          email: 'ops@call-brief-guarantor.policy',
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
        await startCallBrief(
          {
            db,
            clock,
            extractor,
            embedder: createFakeEmbedder(embeddingColumnDimensions),
            schedule: () => {
              throw new Error('a brief was scheduled');
            },
          },
          call.id,
        );
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
          email: 'ops@call-brief-off.policy',
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
        await startCallBrief(
          {
            db,
            clock,
            extractor,
            embedder: createFakeEmbedder(embeddingColumnDimensions),
            schedule: () => {
              throw new Error('a brief was scheduled');
            },
          },
          call.id,
        );
        assert.equal(extractor.calls.length, 0);
        const thread = await loadCallThread(db, call.id);
        assert.equal(thread?.status, 'skipped');
        assert.equal(thread?.skipReason, 'off');
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
          email: 'ops@call-brief-wa.policy',
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
        await startCallBrief(
          {
            db,
            clock,
            extractor,
            embedder: createFakeEmbedder(embeddingColumnDimensions),
            schedule: () => {
              throw new Error('a brief was scheduled');
            },
          },
          callId,
        );
        assert.equal(extractor.calls.length, 0);
        const thread = await loadCallThread(db, callId);
        assert.equal(thread?.status, 'skipped');
        assert.equal(thread?.skipReason, 'whatsapp');
      });
    } finally {
      await pool.end();
    }
  });

  it('a refresh writes the first turn when the brief never landed', async (t) => {
    const pool = await policyPool();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await inRolledBackTransaction(pool, async (db) => {
        const clock = fixedClock(AT);
        const { account } = await addOperator(db, clock, {
          email: 'ops@call-brief-retry.policy',
          role: 'OPERATOR',
        });
        const party = await createParty(db, {
          kind: 'PERSON',
          givenName: 'עמית',
          familyName: 'רענון',
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
        const extractor = createFakeExtractor(() => ({
          answers: false,
          text: '',
          hit_indexes: [],
        }));
        const runner = {
          db,
          clock,
          extractor,
          embedder: createFakeEmbedder(embeddingColumnDimensions),
          schedule: () => {
            /* the first brief never runs */
          },
        };
        await startCallBrief(runner, call.id);
        const waiting = await loadCallThread(db, call.id);
        assert.equal(waiting?.status, 'writing');
        assert.equal(waiting?.turns.length, 0);
        await refreshCallBrief(runner, call.id);
        const thread = await loadCallThread(db, call.id);
        assert.equal(thread?.status, 'ready');
        assert.equal(thread?.turns.length, 1);
        assert.equal(thread?.turns[0]?.refused, true);
      });
    } finally {
      await pool.end();
    }
  });

  it('gives a provider only their record, and building paper is not a neighbour lease', async (t) => {
    const pool = await policyPool();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await inRolledBackTransaction(pool, async (db) => {
        const clock = fixedClock(AT);
        const home = await seedOccupancy(db, '252-h', {
          phone: '+972501252002',
          contactFrom: '2026-01-01',
          contactTo: null,
          tenancyFrom: '2026-01-01',
          tenancyTo: '2027-01-01',
        });
        const neighbour = await seedOccupancy(db, '252-n', {
          phone: '+972501252003',
          contactFrom: '2026-01-01',
          contactTo: null,
          tenancyFrom: '2026-01-01',
          tenancyTo: '2027-01-01',
        });
        const building = await db.query<{ building_id: string }>(
          `SELECT building_id FROM space WHERE space_id = $1`,
          [home.unitId],
        );
        const buildingId = building.rows[0]?.building_id;
        assert.ok(buildingId);
        await applyDocumentTypeCatalogue(db, seedDocumentTypes);
        const filed = intake(db);
        const lease = await fileDocument(filed, {
          bytes: Buffer.from('%PDF-1.4\n% lease\n', 'latin1'),
          typeKey: 'lease',
          place: { kind: 'UNIT', id: neighbour.unitId },
          tenancyId: neighbour.tenancyId,
        });
        assert.equal(lease.filed, true);
        const paperFile = await fileDocument(
          intake(db, [
            `${PAPER_MARKER} מסירת הבניין מהיזם. מערכות הבניין. מועד המסירה.`,
          ]),
          {
            bytes: Buffer.from('%PDF-1.4\n% paper\n', 'latin1'),
            typeKey: 'building_handover_protocol',
            place: { kind: 'BUILDING', id: buildingId },
            tenancyId: null,
          },
        );
        assert.equal(paperFile.filed, true);
        const paper = await searchPassages(
          db,
          createFakeEmbedder(embeddingColumnDimensions),
          'מתי נמסר הבניין?',
          'administrator',
          { kind: 'building-paper', id: buildingId },
        );
        assert.ok(paper.some((hit) => hit.text.includes(PAPER_MARKER)));
        assert.ok(paper.every((hit) => !hit.text.includes(LEASE_MARKER)));

        const { account } = await addOperator(db, clock, {
          email: 'ops@call-brief-provider.policy',
          role: 'OPERATOR',
        });
        const company = await createParty(db, {
          kind: 'COMPANY',
          legalName: 'קבלן בדיקה 252',
          preferredLanguage: 'he',
        });
        await linkProvider(db, clock, {
          partyId: company.id,
          kind: 'CONTRACTOR',
          actorId: account.staffAccountId,
          actorRole: 'OPERATOR',
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
          partyId: company.id,
          actorId: account.staffAccountId,
          actorRole: 'OPERATOR',
        });
        const extractor = createFakeExtractor((request) => ({
          answers: true,
          text: request.input.includes(LEASE_MARKER)
            ? 'LEAKED'
            : 'רק הרשומה של הספק',
          hit_indexes: [],
        }));
        const queued: Array<() => Promise<void>> = [];
        await startCallBrief(
          {
            db,
            clock,
            extractor,
            embedder: createFakeEmbedder(embeddingColumnDimensions),
            schedule: (work) => {
              queued.push(work);
            },
          },
          call.id,
        );
        assert.equal(extractor.calls.length, 0);
        assert.equal(queued.length, 1);
        const run = queued[0];
        assert.ok(run);
        await run();
        const thread = await loadCallThread(db, call.id);
        assert.equal(thread?.turns.length, 1);
        assert.equal(thread?.turns[0]?.answer, 'רק הרשומה של הספק');
        assert.equal(thread?.turns[0]?.citations.length, 0);

        const tenantCall = await openCall(db, clock, {
          sourceChannel: 'PHONE',
          description: 'מתי נמסר הבניין?',
          sender: { kind: 'unknown' },
          openedBy: account.staffAccountId,
          actorRole: 'OPERATOR',
        });
        await identifyCall(db, clock, {
          callId: tenantCall.id,
          partyId: home.partyId,
          actorId: account.staffAccountId,
          actorRole: 'OPERATOR',
        });
        const tenantModel = createFakeExtractor((request) => ({
          answers: !request.input.includes(LEASE_MARKER),
          text: request.input.includes(LEASE_MARKER) ? 'LEAKED' : 'מועד המסירה',
          hit_indexes: request.input.includes(PAPER_MARKER) ? [1] : [],
        }));
        const tenantQueued: Array<() => Promise<void>> = [];
        await startCallBrief(
          {
            db,
            clock,
            extractor: tenantModel,
            embedder: createFakeEmbedder(embeddingColumnDimensions),
            schedule: (work) => {
              tenantQueued.push(work);
            },
          },
          tenantCall.id,
        );
        const tenantRun = tenantQueued[0];
        assert.ok(tenantRun);
        await tenantRun();
        const tenantThread = await loadCallThread(db, tenantCall.id);
        assert.equal(tenantThread?.turns.length, 1);
        assert.equal(tenantThread?.turns[0]?.answer, 'מועד המסירה');
        assert.equal(tenantThread?.turns[0]?.refused, false);
        assert.equal(tenantThread?.turns[0]?.citations.length, 1);
        assert.equal(tenantThread?.turns[0]?.citations[0]?.kind, undefined);
      });
    } finally {
      await pool.end();
    }
  });
});

function intake(
  db: PoolClient,
  pages: string[] = [`${LEASE_MARKER} חוזה שכירות. המושכר. תקופת השכירות.`],
): IntakeDeps {
  return {
    db,
    objects: createMemoryStore(),
    pdf: createFakePdfText(pages),
    embedder: createFakeEmbedder(embeddingColumnDimensions),
    audit: createAuditLog(db, fixedClock(AT)),
    clock: fixedClock(AT),
    bucket: 'dona-v5-test-call-brief',
  };
}
