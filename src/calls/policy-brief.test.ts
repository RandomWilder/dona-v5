// #254. The call page labels a Policy citation with its section and its dates.
// The day a version ends, the follow-up cites the version then in force.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { asOperator, signIn, signOutAll } from '../../tests/support/session.ts';
import { buildApp } from '../app.ts';
import { fixedClock } from '../kernel/clock.ts';
import { embeddingColumnDimensions } from '../kernel/config.ts';
import { createFakeEmbedder, vectorLiteral } from '../kernel/embeddings.ts';
import { createFakeExtractor } from '../kernel/extraction.ts';
import { newId } from '../kernel/ids.ts';
import {
  migratedPoolOrNull,
  skipReason,
  withGuardsOff,
} from '../kernel/pg-support.ts';
import { createParty } from '../parties/contract.ts';
import { applyPolicySections, policySections } from '../policy/contract.ts';

const AT = new Date('2026-10-17T09:00:00.000Z');
const DAY_BEFORE = 'מה חל ב־2026-03-31?';
const BOUNDARY = 'מה חל ב־2026-04-01?';

function form(fields: Record<string, string>): string {
  return new URLSearchParams(fields).toString();
}

function turnAround(body: string, question: string): string {
  const at = body.indexOf(question);
  assert.ok(at > 0, question);
  const start = body.lastIndexOf('data-brief-turn', at);
  const end = body.indexOf('data-brief-turn', start + 1);
  return body.slice(start, end === -1 ? body.length : end);
}

describe('calls · policy in the brief', () => {
  it('labels the section and the version dates, and the boundary date cites the new version', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    const domain = 'calls-policy-brief.test';
    const clock = fixedClock(AT);
    const embedder = createFakeEmbedder(embeddingColumnDimensions);
    const queued: Array<() => Promise<void>> = [];
    const extractor = createFakeExtractor((request) => {
      if (!request.input.includes('נכון לתאריך')) {
        return { answers: false, text: '', hit_indexes: [] };
      }
      return {
        answers: true,
        text: 'הנוסח שבתוקף',
        hit_indexes: [1],
      };
    });
    const app = buildApp({
      pool,
      version: '9.9.9-test',
      clock,
      extractor,
      embedder,
      briefSchedule: (work) => {
        queued.push(work);
      },
    });
    await signOutAll(pool, domain);
    const who = await signIn(pool, clock, {
      email: `ops@${domain}`,
      role: 'OPERATOR',
    });
    const client = asOperator(app, who);
    const party = await createParty(pool, {
      kind: 'PERSON',
      givenName: 'רות',
      familyName: 'מדיניות',
      preferredLanguage: 'he',
    });
    const section = policySections[0];
    assert.ok(section);
    const title = `חוק לדוגמה ${newId().slice(0, 8)}`;
    const oldId = newId();
    const newDocId = newId();
    const documentIds = [oldId, newDocId];
    try {
      await applyPolicySections(pool, policySections);
      const embed = embedder.embed.bind(embedder);
      const [oldVector] = await embed([DAY_BEFORE]);
      const [newVector] = await embed([BOUNDARY]);
      for (const spec of [
        {
          id: oldId,
          from: '2024-01-01',
          to: '2026-04-01',
          body: 'גרסה ישנה: ארבעה עשר יום',
          vector: oldVector,
        },
        {
          id: newDocId,
          from: '2026-04-01',
          to: null,
          body: 'גרסה חדשה: שבעה ימים',
          vector: newVector,
        },
      ]) {
        await pool.query(
          `INSERT INTO policy_document (
             policy_document_id, policy_section_id, title, effective_from,
             effective_to, storage_uri, file_hash, uploaded_by, ingested_at
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            spec.id,
            section.policySectionId,
            title,
            spec.from,
            spec.to,
            `gs://dona-v5-test-docs/policy/${spec.id}.pdf`,
            spec.id,
            who.staffAccountId,
            AT,
          ],
        );
        await pool.query(
          `INSERT INTO policy_passage (
             policy_passage_id, policy_document_id, policy_section_id,
             page, ordinal, body, embedding
           ) VALUES ($1, $2, $3, 1, 0, $4, $5::vector)`,
          [
            newId(),
            spec.id,
            section.policySectionId,
            spec.body,
            vectorLiteral(spec.vector ?? []),
          ],
        );
      }

      const created = await client.inject({
        method: 'POST',
        url: '/calls',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: form({
          channel: 'PHONE',
          description: 'הדוד לא מחמם 254',
          sender: 'unknown',
        }),
      });
      assert.equal(created.statusCode, 303);
      const list = await client.inject({ method: 'GET', url: '/calls' });
      const callId = list.body.match(
        /href="\/calls\/([0-9a-f-]{36})">הדוד לא מחמם 254/,
      )?.[1];
      assert.ok(callId);
      const identified = await client.inject({
        method: 'POST',
        url: `/calls/${callId}/identify`,
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: form({ party_id: party.id }),
      });
      assert.equal(identified.statusCode, 303);
      const run = queued[0];
      assert.ok(run);
      await run();

      for (const question of [DAY_BEFORE, BOUNDARY]) {
        const posted = await client.inject({
          method: 'POST',
          url: `/calls/${callId}/follow-up`,
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          payload: form({ question }),
        });
        assert.equal(posted.statusCode, 303);
      }

      const page = await client.inject({
        method: 'GET',
        url: `/calls/${callId}`,
      });
      assert.equal(page.statusCode, 200);
      const older = turnAround(page.body, DAY_BEFORE);
      const newer = turnAround(page.body, BOUNDARY);
      assert.match(older, /דין המדינה/);
      assert.match(older, /בתוקף מ־01\.01\.2024/);
      assert.match(older, /הוחלף ב־01\.04\.2026/);
      assert.match(older, /31\.03\.2026/);
      assert.match(newer, /דין המדינה/);
      assert.match(newer, /בתוקף מ־01\.04\.2026/);
      assert.doesNotMatch(newer, /01\.01\.2024/);
      assert.match(newer, /01\.04\.2026/);
    } finally {
      await withGuardsOff(
        pool,
        [
          ['policy_passage', 'policy_passage_is_append_only'],
          ['policy_document', 'policy_document_is_append_only'],
        ],
        async (db) => {
          await db.query(
            `DELETE FROM policy_passage WHERE policy_document_id = ANY($1::uuid[])`,
            [documentIds],
          );
          await db.query(
            `DELETE FROM policy_document WHERE policy_document_id = ANY($1::uuid[])`,
            [documentIds],
          );
        },
      );
      await pool.query(
        `DELETE FROM service_call_transition
          WHERE service_call_id IN (
            SELECT service_call_id FROM service_call WHERE opened_by = $1
          )`,
        [who.staffAccountId],
      );
      await pool.query(`DELETE FROM service_call WHERE opened_by = $1`, [
        who.staffAccountId,
      ]);
      await pool.query('DELETE FROM party WHERE party_id = $1', [party.id]);
      await signOutAll(pool, domain);
      await app.close();
      await pool.end();
    }
  });
});
