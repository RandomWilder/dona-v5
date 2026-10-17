// #250. Uploading a Policy document is settings.write. An OPERATOR holds
// documents.write and does not hold settings.write, so this case was red while
// the route declared documents.write: the post answered 303 and the row existed.
// It is green only when the server refuses.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { PoolClient } from 'pg';
import { buildApp } from '../../src/app.ts';
import { fixedClock } from '../../src/kernel/clock.ts';
import { embeddingColumnDimensions } from '../../src/kernel/config.ts';
import { createFakeEmbedder } from '../../src/kernel/embeddings.ts';
import { newId } from '../../src/kernel/ids.ts';
import { createMemoryStore } from '../../src/kernel/objects.ts';
import { createFakePdfText } from '../../src/kernel/pdf.ts';
import {
  inRolledBackTransaction,
  migratedPoolOrNull,
  skipReason,
} from '../../src/kernel/pg-support.ts';
import {
  applyPolicySections,
  policySections,
} from '../../src/policy/contract.ts';
import { asOperator, signIn, signOutAll } from '../support/session.ts';

const DOMAIN = 'policy-upload-refused.test';
const AT = new Date('2026-10-17T09:00:00.000Z');
const BOUNDARY = '----policy-refused';
const RESTRICT_VIOLATION = '23001';

function pdfBytes(): Buffer {
  return Buffer.from('%PDF-1.4\n% specimen\n', 'latin1');
}

function uploadBody(fields: Record<string, string>): {
  payload: Buffer;
  headers: { 'content-type': string };
} {
  const parts: Buffer[] = [];
  for (const [name, value] of Object.entries(fields)) {
    parts.push(
      Buffer.from(
        `--${BOUNDARY}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
      ),
    );
  }
  parts.push(
    Buffer.from(
      `--${BOUNDARY}\r\nContent-Disposition: form-data; name="file"; filename="specimen.pdf"\r\n` +
        'Content-Type: application/octet-stream\r\n\r\n',
    ),
    pdfBytes(),
    Buffer.from('\r\n'),
    Buffer.from(`--${BOUNDARY}--\r\n`),
  );
  return {
    payload: Buffer.concat(parts),
    headers: {
      'content-type': `multipart/form-data; boundary=${BOUNDARY}`,
    },
  };
}

async function rejects(
  db: PoolClient,
  statement: () => Promise<unknown>,
): Promise<void> {
  await db.query('SAVEPOINT attempt');
  try {
    await statement();
    await db.query('ROLLBACK TO SAVEPOINT attempt');
    assert.fail('expected the write to be refused');
  } catch (error) {
    await db.query('ROLLBACK TO SAVEPOINT attempt');
    assert.equal((error as { code?: string }).code, RESTRICT_VIOLATION);
  }
}

describe('policy · only an admin uploads, and a document is never rewritten', () => {
  it('an operator and a viewer can read and cannot upload', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    const clock = fixedClock(AT);
    const app = buildApp({
      pool,
      version: '9.9.9-test',
      clock,
      objects: createMemoryStore(),
      pdf: createFakePdfText(['נוהל דוגמה']),
      embedder: createFakeEmbedder(embeddingColumnDimensions),
      bucket: 'dona-v5-test-docs',
    });
    await signOutAll(pool, DOMAIN);
    try {
      await applyPolicySections(pool, policySections);
      const operator = await signIn(pool, clock, {
        email: `ops@${DOMAIN}`,
        role: 'OPERATOR',
      });
      const viewer = await signIn(pool, clock, {
        email: `view@${DOMAIN}`,
        role: 'VIEWER',
      });
      for (const who of [operator, viewer]) {
        const page = await asOperator(app, who).inject({
          method: 'GET',
          url: '/policy',
        });
        assert.equal(page.statusCode, 200);
        assert.match(page.body, /מדיניות/);
        assert.match(page.body, /דין המדינה/);
        assert.doesNotMatch(page.body, /type="file"/);
        assert.doesNotMatch(page.body, /העלאה/);
        const body = uploadBody({
          csrf: who.csrf,
          section_key: 'state_law',
          title: 'לא אמור להישמר',
          effective_from: '2026-01-01',
        });
        const refused = await app.inject({
          method: 'POST',
          url: '/policy',
          headers: { cookie: who.cookie, ...body.headers },
          payload: body.payload,
        });
        assert.equal(refused.statusCode, 403);
        assert.equal(refused.json().code, 'not_allowed');
      }
      const stored = await pool.query(
        `SELECT policy_document_id FROM policy_document WHERE title = 'לא אמור להישמר'`,
      );
      assert.equal(stored.rowCount, 0);
    } finally {
      await signOutAll(pool, DOMAIN);
      await app.close();
      await pool.end();
    }
  });

  it('refuses an update and a delete of a document and of a passage', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await inRolledBackTransaction(pool, async (db) => {
        await applyPolicySections(db, policySections);
        const documentId = newId();
        const passageId = newId();
        const section = await db.query<{ policy_section_id: string }>(
          `SELECT policy_section_id FROM policy_section WHERE section_key = 'state_law'`,
        );
        const sectionId = section.rows[0]?.policy_section_id;
        assert.ok(sectionId);
        await db.query(
          `INSERT INTO policy_document (
             policy_document_id, policy_section_id, title, effective_from,
             storage_uri, file_hash, uploaded_by, ingested_at
           ) VALUES ($1, $2, 'דין דוגמה', '2024-01-01',
                     'gs://dona-v5-test-docs/policy/state_law/abc.pdf',
                     $3, $4, $5)`,
          [
            documentId,
            sectionId,
            'a'.repeat(64),
            newId(),
            new Date('2026-10-17T09:00:00.000Z'),
          ],
        );
        await db.query(
          `INSERT INTO policy_passage (
             policy_passage_id, policy_document_id, policy_section_id,
             page, ordinal, body, embedding
           ) VALUES ($1, $2, $3, 1, 0, 'טקסט דוגמה', $4::vector)`,
          [
            passageId,
            documentId,
            sectionId,
            `[${new Array(1536).fill(0).join(',')}]`,
          ],
        );
        await rejects(db, () =>
          db.query(
            `UPDATE policy_document SET title = 'אחר' WHERE policy_document_id = $1`,
            [documentId],
          ),
        );
        await rejects(db, () =>
          db.query(
            `DELETE FROM policy_document WHERE policy_document_id = $1`,
            [documentId],
          ),
        );
        await rejects(db, () =>
          db.query(
            `UPDATE policy_passage SET body = 'אחר' WHERE policy_passage_id = $1`,
            [passageId],
          ),
        );
        await rejects(db, () =>
          db.query(`DELETE FROM policy_passage WHERE policy_passage_id = $1`, [
            passageId,
          ]),
        );
      });
    } finally {
      await pool.end();
    }
  });
});
