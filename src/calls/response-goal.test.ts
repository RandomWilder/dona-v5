// #191. The internal response goal, driven the way the office drives it: a settings
// save, then the list. Thresholds are whole minutes. Older than amber is amber,
// older than red is red, and a closed call is neither.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Pool } from 'pg';
import { asOperator, signIn, signOutAll } from '../../tests/support/session.ts';
import { buildApp } from '../app.ts';
import { fixedClock } from '../kernel/clock.ts';
import { migratedPoolOrNull, skipReason } from '../kernel/pg-support.ts';

const AT = new Date('2026-10-07T09:00:00.000Z');
const MINUTE = 60_000;

function form(fields: Record<string, string>): {
  headers: { 'content-type': string };
  payload: string;
} {
  return {
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    payload: new URLSearchParams(fields).toString(),
  };
}

function fieldValue(html: string, name: string): string | undefined {
  const tag = html.match(new RegExp(`<input\\b(?=[^>]*name="${name}")[^>]*>`));
  return tag?.[0].match(/value="(\d+)"/)?.[1];
}

function article(html: string, description: string): string {
  const at = html.indexOf(`>${description}</a>`);
  assert.ok(at >= 0, description);
  const start = html.lastIndexOf('<article', at);
  const end = html.indexOf('</article>', at);
  assert.ok(start >= 0 && end > start);
  return html.slice(start, end);
}

function band(html: string, description: string): string | null {
  return (
    article(html, description).match(/data-goal="(amber|red)"/)?.[1] ?? null
  );
}

async function cleanup(pool: Pool, domain: string): Promise<void> {
  await pool.query(
    `DELETE FROM service_call_transition
      WHERE actor_id IN
          (SELECT staff_account_id FROM staff_account WHERE email LIKE $1)
         OR service_call_id IN
          (SELECT service_call_id FROM service_call WHERE opened_by IN
             (SELECT staff_account_id FROM staff_account WHERE email LIKE $1))`,
    [`%@${domain}`],
  );
  await pool.query(
    `DELETE FROM service_call WHERE opened_by IN
       (SELECT staff_account_id FROM staff_account WHERE email LIKE $1)`,
    [`%@${domain}`],
  );
  await pool.query(
    `DELETE FROM audit_log WHERE action IN ('calls.open', 'calls.exit', 'calls.response_goal')
       AND actor_id IN
       (SELECT staff_account_id::text FROM staff_account WHERE email LIKE $1)`,
    [`%@${domain}`],
  );
  await signOutAll(pool, domain);
}

describe('calls · the response goal', () => {
  it('saves the thresholds, marks age amber then red, and filters on the band', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    const suffix = AT.getTime().toString(36);
    const late = `סף ${suffix}`;
    const fresh = `טרי ${suffix}`;
    const domain = 'response-goal.test';
    const clock = fixedClock(AT);
    const app = buildApp({ pool, version: '9.9.9-test', clock });
    await cleanup(pool, domain);
    const admin = await signIn(pool, clock, {
      email: `admin@${domain}`,
      role: 'ADMIN',
    });
    const operator = await signIn(pool, clock, {
      email: `ops@${domain}`,
      role: 'OPERATOR',
    });
    const asAdmin = asOperator(app, admin);
    const asOps = asOperator(app, operator);
    let restore: { amber: string; red: string } | undefined;
    try {
      const before = await asAdmin.inject({ method: 'GET', url: '/settings' });
      assert.equal(before.statusCode, 200);
      assert.match(before.body, /action="\/settings\/response-goal"/);
      assert.match(before.body, /לא מוצג לדייר/);
      const amber = fieldValue(before.body, 'amber_minutes');
      const red = fieldValue(before.body, 'red_minutes');
      assert.equal(amber, '240');
      assert.equal(red, '1440');
      restore = { amber, red };

      const refused = await asOps.inject({
        method: 'POST',
        url: '/settings/response-goal',
        ...form({ amber_minutes: '10', red_minutes: '20' }),
      });
      assert.equal(refused.statusCode, 403);
      const viewer = await asOps.inject({ method: 'GET', url: '/settings' });
      assert.doesNotMatch(viewer.body, /action="\/settings\/response-goal"/);
      assert.match(viewer.body, /240/);
      assert.match(viewer.body, /1440/);

      const backwards = await asAdmin.inject({
        method: 'POST',
        url: '/settings/response-goal',
        ...form({ amber_minutes: '20', red_minutes: '10' }),
      });
      assert.equal(backwards.statusCode, 400);
      assert.equal(backwards.json().code, 'invalid');

      const saved = await asAdmin.inject({
        method: 'POST',
        url: '/settings/response-goal',
        ...form({ amber_minutes: '10', red_minutes: '20' }),
      });
      assert.equal(saved.statusCode, 303);
      assert.equal(saved.headers.location, '/settings?saved=goal');
      const page = await asAdmin.inject({
        method: 'GET',
        url: '/settings?saved=goal',
      });
      assert.match(page.body, /נשמר/);
      assert.equal(fieldValue(page.body, 'amber_minutes'), '10');
      assert.equal(fieldValue(page.body, 'red_minutes'), '20');

      const opened = await asAdmin.inject({
        method: 'POST',
        url: '/calls',
        ...form({
          channel: 'PHONE',
          description: late,
          sender: 'unknown',
        }),
      });
      assert.equal(opened.statusCode, 303);

      clock.advance(10 * MINUTE);
      const onAmber = await asAdmin.inject({ method: 'GET', url: '/calls' });
      assert.equal(band(onAmber.body, late), null);

      clock.advance(MINUTE);
      const amberList = await asAdmin.inject({ method: 'GET', url: '/calls' });
      assert.equal(band(amberList.body, late), 'amber');
      assert.match(article(amberList.body, late), /קרוב ליעד/);
      const lateId = amberList.body.match(
        new RegExp(`href="/calls/([0-9a-f-]{36})">${late}`),
      )?.[1];
      assert.ok(lateId);
      const amberPage = await asAdmin.inject({
        method: 'GET',
        url: `/calls/${lateId}`,
      });
      assert.match(amberPage.body, /<dd data-goal="amber">/);

      clock.advance(10 * MINUTE);
      const redList = await asAdmin.inject({ method: 'GET', url: '/calls' });
      assert.equal(band(redList.body, late), 'red');
      assert.match(article(redList.body, late), /מעבר ליעד/);

      const second = await asAdmin.inject({
        method: 'POST',
        url: '/calls',
        ...form({
          channel: 'WALK_IN',
          description: fresh,
          sender: 'unknown',
        }),
      });
      assert.equal(second.statusCode, 303);
      const both = await asAdmin.inject({ method: 'GET', url: '/calls' });
      assert.equal(band(both.body, late), 'red');
      assert.equal(band(both.body, fresh), null);

      const onlyAmber = await asAdmin.inject({
        method: 'GET',
        url: '/calls?goal=amber',
      });
      assert.doesNotMatch(onlyAmber.body, new RegExp(late));
      assert.doesNotMatch(onlyAmber.body, new RegExp(fresh));
      const onlyRed = await asAdmin.inject({
        method: 'GET',
        url: '/calls?goal=red',
      });
      assert.match(onlyRed.body, new RegExp(late));
      assert.doesNotMatch(onlyRed.body, new RegExp(fresh));
      assert.equal(band(onlyRed.body, late), 'red');

      const closed = await asAdmin.inject({
        method: 'POST',
        url: `/calls/${lateId}/exit`,
        ...form({ exit: 'ANSWERED', note: 'נסגרה בבדיקה' }),
      });
      assert.equal(closed.statusCode, 303);
      const closedList = await asAdmin.inject({
        method: 'GET',
        url: '/calls?state=CLOSED',
      });
      assert.match(closedList.body, new RegExp(late));
      assert.equal(band(closedList.body, late), null);
      assert.doesNotMatch(article(closedList.body, late), /data-goal=/);
      const closedPage = await asAdmin.inject({
        method: 'GET',
        url: `/calls/${lateId}`,
      });
      assert.match(closedPage.body, /data-call-state="CLOSED"/);
      assert.doesNotMatch(closedPage.body, /<dd data-goal=/);
      const redAfter = await asAdmin.inject({
        method: 'GET',
        url: '/calls?goal=red',
      });
      assert.doesNotMatch(redAfter.body, new RegExp(late));
    } finally {
      if (restore !== undefined) {
        await asAdmin.inject({
          method: 'POST',
          url: '/settings/response-goal',
          ...form({
            amber_minutes: restore.amber,
            red_minutes: restore.red,
          }),
        });
      }
      await cleanup(pool, domain);
      await app.close();
      await pool.end();
    }
  });
});
