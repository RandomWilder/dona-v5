// #287. Handling thresholds in business days, and the non-working dates the count
// skips. Driven the way an administrator drives /settings. Red must be later
// than amber. Each date that actually changes the list is an audit row.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Pool } from 'pg';
import { asOperator, signIn, signOutAll } from '../../tests/support/session.ts';
import { buildApp } from '../app.ts';
import { fixedClock } from '../kernel/clock.ts';
import { migratedPoolOrNull, skipReason } from '../kernel/pg-support.ts';

const AT = new Date('2026-10-08T07:00:00.000Z');
const DAY = '2026-10-11';

function form(fields: Record<string, string>): {
  headers: { 'content-type': string };
  payload: string;
} {
  return {
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    payload: new URLSearchParams(fields).toString(),
  };
}

function article(html: string, description: string): string {
  const at = html.indexOf(`>${description}</a>`);
  assert.ok(at >= 0, description);
  const start = html.lastIndexOf('<article', at);
  const end = html.indexOf('</article>', at);
  assert.ok(start >= 0 && end > start);
  return html.slice(start, end);
}

function bandOf(html: string, description: string): string | null {
  return (
    article(html, description).match(/data-goal="(amber|red)"/)?.[1] ?? null
  );
}

function fieldValue(html: string, name: string): string | undefined {
  const tag = html.match(new RegExp(`<input\\b(?=[^>]*name="${name}")[^>]*>`));
  return tag?.[0].match(/value="([^"]*)"/)?.[1];
}

async function audits(
  pool: Pool,
  actorId: string,
): Promise<{ change: string; date: string }[]> {
  const { rows } = await pool.query<{
    inputs: { change?: string; date?: string };
  }>(
    `SELECT inputs FROM audit_log
      WHERE action = 'calls.non_working_date' AND actor_id = $1
      ORDER BY at`,
    [actorId],
  );
  return rows.map((row) => ({
    change: row.inputs.change ?? '',
    date: row.inputs.date ?? '',
  }));
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
    `DELETE FROM audit_log
      WHERE action IN (
        'calls.non_working_date',
        'calls.handling_clock',
        'calls.open',
        'calls.emergency.flag'
      )
        AND actor_id IN
          (SELECT staff_account_id::text FROM staff_account WHERE email LIKE $1)`,
    [`%@${domain}`],
  );
}

describe('calls · the handling clock', () => {
  it('saves business-day thresholds and adds and removes a non-working date', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    const domain = 'handling-clock.test';
    const clock = fixedClock(AT);
    const app = buildApp({ pool, version: '9.9.9-test', clock });
    const lock = await pool.connect();
    await lock.query('SELECT pg_advisory_lock(287)');
    await cleanup(pool, domain);
    await signOutAll(pool, domain);
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
    let already = false;
    try {
      const before = await asAdmin.inject({ method: 'GET', url: '/settings' });
      assert.equal(before.statusCode, 200);
      assert.match(before.body, /action="\/settings\/handling-clock"/);
      assert.match(before.body, /לקריאה שאינה חירום/);
      const amber = fieldValue(before.body, 'amber_days');
      const red = fieldValue(before.body, 'red_days');
      if (amber === undefined || red === undefined) {
        throw new Error('handling thresholds are missing');
      }
      restore = { amber, red };
      already = before.body.includes(`value="${DAY}"`);

      const refused = await asOps.inject({
        method: 'POST',
        url: '/settings/handling-clock',
        ...form({ amber_days: '1', red_days: '3' }),
      });
      assert.equal(refused.statusCode, 403);
      const viewer = await asOps.inject({ method: 'GET', url: '/settings' });
      assert.doesNotMatch(viewer.body, /action="\/settings\/handling-clock"/);
      assert.doesNotMatch(
        viewer.body,
        /action="\/settings\/non-working-dates"/,
      );
      assert.match(viewer.body, new RegExp(`>${amber} ימים<`));
      assert.match(viewer.body, new RegExp(`>${red} ימים<`));

      const backwards = await asAdmin.inject({
        method: 'POST',
        url: '/settings/handling-clock',
        ...form({ amber_days: '5', red_days: '2' }),
      });
      assert.equal(backwards.statusCode, 400);
      assert.equal(backwards.json().code, 'invalid');

      const tooBig = await asAdmin.inject({
        method: 'POST',
        url: '/settings/handling-clock',
        ...form({ amber_days: '10', red_days: '400' }),
      });
      assert.equal(tooBig.statusCode, 400);

      const saved = await asAdmin.inject({
        method: 'POST',
        url: '/settings/handling-clock',
        ...form({ amber_days: '1', red_days: '3' }),
      });
      assert.equal(saved.statusCode, 303);
      assert.equal(saved.headers.location, '/settings?saved=handling');
      const page = await asAdmin.inject({
        method: 'GET',
        url: '/settings?saved=handling',
      });
      assert.match(page.body, /נשמר/);
      assert.equal(fieldValue(page.body, 'amber_days'), '1');
      assert.equal(fieldValue(page.body, 'red_days'), '3');

      if (!already) {
        const added = await asAdmin.inject({
          method: 'POST',
          url: '/settings/non-working-dates',
          ...form({ op: 'add', date: DAY }),
        });
        assert.equal(added.statusCode, 303);
      }
      const listed = await asAdmin.inject({ method: 'GET', url: '/settings' });
      assert.match(listed.body, new RegExp(`value="${DAY}"`));
      const afterAdd = await audits(pool, admin.staffAccountId);
      const adds = afterAdd.filter(
        (row) => row.date === DAY && row.change === 'add',
      );
      assert.equal(adds.length, already ? 0 : 1);

      const again = await asAdmin.inject({
        method: 'POST',
        url: '/settings/non-working-dates',
        ...form({ op: 'add', date: DAY }),
      });
      assert.equal(again.statusCode, 303);
      const stillOne = await audits(pool, admin.staffAccountId);
      assert.equal(
        stillOne.filter((row) => row.date === DAY && row.change === 'add')
          .length,
        adds.length,
      );

      const bogus = await asAdmin.inject({
        method: 'POST',
        url: '/settings/non-working-dates',
        ...form({ op: 'add', date: '2026-02-31' }),
      });
      assert.equal(bogus.statusCode, 400);

      const removed = await asAdmin.inject({
        method: 'POST',
        url: '/settings/non-working-dates',
        ...form({ op: 'remove', date: DAY }),
      });
      assert.equal(removed.statusCode, 303);
      const gone = await asAdmin.inject({ method: 'GET', url: '/settings' });
      assert.doesNotMatch(gone.body, new RegExp(`value="${DAY}"`));
      const afterRemove = await audits(pool, admin.staffAccountId);
      assert.equal(
        afterRemove.filter((row) => row.date === DAY && row.change === 'remove')
          .length,
        1,
      );

      const missing = await asAdmin.inject({
        method: 'POST',
        url: '/settings/non-working-dates',
        ...form({ op: 'remove', date: DAY }),
      });
      assert.equal(missing.statusCode, 303);
      const quiet = await audits(pool, admin.staffAccountId);
      assert.equal(
        quiet.filter((row) => row.date === DAY && row.change === 'remove')
          .length,
        1,
      );

      const kept = await asAdmin.inject({
        method: 'POST',
        url: '/settings/non-working-dates',
        ...form({ op: 'add', date: DAY }),
      });
      assert.equal(kept.statusCode, 303);
      const suffix = Date.now().toString(36);
      const plain = `טיפול ${suffix}`;
      const urgent = `חירום ${suffix}`;
      const openedPlain = await asAdmin.inject({
        method: 'POST',
        url: '/calls',
        ...form({ channel: 'PHONE', description: plain, sender: 'unknown' }),
      });
      assert.equal(openedPlain.statusCode, 303);
      const openedUrgent = await asAdmin.inject({
        method: 'POST',
        url: '/calls',
        ...form({ channel: 'PHONE', description: urgent, sender: 'unknown' }),
      });
      assert.equal(openedUrgent.statusCode, 303);
      const created = await asAdmin.inject({ method: 'GET', url: '/calls' });
      const urgentId = created.body.match(
        new RegExp(`href="/calls/([0-9a-f-]{36})">${urgent}`),
      )?.[1];
      assert.ok(urgentId);
      const flagged = await asAdmin.inject({
        method: 'POST',
        url: `/calls/${urgentId}/emergency`,
        ...form({ action: 'flag' }),
      });
      assert.equal(flagged.statusCode, 303);
      clock.advance(6 * 24 * 60 * 60 * 1000);
      const later = asOperator(
        app,
        await signIn(pool, clock, {
          email: `admin@${domain}`,
          role: 'ADMIN',
        }),
      );
      const aged = await later.inject({ method: 'GET', url: '/calls' });
      assert.equal(bandOf(aged.body, plain), 'amber');
      assert.match(article(aged.body, plain), /קרוב ליעד/);
      assert.equal(bandOf(aged.body, urgent), 'red');
      const onlyAmber = await later.inject({
        method: 'GET',
        url: '/calls?goal=amber',
      });
      assert.match(onlyAmber.body, new RegExp(plain));
      assert.doesNotMatch(onlyAmber.body, new RegExp(urgent));
      if (!already) {
        await later.inject({
          method: 'POST',
          url: '/settings/non-working-dates',
          ...form({ op: 'remove', date: DAY }),
        });
      }
    } finally {
      const restoring = asOperator(
        app,
        await signIn(pool, clock, {
          email: `admin@${domain}`,
          role: 'ADMIN',
        }),
      );
      if (restore !== undefined) {
        await restoring.inject({
          method: 'POST',
          url: '/settings/handling-clock',
          ...form({ amber_days: restore.amber, red_days: restore.red }),
        });
      }
      await restoring.inject({
        method: 'POST',
        url: '/settings/non-working-dates',
        ...form({ op: already ? 'add' : 'remove', date: DAY }),
      });
      await cleanup(pool, domain);
      await signOutAll(pool, domain);
      await lock.query('SELECT pg_advisory_unlock(287)');
      lock.release();
      await app.close();
      await pool.end();
    }
  });
});
