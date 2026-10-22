// POLICY — a tenant reports an issue on the chosen tenancy. The category is a
// suggestion, the entry permission is stored, and nothing is a call until send.
// The same send twice is one call. An emergency word flags it. #282.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Pool } from 'pg';
import { buildApp } from '../../src/app.ts';
import { createRecordingCodeSender } from '../../src/channel/contract.ts';
import { fixedClock } from '../../src/kernel/clock.ts';
import { asTenant, signIn } from '../support/session.ts';
import { seedOccupancy } from './fixtures.ts';
import { policyPool, skipReason } from './support.ts';

const AT = new Date('2026-10-21T09:00:00.000Z');
const PHONE = '052-000-2821';
const E164 = '+972520002821';
const DUTY = '050-282-0001';
const DUTY_TEL = 'tel:+972502820001';
const CITY = 'פורטל 282';
const LINE = 'רחוב 282';
const TEXT = 'протечка под раковиной, ויש שריפה';
const DOMAIN = 'report-282.test';

function csrfOf(html: string): string {
  const match = /name="csrf" value="([^"]+)"/.exec(html);
  assert.ok(match?.[1]);
  return match[1];
}

function submissionOf(html: string): string {
  const match = /name="submission" value="([^"]+)"/.exec(html);
  assert.ok(match?.[1]);
  return match[1];
}

function categoryOf(html: string, code: string): string {
  const match = new RegExp(`data-code="${code}" value="([^"]+)"`).exec(html);
  assert.ok(match?.[1]);
  return match[1];
}

function callNumberOf(html: string): string {
  const match = /data-call-number="(\d+)"/.exec(html);
  assert.ok(match?.[1]);
  return match[1];
}

async function callsFor(pool: Pool): Promise<number> {
  const rows = await pool.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM service_call WHERE sender_label = $1`,
    [E164],
  );
  return rows.rows[0]?.n ?? 0;
}

async function cleanup(pool: Pool): Promise<void> {
  await pool.query(
    `WITH gone AS (
       DELETE FROM message WHERE sender_address = $1
       RETURNING conversation_id
     )
     DELETE FROM conversation
      WHERE conversation_id IN (SELECT conversation_id FROM gone)`,
    [E164],
  );
  await pool.query(
    `DELETE FROM service_call_transition WHERE service_call_id IN (
       SELECT service_call_id FROM service_call WHERE sender_label = $1
     )`,
    [E164],
  );
  await pool.query(`DELETE FROM service_call WHERE sender_label = $1`, [E164]);
  await pool.query(
    `DELETE FROM portal_session WHERE portal_identity_id IN
       (SELECT portal_identity_id FROM portal_identity WHERE phone = $1)`,
    [E164],
  );
  await pool.query(`DELETE FROM portal_sign_in_code WHERE phone = $1`, [E164]);
  await pool.query(`DELETE FROM portal_identity WHERE phone = $1`, [E164]);
  await pool.query(
    `DELETE FROM tenancy_party
      WHERE party_id IN (SELECT party_id FROM party_contact WHERE value = $1)`,
    [E164],
  );
  await pool.query(
    `DELETE FROM tenancy
      WHERE unit_id IN (
        SELECT u.unit_id FROM unit u
        JOIN space s ON s.space_id = u.unit_id
        JOIN building b ON b.building_id = s.building_id
        WHERE b.city = $1
      )`,
    [CITY],
  );
  await pool.query(
    `WITH gone AS (
       DELETE FROM party_contact WHERE value = $1
       RETURNING party_id
     )
     DELETE FROM party WHERE party_id IN (SELECT party_id FROM gone)`,
    [E164],
  );
  await pool.query(
    `DELETE FROM unit
      WHERE unit_id IN (
        SELECT s.space_id FROM space s
        JOIN building b ON b.building_id = s.building_id
        WHERE b.city = $1
      )`,
    [CITY],
  );
  await pool.query(
    `DELETE FROM space
      WHERE building_id IN (SELECT building_id FROM building WHERE city = $1)`,
    [CITY],
  );
  await pool.query(`DELETE FROM building WHERE city = $1`, [CITY]);
  await pool.query(
    `UPDATE call_category SET is_active = true WHERE code = 'GATES'`,
  );
}

describe('policy · report an issue', { concurrency: 1 }, () => {
  it('opens one call on send, keeps the suggestion, and flags an emergency word', async (t) => {
    const pool = await policyPool();
    if (pool === null) return t.skip(skipReason);
    await cleanup(pool);
    const previous = await pool.query<{ value: unknown }>(
      `SELECT value FROM config_settings WHERE key = 'calls.duty_phone'`,
    );
    const clock = fixedClock(AT);
    const sender = createRecordingCodeSender();
    const app = buildApp({
      pool,
      clock,
      version: '9.9.9-test',
      codeSender: sender,
    });
    t.after(async () => {
      await cleanup(pool);
      if (previous.rows[0] === undefined) {
        await pool.query(
          `DELETE FROM config_settings WHERE key = 'calls.duty_phone'`,
        );
      } else {
        await pool.query(
          `UPDATE config_settings SET value = $1::jsonb WHERE key = 'calls.duty_phone'`,
          [JSON.stringify(previous.rows[0].value)],
        );
      }
      await app.close();
      await pool.end();
    });

    await pool.query(
      `INSERT INTO config_settings (key, value, updated_at)
       VALUES ('calls.duty_phone', $1::jsonb, $2)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [JSON.stringify(DUTY), AT],
    );
    await pool.query(
      `UPDATE call_category SET is_active = false WHERE code = 'GATES'`,
    );
    const seeded = await seedOccupancy(pool, '12', {
      phone: E164,
      contactFrom: '2026-01-01',
      contactTo: null,
      tenancyFrom: '2026-03-01',
      tenancyTo: '2027-02-28',
      address: { line: LINE, city: CITY },
    });
    await pool.query(
      `UPDATE building SET portal_enabled = true
        WHERE building_id IN (
          SELECT building_id FROM space WHERE space_id = $1
        )`,
      [seeded.unitId],
    );

    const tenant = await asTenant(app, PHONE, sender, {
      remoteAddress: '10.282.0.1',
    });
    const first = await tenant.inject({ method: 'GET', url: '/report' });
    assert.equal(first.statusCode, 200);
    assert.equal(first.body.includes('<select'), false);
    assert.match(first.body, /dona\.portal\.install/);
    assert.equal((first.body.match(/<script\b/g) ?? []).length, 1);
    const telAt = first.body.indexOf(DUTY_TEL);
    const radioAt = first.body.indexOf('type="radio"');
    assert.ok(telAt >= 0 && radioAt > telAt);
    assert.match(first.body, new RegExp(DUTY));
    assert.match(first.body, /חירום\? אל תחכו לטופס/);
    assert.match(first.body, /אינסטלציה/);
    assert.doesNotMatch(first.body, /שערים/);
    assert.equal(await callsFor(pool), 0);

    const plumbing = categoryOf(first.body, 'PLUMBING');
    const step1 = `csrf=${csrfOf(first.body)}&submission=${submissionOf(first.body)}&category=${plumbing}&description=&entry=&step=1&action=next`;
    const details = await tenant.inject({
      method: 'POST',
      url: '/report',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: step1,
    });
    assert.equal(details.statusCode, 200);
    assert.match(details.body, /ספרו לנו מה קרה/);
    assert.match(details.body, /אינסטלציה/);
    assert.equal(await callsFor(pool), 0);

    const told = `csrf=${csrfOf(details.body)}&submission=${submissionOf(details.body)}&category=${plumbing}&description=${encodeURIComponent(TEXT)}&entry=&step=2&action=next`;
    const entry = await tenant.inject({
      method: 'POST',
      url: '/report',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: told,
    });
    assert.equal(entry.statusCode, 200);
    assert.match(entry.body, /אפשר להיכנס לדירה כשאתם לא בבית/);
    assert.match(entry.body, new RegExp(TEXT));
    assert.match(entry.body, /דירה 12/);
    assert.equal(await callsFor(pool), 0);

    const backToDetails = `csrf=${csrfOf(entry.body)}&submission=${submissionOf(entry.body)}&category=${plumbing}&description=${encodeURIComponent(TEXT)}&entry=&step=3&action=back`;
    const again = await tenant.inject({
      method: 'POST',
      url: '/report',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: backToDetails,
    });
    assert.equal(again.statusCode, 200);
    assert.match(again.body, new RegExp(`>${TEXT}</textarea>`));
    assert.equal(await callsFor(pool), 0);

    const backToCategory = `csrf=${csrfOf(again.body)}&submission=${submissionOf(again.body)}&category=${plumbing}&description=${encodeURIComponent(TEXT)}&entry=YES&step=2&action=back`;
    const category = await tenant.inject({
      method: 'POST',
      url: '/report',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: backToCategory,
    });
    assert.equal(category.statusCode, 200);
    assert.match(
      category.body,
      new RegExp(`data-code="PLUMBING" value="${plumbing}" checked`),
    );
    assert.equal(await callsFor(pool), 0);

    const send = `csrf=${csrfOf(category.body)}&submission=${submissionOf(category.body)}&category=${plumbing}&description=${encodeURIComponent(TEXT)}&entry=YES&step=3&action=send`;
    const sent = await tenant.inject({
      method: 'POST',
      url: '/report',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: send,
    });
    assert.equal(sent.statusCode, 200);
    assert.match(sent.body, /הדיווח התקבל/);
    assert.match(sent.body, /אינסטלציה/);
    assert.match(sent.body, /קריאת חירום/);
    assert.match(sent.body, new RegExp(DUTY));
    assert.match(sent.body, /לצפייה בקריאה/);
    assert.match(sent.body, /חזרה לבית/);
    const number = callNumberOf(sent.body);
    assert.equal(await callsFor(pool), 1);

    const duplicate = await tenant.inject({
      method: 'POST',
      url: '/report',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: send,
    });
    assert.equal(duplicate.statusCode, 200);
    assert.equal(callNumberOf(duplicate.body), number);
    assert.equal(await callsFor(pool), 1);

    const stored = await pool.query<{
      source_channel: string;
      state: string;
      category_id: string | null;
      suggested: string | null;
      entry_permission: string | null;
      tenancy_id: string | null;
      emergency: boolean;
      description: string;
    }>(
      `SELECT sc.source_channel, sc.state, sc.category_id,
              suggested.code AS suggested, sc.entry_permission, sc.tenancy_id,
              sc.emergency, sc.description
         FROM service_call sc
         LEFT JOIN call_category suggested
           ON suggested.category_id = sc.suggested_category_id
        WHERE sc.sender_label = $1`,
      [E164],
    );
    assert.equal(stored.rows[0]?.source_channel, 'PORTAL');
    assert.equal(stored.rows[0]?.state, 'IDENTIFIED');
    assert.equal(stored.rows[0]?.category_id, null);
    assert.equal(stored.rows[0]?.suggested, 'PLUMBING');
    assert.equal(stored.rows[0]?.entry_permission, 'YES');
    assert.equal(stored.rows[0]?.tenancy_id, seeded.tenancyId);
    assert.equal(stored.rows[0]?.emergency, true);
    assert.equal(stored.rows[0]?.description, TEXT);

    const staff = await signIn(pool, clock, {
      email: `office@${DOMAIN}`,
      role: 'ADMIN',
    });
    const list = await app.inject({
      method: 'GET',
      url: '/calls',
      headers: { cookie: staff.cookie },
    });
    assert.equal(list.statusCode, 200);
    assert.match(list.body, new RegExp(TEXT));
    assert.match(list.body, /פורטל/);

    const id = await pool.query<{ service_call_id: string }>(
      `SELECT service_call_id FROM service_call WHERE sender_label = $1`,
      [E164],
    );
    const page = await app.inject({
      method: 'GET',
      url: `/calls/${id.rows[0]?.service_call_id}`,
      headers: { cookie: staff.cookie },
    });
    assert.equal(page.statusCode, 200);
    assert.match(page.body, /data-suggested="PLUMBING"/);
    assert.match(page.body, /אינסטלציה/);
    assert.match(page.body, /data-entry="YES"/);
    assert.match(page.body, /כן, מותר להיכנס/);
    assert.match(page.body, /טרם נבחרה/);
    assert.match(page.body, new RegExp(`data-tenancy="${seeded.tenancyId}"`));
    assert.match(page.body, /דירה 12/);
  });
});
