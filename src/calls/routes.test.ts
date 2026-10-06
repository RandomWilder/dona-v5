// #182. The קריאות tab, driven the way the office drives it: a form post, then the list.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { asOperator, signIn, signOutAll } from '../../tests/support/session.ts';
import { buildApp } from '../app.ts';
import { fixedClock } from '../kernel/clock.ts';
import { migratedPoolOrNull, skipReason } from '../kernel/pg-support.ts';

const AT = new Date('2026-10-06T12:00:00.000Z');
const HALF_HOUR = 30 * 60 * 1000;

function form(fields: Record<string, string>): string {
  return new URLSearchParams(fields).toString();
}

async function cleanup(pool: import('pg').Pool, domain: string): Promise<void> {
  await pool.query(
    `DELETE FROM service_call WHERE opened_by IN
       (SELECT staff_account_id FROM staff_account WHERE email LIKE $1)`,
    [`%@${domain}`],
  );
  await pool.query(
    `DELETE FROM audit_log WHERE action = 'calls.open' AND actor_id IN
       (SELECT staff_account_id::text FROM staff_account WHERE email LIKE $1)`,
    [`%@${domain}`],
  );
  await signOutAll(pool, domain);
}

describe('calls · the קריאות tab', () => {
  it('shows a phone call and a walk-in on the list, with the rail count', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    const clock = fixedClock(AT);
    const app = buildApp({ pool, version: '9.9.9-test', clock });
    const domain = 'calls-routes-list.test';
    await cleanup(pool, domain);
    const who = await signIn(pool, clock, {
      email: `ops@${domain}`,
      role: 'OPERATOR',
    });
    const client = asOperator(app, who);
    try {
      const phone = await client.inject({
        method: 'POST',
        url: '/calls',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: form({
          channel: 'PHONE',
          description: 'נזילה במטבח',
          sender: 'named',
          sender_name: 'יעל כהן',
        }),
      });
      assert.equal(phone.statusCode, 303);
      assert.equal(phone.headers.location, '/calls');

      const walkIn = await client.inject({
        method: 'POST',
        url: '/calls',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: form({
          channel: 'WALK_IN',
          description: 'מפתח תקוע',
          sender: 'unknown',
        }),
      });
      assert.equal(walkIn.statusCode, 303);

      clock.advance(HALF_HOUR);
      const page = await client.inject({ method: 'GET', url: '/calls' });
      assert.equal(page.statusCode, 200);
      assert.doesNotMatch(page.body, /<script/);
      assert.match(page.body, /נזילה במטבח/);
      assert.match(page.body, /יעל כהן/);
      assert.match(page.body, /טלפון/);
      assert.match(page.body, /מפתח תקוע/);
      assert.match(page.body, /לא ידוע/);
      assert.match(page.body, /הגעה/);
      assert.match(page.body, /חדשה/);
      assert.match(page.body, /30 דקות/);

      const rows = page.body.match(/data-call="/g)?.length ?? 0;
      const badge = page.body.match(/data-open-calls="(\d+)"/);
      assert.equal(Number(badge?.[1]), rows);
      assert.ok(rows >= 2);

      const { rows: audit } = await pool.query<{ actor_id: string }>(
        `SELECT actor_id FROM audit_log
          WHERE action = 'calls.open' AND actor_id = $1`,
        [who.staffAccountId],
      );
      assert.equal(audit.length, 2);
      assert.equal(audit[0]?.actor_id, who.staffAccountId);
    } finally {
      await cleanup(pool, domain);
      await app.close();
      await pool.end();
    }
  });

  it('refuses an entry missing the channel, the description, or a sender choice', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    const clock = fixedClock(AT);
    const app = buildApp({ pool, version: '9.9.9-test', clock });
    const domain = 'calls-routes-refuse.test';
    await cleanup(pool, domain);
    const who = await signIn(pool, clock, { email: `ops@${domain}` });
    const client = asOperator(app, who);
    try {
      const cases = [
        {
          payload: form({
            description: 'חסר ערוץ',
            sender: 'unknown',
          }),
          sentence: 'יש לבחור טלפון או הגעה.',
          absent: 'חסר ערוץ',
        },
        {
          payload: form({
            channel: 'PHONE',
            sender: 'unknown',
          }),
          sentence: 'יש לכתוב תיאור.',
          absent: '',
        },
        {
          payload: form({
            channel: 'WALK_IN',
            description: 'חסר פונה',
          }),
          sentence: 'יש לציין את הפונה, או לסמן שלא ידוע.',
          absent: 'חסר פונה',
        },
        {
          payload: form({
            channel: 'PHONE',
            description: 'שם ריק',
            sender: 'named',
            sender_name: '   ',
          }),
          sentence: 'יש לציין את הפונה, או לסמן שלא ידוע.',
          absent: 'שם ריק',
        },
      ];
      for (const entry of cases) {
        const refused = await client.inject({
          method: 'POST',
          url: '/calls',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          payload: entry.payload,
        });
        assert.equal(refused.statusCode, 400);
        assert.ok(refused.body.includes(entry.sentence));
        assert.match(refused.body, /<form/);
        assert.doesNotMatch(refused.body, /<script/);
      }
      const page = await client.inject({ method: 'GET', url: '/calls' });
      assert.doesNotMatch(page.body, /חסר ערוץ|חסר פונה|שם ריק/);
    } finally {
      await cleanup(pool, domain);
      await app.close();
      await pool.end();
    }
  });

  it('does not offer a control that changes a call’s source channel', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    const clock = fixedClock(AT);
    const app = buildApp({ pool, version: '9.9.9-test', clock });
    const domain = 'calls-routes-channel.test';
    await cleanup(pool, domain);
    const who = await signIn(pool, clock, { email: `ops@${domain}` });
    const client = asOperator(app, who);
    try {
      const created = await client.inject({
        method: 'POST',
        url: '/calls',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: form({
          channel: 'PHONE',
          description: 'ערוץ קבוע',
          sender: 'unknown',
        }),
      });
      assert.equal(created.statusCode, 303);
      const page = await client.inject({ method: 'GET', url: '/calls' });
      const row = [
        ...page.body.matchAll(/<article class="call"[\s\S]*?<\/article>/g),
      ]
        .map((match) => match[0])
        .find((article) => article.includes('ערוץ קבוע'));
      assert.ok(row);
      assert.match(row, /טלפון/);
      assert.doesNotMatch(row, /הגעה/);
      assert.doesNotMatch(row, /<input|<select|<textarea/);
    } finally {
      await cleanup(pool, domain);
      await app.close();
      await pool.end();
    }
  });
});
