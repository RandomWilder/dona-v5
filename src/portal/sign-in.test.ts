// Sign-in by code, driven the way a tenant drives it. #273.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { asTenant } from '../../tests/support/session.ts';
import { buildApp } from '../app.ts';
import {
  createRecordingCodeSender,
  createUnavailableCodeSender,
} from '../channel/contract.ts';
import { fixedClock } from '../kernel/clock.ts';
import { migratedPoolOrNull, skipReason } from '../kernel/pg-support.ts';
import { csrfTokenFor } from '../staff/contract.ts';

const AT = new Date('2026-10-20T09:41:00.000Z');
const HOST = { host: 'tenant.localhost' };
const PHONE = '052-000-0191';

function pairs(header: unknown): string[] {
  if (Array.isArray(header)) return header.map(String);
  if (typeof header === 'string') return [header];
  return [];
}

function pairNamed(header: unknown, name: string): string | null {
  for (const value of pairs(header)) {
    const pair = value.split(';')[0] ?? '';
    if (pair.startsWith(`${name}=`)) return pair;
  }
  return null;
}

function csrfOf(html: string): string {
  const match = /name="csrf" value="([^"]+)"/.exec(html);
  assert.ok(match?.[1]);
  return match[1];
}

async function cleanup(pool: {
  query: (sql: string, params?: unknown[]) => Promise<unknown>;
}): Promise<void> {
  await pool.query(
    `DELETE FROM portal_passkey WHERE portal_identity_id IN
       (SELECT portal_identity_id FROM portal_identity WHERE phone LIKE '+972520000%')`,
  );
  await pool.query(
    `DELETE FROM portal_passkey_challenge WHERE portal_identity_id IN
       (SELECT portal_identity_id FROM portal_identity WHERE phone LIKE '+972520000%')
        OR (portal_identity_id IS NULL AND expires_at >= $1 AND expires_at < $2)`,
    [AT, new Date(AT.getTime() + 60 * 60 * 1000)],
  );
  await pool.query(
    `DELETE FROM portal_session WHERE portal_identity_id IN
       (SELECT portal_identity_id FROM portal_identity WHERE phone LIKE '+972520000%')`,
  );
  await pool.query(
    `DELETE FROM portal_sign_in_code WHERE phone LIKE '+972520000%'`,
  );
  await pool.query(
    `DELETE FROM portal_identity WHERE phone LIKE '+972520000%'`,
  );
  await pool.query(
    `DELETE FROM audit_log WHERE action LIKE 'portal.%' AND at >= $1 AND at < $2`,
    [AT, new Date(AT.getTime() + 60 * 60 * 1000)],
  );
}

describe('portal sign-in', () => {
  it('signs in through a code, then signs out of this device and of every device', async (t) => {
    const pool = await migratedPoolOrNull();
    if (pool === null) return t.skip(skipReason);
    t.after(() => pool.end());
    await cleanup(pool);
    const clock = fixedClock(AT);
    const sender = createRecordingCodeSender();
    const app = buildApp({
      pool,
      clock,
      version: '9.9.9-test',
      codeSender: sender,
    });
    t.after(() => app.close());

    const office = await app.inject({
      method: 'GET',
      url: '/sign-in/code',
    });
    assert.equal(office.statusCode, 404);

    const tenant = await asTenant(app, PHONE, sender);
    clock.advance(61_000);
    const home = await tenant.inject({ method: 'GET', url: '/' });
    assert.equal(home.statusCode, 200);
    assert.match(home.body, /אין כאן עדיין מה להציג/);
    assert.match(home.body, /יציאה מכל המכשירים/);
    assert.doesNotMatch(home.body, /type="email"/);
    assert.doesNotMatch(home.body, /mailto:/);

    const other = await asTenant(app, PHONE, sender);
    const signedOut = await tenant.inject({
      method: 'POST',
      url: '/sign-out',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: '',
    });
    assert.equal(signedOut.statusCode, 303);
    const afterOne = await tenant.inject({ method: 'GET', url: '/' });
    assert.match(afterOne.body, /שליחת קוד/);
    const still = await other.inject({ method: 'GET', url: '/' });
    assert.match(still.body, /אין כאן עדיין מה להציג/);

    const everywhere = await other.inject({
      method: 'POST',
      url: '/sign-out/all',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: '',
    });
    assert.equal(everywhere.statusCode, 303);
    const afterAll = await other.inject({ method: 'GET', url: '/' });
    assert.match(afterAll.body, /שליחת קוד/);

    const { rows } = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM audit_log
        WHERE action = 'portal.session.end_all' AND at >= $1 AND at < $2`,
      [AT, new Date(AT.getTime() + 60 * 60 * 1000)],
    );
    assert.equal(rows[0]?.n, '1');
  });

  it('says what is wrong with a code, and offers a new one once the wait has passed', async (t) => {
    const pool = await migratedPoolOrNull();
    if (pool === null) return t.skip(skipReason);
    t.after(() => pool.end());
    await cleanup(pool);
    const clock = fixedClock(AT);
    const sender = createRecordingCodeSender();
    const app = buildApp({
      pool,
      clock,
      version: '9.9.9-test',
      codeSender: sender,
    });
    t.after(() => app.close());

    const page = await app.inject({
      method: 'GET',
      url: '/',
      headers: HOST,
    });
    assert.match(page.body, /type="tel"/);
    assert.match(page.body, /inputmode="tel"/);
    assert.match(page.body, /autocomplete="tel-national"/);
    assert.match(page.body, /שליחת קוד/);
    assert.match(page.body, /הקוד יגיע בוואטסאפ/);
    assert.doesNotMatch(page.body, /מסרון/);
    assert.doesNotMatch(page.body, /type="email"/);
    assert.match(page.body, /dona\.portal\.passkey/);
    assert.doesNotMatch(page.body, /<script[^>]*\ssrc=/);

    const sent = await app.inject({
      method: 'POST',
      url: '/sign-in',
      headers: {
        ...HOST,
        cookie: pairNamed(page.headers['set-cookie'], 'dona_portal_form') ?? '',
        'content-type': 'application/x-www-form-urlencoded',
      },
      payload: `phone=${encodeURIComponent(PHONE)}&csrf=${csrfOf(page.body)}`,
    });
    assert.equal(sent.statusCode, 303);
    const challenge =
      pairNamed(sent.headers['set-cookie'], 'dona_portal_code') ?? '';
    const codePage = await app.inject({
      method: 'GET',
      url: '/sign-in/code',
      headers: { ...HOST, cookie: challenge },
    });
    assert.match(codePage.body, /autocomplete="one-time-code"/);
    assert.match(codePage.body, /inputmode="numeric"/);
    assert.match(codePage.body, /maxlength="6"/);
    assert.match(codePage.body, /data-portal-submit/);
    assert.match(codePage.body, /אפשר לבקש קוד חדש בעוד/);
    assert.doesNotMatch(codePage.body, /שליחת קוד חדש/);
    assert.match(codePage.body, /052-000-0191/);
    assert.match(codePage.body, /שינוי/);

    let wrongBody = '';
    let wrongCsrf = csrfOf(codePage.body);
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const wrong = await app.inject({
        method: 'POST',
        url: '/sign-in/code',
        headers: {
          ...HOST,
          cookie: challenge,
          'content-type': 'application/x-www-form-urlencoded',
        },
        payload: `code=000000&csrf=${wrongCsrf}`,
      });
      wrongBody = wrong.body;
      wrongCsrf = csrfOf(wrong.body);
      if (attempt < 5) assert.match(wrongBody, /הקוד שגוי/);
    }
    assert.match(wrongBody, /יותר מדי ניסיונות/);

    clock.advance(5 * 60 * 1000 + 1000);
    const expired = await app.inject({
      method: 'POST',
      url: '/sign-in/code',
      headers: {
        ...HOST,
        cookie: challenge,
        'content-type': 'application/x-www-form-urlencoded',
      },
      payload: `code=${sender.sent[0]?.code}&csrf=${csrfOf(wrongBody)}`,
    });
    assert.match(expired.body, /תוקף הקוד פג/);
    assert.match(expired.body, /שליחת קוד חדש/);

    const again = await app.inject({
      method: 'POST',
      url: '/sign-in/code/send',
      headers: {
        ...HOST,
        cookie: challenge,
        'content-type': 'application/x-www-form-urlencoded',
      },
      payload: `csrf=${csrfOf(expired.body)}`,
    });
    assert.equal(again.statusCode, 303);
    assert.equal(sender.sent.length, 2);

    const next =
      pairNamed(again.headers['set-cookie'], 'dona_portal_code') ?? '';
    const fresh = await app.inject({
      method: 'GET',
      url: '/sign-in/code',
      headers: { ...HOST, cookie: next },
    });
    const accepted = await app.inject({
      method: 'POST',
      url: '/sign-in/code',
      headers: {
        ...HOST,
        cookie: next,
        'content-type': 'application/x-www-form-urlencoded',
        'x-forwarded-proto': 'https',
      },
      payload: `code=${sender.sent[1]?.code}&csrf=${csrfOf(fresh.body)}`,
    });
    assert.equal(accepted.statusCode, 303);
    const session = pairs(accepted.headers['set-cookie']).find((value) =>
      value.startsWith('dona_portal='),
    );
    assert.ok(session);
    assert.match(session, /HttpOnly/);
    assert.match(session, /SameSite=Strict/);
    assert.match(session, /Secure/);
    assert.doesNotMatch(session, /Domain=/);

    const used = await app.inject({
      method: 'POST',
      url: '/sign-in/code',
      headers: {
        ...HOST,
        cookie: next,
        'content-type': 'application/x-www-form-urlencoded',
      },
      payload: `code=${sender.sent[1]?.code}&csrf=${csrfOf(fresh.body)}`,
    });
    assert.match(used.body, /הקוד כבר נוצל/);
  });

  it('refuses a number that is not an Israeli mobile before a send', async (t) => {
    const pool = await migratedPoolOrNull();
    if (pool === null) return t.skip(skipReason);
    t.after(() => pool.end());
    const clock = fixedClock(AT);
    const sender = createRecordingCodeSender();
    const app = buildApp({
      pool,
      clock,
      version: '9.9.9-test',
      codeSender: sender,
    });
    t.after(() => app.close());
    const page = await app.inject({ method: 'GET', url: '/', headers: HOST });
    const refused = await app.inject({
      method: 'POST',
      url: '/sign-in',
      headers: {
        ...HOST,
        cookie: pairNamed(page.headers['set-cookie'], 'dona_portal_form') ?? '',
        'content-type': 'application/x-www-form-urlencoded',
      },
      payload: `phone=${encodeURIComponent('03-555-1234')}&csrf=${csrfOf(page.body)}`,
    });
    assert.equal(refused.statusCode, 200);
    assert.match(refused.body, /אינו נייד ישראלי/);
    assert.equal(sender.sent.length, 0);
  });

  it('waits a minute after a code was used, and a failed send still counts', async (t) => {
    const pool = await migratedPoolOrNull();
    if (pool === null) return t.skip(skipReason);
    t.after(() => pool.end());
    await cleanup(pool);
    const clock = fixedClock(AT);
    const sender = createRecordingCodeSender();
    const app = buildApp({
      pool,
      clock,
      version: '9.9.9-test',
      codeSender: sender,
    });
    t.after(() => app.close());

    await asTenant(app, PHONE, sender);
    const page = await app.inject({ method: 'GET', url: '/', headers: HOST });
    const early = await app.inject({
      method: 'POST',
      url: '/sign-in',
      headers: {
        ...HOST,
        cookie: pairNamed(page.headers['set-cookie'], 'dona_portal_form') ?? '',
        'content-type': 'application/x-www-form-urlencoded',
      },
      payload: `phone=${encodeURIComponent(PHONE)}&csrf=${csrfOf(page.body)}`,
    });
    assert.equal(early.statusCode, 200);
    assert.match(early.body, /בעוד דקה/);
    assert.equal(sender.sent.length, 1);

    const down = {
      channels: ['whatsapp'] as const,
      sent: [] as { to: string; code: string }[],
      async send(): Promise<void> {
        throw new Error('provider said TRACE-99');
      },
      async notify(): Promise<void> {
        throw new Error('provider said TRACE-99');
      },
    };
    const other = '052-000-0192';
    const quiet = buildApp({
      pool,
      clock,
      version: '9.9.9-test',
      codeSender: down,
    });
    t.after(() => quiet.close());
    clock.advance(61_000);
    const form = await quiet.inject({ method: 'GET', url: '/', headers: HOST });
    const failed = await quiet.inject({
      method: 'POST',
      url: '/sign-in',
      headers: {
        ...HOST,
        cookie: pairNamed(form.headers['set-cookie'], 'dona_portal_form') ?? '',
        'content-type': 'application/x-www-form-urlencoded',
      },
      payload: `phone=${encodeURIComponent(other)}&csrf=${csrfOf(form.body)}`,
    });
    assert.equal(failed.statusCode, 200);
    assert.match(failed.body, /לא ניתן לשלוח קוד כרגע/);
    assert.equal(failed.body.includes('TRACE-99'), false);
    const leaked = await pool.query<{ error_message: string; inputs: string }>(
      `SELECT error_message, inputs::text
         FROM audit_log
        WHERE action = 'portal.code.send' AND outcome = 'error' AND at = $1`,
      [new Date(AT.getTime() + 61_000)],
    );
    assert.equal(leaked.rows[0]?.error_message, 'sender');
    assert.equal(leaked.rows[0]?.inputs.includes('TRACE-99'), false);
    const counted = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM portal_sign_in_code WHERE phone = $1`,
      ['+972520000192'],
    );
    assert.equal(counted.rows[0]?.n, '1');

    const formAgain = await quiet.inject({
      method: 'GET',
      url: '/',
      headers: HOST,
    });
    const held = await quiet.inject({
      method: 'POST',
      url: '/sign-in',
      headers: {
        ...HOST,
        cookie:
          pairNamed(formAgain.headers['set-cookie'], 'dona_portal_form') ?? '',
        'content-type': 'application/x-www-form-urlencoded',
      },
      payload: `phone=${encodeURIComponent(other)}&csrf=${csrfOf(formAgain.body)}`,
    });
    assert.equal(held.statusCode, 200);
    assert.match(held.body, /בעוד דקה/);
    const still = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM portal_sign_in_code WHERE phone = $1`,
      ['+972520000192'],
    );
    assert.equal(still.rows[0]?.n, '1');
  });

  it('sends WhatsApp first and offers SMS only as the bottom card', async (t) => {
    const pool = await migratedPoolOrNull();
    if (pool === null) return t.skip(skipReason);
    t.after(() => pool.end());
    await cleanup(pool);
    const clock = fixedClock(AT);
    const sender = createRecordingCodeSender(['whatsapp', 'sms']);
    const app = buildApp({
      pool,
      clock,
      version: '9.9.9-test',
      codeSender: sender,
    });
    t.after(() => app.close());

    const page = await app.inject({ method: 'GET', url: '/', headers: HOST });
    assert.match(page.body, /הקוד יגיע בוואטסאפ/);
    assert.match(page.body, /מסרון במסך הבא/);
    const sent = await app.inject({
      method: 'POST',
      url: '/sign-in',
      headers: {
        ...HOST,
        cookie: pairNamed(page.headers['set-cookie'], 'dona_portal_form') ?? '',
        'content-type': 'application/x-www-form-urlencoded',
      },
      payload: `phone=${encodeURIComponent(PHONE)}&csrf=${csrfOf(page.body)}`,
    });
    assert.equal(sent.statusCode, 303);
    assert.equal(sender.sent[0]?.channel, 'whatsapp');
    const challenge =
      pairNamed(sent.headers['set-cookie'], 'dona_portal_code') ?? '';
    const codePage = await app.inject({
      method: 'GET',
      url: '/sign-in/code',
      headers: { ...HOST, cookie: challenge },
    });
    assert.match(codePage.body, /לוואטסאפ של/);
    assert.doesNotMatch(codePage.body, /לא הגיע/);
    clock.advance(61_000);
    const ready = await app.inject({
      method: 'GET',
      url: '/sign-in/code',
      headers: { ...HOST, cookie: challenge },
    });
    assert.match(ready.body, /לא הגיע בוואטסאפ\?/);
    assert.match(ready.body, /שלחו במסרון\. עובד גם בלי אינטרנט\./);
    assert.doesNotMatch(ready.body, /לא הגיע במסרון/);
    assert.match(ready.body, /name="channel" value="sms"/);

    const sms = await app.inject({
      method: 'POST',
      url: '/sign-in/code/send',
      headers: {
        ...HOST,
        cookie: challenge,
        'content-type': 'application/x-www-form-urlencoded',
      },
      payload: `channel=sms&csrf=${csrfOf(ready.body)}`,
    });
    assert.equal(sms.statusCode, 303);
    assert.equal(sender.sent[1]?.channel, 'sms');
    assert.equal(sender.sent.length, 2);
    const next = pairNamed(sms.headers['set-cookie'], 'dona_portal_code') ?? '';
    const smsPage = await app.inject({
      method: 'GET',
      url: '/sign-in/code',
      headers: { ...HOST, cookie: next },
    });
    assert.match(smsPage.body, /במסרון אל/);
    assert.doesNotMatch(smsPage.body, /לא הגיע/);
    clock.advance(61_000);
    const smsReady = await app.inject({
      method: 'GET',
      url: '/sign-in/code',
      headers: { ...HOST, cookie: next },
    });
    assert.match(smsReady.body, /לא הגיע במסרון\?/);
    assert.match(smsReady.body, /name="channel" value="whatsapp"/);
    assert.doesNotMatch(smsReady.body, /לא הגיע בוואטסאפ/);
  });

  it('hides the other channel when only SMS is configured', async (t) => {
    const pool = await migratedPoolOrNull();
    if (pool === null) return t.skip(skipReason);
    t.after(() => pool.end());
    await cleanup(pool);
    const sender = createRecordingCodeSender(['sms']);
    const app = buildApp({
      pool,
      clock: fixedClock(AT),
      version: '9.9.9-test',
      codeSender: sender,
    });
    t.after(() => app.close());
    const page = await app.inject({ method: 'GET', url: '/', headers: HOST });
    assert.match(page.body, /הקוד יגיע במסרון/);
    assert.doesNotMatch(page.body, /וואטסאפ/);
    const sent = await app.inject({
      method: 'POST',
      url: '/sign-in',
      headers: {
        ...HOST,
        cookie: pairNamed(page.headers['set-cookie'], 'dona_portal_form') ?? '',
        'content-type': 'application/x-www-form-urlencoded',
      },
      payload: `phone=${encodeURIComponent(PHONE)}&csrf=${csrfOf(page.body)}`,
    });
    assert.equal(sender.sent[0]?.channel, 'sms');
    const challenge =
      pairNamed(sent.headers['set-cookie'], 'dona_portal_code') ?? '';
    const codePage = await app.inject({
      method: 'GET',
      url: '/sign-in/code',
      headers: { ...HOST, cookie: challenge },
    });
    assert.match(codePage.body, /במסרון אל/);
    assert.doesNotMatch(codePage.body, /וואטסאפ/);
    assert.doesNotMatch(codePage.body, /לא הגיע/);
  });

  it('does not start sign-in when no sender is configured', async (t) => {
    const pool = await migratedPoolOrNull();
    if (pool === null) return t.skip(skipReason);
    t.after(() => pool.end());
    const app = buildApp({
      pool,
      clock: fixedClock(AT),
      version: '9.9.9-test',
      codeSender: createUnavailableCodeSender(),
    });
    t.after(() => app.close());
    const page = await app.inject({ method: 'GET', url: '/', headers: HOST });
    assert.equal(page.statusCode, 200);
    assert.match(page.body, /לא ניתן לשלוח קוד כרגע/);
    assert.doesNotMatch(page.body, /שליחת קוד/);
    assert.doesNotMatch(page.body, /וואטסאפ/);
    assert.doesNotMatch(page.body, /מסרון/);
    const form =
      pairNamed(page.headers['set-cookie'], 'dona_portal_form') ?? '';
    const posted = await app.inject({
      method: 'POST',
      url: '/sign-in',
      headers: {
        ...HOST,
        cookie: form,
        'content-type': 'application/x-www-form-urlencoded',
      },
      payload: `phone=${encodeURIComponent(PHONE)}&csrf=${csrfTokenFor(form.slice('dona_portal_form='.length))}`,
    });
    assert.equal(posted.statusCode, 200);
    assert.match(posted.body, /נסו שוב/);
    assert.doesNotMatch(posted.body, /שליחת קוד/);
  });
});
