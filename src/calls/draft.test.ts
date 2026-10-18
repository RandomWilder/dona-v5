// The draft reply on the call page. #255. English gets a Hebrew rendering.
// Hebrew is one text. Copy is on the page. Nothing is sent.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { seedOccupancy } from '../../tests/policy/fixtures.ts';
import { asOperator, signIn, signOutAll } from '../../tests/support/session.ts';
import { buildApp } from '../app.ts';
import {
  applyDocumentTypeCatalogue,
  fileDocument,
  type IntakeDeps,
} from '../evidence/contract.ts';
import { seedDocumentTypes } from '../evidence/fixtures/document-types.ts';
import { createAuditLog } from '../kernel/audit.ts';
import { fixedClock } from '../kernel/clock.ts';
import { embeddingColumnDimensions } from '../kernel/config.ts';
import { createFakeEmbedder } from '../kernel/embeddings.ts';
import { createFakeExtractor } from '../kernel/extraction.ts';
import { newId } from '../kernel/ids.ts';
import { createMemoryStore } from '../kernel/objects.ts';
import { createFakePdfText } from '../kernel/pdf.ts';
import { migratedPoolOrNull, skipReason } from '../kernel/pg-support.ts';
import { createParty } from '../parties/contract.ts';

const AT = new Date('2026-10-18T09:00:00.000Z');
const ENGLISH = 'The kitchen ceiling is damp';
const HEBREW = 'רטיבות בתקרת המטבח';
const MARKER = 'MARKER-255-LEASE בעל הדירה';

function form(fields: Record<string, string>): string {
  return new URLSearchParams(fields).toString();
}

function draftSection(body: string): string {
  const at = body.indexOf('class="glass sheet draft"');
  assert.ok(at > 0);
  const next = body.indexOf('<section', at);
  return next === -1 ? body.slice(at) : body.slice(at, next);
}

describe('calls · the draft reply', () => {
  it('writes English with a Hebrew rendering, and Hebrew as one text, and offers copy', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    const domain = 'calls-draft.test';
    const clock = fixedClock(AT);
    const queued: Array<() => Promise<void>> = [];
    const extractor = createFakeExtractor(() => ({
      answers: false,
      text: '',
      hebrew: '',
      hit_indexes: [],
    }));
    const app = buildApp({
      pool,
      version: '9.9.9-test',
      clock,
      extractor,
      embedder: createFakeEmbedder(embeddingColumnDimensions),
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
      givenName: 'נועה',
      familyName: 'טיוטה',
      preferredLanguage: 'he',
    });
    try {
      const opened = await client.inject({
        method: 'POST',
        url: '/calls',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: form({
          channel: 'PHONE',
          description: ENGLISH,
          sender: 'unknown',
        }),
      });
      assert.equal(opened.statusCode, 303);
      const list = await client.inject({ method: 'GET', url: '/calls' });
      const callId = list.body.match(
        new RegExp(`href="/calls/([0-9a-f-]{36})">${ENGLISH}`),
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
      const ready = await client.inject({
        method: 'GET',
        url: `/calls/${callId}`,
      });
      assert.match(ready.body, /כתבו טיוטה/);
      assert.doesNotMatch(ready.body, /<script/);
      const drafted = await client.inject({
        method: 'POST',
        url: `/calls/${callId}/draft`,
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: form({}),
      });
      assert.equal(drafted.statusCode, 303);
      const page = await client.inject({
        method: 'GET',
        url: `/calls/${callId}`,
      });
      const section = draftSection(page.body);
      assert.match(section, /data-draft-lang="other"/);
      assert.match(section, /data-draft[^>]*>Hello נועה,/);
      assert.match(section, /The papers on file do not answer this\./);
      assert.match(section, /data-rendering>שלום נועה,/);
      assert.match(section, /אין במסמכים האלה תשובה לשאלה הזו/);
      assert.match(section, /data-copy>העתקה/);
      assert.match(section, /<script/);
      assert.match(section, /clipboard/);
      assert.doesNotMatch(section, /שליחה/);
      assert.equal(
        extractor.calls.filter((call) => call.name === 'call_draft').length,
        0,
      );

      const walked = await client.inject({
        method: 'POST',
        url: '/calls',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: form({
          channel: 'WALK_IN',
          description: HEBREW,
          sender: 'unknown',
        }),
      });
      assert.equal(walked.statusCode, 303);
      const again = await client.inject({ method: 'GET', url: '/calls' });
      const walkId = again.body.match(
        new RegExp(`href="/calls/([0-9a-f-]{36})">${HEBREW}`),
      )?.[1];
      assert.ok(walkId);
      const named = await client.inject({
        method: 'POST',
        url: `/calls/${walkId}/identify`,
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: form({ party_id: party.id }),
      });
      assert.equal(named.statusCode, 303);
      const second = queued[1];
      assert.ok(second);
      await second();
      const posted = await client.inject({
        method: 'POST',
        url: `/calls/${walkId}/draft`,
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: form({}),
      });
      assert.equal(posted.statusCode, 303);
      const hebrew = await client.inject({
        method: 'GET',
        url: `/calls/${walkId}`,
      });
      const one = draftSection(hebrew.body);
      assert.match(one, /data-draft-lang="he"/);
      assert.match(one, /data-draft[^>]*>שלום נועה,/);
      assert.match(one, /אין במסמכים האלה תשובה לשאלה הזו/);
      assert.doesNotMatch(one, /data-rendering/);
      assert.match(one, /data-copy>העתקה/);
      assert.doesNotMatch(one, /שליחה/);
    } finally {
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

  it('grounds an English draft in the brief’s cited passage', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    const domain = 'calls-draft-cited.test';
    const clock = fixedClock(AT);
    const bucket = 'dona-v5-test-call-draft';
    const queued: Array<() => Promise<void>> = [];
    const extractor = createFakeExtractor((request) => {
      if (request.name === 'call_draft') {
        return {
          answers: true,
          text: 'The owner repairs fair wear.',
          hebrew: 'בעל הדירה מתקן בלאי סביר.',
          hit_indexes: [1],
        };
      }
      return {
        answers: request.input.includes(MARKER),
        text: request.input.includes(MARKER) ? 'בעל הדירה' : '',
        hit_indexes: request.input.includes(MARKER) ? [1] : [],
      };
    });
    const app = buildApp({
      pool,
      version: '9.9.9-test',
      clock,
      extractor,
      embedder: createFakeEmbedder(embeddingColumnDimensions),
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
    const unitNumber = `d${
      newId()
        .replace(/[^a-z]/g, '')
        .slice(0, 6) || 'draft'
    }`;
    const home = await seedOccupancy(pool, unitNumber, {
      phone: `+97250${newId().replace(/\D/g, '').padEnd(7, '2').slice(0, 7)}`,
      contactFrom: '2026-01-01',
      contactTo: null,
      tenancyFrom: '2026-01-01',
      tenancyTo: '2027-01-01',
    });
    await applyDocumentTypeCatalogue(pool, seedDocumentTypes);
    const intake: IntakeDeps = {
      db: pool,
      objects: createMemoryStore(),
      pdf: createFakePdfText([
        `${MARKER} חוזה שכירות. המושכר. תקופת השכירות. השוכר.`,
      ]),
      embedder: createFakeEmbedder(embeddingColumnDimensions),
      audit: createAuditLog(pool, clock),
      clock,
      bucket,
    };
    const lease = await fileDocument(intake, {
      bytes: Buffer.from(`%PDF-1.4\n% ${newId()}\n`, 'latin1'),
      typeKey: 'lease',
      place: { kind: 'UNIT', id: home.unitId },
      tenancyId: home.tenancyId,
    });
    assert.equal(lease.filed, true, lease.filed ? '' : lease.refusal);
    try {
      const opened = await client.inject({
        method: 'POST',
        url: '/calls',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: form({
          channel: 'PHONE',
          description: ENGLISH,
          sender: 'unknown',
        }),
      });
      assert.equal(opened.statusCode, 303);
      const list = await client.inject({ method: 'GET', url: '/calls' });
      const callId = list.body.match(
        new RegExp(`href="/calls/([0-9a-f-]{36})">${ENGLISH}`),
      )?.[1];
      assert.ok(callId);
      const identified = await client.inject({
        method: 'POST',
        url: `/calls/${callId}/identify`,
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: form({ party_id: home.partyId }),
      });
      assert.equal(identified.statusCode, 303);
      const run = queued[0];
      assert.ok(run);
      await run();
      const drafted = await client.inject({
        method: 'POST',
        url: `/calls/${callId}/draft`,
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: form({}),
      });
      assert.equal(drafted.statusCode, 303);
      const page = await client.inject({
        method: 'GET',
        url: `/calls/${callId}`,
      });
      const section = draftSection(page.body);
      assert.match(section, /data-draft-lang="other"/);
      assert.match(section, /data-draft[^>]*>Hello Tenant,/);
      assert.match(section, /The owner repairs fair wear/);
      assert.match(section, /data-rendering>שלום Tenant,/);
      assert.match(section, /בעל הדירה מתקן בלאי סביר/);
      const draftCall = extractor.calls.find(
        (call) => call.name === 'call_draft',
      );
      assert.ok(draftCall);
      assert.match(draftCall.input, /LANGUAGE: English/);
      assert.match(draftCall.input, new RegExp(MARKER));
    } finally {
      await pool.query(
        `DELETE FROM document_passage WHERE document_id IN
           (SELECT document_id FROM document WHERE storage_uri LIKE $1)`,
        [`gs://${bucket}/%`],
      );
      await pool.query(
        `DELETE FROM document_link WHERE document_id IN
           (SELECT document_id FROM document WHERE storage_uri LIKE $1)`,
        [`gs://${bucket}/%`],
      );
      await pool.query('DELETE FROM document WHERE storage_uri LIKE $1', [
        `gs://${bucket}/%`,
      ]);
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
      await pool.query(`DELETE FROM tenancy_party WHERE tenancy_id = $1`, [
        home.tenancyId,
      ]);
      await pool.query(`DELETE FROM tenancy WHERE tenancy_id = $1`, [
        home.tenancyId,
      ]);
      await pool.query(`DELETE FROM party_contact WHERE party_id = $1`, [
        home.partyId,
      ]);
      await pool.query(`DELETE FROM party WHERE party_id = $1`, [home.partyId]);
      await pool.query(`DELETE FROM unit WHERE unit_id = $1`, [home.unitId]);
      await pool.query(`DELETE FROM space WHERE space_id = $1`, [home.unitId]);
      await signOutAll(pool, domain);
      await app.close();
      await pool.end();
    }
  });
});
