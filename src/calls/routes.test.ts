// #182. The קריאות tab, driven the way the office drives it: a form post, then the list.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { asOperator, signIn, signOutAll } from '../../tests/support/session.ts';
import { buildApp } from '../app.ts';
import { fixedClock } from '../kernel/clock.ts';
import { migratedPoolOrNull, skipReason } from '../kernel/pg-support.ts';
import { createParty } from '../parties/contract.ts';

const AT = new Date('2026-10-06T12:00:00.000Z');
const HALF_HOUR = 30 * 60 * 1000;

function form(fields: Record<string, string>): string {
  return new URLSearchParams(fields).toString();
}

async function cleanup(pool: import('pg').Pool, domain: string): Promise<void> {
  await pool.query(
    `DELETE FROM service_call_transition WHERE service_call_id IN
       (SELECT service_call_id FROM service_call WHERE opened_by IN
          (SELECT staff_account_id FROM staff_account WHERE email LIKE $1))`,
    [`%@${domain}`],
  );
  await pool.query(
    `DELETE FROM service_call
      WHERE duplicate_of IS NOT NULL
        AND opened_by IN
          (SELECT staff_account_id FROM staff_account WHERE email LIKE $1)`,
    [`%@${domain}`],
  );
  await pool.query(
    `DELETE FROM service_call WHERE opened_by IN
       (SELECT staff_account_id FROM staff_account WHERE email LIKE $1)`,
    [`%@${domain}`],
  );
  await pool.query(
    `DELETE FROM audit_log WHERE action IN ('calls.open', 'calls.identify', 'calls.triage', 'calls.exit')
       AND actor_id IN
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

      const home = await client.inject({ method: 'GET', url: '/' });
      assert.equal(home.statusCode, 200);
      const homeBadge = home.body.match(/data-open-calls="(\d+)"/);
      assert.equal(Number(homeBadge?.[1]), rows);

      const inventory = await client.inject({
        method: 'GET',
        url: '/estate/inventory',
      });
      assert.equal(inventory.statusCode, 200);
      const inventoryBadge = inventory.body.match(/data-open-calls="(\d+)"/);
      assert.equal(Number(inventoryBadge?.[1]), rows);

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

  it('opens a call, identifies the requester, sets a category, and filters', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    const clock = fixedClock(AT);
    const app = buildApp({ pool, version: '9.9.9-test', clock });
    const domain = 'calls-routes-page.test';
    await cleanup(pool, domain);
    const who = await signIn(pool, clock, {
      email: `ops@${domain}`,
      role: 'OPERATOR',
    });
    const client = asOperator(app, who);
    const party = await createParty(pool, {
      kind: 'PERSON',
      fullName: 'יעל מזוהה',
      preferredLanguage: 'he',
    });
    try {
      const created = await client.inject({
        method: 'POST',
        url: '/calls',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: form({
          channel: 'PHONE',
          description: 'נזילה לזיהוי',
          sender: 'unknown',
        }),
      });
      assert.equal(created.statusCode, 303);
      const list = await client.inject({ method: 'GET', url: '/calls' });
      assert.match(list.body, /name="state"/);
      assert.match(list.body, /name="category"/);
      assert.match(list.body, /אינסטלציה/);
      const callId = list.body.match(
        /href="\/calls\/([0-9a-f-]{36})">נזילה לזיהוי/,
      )?.[1];
      assert.ok(callId);

      const page = await client.inject({
        method: 'GET',
        url: `/calls/${callId}`,
      });
      assert.equal(page.statusCode, 200);
      assert.doesNotMatch(page.body, /<script/);
      assert.match(page.body, /נזילה לזיהוי/);
      assert.match(page.body, /נפתחה/);
      assert.match(page.body, /ops@calls-routes-page\.test/);
      assert.match(page.body, /לא שומר איש קשר/);

      const found = await client.inject({
        method: 'GET',
        url: `/calls/${callId}?q=${encodeURIComponent('יעל מזוהה')}`,
      });
      assert.match(found.body, /יעל מזוהה/);
      const identified = await client.inject({
        method: 'POST',
        url: `/calls/${callId}/identify`,
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: form({ party_id: party.id }),
      });
      assert.equal(identified.statusCode, 303);
      const afterId = await client.inject({
        method: 'GET',
        url: `/calls/${callId}`,
      });
      assert.match(afterId.body, /data-call-state="IDENTIFIED"/);
      assert.match(afterId.body, /זוהתה/);
      assert.match(afterId.body, /יעל מזוהה/);
      const plumbing = afterId.body.match(
        /<option value="([0-9a-f-]{36})"[^>]*>אינסטלציה<\/option>/,
      )?.[1];
      assert.ok(plumbing);

      const triaged = await client.inject({
        method: 'POST',
        url: `/calls/${callId}/category`,
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: form({ category_id: plumbing }),
      });
      assert.equal(triaged.statusCode, 303);
      const afterCat = await client.inject({
        method: 'GET',
        url: `/calls/${callId}`,
      });
      assert.match(afterCat.body, /data-call-state="TRIAGED"/);
      assert.match(afterCat.body, /קטגוריה אינסטלציה/);
      assert.match(afterCat.body, /מוינה/);

      const filtered = await client.inject({
        method: 'GET',
        url: `/calls?state=TRIAGED&category=${plumbing}`,
      });
      assert.match(filtered.body, /נזילה לזיהוי/);
      const others = await client.inject({
        method: 'GET',
        url: '/calls?state=NEW',
      });
      assert.doesNotMatch(others.body, /נזילה לזיהוי/);
    } finally {
      await cleanup(pool, domain);
      await pool.query('DELETE FROM party WHERE party_id = $1', [party.id]);
      await app.close();
      await pool.end();
    }
  });

  it('closes a call by an exit, drops it from the open list, and links a duplicate both ways', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    const clock = fixedClock(AT);
    const app = buildApp({ pool, version: '9.9.9-test', clock });
    const domain = 'calls-routes-exit.test';
    await cleanup(pool, domain);
    const who = await signIn(pool, clock, {
      email: `ops@${domain}`,
      role: 'OPERATOR',
    });
    const client = asOperator(app, who);
    try {
      for (const description of ['שאלה לסוגר', 'נזילה מקורית']) {
        const created = await client.inject({
          method: 'POST',
          url: '/calls',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          payload: form({
            channel: 'PHONE',
            description,
            sender: 'unknown',
          }),
        });
        assert.equal(created.statusCode, 303);
      }
      const listed = await client.inject({ method: 'GET', url: '/calls' });
      const questionId = listed.body.match(
        /href="\/calls\/([0-9a-f-]{36})">שאלה לסוגר/,
      )?.[1];
      const originalId = listed.body.match(
        /href="\/calls\/([0-9a-f-]{36})">נזילה מקורית/,
      )?.[1];
      assert.ok(questionId);
      assert.ok(originalId);
      const openBadge = Number(
        listed.body.match(/data-open-calls="(\d+)"/)?.[1],
      );

      const page = await client.inject({
        method: 'GET',
        url: `/calls/${questionId}`,
      });
      assert.match(page.body, /name="exit"/);
      assert.match(page.body, /נענתה/);
      assert.match(page.body, /הועברה/);
      assert.match(page.body, /כפולה/);
      assert.match(page.body, /בוטלה/);

      const refused = await client.inject({
        method: 'POST',
        url: `/calls/${questionId}/exit`,
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: form({ exit: 'ANSWERED', note: '   ' }),
      });
      assert.equal(refused.statusCode, 400);
      assert.match(refused.body, /יש לכתוב סיבה/);
      assert.match(refused.body, /data-call-state="NEW"/);

      const closed = await client.inject({
        method: 'POST',
        url: `/calls/${questionId}/exit`,
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: form({ exit: 'ANSWERED', note: 'עניתי בטלפון' }),
      });
      assert.equal(closed.statusCode, 303);

      const after = await client.inject({ method: 'GET', url: '/calls' });
      const afterBadge = Number(
        after.body.match(/data-open-calls="(\d+)"/)?.[1],
      );
      assert.equal(afterBadge, openBadge - 1);
      assert.equal(afterBadge, after.body.match(/data-call="/g)?.length ?? 0);
      assert.doesNotMatch(after.body, /שאלה לסוגר/);
      assert.match(after.body, /נזילה מקורית/);

      const closedList = await client.inject({
        method: 'GET',
        url: '/calls?state=CLOSED',
      });
      assert.match(closedList.body, /שאלה לסוגר/);
      assert.match(closedList.body, /סגורות/);
      assert.equal(
        Number(closedList.body.match(/data-open-calls="(\d+)"/)?.[1]),
        afterBadge,
      );
      const home = await client.inject({ method: 'GET', url: '/' });
      assert.equal(
        Number(home.body.match(/data-open-calls="(\d+)"/)?.[1]),
        afterBadge,
      );

      const closedPage = await client.inject({
        method: 'GET',
        url: `/calls/${questionId}`,
      });
      assert.match(closedPage.body, /data-call-state="CLOSED"/);
      assert.match(closedPage.body, /נענתה/);
      assert.match(closedPage.body, /עניתי בטלפון/);
      assert.match(closedPage.body, /ops@calls-routes-exit\.test/);
      assert.doesNotMatch(closedPage.body, /name="exit"/);
      assert.doesNotMatch(closedPage.body, /לא שומר איש קשר/);

      const again = await client.inject({
        method: 'POST',
        url: '/calls',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: form({
          channel: 'WALK_IN',
          description: 'נזילה שוב',
          sender: 'unknown',
        }),
      });
      assert.equal(again.statusCode, 303);
      const withAgain = await client.inject({ method: 'GET', url: '/calls' });
      const againId = withAgain.body.match(
        /href="\/calls\/([0-9a-f-]{36})">נזילה שוב/,
      )?.[1];
      assert.ok(againId);
      const found = await client.inject({
        method: 'GET',
        url: `/calls/${againId}?dup=${encodeURIComponent('מקורית')}`,
      });
      assert.match(found.body, new RegExp(`value="${originalId}"`));

      const linked = await client.inject({
        method: 'POST',
        url: `/calls/${againId}/exit`,
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: form({ exit: 'DUPLICATE', duplicate_of: originalId }),
      });
      assert.equal(linked.statusCode, 303);
      const duplicatePage = await client.inject({
        method: 'GET',
        url: `/calls/${againId}`,
      });
      assert.match(duplicatePage.body, /כפולה/);
      assert.match(
        duplicatePage.body,
        new RegExp(`href="/calls/${originalId}"`),
      );
      const originalPage = await client.inject({
        method: 'GET',
        url: `/calls/${originalId}`,
      });
      assert.match(originalPage.body, /נזילה שוב/);
      assert.match(originalPage.body, /data-call-state="NEW"/);
    } finally {
      await cleanup(pool, domain);
      await app.close();
      await pool.end();
    }
  });
});
