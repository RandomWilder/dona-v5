// #254. Search cites only the version in force on the as-of date. On the day the
// next version starts, the previous one is already over. Each section is capped
// on its own, so one section cannot fill the prompt.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { PoolClient } from 'pg';
import { embeddingColumnDimensions } from '../../src/kernel/config.ts';
import {
  createFakeEmbedder,
  vectorLiteral,
} from '../../src/kernel/embeddings.ts';
import { newId } from '../../src/kernel/ids.ts';
import {
  inRolledBackTransaction,
  migratedPoolOrNull,
  skipReason,
} from '../../src/kernel/pg-support.ts';
import {
  applyPolicySections,
  POLICY_SECTION_CAP,
  policySections,
  searchPolicyPassages,
} from '../../src/policy/contract.ts';

const OLD_FROM = '2024-01-01';
const BOUNDARY = '2026-04-01';
const DAY_BEFORE = '2026-03-31';
const QUESTION = 'מה חלון התיקון לדוד?';

const embedder = createFakeEmbedder(embeddingColumnDimensions);

async function insertVersion(
  db: PoolClient,
  spec: {
    sectionId: string;
    title: string;
    from: string;
    to: string | null;
    body: string;
    vectorOf: string;
  },
): Promise<string> {
  const documentId = newId();
  const passageId = newId();
  await db.query(
    `INSERT INTO policy_document (
       policy_document_id, policy_section_id, title, effective_from, effective_to,
       storage_uri, file_hash, uploaded_by, ingested_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      documentId,
      spec.sectionId,
      spec.title,
      spec.from,
      spec.to,
      `gs://dona-v5-test-docs/policy/${documentId}.pdf`,
      documentId,
      newId(),
      new Date('2026-10-17T09:00:00.000Z'),
    ],
  );
  const [vector] = await embedder.embed([spec.vectorOf]);
  await db.query(
    `INSERT INTO policy_passage (
       policy_passage_id, policy_document_id, policy_section_id,
       page, ordinal, body, embedding
     ) VALUES ($1, $2, $3, 1, 0, $4, $5::vector)`,
    [
      passageId,
      documentId,
      spec.sectionId,
      spec.body,
      vectorLiteral(vector ?? []),
    ],
  );
  return passageId;
}

describe('policy search as of a date', () => {
  it('on the boundary date the ended version is absent and the new one is returned', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await inRolledBackTransaction(pool, async (db) => {
        await applyPolicySections(db, policySections);
        const section = policySections[0];
        assert.ok(section);
        const title = `254 boundary ${newId()}`;
        const oldId = await insertVersion(db, {
          sectionId: section.policySectionId,
          title,
          from: OLD_FROM,
          to: BOUNDARY,
          body: 'גרסה ישנה: חלון של ארבעה עשר יום',
          vectorOf: QUESTION,
        });
        const openedId = await insertVersion(db, {
          sectionId: section.policySectionId,
          title,
          from: BOUNDARY,
          to: null,
          body: 'גרסה חדשה: חלון של שבעה ימים',
          vectorOf: QUESTION,
        });
        const onBoundary = await searchPolicyPassages(
          db,
          embedder,
          QUESTION,
          BOUNDARY,
        );
        const before = await searchPolicyPassages(
          db,
          embedder,
          QUESTION,
          DAY_BEFORE,
        );
        const boundaryIds = onBoundary.map((hit) => hit.passageId);
        const beforeIds = before.map((hit) => hit.passageId);
        assert.equal(boundaryIds.includes(oldId), false);
        assert.equal(boundaryIds.includes(openedId), true);
        assert.equal(beforeIds.includes(oldId), true);
        assert.equal(beforeIds.includes(openedId), false);
        const cited = onBoundary.find((hit) => hit.passageId === openedId);
        assert.equal(cited?.sectionKey, 'state_law');
        assert.equal(cited?.effectiveFrom, BOUNDARY);
        assert.equal(cited?.effectiveTo, null);
      });
    } finally {
      await pool.end();
    }
  });

  it('returns at most eight passages from each section, and both sections', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await inRolledBackTransaction(pool, async (db) => {
        await applyPolicySections(db, policySections);
        const question = `254 cap ${newId()}`;
        const [vector] = await embedder.embed([question]);
        const literal = vectorLiteral(vector ?? []);
        for (const section of policySections) {
          const documentId = newId();
          await db.query(
            `INSERT INTO policy_document (
               policy_document_id, policy_section_id, title, effective_from,
               storage_uri, file_hash, uploaded_by, ingested_at
             ) VALUES ($1, $2, $3, '2020-01-01', $4, $5, $6, $7)`,
            [
              documentId,
              section.policySectionId,
              `254 cap ${section.sectionKey} ${documentId}`,
              `gs://dona-v5-test-docs/policy/${documentId}.pdf`,
              documentId,
              newId(),
              new Date('2026-10-17T09:00:00.000Z'),
            ],
          );
          for (let page = 1; page <= POLICY_SECTION_CAP + 1; page += 1) {
            await db.query(
              `INSERT INTO policy_passage (
                 policy_passage_id, policy_document_id, policy_section_id,
                 page, ordinal, body, embedding
               ) VALUES ($1, $2, $3, $4, $5, $6, $7::vector)`,
              [
                newId(),
                documentId,
                section.policySectionId,
                page,
                page - 1,
                `${question} עמוד ${page}`,
                literal,
              ],
            );
          }
        }
        const hits = await searchPolicyPassages(
          db,
          embedder,
          question,
          '2026-10-17',
        );
        const counts = new Map<string, number>();
        for (const hit of hits) {
          counts.set(hit.sectionKey, (counts.get(hit.sectionKey) ?? 0) + 1);
        }
        assert.equal(counts.get('state_law'), POLICY_SECTION_CAP);
        assert.equal(counts.get('company_policy'), POLICY_SECTION_CAP);
        const lawAt = hits.findIndex((hit) => hit.sectionKey === 'state_law');
        const companyAt = hits.findIndex(
          (hit) => hit.sectionKey === 'company_policy',
        );
        assert.ok(lawAt >= 0 && companyAt > lawAt);
      });
    } finally {
      await pool.end();
    }
  });
});
