// The first-visit notice, driven the way a tenant drives it. #276.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildApp } from '../app.ts';
import { createRecordingCodeSender } from '../channel/contract.ts';
import { fixedClock } from '../kernel/clock.ts';
import { newId } from '../kernel/ids.ts';
import { migratedPoolOrNull, skipReason } from '../kernel/pg-support.ts';

const AT = new Date('2099-06-01T00:00:00.000Z');
const HOST = { host: 'tenant.localhost' };
const PHONE = '052-276-0001';
const FORM = { 'content-type': 'application/x-www-form-urlencoded' };

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

function noticePayload(html: string, extra = ''): string {
  const privacy = /name="privacy" value="([^"]+)"/.exec(html)?.[1] ?? '';
  const terms = /name="terms" value="([^"]+)"/.exec(html)?.[1] ?? '';
  return `csrf=${csrfOf(html)}&privacy=${privacy}&terms=${terms}${extra}`;
}

async function cleanup(pool: {
  query: (sql: string, params?: unknown[]) => Promise<unknown>;
}): Promise<void> {
  await pool.query(
    `DELETE FROM portal_acknowledgement
      WHERE legal_text_id IN
        (SELECT legal_text_id FROM portal_legal_text WHERE version > 1)`,
  );
  await pool.query(`DELETE FROM portal_legal_text WHERE version > 1`);
  await pool.query(
    `DELETE FROM portal_session WHERE portal_identity_id IN
       (SELECT portal_identity_id FROM portal_identity WHERE phone = '+972522760001')`,
  );
  await pool.query(
    `DELETE FROM portal_sign_in_code WHERE phone = '+972522760001'`,
  );
  await pool.query(`DELETE FROM portal_identity WHERE phone = '+972522760001'`);
  await pool.query(
    `DELETE FROM audit_log WHERE action LIKE 'portal.%' AND at >= $1 AND at < $2`,
    [AT, new Date(AT.getTime() + 60 * 60 * 1000)],
  );
}

async function publish(
  pool: {
    query: (sql: string, params?: unknown[]) => Promise<unknown>;
  },
  kind: 'privacy' | 'terms',
  summary: string,
  version: number,
): Promise<void> {
  await pool.query(
    `INSERT INTO portal_legal_text
       (legal_text_id, kind, language, version, opt_in_key, title, summary, body,
        placeholder, created_at)
     VALUES ($1, $2, 'he', $3, '', $4, $5, $5, false, $6)`,
    [
      newId(fixedClock(AT)),
      kind,
      version,
      kind === 'privacy' ? 'הודעת פרטיות' : 'תנאי שימוש',
      summary,
      AT,
    ],
  );
}

describe('portal first visit', () => {
  it('seeds a placeholder in Hebrew, English and Russian', async (t) => {
    const pool = await migratedPoolOrNull();
    if (pool === null) return t.skip(skipReason);
    t.after(() => pool.end());
    const { rows } = await pool.query<{
      language: string;
      kind: string;
      placeholder: boolean;
    }>(
      `SELECT language, kind, placeholder
         FROM portal_legal_text
        WHERE version = 1
        ORDER BY kind, language`,
    );
    const keys = rows.map((row) => `${row.kind}:${row.language}`);
    for (const kind of ['privacy', 'terms', 'entry', 'opt_in']) {
      for (const language of ['he', 'en', 'ru']) {
        assert.ok(keys.includes(`${kind}:${language}`), `${kind}:${language}`);
      }
    }
    assert.equal(
      rows.every((row) => row.placeholder),
      true,
    );
  });

  it('asks once, keeps an opt-in off until it is turned on, and asks again for a new version', async (t) => {
    const pool = await migratedPoolOrNull();
    if (pool === null) return t.skip(skipReason);
    t.after(async () => {
      try {
        await cleanup(pool);
      } finally {
        await pool.end();
      }
    });
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

    const phone = await app.inject({ method: 'GET', url: '/', headers: HOST });
    const sent = await app.inject({
      method: 'POST',
      url: '/sign-in',
      headers: {
        ...HOST,
        ...FORM,
        cookie:
          pairNamed(phone.headers['set-cookie'], 'dona_portal_form') ?? '',
      },
      payload: `phone=${encodeURIComponent(PHONE)}&csrf=${csrfOf(phone.body)}`,
    });
    const challenge =
      pairNamed(sent.headers['set-cookie'], 'dona_portal_code') ?? '';
    const codePage = await app.inject({
      method: 'GET',
      url: '/sign-in/code',
      headers: { ...HOST, cookie: challenge },
    });
    const verified = await app.inject({
      method: 'POST',
      url: '/sign-in/code',
      headers: { ...HOST, ...FORM, cookie: challenge },
      payload: `code=${sender.sent[0]?.code}&csrf=${csrfOf(codePage.body)}`,
    });
    assert.equal(verified.headers.location, '/passkey');
    const session =
      pairNamed(verified.headers['set-cookie'], 'dona_portal') ?? '';

    const gated = await app.inject({
      method: 'GET',
      url: '/',
      headers: { ...HOST, cookie: session },
    });
    assert.equal(gated.statusCode, 303);
    assert.equal(gated.headers.location, '/notice');
    const notice = await app.inject({
      method: 'GET',
      url: '/notice',
      headers: { ...HOST, cookie: session },
    });
    assert.equal(notice.statusCode, 200);
    assert.match(notice.body, /lang="he"/);
    assert.match(notice.body, /dir="rtl"/);
    assert.match(notice.body, /לפני שמתחילים/);
    assert.match(notice.body, /השירות אינו מותנה באישור/);
    const article =
      /<article class="tp-card">[\s\S]*?<\/article>/.exec(notice.body)?.[0] ??
      '';
    assert.match(article, /הודעת פרטיות/);
    assert.match(article, /תנאי שימוש/);
    assert.match(article, /href="\/notice\/full"/);
    assert.doesNotMatch(article, /checkbox/);
    assert.doesNotMatch(notice.body, /בלי האישור אין כניסה/);
    assert.doesNotMatch(notice.body, /Privacy notice/);
    const opt =
      /<label class="tp-card is-row"[\s\S]*?<\/label>/.exec(notice.body)?.[0] ??
      '';
    assert.match(opt, /עדכונים על הבניין/);
    assert.match(opt, /type="checkbox" role="switch"/);
    assert.doesNotMatch(opt, /checked/);
    assert.doesNotMatch(opt, /קראתי/);
    assert.match(
      notice.body,
      /<button class="tp-primary" type="submit">קראתי, המשך<\/button>/,
    );
    assert.equal((notice.body.match(/type="checkbox"/g) ?? []).length, 1);
    assert.match(notice.body, /dona\.portal\.install/);
    assert.equal((notice.body.match(/<script\b/g) ?? []).length, 1);

    const full = await app.inject({
      method: 'GET',
      url: '/notice/full',
      headers: { ...HOST, cookie: session },
    });
    assert.match(full.body, /אפשר לבקש עיון, תיקון או מחיקה/);
    assert.doesNotMatch(notice.body, /אפשר לבקש עיון, תיקון או מחיקה/);

    const continued = await app.inject({
      method: 'POST',
      url: '/notice',
      headers: { ...HOST, ...FORM, cookie: session },
      payload: noticePayload(notice.body),
    });
    assert.equal(continued.statusCode, 303);
    assert.equal(continued.headers.location, '/');
    const home = await app.inject({
      method: 'GET',
      url: '/',
      headers: { ...HOST, cookie: session },
    });
    assert.match(home.body, /הבניין שלכם עוד לא בפורטל/);

    await publish(pool, 'privacy', 'נוסח שני של הודעת הפרטיות', 2);
    const again = await app.inject({
      method: 'GET',
      url: '/',
      headers: { ...HOST, cookie: session },
    });
    assert.equal(again.headers.location, '/notice');
    const second = await app.inject({
      method: 'GET',
      url: '/notice',
      headers: { ...HOST, cookie: session },
    });
    assert.match(second.body, /נוסח שני של הודעת הפרטיות/);
    assert.doesNotMatch(second.body, /checked/);
    await app.inject({
      method: 'POST',
      url: '/notice',
      headers: { ...HOST, ...FORM, cookie: session },
      payload: noticePayload(second.body, '&opt_building_notices=on'),
    });

    await publish(pool, 'terms', 'נוסח שני של תנאי השימוש', 2);
    const third = await app.inject({
      method: 'GET',
      url: '/notice',
      headers: { ...HOST, cookie: session },
    });
    assert.match(third.body, /נוסח שני של תנאי השימוש/);
    assert.match(third.body, /checked/);
    await app.inject({
      method: 'POST',
      url: '/notice',
      headers: { ...HOST, ...FORM, cookie: session },
      payload: noticePayload(third.body),
    });

    await publish(pool, 'privacy', 'נוסח שלישי של הודעת הפרטיות', 3);
    const fourth = await app.inject({
      method: 'GET',
      url: '/notice',
      headers: { ...HOST, cookie: session },
    });
    assert.match(fourth.body, /נוסח שלישי של הודעת הפרטיות/);
    assert.doesNotMatch(fourth.body, /checked/);
  });
});
