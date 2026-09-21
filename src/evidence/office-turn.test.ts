// The office turn: search this bound, answer or refuse, persist the thread.
// Ticket #113. Tests go through the public command only.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { PoolClient } from 'pg';
import { specimenDocuments } from '../../evals/fixtures/specimen-clauses.ts';
import { createAuditLog } from '../kernel/audit.ts';
import { fixedClock } from '../kernel/clock.ts';
import { embeddingColumnDimensions } from '../kernel/config.ts';
import { createFakeEmbedder } from '../kernel/embeddings.ts';
import type { ExtractionRequest } from '../kernel/extraction.ts';
import { createFakeExtractor } from '../kernel/extraction.ts';
import { newId } from '../kernel/ids.ts';
import { createMemoryStore } from '../kernel/objects.ts';
import { createFakePdfText } from '../kernel/pdf.ts';
import {
  inRolledBackTransaction,
  migratedPoolOrNull,
  skipReason,
} from '../kernel/pg-support.ts';
import { addOperator } from '../staff/contract.ts';
import type { IntakeDeps, RetrievalBound } from './contract.ts';
import {
  applyDocumentTypeCatalogue,
  fileDocument,
  OFFICE_TURN_EMPTY_ROLL,
  OFFICE_TURN_REFUSAL,
  runOfficeTurn,
} from './contract.ts';
import { seedDocumentTypes } from './fixtures/document-types.ts';

const BUCKET = 'dona-v5-test-office-turn';
const AT = new Date('2026-09-16T09:00:00.000Z');
const RENT = '4,520';
const ID = '312345678';

const specimen = (file: string): string => {
  const found = specimenDocuments.find((document) => document.file === file);
  if (!found) throw new Error(`${file} is not in the corpus`);
  return found.text;
};

const pdfBytes = (marker: string): Buffer =>
  Buffer.from(`%PDF-1.4\n% ${marker}\n`, 'latin1');

function deps(db: PoolClient, text: string[]): IntakeDeps {
  return {
    db,
    objects: createMemoryStore(),
    pdf: createFakePdfText(text),
    embedder: createFakeEmbedder(embeddingColumnDimensions),
    audit: createAuditLog(db, fixedClock(AT)),
    clock: fixedClock(AT),
    bucket: BUCKET,
  };
}

async function fileLease(
  db: PoolClient,
  extraPages: string[],
  unitId = newId(),
): Promise<{ documentId: string; unitId: string }> {
  await applyDocumentTypeCatalogue(db, seedDocumentTypes);
  const pages = [specimen('lease-standard.md'), ...extraPages];
  const result = await fileDocument(deps(db, pages), {
    bytes: pdfBytes(`office-turn-${newId()}`),
    typeKey: 'lease',
    place: { kind: 'UNIT', id: unitId },
    tenancyId: null,
  });
  assert.equal(result.filed, true);
  if (!result.filed) throw new Error('expected a filed document');
  return { documentId: result.documentId, unitId };
}

async function operator(db: PoolClient) {
  const clock = fixedClock(AT);
  const { account } = await addOperator(db, clock, {
    email: `${newId(clock)}@office.test`,
    role: 'OPERATOR',
  });
  return account.staffAccountId;
}

function citingExtractor(text: string) {
  return createFakeExtractor(() => ({
    answers: true,
    text,
    hit_indexes: [1],
  }));
}

function refusingExtractor() {
  return createFakeExtractor(() => ({
    answers: false,
    text: '',
    hit_indexes: [],
  }));
}

function echoingExtractor() {
  return createFakeExtractor((request: ExtractionRequest) => {
    if (request.name === 'office_tools') {
      return { search: true, list: false };
    }
    const facts = request.input.split('PASSAGES:')[1] ?? '';
    const first = facts.match(/\[1\][\s\S]*?(?=\[\d+\]|$)/)?.[0] ?? '';
    return {
      answers: true,
      text: first,
      hit_indexes: [1],
    };
  });
}

function toolsThen(
  tools: { search: boolean; list: boolean },
  answer: (request: ExtractionRequest) => unknown,
) {
  return createFakeExtractor((request: ExtractionRequest) => {
    if (request.name === 'office_tools') return tools;
    return answer(request);
  });
}

function turnDeps(
  db: PoolClient,
  extractor: ReturnType<typeof createFakeExtractor>,
) {
  return {
    db,
    clock: fixedClock(AT),
    extractor,
    embedder: createFakeEmbedder(embeddingColumnDimensions),
    model: 'fake-office-turn',
  };
}

describe('evidence · office turn', () => {
  it('refuses an empty bound without calling the answering model', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await inRolledBackTransaction(pool, async (db) => {
        const extractor = refusingExtractor();
        const bound: RetrievalBound = { kind: 'unit', id: newId() };
        const result = await runOfficeTurn(turnDeps(db, extractor), {
          staffAccountId: await operator(db),
          bound,
          question: 'מה דמי השכירות?',
        });
        assert.equal(result.refused, true);
        assert.equal(result.text, OFFICE_TURN_REFUSAL);
        assert.deepEqual(result.citations, []);
        assert.equal(extractor.calls.length, 0);
        assert.equal(result.thread.length, 1);
        assert.equal(result.thread[0]?.refused, true);
      });
    } finally {
      await pool.end();
    }
  });

  it('cites document and page, with amounts and identifiers as printed', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await inRolledBackTransaction(pool, async (db) => {
        const page = `דמי השכירות ${RENT} ש״ח. ת.ז. ${ID}. סעיף 10.3`;
        const { documentId, unitId } = await fileLease(db, [page]);
        const extractor = citingExtractor(
          `דמי השכירות ${RENT} ש״ח לפי סעיף 10.3. ת.ז. ${ID}.`,
        );
        const result = await runOfficeTurn(turnDeps(db, extractor), {
          staffAccountId: await operator(db),
          bound: { kind: 'unit', id: unitId },
          question: page,
        });
        assert.equal(result.refused, false);
        assert.equal(result.text.includes(RENT), true);
        assert.equal(result.text.includes(ID), true);
        assert.equal(result.text.includes('סעיף'), true);
        assert.equal(result.citations.length, 1);
        assert.equal(result.citations[0]?.documentId, documentId);
        assert.equal(result.citations[0]?.page, 2);
        assert.equal(result.citations[0]?.documentType, 'lease');
      });
    } finally {
      await pool.end();
    }
  });

  it('refuses when hits come back and none answer, with no citations', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await inRolledBackTransaction(pool, async (db) => {
        const { unitId } = await fileLease(db, ['דף על שכירות']);
        const extractor = refusingExtractor();
        const result = await runOfficeTurn(turnDeps(db, extractor), {
          staffAccountId: await operator(db),
          bound: { kind: 'unit', id: unitId },
          question: 'מי זכה בגביע המדינה בכדורגל?',
        });
        assert.equal(result.refused, true);
        assert.equal(result.text, OFFICE_TURN_REFUSAL);
        assert.deepEqual(result.citations, []);
        assert.equal(extractor.calls.length, 1);
      });
    } finally {
      await pool.end();
    }
  });

  it('refuses a neighbour-Unit question while bound to this Unit', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await inRolledBackTransaction(pool, async (db) => {
        const answering = `דמי השכירות החודשיים הם ${RENT} ש״ח — יחידת השכן`;
        const home = await fileLease(db, ['דף אחר בבית']);
        await fileLease(db, [answering]);
        const extractor = refusingExtractor();
        const result = await runOfficeTurn(turnDeps(db, extractor), {
          staffAccountId: await operator(db),
          bound: { kind: 'unit', id: home.unitId },
          question: answering,
        });
        assert.equal(result.refused, true);
        assert.deepEqual(result.citations, []);
        assert.equal(result.text.includes('בניין'), false);
      });
    } finally {
      await pool.end();
    }
  });

  it('searches again on a follow-up; history is not a source of facts', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await inRolledBackTransaction(pool, async (db) => {
        const rentPage = `דמי השכירות ${RENT} ש״ח`;
        const otherPage = 'מי מתקן את הדוד מבלאי סביר';
        const { unitId } = await fileLease(db, [rentPage, otherPage]);
        const staffAccountId = await operator(db);
        const bound: RetrievalBound = { kind: 'unit', id: unitId };
        const depsFor = turnDeps(db, echoingExtractor());
        await runOfficeTurn(depsFor, {
          staffAccountId,
          bound,
          question: rentPage,
        });
        const second = await runOfficeTurn(depsFor, {
          staffAccountId,
          bound,
          question: otherPage,
        });
        assert.equal(second.thread.length, 2);
        assert.equal(second.text.includes(RENT), false);
      });
    } finally {
      await pool.end();
    }
  });

  it('does not show the first staff account’s thread to a second on the same Unit', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await inRolledBackTransaction(pool, async (db) => {
        const page = `דמי השכירות ${RENT} ש״ח. סעיף 10.3`;
        const { unitId } = await fileLease(db, [page]);
        const bound: RetrievalBound = { kind: 'unit', id: unitId };
        const first = await operator(db);
        const second = await operator(db);
        const extractor = citingExtractor(`לפי סעיף 10.3 ${RENT}`);
        await runOfficeTurn(turnDeps(db, extractor), {
          staffAccountId: first,
          bound,
          question: page,
        });
        const other = await runOfficeTurn(turnDeps(db, extractor), {
          staffAccountId: second,
          bound,
          question: page,
        });
        assert.equal(other.thread.length, 1);
        assert.equal(
          other.thread.some((turn) => turn.question === page),
          true,
        );
        assert.equal(other.thread.length === 1, true);
      });
    } finally {
      await pool.end();
    }
  });
});

const TENANT = 'יעל כהן';
const UNIT_NAME = 'דירה 12';
const PROTOCOL = 'מועד המסירה בפרוטוקול: 2024-06-01. מעלית נבדקה.';

async function seedBuilding(
  db: PoolClient,
): Promise<{ buildingId: string; unitId: string }> {
  const buildingId = newId();
  const unitId = newId();
  await db.query(
    `INSERT INTO building (building_id, name, address_line, city, handover_date,
                           warranty_end_date, status)
     VALUES ($1, 'office-turn-building', $2, 'Shoham', '2020-01-01', '2022-01-01', 'ACTIVE')`,
    [buildingId, `Office ${buildingId}`],
  );
  await db.query(
    `INSERT INTO space (space_id, building_id, space_kind, name)
     VALUES ($1, $2, 'UNIT', $3)`,
    [unitId, buildingId, UNIT_NAME],
  );
  await db.query(
    `INSERT INTO unit (unit_id, unit_number, rooms, has_mamad, condition_status)
     VALUES ($1, '12', 3.5, true, 'READY')`,
    [unitId],
  );
  return { buildingId, unitId };
}

async function seedActiveLetting(
  db: PoolClient,
  unitId: string,
  name: string,
): Promise<void> {
  const profileId = newId();
  const tenancyId = newId();
  const partyId = newId();
  await db.query(
    `INSERT INTO terms_profile (terms_profile_id, name) VALUES ($1, $2)`,
    [profileId, `office-turn-${profileId}`],
  );
  await db.query(
    `INSERT INTO tenancy (tenancy_id, unit_id, start_date, end_date, status, terms_profile_id)
     VALUES ($1, $2, '2026-01-01', '2027-01-01', 'ACTIVE', $3)`,
    [tenancyId, unitId, profileId],
  );
  await db.query(
    `INSERT INTO party (party_id, party_kind, full_name, preferred_language)
     VALUES ($1, 'PERSON', $2, 'he')`,
    [partyId, name],
  );
  await db.query(
    `INSERT INTO tenancy_party (tenancy_id, party_id, role, is_service_contact)
     VALUES ($1, $2, 'PRIMARY_TENANT', true)`,
    [tenancyId, partyId],
  );
}

function listingAnswer(request: ExtractionRequest) {
  const facts = request.input.split('LETTINGS:')[1]?.trim() ?? '';
  if (facts === '' || facts === '(none)') {
    return {
      answers: true,
      text: 'אין דירות מושכרות היום.',
      hit_indexes: [],
    };
  }
  return {
    answers: true,
    text: facts,
    hit_indexes: [],
  };
}

describe('evidence · office turn on a Building bound', () => {
  it('lists who is let today without reading the names from Passages', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await inRolledBackTransaction(pool, async (db) => {
        const { buildingId, unitId } = await seedBuilding(db);
        await seedActiveLetting(db, unitId, TENANT);
        await fileLease(db, ['דף על שכירות בלי שם דייר'], unitId);
        const extractor = toolsThen(
          { search: false, list: true },
          listingAnswer,
        );
        const result = await runOfficeTurn(turnDeps(db, extractor), {
          staffAccountId: await operator(db),
          bound: { kind: 'building', id: buildingId },
          question: 'אילו דירות מושכרות היום ומי הדיירים?',
        });
        assert.deepEqual(result.tools, ['list']);
        assert.equal(result.refused, false);
        assert.equal(result.text.includes(TENANT), true);
        assert.equal(result.text.includes(UNIT_NAME), true);
        assert.deepEqual(result.citations, []);
        assert.equal(
          extractor.calls.some((call) => call.input.includes('PASSAGES:')),
          false,
        );
      });
    } finally {
      await pool.end();
    }
  });

  it('searches a protocol question and does not load the household roll', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await inRolledBackTransaction(pool, async (db) => {
        const { buildingId, unitId } = await seedBuilding(db);
        await seedActiveLetting(db, unitId, TENANT);
        await fileLease(db, [PROTOCOL], unitId);
        const extractor = toolsThen(
          { search: true, list: false },
          (request) => {
            assert.equal(request.input.includes('LETTINGS:'), false);
            assert.equal(request.input.includes(TENANT), false);
            return {
              answers: true,
              text: PROTOCOL,
              hit_indexes: [1],
            };
          },
        );
        const result = await runOfficeTurn(turnDeps(db, extractor), {
          staffAccountId: await operator(db),
          bound: { kind: 'building', id: buildingId },
          question: PROTOCOL,
        });
        assert.deepEqual(result.tools, ['search']);
        assert.equal(result.refused, false);
        assert.equal(result.citations.length > 0, true);
        assert.equal(result.text.includes(TENANT), false);
      });
    } finally {
      await pool.end();
    }
  });

  it('may run both this turn; an earlier table is not a fact unless listed again', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await inRolledBackTransaction(pool, async (db) => {
        const { buildingId, unitId } = await seedBuilding(db);
        await seedActiveLetting(db, unitId, TENANT);
        await fileLease(db, [PROTOCOL], unitId);
        const staffAccountId = await operator(db);
        const bound: RetrievalBound = { kind: 'building', id: buildingId };
        const first = toolsThen({ search: true, list: true }, listingAnswer);
        const listed = await runOfficeTurn(turnDeps(db, first), {
          staffAccountId,
          bound,
          question: 'אילו דירות מושכרות היום ומי הדיירים?',
        });
        assert.equal(listed.tools.includes('list'), true);
        assert.equal(listed.tools.includes('search'), true);
        assert.equal(listed.text.includes(TENANT), true);

        const second = toolsThen({ search: true, list: false }, (request) => {
          assert.equal(request.input.includes('LETTINGS:'), false);
          const thread = request.input.split('QUESTION:')[0] ?? '';
          assert.equal(thread.includes(TENANT), true);
          return {
            answers: true,
            text: PROTOCOL,
            hit_indexes: [1],
          };
        });
        const follow = await runOfficeTurn(turnDeps(db, second), {
          staffAccountId,
          bound,
          question: PROTOCOL,
        });
        assert.deepEqual(follow.tools, ['search']);
        assert.equal(follow.text.includes(TENANT), false);
      });
    } finally {
      await pool.end();
    }
  });

  it('cannot call the list from a Unit bound', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await inRolledBackTransaction(pool, async (db) => {
        const { unitId } = await fileLease(db, [PROTOCOL]);
        const extractor = toolsThen({ search: false, list: true }, () => ({
          answers: true,
          text: TENANT,
          hit_indexes: [],
        }));
        const result = await runOfficeTurn(turnDeps(db, extractor), {
          staffAccountId: await operator(db),
          bound: { kind: 'unit', id: unitId },
          question: 'אילו דירות מושכרות היום ומי הדיירים?',
        });
        assert.deepEqual(result.tools, ['search']);
        assert.equal(
          extractor.calls.some((call) => call.name === 'office_tools'),
          false,
        );
      });
    } finally {
      await pool.end();
    }
  });

  it('answers an empty roll without the documents-refusal sentence', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await inRolledBackTransaction(pool, async (db) => {
        const { buildingId } = await seedBuilding(db);
        const extractor = toolsThen({ search: false, list: true }, () => ({
          answers: false,
          text: OFFICE_TURN_REFUSAL,
          hit_indexes: [],
        }));
        const result = await runOfficeTurn(turnDeps(db, extractor), {
          staffAccountId: await operator(db),
          bound: { kind: 'building', id: buildingId },
          question: 'אילו דירות מושכרות היום ומי הדיירים?',
        });
        assert.deepEqual(result.tools, ['list']);
        assert.equal(result.refused, false);
        assert.equal(result.text, OFFICE_TURN_EMPTY_ROLL);
        assert.notEqual(result.text, OFFICE_TURN_REFUSAL);
        assert.deepEqual(result.citations, []);
        assert.equal(
          extractor.calls.some((call) => call.name === 'office_turn'),
          false,
        );
      });
    } finally {
      await pool.end();
    }
  });
});
