// #250. The מדיניות tab, driven the way a staff member drives it.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { asOperator, signIn, signOutAll } from '../../tests/support/session.ts';
import { buildApp } from '../app.ts';
import { fixedClock } from '../kernel/clock.ts';
import { embeddingColumnDimensions } from '../kernel/config.ts';
import { createFakeEmbedder } from '../kernel/embeddings.ts';
import { createMemoryStore } from '../kernel/objects.ts';
import { createFakePdfText } from '../kernel/pdf.ts';
import { migratedPoolOrNull, skipReason } from '../kernel/pg-support.ts';
import {
  applyPolicySections,
  listPolicyLibrary,
  policySections,
} from './contract.ts';

const DOMAIN = 'policy-library.test';
const AT = new Date('2026-10-17T09:00:00.000Z');
const SPECIMEN = 'נוהל דוגמה. הפנייה למשרד נעשית בשעות העבודה.';
const BOUNDARY = '----policy-library';

function pdfBytes(marker: string): Buffer {
  return Buffer.from(`%PDF-1.4\n% ${marker}\n`, 'latin1');
}

function uploadBody(
  fields: Record<string, string>,
  bytes: Buffer,
): {
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
    bytes,
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

describe('policy library', () => {
  it('seeds State law and Company policy, and a second run creates nothing', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await applyPolicySections(pool, policySections);
      const rows = await pool.query<{ section_key: string; label_he: string }>(
        `SELECT section_key, label_he FROM policy_section ORDER BY sort_order`,
      );
      assert.deepEqual(
        rows.rows.map((row) => row.section_key),
        ['state_law', 'company_policy'],
      );
      assert.deepEqual(
        rows.rows.map((row) => row.label_he),
        ['דין המדינה', 'נוהל חברה'],
      );
      const second = await applyPolicySections(pool, policySections);
      assert.equal(second.created, 0);
    } finally {
      await pool.end();
    }
  });

  it('an admin uploads a specimen and it is readable, with the section on each passage', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    const clock = fixedClock(AT);
    const marker = `specimen-${Date.now()}`;
    const title = `נוהל דוגמה ${marker}`;
    const app = buildApp({
      pool,
      version: '9.9.9-test',
      clock,
      objects: createMemoryStore(),
      pdf: createFakePdfText([SPECIMEN]),
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
      const asAdmin = asOperator(app, admin);
      const before = await asAdmin.inject({ method: 'GET', url: '/policy' });
      assert.equal(before.statusCode, 200);
      assert.match(before.body, /מדיניות/);
      assert.match(before.body, /דין המדינה/);
      assert.match(before.body, /נוהל חברה/);
      assert.match(before.body, /type="file"/);
      assert.match(before.body, /העלאה/);
      assert.match(before.body, /data-dest="policy"/);

      const posted = await app.inject({
        method: 'POST',
        url: '/policy',
        headers: {
          cookie: admin.cookie,
          ...uploadBody(
            {
              csrf: admin.csrf,
              section_key: 'company_policy',
              title,
              effective_from: '2026-03-15',
            },
            pdfBytes(marker),
          ).headers,
        },
        payload: uploadBody(
          {
            csrf: admin.csrf,
            section_key: 'company_policy',
            title,
            effective_from: '2026-03-15',
          },
          pdfBytes(marker),
        ).payload,
      });
      assert.equal(posted.statusCode, 303);
      assert.equal(posted.headers.location, '/policy');

      const after = await asAdmin.inject({ method: 'GET', url: '/policy' });
      assert.equal(after.statusCode, 200);
      assert.match(after.body, new RegExp(title));
      assert.match(after.body, /data-effective-from="2026-03-15"/);
      assert.match(after.body, new RegExp(SPECIMEN));

      const library = await listPolicyLibrary(pool);
      const section = library.find(
        (item) => item.sectionKey === 'company_policy',
      );
      const document = section?.documents.find((item) => item.title === title);
      assert.ok(document);
      assert.ok(document.passages.length > 0);
      assert.equal(
        document.passages.every(
          (passage) => passage.sectionKey === 'company_policy',
        ),
        true,
      );
      assert.match(document.passages[0]?.body ?? '', /נוהל דוגמה/);
    } finally {
      await signOutAll(pool, DOMAIN);
      await app.close();
      await pool.end();
    }
  });
});
