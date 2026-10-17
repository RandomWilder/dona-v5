// #251. A later version has to start after the current one, and two versions of
// one Policy document are never in force on the same date. Both refusals were
// red before the rule existed: the second insert was stored, and a backdated
// upload answered 303.
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
import { signIn, signOutAll } from '../support/session.ts';

const EXCLUSION_VIOLATION = '23P01';
const DOMAIN = 'policy-versions.test';
const AT = new Date('2026-10-17T09:00:00.000Z');
const BOUNDARY = '----policy-versions';

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
    Buffer.from('%PDF-1.4\n% specimen\n', 'latin1'),
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

async function insertVersion(
  db: PoolClient,
  sectionId: string,
  title: string,
  effectiveFrom: string,
): Promise<void> {
  await db.query(
    `INSERT INTO policy_document (
       policy_document_id, policy_section_id, title, effective_from,
       storage_uri, file_hash, uploaded_by, ingested_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      newId(),
      sectionId,
      title,
      effectiveFrom,
      `gs://dona-v5-test-docs/policy/state_law/${effectiveFrom}.pdf`,
      newId(),
      newId(),
      new Date('2026-10-17T09:00:00.000Z'),
    ],
  );
}

describe('policy · versions do not overlap', () => {
  it('refuses a second version that would also be in force', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await inRolledBackTransaction(pool, async (db) => {
        await applyPolicySections(db, policySections);
        const section = await db.query<{ policy_section_id: string }>(
          `SELECT policy_section_id FROM policy_section WHERE section_key = 'state_law'`,
        );
        const sectionId = section.rows[0]?.policy_section_id;
        assert.ok(sectionId);
        const title = 'דין דוגמה לגרסאות';
        await insertVersion(db, sectionId, title, '2024-01-01');
        await db.query('SAVEPOINT attempt');
        let code: string | undefined;
        try {
          await insertVersion(db, sectionId, title, '2025-06-01');
        } catch (error) {
          code = (error as { code?: string }).code;
        }
        await db.query('ROLLBACK TO SAVEPOINT attempt');
        assert.equal(code, EXCLUSION_VIOLATION);
      });
    } finally {
      await pool.end();
    }
  });

  it('refuses a new version that does not start after the current one', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    const clock = fixedClock(AT);
    const title = `דין דוגמה ${Date.now()}`;
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
      const admin = await signIn(pool, clock, {
        email: `admin@${DOMAIN}`,
        role: 'ADMIN',
      });
      const first = uploadBody({
        csrf: admin.csrf,
        section_key: 'state_law',
        title,
        effective_from: '2026-06-01',
      });
      const posted = await app.inject({
        method: 'POST',
        url: '/policy',
        headers: { cookie: admin.cookie, ...first.headers },
        payload: first.payload,
      });
      assert.equal(posted.statusCode, 303);
      const sameDay = uploadBody({
        csrf: admin.csrf,
        section_key: 'state_law',
        title,
        effective_from: '2026-06-01',
      });
      const refused = await app.inject({
        method: 'POST',
        url: '/policy',
        headers: { cookie: admin.cookie, ...sameDay.headers },
        payload: sameDay.payload,
      });
      assert.equal(refused.statusCode, 409);
      assert.equal(refused.json().code, 'conflict');
      const earlier = uploadBody({
        csrf: admin.csrf,
        section_key: 'state_law',
        title,
        effective_from: '2026-05-31',
      });
      const alsoRefused = await app.inject({
        method: 'POST',
        url: '/policy',
        headers: { cookie: admin.cookie, ...earlier.headers },
        payload: earlier.payload,
      });
      assert.equal(alsoRefused.statusCode, 409);
      const stored = await pool.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM policy_document WHERE title = $1`,
        [title],
      );
      assert.equal(stored.rows[0]?.n, '1');
    } finally {
      await signOutAll(pool, DOMAIN);
      await app.close();
      await pool.end();
    }
  });
});
