// POLICY — a report's file is scanned before anyone can open it. A type the
// allowlist does not name is refused in a sentence. An infected file is not
// on the call. #283.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Pool } from 'pg';
import { buildApp } from '../../src/app.ts';
import type { MalwareScanner } from '../../src/channel/contract.ts';
import { createRecordingCodeSender } from '../../src/channel/contract.ts';
import { fixedClock } from '../../src/kernel/clock.ts';
import { asOperator, asTenant, signIn } from '../support/session.ts';
import { seedOccupancy } from './fixtures.ts';
import { policyPool, skipReason } from './support.ts';

const AT = new Date('2026-10-21T09:00:00.000Z');
const PHONE = '052-000-2831';
const E164 = '+972520002831';
const CITY = 'פורטל 283';
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
const BOUNDARY = '----dona283';

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

function categoryOf(html: string): string {
  const match = /data-code="PLUMBING" value="([^"]+)"/.exec(html);
  assert.ok(match?.[1]);
  return match[1];
}

function form(fields: Record<string, string>): string {
  return new URLSearchParams(fields).toString();
}

function upload(
  fields: Record<string, string>,
  file: { filename: string; bytes: Buffer },
): { payload: Buffer; headers: Record<string, string> } {
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
      `--${BOUNDARY}\r\nContent-Disposition: form-data; name="file"; filename="${file.filename}"\r\n` +
        'Content-Type: application/octet-stream\r\n\r\n',
    ),
    file.bytes,
    Buffer.from('\r\n'),
  );
  parts.push(Buffer.from(`--${BOUNDARY}--\r\n`));
  return {
    payload: Buffer.concat(parts),
    headers: { 'content-type': `multipart/form-data; boundary=${BOUNDARY}` },
  };
}

async function cleanup(pool: Pool): Promise<void> {
  await pool.query(
    `DELETE FROM attachment_hold WHERE owner_id IN
       (SELECT portal_identity_id FROM portal_identity WHERE phone = $1)`,
    [E164],
  );
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
  await pool.query(`DELETE FROM staff_session WHERE staff_account_id IN
      (SELECT staff_account_id FROM staff_account WHERE email = 'ops@attach-283.test')`);
  await pool.query(
    `DELETE FROM staff_account WHERE email = 'ops@attach-283.test'`,
  );
}

describe('policy · report attachments', { concurrency: 1 }, () => {
  it('shows a clean file, removes it, and lets the office open the one that was sent', async (t) => {
    const pool = await policyPool();
    if (pool === null) return t.skip(skipReason);
    await cleanup(pool);
    const clock = fixedClock(AT);
    const sender = createRecordingCodeSender();
    const scanner: MalwareScanner = {
      async scan() {
        return 'clean';
      },
    };
    const app = buildApp({
      pool,
      clock,
      version: '9.9.9-test',
      codeSender: sender,
      scanner,
    });
    t.after(async () => {
      await cleanup(pool);
      await app.close();
      await pool.end();
    });
    const seeded = await seedOccupancy(pool, '18', {
      phone: E164,
      contactFrom: '2026-01-01',
      contactTo: null,
      tenancyFrom: '2026-03-01',
      tenancyTo: '2027-02-28',
      address: { line: 'רחוב 283', city: CITY },
    });
    await pool.query(
      `UPDATE building SET portal_enabled = true
        WHERE building_id IN (
          SELECT building_id FROM space WHERE space_id = $1
        )`,
      [seeded.unitId],
    );
    const tenant = await asTenant(app, PHONE, sender, {
      remoteAddress: '10.283.0.1',
    });
    const first = await tenant.inject({ method: 'GET', url: '/report' });
    const plumbing = categoryOf(first.body);
    const step2 = await tenant.inject({
      method: 'POST',
      url: '/report',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: form({
        csrf: csrfOf(first.body),
        submission: submissionOf(first.body),
        category: plumbing,
        description: '',
        entry: '',
        step: '1',
        action: 'next',
      }),
    });
    assert.match(step2.body, /enctype="multipart\/form-data"/);
    const bad = upload(
      {
        csrf: csrfOf(step2.body),
        submission: submissionOf(step2.body),
        category: plumbing,
        description: 'נזילה',
        entry: '',
        step: '2',
        action: 'next',
      },
      { filename: 'note.txt', bytes: Buffer.from('hello') },
    );
    const refused = await tenant.inject({
      method: 'POST',
      url: '/report',
      headers: bad.headers,
      payload: bad.payload,
    });
    assert.match(refused.body, /אפשר לצרף תמונה, סרטון קצר או PDF/);
    assert.match(refused.body, /ספרו לנו מה קרה/);
    const good = upload(
      {
        csrf: csrfOf(refused.body),
        submission: submissionOf(refused.body),
        category: plumbing,
        description: 'נזילה',
        entry: '',
        step: '2',
        action: 'next',
      },
      { filename: 'leak.jpg', bytes: JPEG },
    );
    const summary = await tenant.inject({
      method: 'POST',
      url: '/report',
      headers: good.headers,
      payload: good.payload,
    });
    assert.match(summary.body, /leak\.jpg/);
    assert.doesNotMatch(summary.body, /אין קבצים/);
    const back = await tenant.inject({
      method: 'POST',
      url: '/report',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: form({
        csrf: csrfOf(summary.body),
        submission: submissionOf(summary.body),
        category: plumbing,
        description: 'נזילה',
        entry: '',
        step: '3',
        action: 'back',
      }),
    });
    assert.match(back.body, /class="tp-thumb-x"/);
    assert.match(back.body, /aria-label="הסרת קובץ: leak\.jpg"/);
    assert.match(back.body, /src="\/report\/files\//);
    const holdUrl = `/report/files/${/name="remove" value="([^"]+)"/.exec(back.body)?.[1]}`;
    const picture = await tenant.inject({ method: 'GET', url: holdUrl });
    assert.equal(picture.statusCode, 200);
    assert.equal(picture.headers['content-type'], 'image/jpeg');
    const stranger = await app.inject({
      method: 'GET',
      url: holdUrl,
      headers: { host: 'tenant.localhost' },
    });
    assert.equal(stranger.statusCode, 404);
    const removed = await tenant.inject({
      method: 'POST',
      url: '/report',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: form({
        csrf: csrfOf(back.body),
        submission: submissionOf(back.body),
        category: plumbing,
        description: 'נזילה',
        entry: '',
        step: '2',
        action: 'next',
        remove: /name="remove" value="([^"]+)"/.exec(back.body)?.[1] ?? '',
      }),
    });
    assert.doesNotMatch(removed.body, /tp-thumb-x/);
    const again = upload(
      {
        csrf: csrfOf(removed.body),
        submission: submissionOf(removed.body),
        category: plumbing,
        description: 'נזילה',
        entry: '',
        step: '2',
        action: 'next',
      },
      { filename: 'leak.jpg', bytes: JPEG },
    );
    const ready = await tenant.inject({
      method: 'POST',
      url: '/report',
      headers: again.headers,
      payload: again.payload,
    });
    const sent = await tenant.inject({
      method: 'POST',
      url: '/report',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: form({
        csrf: csrfOf(ready.body),
        submission: submissionOf(ready.body),
        category: plumbing,
        description: 'נזילה',
        entry: 'YES',
        step: '3',
        action: 'send',
      }),
    });
    assert.match(sent.body, /הדיווח התקבל/);
    const callId = /href="\/calls\/([0-9a-f-]{36})"/.exec(sent.body)?.[1];
    assert.ok(callId);
    const office = asOperator(
      app,
      await signIn(pool, clock, {
        email: 'ops@attach-283.test',
        role: 'OPERATOR',
      }),
    );
    const page = await office.inject({
      method: 'GET',
      url: `/calls/${callId}`,
    });
    const open = page.body.match(
      new RegExp(`/calls/${callId}/messages/[0-9a-f-]{36}/files/0`),
    );
    assert.ok(open);
    const file = await office.inject({ method: 'GET', url: open[0] });
    assert.equal(file.statusCode, 200);
    assert.equal(file.headers['content-type'], 'image/jpeg');
  });

  it('does not put an infected file on the call', async (t) => {
    const pool = await policyPool();
    if (pool === null) return t.skip(skipReason);
    await cleanup(pool);
    const clock = fixedClock(AT);
    const sender = createRecordingCodeSender();
    const scanner: MalwareScanner = {
      async scan() {
        return 'infected';
      },
    };
    const app = buildApp({
      pool,
      clock,
      version: '9.9.9-test',
      codeSender: sender,
      scanner,
    });
    t.after(async () => {
      await cleanup(pool);
      await app.close();
      await pool.end();
    });
    const seeded = await seedOccupancy(pool, '19', {
      phone: E164,
      contactFrom: '2026-01-01',
      contactTo: null,
      tenancyFrom: '2026-03-01',
      tenancyTo: '2027-02-28',
      address: { line: 'רחוב 283', city: CITY },
    });
    await pool.query(
      `UPDATE building SET portal_enabled = true
        WHERE building_id IN (
          SELECT building_id FROM space WHERE space_id = $1
        )`,
      [seeded.unitId],
    );
    const tenant = await asTenant(app, PHONE, sender, {
      remoteAddress: '10.283.0.2',
    });
    const first = await tenant.inject({ method: 'GET', url: '/report' });
    const plumbing = categoryOf(first.body);
    const step2 = await tenant.inject({
      method: 'POST',
      url: '/report',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: form({
        csrf: csrfOf(first.body),
        submission: submissionOf(first.body),
        category: plumbing,
        description: '',
        entry: '',
        step: '1',
        action: 'next',
      }),
    });
    const bad = upload(
      {
        csrf: csrfOf(step2.body),
        submission: submissionOf(step2.body),
        category: plumbing,
        description: 'נזילה',
        entry: '',
        step: '2',
        action: 'next',
      },
      { filename: 'leak.jpg', bytes: JPEG },
    );
    const refused = await tenant.inject({
      method: 'POST',
      url: '/report',
      headers: bad.headers,
      payload: bad.payload,
    });
    assert.match(refused.body, /הקובץ נחסם בבדיקת האבטחה/);
    assert.match(refused.body, /ספרו לנו מה קרה/);
    assert.doesNotMatch(refused.body, /tp-thumb-x/);
  });
});
