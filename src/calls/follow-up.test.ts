// A follow-up on the call page. #253. Two staff accounts, one shared thread,
// each turn showing who asked, in the order they were asked.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { asOperator, signIn, signOutAll } from '../../tests/support/session.ts';
import { buildApp } from '../app.ts';
import { fixedClock } from '../kernel/clock.ts';
import { embeddingColumnDimensions } from '../kernel/config.ts';
import { createFakeEmbedder } from '../kernel/embeddings.ts';
import { createFakeExtractor } from '../kernel/extraction.ts';
import { migratedPoolOrNull, skipReason } from '../kernel/pg-support.ts';
import { createParty } from '../parties/contract.ts';

const AT = new Date('2026-10-17T09:00:00.000Z');

function form(fields: Record<string, string>): string {
  return new URLSearchParams(fields).toString();
}

describe('calls · a follow-up on the call thread', () => {
  it('appends each question in order, with the staff account that asked', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    const domain = 'calls-follow-up.test';
    const clock = fixedClock(AT);
    const queued: Array<() => Promise<void>> = [];
    const extractor = createFakeExtractor(() => ({
      answers: false,
      text: '',
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
    const first = await signIn(pool, clock, {
      email: `maya@${domain}`,
      role: 'OPERATOR',
    });
    const second = await signIn(pool, clock, {
      email: `noam@${domain}`,
      role: 'VIEWER',
    });
    await pool.query(
      `UPDATE staff_account SET display_name = $2 WHERE staff_account_id = $1`,
      [first.staffAccountId, 'מיה כהן'],
    );
    await pool.query(
      `UPDATE staff_account SET display_name = $2 WHERE staff_account_id = $1`,
      [second.staffAccountId, 'נועם לוי'],
    );
    const maya = asOperator(app, first);
    const noam = asOperator(app, second);
    const party = await createParty(pool, {
      kind: 'PERSON',
      givenName: 'דנה',
      familyName: 'כהן',
      preferredLanguage: 'he',
    });
    try {
      const created = await maya.inject({
        method: 'POST',
        url: '/calls',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: form({
          channel: 'PHONE',
          description: 'הדוד לא מחמם',
          sender: 'unknown',
        }),
      });
      assert.equal(created.statusCode, 303);
      const list = await maya.inject({ method: 'GET', url: '/calls' });
      const callId = list.body.match(
        /href="\/calls\/([0-9a-f-]{36})">הדוד לא מחמם/,
      )?.[1];
      assert.ok(callId);
      const identified = await maya.inject({
        method: 'POST',
        url: `/calls/${callId}/identify`,
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: form({ party_id: party.id }),
      });
      assert.equal(identified.statusCode, 303);
      const run = queued[0];
      assert.ok(run);
      await run();

      const unit = await maya.inject({
        method: 'POST',
        url: `/calls/${callId}/follow-up`,
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: form({ question: 'מה חלון הזמן לביקור?' }),
      });
      assert.equal(unit.statusCode, 303);
      clock.advance(60_000);
      const deposit = await noam.inject({
        method: 'POST',
        url: `/calls/${callId}/follow-up`,
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: form({ question: 'ומה סכום הפיקדון?' }),
      });
      assert.equal(deposit.statusCode, 303);

      const page = await noam.inject({
        method: 'GET',
        url: `/calls/${callId}`,
      });
      assert.equal(page.statusCode, 200);
      assert.match(page.body, /data-brief-turns="3"/);
      const mayaAt = page.body.indexOf('data-brief-asker="מיה כהן"');
      const noamAt = page.body.indexOf('data-brief-asker="נועם לוי"');
      assert.equal(mayaAt > 0, true);
      assert.equal(noamAt > mayaAt, true);
      assert.match(page.body, /מה חלון הזמן לביקור\?/);
      assert.match(page.body, /ומה סכום הפיקדון\?/);
      assert.match(page.body, /אין במסמכים האלה תשובה לשאלה הזו/);
      assert.doesNotMatch(page.body, /אין בכרטיס ובמסמכים תשובה לשאלה הזו/);
      const question = page.body.indexOf('מה חלון הזמן לביקור?');
      const later = page.body.indexOf('ומה סכום הפיקדון?');
      assert.equal(later > question, true);
    } finally {
      await pool.query(
        `DELETE FROM service_call_transition
          WHERE service_call_id IN (
            SELECT service_call_id FROM service_call WHERE opened_by = $1
          )`,
        [first.staffAccountId],
      );
      await pool.query(`DELETE FROM service_call WHERE opened_by = $1`, [
        first.staffAccountId,
      ]);
      await pool.query('DELETE FROM party WHERE party_id = $1', [party.id]);
      await signOutAll(pool, domain);
      await app.close();
      await pool.end();
    }
  });
});
