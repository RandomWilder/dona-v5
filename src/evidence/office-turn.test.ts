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
  answerOfficeHits,
  applyDocumentTypeCatalogue,
  fileDocument,
  OFFICE_TURN_EMPTY_ROLL,
  OFFICE_TURN_RECORD_REFUSAL,
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
  unit?: string,
): Promise<{ documentId: string; unitId: string }> {
  // #227: a Unit bound reads the Unit record, so the Unit has to exist.
  const unitId = unit ?? (await seedBuilding(db)).unitId;
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
  it('calls the answering model on a Unit bound with no Documents, and refuses with the record sentence', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await inRolledBackTransaction(pool, async (db) => {
        const { unitId } = await seedBuilding(db);
        const extractor = refusingExtractor();
        const result = await runOfficeTurn(turnDeps(db, extractor), {
          staffAccountId: await operator(db),
          bound: { kind: 'unit', id: unitId },
          question: 'מה דמי השכירות?',
        });
        assert.equal(result.refused, true);
        assert.equal(result.text, OFFICE_TURN_RECORD_REFUSAL);
        assert.deepEqual(result.citations, []);
        assert.equal(extractor.calls.length, 1);
        assert.equal(result.thread.length, 1);
        assert.equal(result.thread[0]?.refused, true);
      });
    } finally {
      await pool.end();
    }
  });

  it('refuses the portfolio with no hits without calling the answering model', async () => {
    const extractor = refusingExtractor();
    const result = await answerOfficeHits(
      { extractor, model: 'fake-office-turn' },
      'מה דמי השכירות?',
      [],
      [],
    );
    assert.equal(result.refused, true);
    assert.equal(result.text, OFFICE_TURN_REFUSAL);
    assert.equal(extractor.calls.length, 0);
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
        assert.deepEqual(result.citations, [
          { documentId, page: 2, documentType: 'lease' },
        ]);
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
        assert.equal(result.text, OFFICE_TURN_RECORD_REFUSAL);
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
    `INSERT INTO party (party_id, party_kind, family_name, preferred_language)
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

const PHONE = '+972521234567';

async function seedRecordUnit(db: PoolClient): Promise<string> {
  const { buildingId, unitId } = await seedBuilding(db);
  const parkingId = newId();
  const storageId = newId();
  await db.query(
    `INSERT INTO space (space_id, building_id, space_kind, name)
     VALUES ($1, $3, 'PARKING', 'P-14'), ($2, $3, 'STORAGE', 'M-7')`,
    [parkingId, storageId, buildingId],
  );
  await db.query(`UPDATE space SET floor = '3' WHERE space_id = $1`, [unitId]);
  await db.query(
    `UPDATE unit SET area_sqm = 82, parking_space_id = $2, storage_space_id = $3
      WHERE unit_id = $1`,
    [unitId, parkingId, storageId],
  );
  return unitId;
}

function recordInput(extractor: ReturnType<typeof createFakeExtractor>) {
  const call = extractor.calls.find(
    (request) => request.name === 'office_turn',
  );
  assert.ok(call, 'the answering model was called');
  return call.input;
}

describe('evidence · office turn reads the Unit record', () => {
  it('gives the model the record, with built bay and storage labelled as built', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await inRolledBackTransaction(pool, async (db) => {
        const unitId = await seedRecordUnit(db);
        const extractor = refusingExtractor();
        await runOfficeTurn(turnDeps(db, extractor), {
          staffAccountId: await operator(db),
          bound: { kind: 'unit', id: unitId },
          question: 'מה גודל הדירה?',
        });
        const input = recordInput(extractor);
        assert.match(input, /כרטיס הדירה/);
        assert.match(input, /שטח: 82/);
        assert.match(input, /קומה: 3/);
        assert.match(input, /חדרים: 3\.5/);
        assert.match(input, /ממ״ד: יש/);
        assert.match(input, /סטטוס: להשכרה/);
        assert.match(input, /חניה \(מהבנייה\): P-14/);
        assert.match(input, /מחסן \(מהבנייה\): M-7/);
      });
    } finally {
      await pool.end();
    }
  });

  it('marks every field the account does not hold as לא רשום, never omitted', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await inRolledBackTransaction(pool, async (db) => {
        const { unitId } = await seedBuilding(db);
        const extractor = refusingExtractor();
        await runOfficeTurn(turnDeps(db, extractor), {
          staffAccountId: await operator(db),
          bound: { kind: 'unit', id: unitId },
          question: 'מה גודל הדירה?',
        });
        const input = recordInput(extractor);
        assert.match(input, /שטח: לא רשום/);
        assert.match(input, /קומה: לא רשום/);
        assert.match(input, /חניה \(מהבנייה\): לא רשום/);
        assert.match(input, /מחסן \(מהבנייה\): לא רשום/);
      });
    } finally {
      await pool.end();
    }
  });

  it('carries no phone and no ID number to the model', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await inRolledBackTransaction(pool, async (db) => {
        const unitId = await seedRecordUnit(db);
        await seedActiveLetting(db, unitId, TENANT);
        await db.query(
          `INSERT INTO party_contact (contact_id, party_id, channel, value, is_primary, valid_from)
           SELECT $1, tp.party_id, 'PHONE', $3, true, '2026-01-01'
             FROM tenancy_party tp JOIN tenancy t ON t.tenancy_id = tp.tenancy_id
            WHERE t.unit_id = $2`,
          [newId(), unitId, PHONE],
        );
        await db.query(
          `UPDATE party SET national_id = $2
            WHERE party_id IN (SELECT tp.party_id FROM tenancy_party tp
              JOIN tenancy t ON t.tenancy_id = tp.tenancy_id WHERE t.unit_id = $1)`,
          [unitId, ID],
        );
        const extractor = refusingExtractor();
        await runOfficeTurn(turnDeps(db, extractor), {
          staffAccountId: await operator(db),
          bound: { kind: 'unit', id: unitId },
          question: 'מה הטלפון של הדייר?',
        });
        const input = recordInput(extractor);
        assert.equal(input.includes(PHONE.slice(1)), false);
        assert.equal(input.includes('0521234567'), false);
        assert.equal(input.includes(ID), false);
      });
    } finally {
      await pool.end();
    }
  });

  it('answers from the record alone and persists a record citation', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await inRolledBackTransaction(pool, async (db) => {
        const unitId = await seedRecordUnit(db);
        const extractor = createFakeExtractor(() => ({
          answers: true,
          text: 'שטח הדירה 82 מ״ר.',
          hit_indexes: [],
          cites_record: true,
        }));
        const result = await runOfficeTurn(turnDeps(db, extractor), {
          staffAccountId: await operator(db),
          bound: { kind: 'unit', id: unitId },
          question: 'מה גודל הדירה?',
        });
        const cite = { kind: 'record', record: 'unit', id: unitId };
        assert.equal(result.refused, false);
        assert.equal(result.text, 'שטח הדירה 82 מ״ר.');
        assert.deepEqual(result.citations, [cite]);
        assert.deepEqual(result.thread[0]?.citations, [cite]);
      });
    } finally {
      await pool.end();
    }
  });

  it('drops a record citation when no record was loaded this turn', async () => {
    const extractor = createFakeExtractor(() => ({
      answers: true,
      text: 'שטח הדירה 82 מ״ר.',
      hit_indexes: [],
      cites_record: true,
    }));
    const result = await answerOfficeHits(
      { extractor, model: 'fake-office-turn' },
      'מה גודל הדירה?',
      [],
      [
        {
          passageId: newId(),
          documentId: newId(),
          page: 1,
          text: 'דף שאינו עונה',
          documentType: 'lease',
          unitId: null,
          distance: 0.5,
        },
      ],
    );
    assert.equal(result.refused, true);
    assert.equal(result.text, OFFICE_TURN_REFUSAL);
    assert.deepEqual(result.citations, []);
  });
});

// #228: the record's letting half. Today on the fixed clock is 2026-09-16.
async function seedLetting(
  db: PoolClient,
  unitId: string,
  letting: {
    status: string;
    start: string;
    end: string;
    rent?: { amount: string; currency: string; optionEnd: string };
    parking?: string;
    storage?: string;
  },
): Promise<void> {
  const profileId = newId();
  const tenancyId = newId();
  const tenantId = newId();
  const guarantorId = newId();
  const building = await db.query<{ building_id: string }>(
    `SELECT building_id FROM space WHERE space_id = $1`,
    [unitId],
  );
  const buildingId = building.rows[0]?.building_id;
  let parkingId: string | null = null;
  let storageId: string | null = null;
  if (letting.parking) {
    parkingId = newId();
    await db.query(
      `INSERT INTO space (space_id, building_id, space_kind, name)
       VALUES ($1, $2, 'PARKING', $3)`,
      [parkingId, buildingId, letting.parking],
    );
  }
  if (letting.storage) {
    storageId = newId();
    await db.query(
      `INSERT INTO space (space_id, building_id, space_kind, name)
       VALUES ($1, $2, 'STORAGE', $3)`,
      [storageId, buildingId, letting.storage],
    );
  }
  await db.query(
    `INSERT INTO terms_profile (terms_profile_id, name) VALUES ($1, $2)`,
    [profileId, `office-turn-${profileId}`],
  );
  await db.query(
    `INSERT INTO tenancy (tenancy_id, unit_id, start_date, end_date, status, terms_profile_id,
                          rent_amount, rent_currency, option_end_date,
                          parking_space_id, storage_space_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      tenancyId,
      unitId,
      letting.start,
      letting.end,
      letting.status,
      profileId,
      letting.rent?.amount ?? null,
      letting.rent?.currency ?? null,
      letting.rent?.optionEnd ?? null,
      parkingId,
      storageId,
    ],
  );
  await db.query(
    `INSERT INTO party (party_id, party_kind, family_name, preferred_language)
     VALUES ($1, 'PERSON', $3, 'he'), ($2, 'PERSON', 'דוד לוי', 'he')`,
    [tenantId, guarantorId, TENANT],
  );
  await db.query(
    `INSERT INTO tenancy_party (tenancy_id, party_id, role, is_service_contact)
     VALUES ($1, $2, 'PRIMARY_TENANT', true), ($1, $3, 'GUARANTOR', false)`,
    [tenancyId, tenantId, guarantorId],
  );
}

async function recordInputFor(db: PoolClient, unitId: string): Promise<string> {
  const extractor = refusingExtractor();
  await runOfficeTurn(turnDeps(db, extractor), {
    staffAccountId: await operator(db),
    bound: { kind: 'unit', id: unitId },
    question: 'מי גר בדירה?',
  });
  return recordInput(extractor);
}

describe('evidence · the Unit record carries the letting active today', () => {
  it('gives the model the active letting: dates, option end, rent, assigned bay and storage, parties by role', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await inRolledBackTransaction(pool, async (db) => {
        const unitId = await seedRecordUnit(db);
        await seedLetting(db, unitId, {
          status: 'ACTIVE',
          start: '2026-01-01',
          end: '2027-01-01',
          rent: { amount: '5400', currency: 'ILS', optionEnd: '2028-01-01' },
          parking: 'P-22',
          storage: 'M-9',
        });
        const input = await recordInputFor(db, unitId);
        assert.match(input, /תחילת השכירות: 2026-01-01/);
        assert.match(input, /סיום השכירות: 2027-01-01/);
        assert.match(input, /סיום האופציה: 2028-01-01/);
        assert.match(input, /דמי שכירות: 5400 ILS/);
        assert.match(input, /חניה \(מהשכירות\): P-22/);
        assert.match(input, /מחסן \(מהשכירות\): M-9/);
        // Two labelled facts, never merged.
        assert.match(input, /חניה \(מהבנייה\): P-14/);
        assert.match(input, /מחסן \(מהבנייה\): M-7/);
        assert.match(input, new RegExp(`${TENANT} — שוכר ראשי`));
        assert.match(input, /דוד לוי — ערב/);
        assert.equal(input.includes('אין השכרה פעילה'), false);
      });
    } finally {
      await pool.end();
    }
  });

  it('marks a letting field the account does not hold as לא רשום', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await inRolledBackTransaction(pool, async (db) => {
        const { unitId } = await seedBuilding(db);
        await seedLetting(db, unitId, {
          status: 'ACTIVE',
          start: '2026-01-01',
          end: '2027-01-01',
        });
        const input = await recordInputFor(db, unitId);
        assert.match(input, /סיום האופציה: לא רשום/);
        assert.match(input, /דמי שכירות: לא רשום/);
        assert.match(input, /חניה \(מהשכירות\): לא רשום/);
        assert.match(input, /מחסן \(מהשכירות\): לא רשום/);
      });
    } finally {
      await pool.end();
    }
  });

  it('carries an active letting that has no party yet, with its parties as לא רשום', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await inRolledBackTransaction(pool, async (db) => {
        const { unitId } = await seedBuilding(db);
        const profileId = newId();
        await db.query(
          `INSERT INTO terms_profile (terms_profile_id, name) VALUES ($1, $2)`,
          [profileId, `office-turn-${profileId}`],
        );
        await db.query(
          `INSERT INTO tenancy (tenancy_id, unit_id, start_date, end_date, status, terms_profile_id)
           VALUES ($1, $2, '2026-01-01', '2027-01-01', 'ACTIVE', $3)`,
          [newId(), unitId, profileId],
        );
        const input = await recordInputFor(db, unitId);
        assert.equal(input.includes('אין השכרה פעילה'), false);
        assert.match(input, /סיום השכירות: 2027-01-01/);
        assert.match(input, /צדדים: לא רשום/);
      });
    } finally {
      await pool.end();
    }
  });

  for (const [label, letting] of [
    ['a vacant flat', null],
    [
      'a draft only',
      { status: 'DRAFT', start: '2026-01-01', end: '2027-01-01' },
    ],
    [
      'an ended letting',
      { status: 'ENDED', start: '2025-01-01', end: '2026-01-01' },
    ],
    [
      'a future signed letting',
      { status: 'ACTIVE', start: '2026-12-01', end: '2027-12-01' },
    ],
  ] as const) {
    it(`says אין השכרה פעילה and carries no letting field for ${label}`, async (t) => {
      const pool = await migratedPoolOrNull();
      if (!pool) {
        t.skip(skipReason);
        return;
      }
      try {
        await inRolledBackTransaction(pool, async (db) => {
          const unitId = await seedRecordUnit(db);
          if (letting) {
            await seedLetting(db, unitId, {
              ...letting,
              rent: {
                amount: '5400',
                currency: 'ILS',
                optionEnd: '2028-01-01',
              },
              parking: 'P-22',
            });
          }
          const input = await recordInputFor(db, unitId);
          assert.match(input, /השכרה: אין השכרה פעילה/);
          assert.equal(input.includes('מהשכירות'), false);
          assert.equal(input.includes('5400'), false);
          assert.equal(input.includes(TENANT), false);
          assert.match(input, /חניה \(מהבנייה\): P-14/);
        });
      } finally {
        await pool.end();
      }
    });
  }
});
