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

function callId(html: string, description: string): string | undefined {
  const at = html.indexOf(`>${description}</a>`);
  if (at < 0) return undefined;
  const links = html.slice(0, at).match(/href="\/calls\/([0-9a-f-]{36})"/g);
  return links?.at(-1)?.match(/([0-9a-f-]{36})/)?.[1];
}

function article(html: string, description: string): string {
  const at = html.indexOf(`>${description}</a>`);
  assert.ok(at >= 0, description);
  const start = html.lastIndexOf('<article', at);
  const end = html.indexOf('</article>', at);
  assert.ok(start >= 0 && end > start);
  return html.slice(start, end);
}

function labeledCount(html: string, label: string): number {
  const found = html.match(
    new RegExp(`${label} <span dir="ltr">(\\d+)</span>`),
  );
  assert.ok(found, label);
  return Number(found[1]);
}

function railCount(html: string): number {
  const found = html.match(/data-open-calls="(\d+)"/);
  assert.ok(found);
  return Number(found[1]);
}

function emergencyMark(html: string, description: string): string | undefined {
  const at = html.indexOf(`>${description}</a>`);
  if (at < 0) return undefined;
  return html
    .slice(Math.max(0, at - 400), at)
    .match(/data-emergency="(true|false)"/g)
    ?.at(-1)
    ?.match(/true|false/)?.[0];
}

async function cleanup(pool: import('pg').Pool, domain: string): Promise<void> {
  await pool.query(
    `UPDATE service_call
        SET emergency = false, emergency_by = NULL, emergency_actor = NULL
      WHERE emergency_actor IN
        (SELECT staff_account_id FROM staff_account WHERE email LIKE $1)`,
    [`%@${domain}`],
  );
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
    `DELETE FROM audit_log WHERE action IN ('calls.open', 'calls.identify', 'calls.triage', 'calls.exit', 'calls.emergency.flag', 'calls.emergency.clear')
       AND actor_id IN
       (SELECT staff_account_id::text FROM staff_account WHERE email LIKE $1)`,
    [`%@${domain}`],
  );
  await signOutAll(pool, domain);
}

// The badge and the list are two reads, and other files open and close calls on this database
// while this one runs. A page read while the open count held still is one where the two must agree;
// a page that straddled another file's write is read again.
async function quietCallsPage(
  pool: import('pg').Pool,
  client: ReturnType<typeof asOperator>,
): Promise<Awaited<ReturnType<ReturnType<typeof asOperator>['inject']>>> {
  const openNow = async (): Promise<number> => {
    const { rows } = await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM service_call
        WHERE state <> 'CLOSED' AND returned_at IS NULL`,
    );
    return rows[0]?.n ?? 0;
  };
  for (let attempt = 1; ; attempt += 1) {
    const before = await openNow();
    const page = await client.inject({ method: 'GET', url: '/calls' });
    if ((await openNow()) === before || attempt === 20) return page;
  }
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
      const page = await quietCallsPage(pool, client);
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
      // The count is every open call, and other tests insert some. These two
      // stay open, so a later screen can only be checked against that floor.
      assert.ok(Number(homeBadge?.[1]) >= 2);

      const inventory = await client.inject({
        method: 'GET',
        url: '/estate/inventory',
      });
      assert.equal(inventory.statusCode, 200);
      const inventoryBadge = inventory.body.match(/data-open-calls="(\d+)"/);
      assert.ok(Number(inventoryBadge?.[1]) >= 2);

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
      givenName: 'יעל',
      familyName: 'מזוהה',
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

      const after = await quietCallsPage(pool, client);
      const afterBadge = Number(
        after.body.match(/data-open-calls="(\d+)"/)?.[1],
      );
      assert.equal(afterBadge, after.body.match(/data-call="/g)?.length ?? 0);
      assert.doesNotMatch(after.body, /שאלה לסוגר/);
      assert.match(after.body, /נזילה מקורית/);

      const closedList = await client.inject({
        method: 'GET',
        url: '/calls?state=CLOSED',
      });
      assert.match(closedList.body, /שאלה לסוגר/);
      assert.match(closedList.body, /סגורות/);
      assert.match(closedList.body, /data-open-calls="\d+"/);
      const home = await client.inject({ method: 'GET', url: '/' });
      assert.match(home.body, /data-open-calls="\d+"/);

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

  it('pins a flagged call in red, filters on the flag, and clears it by hand', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    const clock = fixedClock(AT);
    const app = buildApp({ pool, version: '9.9.9-test', clock });
    const domain = 'calls-routes-emergency.test';
    await cleanup(pool, domain);
    const who = await signIn(pool, clock, {
      email: `ops@${domain}`,
      role: 'OPERATOR',
    });
    const client = asOperator(app, who);
    try {
      const flagged = await client.inject({
        method: 'POST',
        url: '/calls',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: form({
          channel: 'PHONE',
          description: 'יש השריפה בדירה',
          sender: 'unknown',
        }),
      });
      assert.equal(flagged.statusCode, 303);
      const plain = await client.inject({
        method: 'POST',
        url: '/calls',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: form({
          channel: 'WALK_IN',
          description: 'נזילה רגילה לבדיקה',
          sender: 'unknown',
        }),
      });
      assert.equal(plain.statusCode, 303);

      const list = await client.inject({ method: 'GET', url: '/calls' });
      assert.equal(list.statusCode, 200);
      const emergencyAt = list.body.indexOf('יש השריפה בדירה');
      const plainAt = list.body.indexOf('נזילה רגילה לבדיקה');
      assert.ok(emergencyAt >= 0 && plainAt > emergencyAt);
      assert.match(list.body, /color: var\(--color-alert\)/);

      const filtered = await client.inject({
        method: 'GET',
        url: '/calls?emergency=1',
      });
      assert.match(filtered.body, /יש השריפה בדירה/);
      assert.doesNotMatch(filtered.body, /נזילה רגילה לבדיקה/);

      assert.equal(emergencyMark(list.body, 'יש השריפה בדירה'), 'true');
      assert.equal(emergencyMark(list.body, 'נזילה רגילה לבדיקה'), 'false');
      const emergencyId = callId(list.body, 'יש השריפה בדירה');
      assert.ok(emergencyId);
      const page = await client.inject({
        method: 'GET',
        url: `/calls/${emergencyId}`,
      });
      assert.match(page.body, /המונחים/);
      const cleared = await client.inject({
        method: 'POST',
        url: `/calls/${emergencyId}/emergency`,
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: form({ action: 'clear' }),
      });
      assert.equal(cleared.statusCode, 303);
      const after = await client.inject({
        method: 'GET',
        url: `/calls/${emergencyId}`,
      });
      assert.match(after.body, /data-emergency="false"/);
      assert.match(after.body, /הוסר סימון חירום/);

      const plainId = callId(list.body, 'נזילה רגילה לבדיקה');
      assert.ok(plainId);
      const plainPage = await client.inject({
        method: 'GET',
        url: `/calls/${plainId}`,
      });
      assert.match(plainPage.body, /נזילה רגילה לבדיקה/);
      const marked = await client.inject({
        method: 'POST',
        url: `/calls/${plainId}/emergency`,
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: form({ action: 'flag' }),
      });
      assert.equal(marked.statusCode, 303);
      const handed = await client.inject({
        method: 'GET',
        url: `/calls/${plainId}`,
      });
      assert.match(handed.body, /data-emergency="true"/);
      assert.match(handed.body, new RegExp(who.email));
    } finally {
      await cleanup(pool, domain);
      await app.close();
      await pool.end();
    }
  });

  it('leads with emergencies and past-goal calls, and counts the whole open book', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    const clock = fixedClock(AT);
    const app = buildApp({ pool, version: '9.9.9-test', clock });
    const domain = 'calls-routes-attention.test';
    await cleanup(pool, domain);
    let client = asOperator(
      app,
      await signIn(pool, clock, {
        email: `ops@${domain}`,
        role: 'OPERATOR',
      }),
    );
    const refresh = async (): Promise<void> => {
      client = asOperator(
        app,
        await signIn(pool, clock, {
          email: `ops@${domain}`,
          role: 'OPERATOR',
        }),
      );
    };
    const suffix = Date.now().toString(36);
    const emergencyOld = `חירום ותיק ${suffix}`;
    const emergencyFresh = `חירום טרי ${suffix}`;
    const pastOld = `איחור ותיק ${suffix}`;
    const pastNew = `איחור טרי ${suffix}`;
    const near = `ליד היעד ${suffix}`;
    const fresh = `זה עתה ${suffix}`;
    const hour = 60 * 60 * 1000;
    const minute = 60 * 1000;
    let gatesOff = false;
    const graphKeys = [
      'GRAPH_TENANT_ID',
      'GRAPH_CLIENT_ID',
      'GRAPH_CLIENT_SECRET',
      'GRAPH_MAILBOX',
      'GRAPH_SECRET_EXPIRES',
    ] as const;
    const savedGraph = Object.fromEntries(
      graphKeys.map((key) => [key, process.env[key]]),
    );
    const open = async (description: string): Promise<void> => {
      await refresh();
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
    };
    const flag = async (description: string, html: string): Promise<void> => {
      const id = callId(html, description);
      assert.ok(id, description);
      const flagged = await client.inject({
        method: 'POST',
        url: `/calls/${id}/emergency`,
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: form({ action: 'flag' }),
      });
      assert.equal(flagged.statusCode, 303);
    };
    try {
      await open(emergencyOld);
      clock.advance(4 * hour);
      await open(pastOld);
      clock.advance(hour);
      await open(pastNew);
      clock.advance(20 * hour);
      await open(near);
      clock.advance(4 * hour);
      await open(emergencyFresh);
      clock.advance(50 * minute);
      await open(fresh);
      clock.advance(10 * minute);

      await refresh();
      const created = await client.inject({ method: 'GET', url: '/calls' });
      assert.equal(created.statusCode, 200);
      await flag(emergencyOld, created.body);
      await flag(emergencyFresh, created.body);

      const list = await client.inject({ method: 'GET', url: '/calls' });
      assert.equal(list.statusCode, 200);
      assert.doesNotMatch(list.body, /type="search"|name="q"|name="search"/);
      const order = [
        emergencyOld,
        emergencyFresh,
        pastOld,
        pastNew,
        fresh,
        near,
      ].map((description) => list.body.indexOf(description));
      assert.ok(
        order.every(
          (at, index) => at >= 0 && (index === 0 || at > order[index - 1]),
        ),
      );
      const heading = list.body.indexOf('דורש טיפול עכשיו');
      assert.ok(heading >= 0 && heading < order[0]);
      assert.match(article(list.body, fresh), /בזמן/);
      assert.doesNotMatch(article(list.body, fresh), /data-goal=/);
      assert.match(article(list.body, near), /קרוב ליעד/);
      assert.match(article(list.body, near), /data-goal="amber"/);
      assert.match(article(list.body, pastOld), /מעבר ליעד/);
      assert.match(article(list.body, pastOld), /data-goal="red"/);
      assert.match(article(list.body, emergencyFresh), /חירום/);
      assert.match(article(list.body, emergencyFresh), /בזמן/);

      const amber = await client.inject({
        method: 'GET',
        url: '/calls?goal=amber',
      });
      assert.match(amber.body, new RegExp(near));
      assert.doesNotMatch(amber.body, new RegExp(pastOld));
      assert.doesNotMatch(amber.body, new RegExp(emergencyOld));
      const empty = await client.inject({
        method: 'GET',
        url: '/calls?category=00000000-0000-4000-8000-000000000099',
      });
      assert.match(empty.body, /אין קריאות תואמות/);
      assert.doesNotMatch(empty.body, /דורש טיפול עכשיו/);
      const red = await client.inject({
        method: 'GET',
        url: '/calls?goal=red',
      });
      assert.match(red.body, new RegExp(pastOld));
      assert.match(red.body, new RegExp(emergencyOld));
      assert.doesNotMatch(red.body, new RegExp(near));
      assert.doesNotMatch(red.body, new RegExp(fresh));
      const late = await client.inject({
        method: 'GET',
        url: '/calls?goal=late',
      });
      assert.match(late.body, /לא בזמן/);
      assert.match(late.body, new RegExp(near));
      assert.match(late.body, new RegExp(pastOld));
      assert.doesNotMatch(late.body, new RegExp(emergencyFresh));
      assert.doesNotMatch(late.body, new RegExp(fresh));
      assert.doesNotMatch(list.body, /כתום|אדום/);

      const emergencies = await client.inject({
        method: 'GET',
        url: '/calls?emergency=1',
      });
      const openTotal = railCount(emergencies.body);
      assert.equal(labeledCount(emergencies.body, 'פתוחות'), openTotal);
      assert.equal(labeledCount(list.body, 'פתוחות'), railCount(list.body));
      for (const label of ['חירום', 'לא בזמן', 'לבדיקה'] as const) {
        assert.equal(
          labeledCount(emergencies.body, label),
          labeledCount(list.body, label),
        );
      }
      const shown = emergencies.body.match(/<article /g)?.length ?? 0;
      assert.ok(shown < openTotal);
      assert.doesNotMatch(emergencies.body, new RegExp(fresh));
      assert.match(
        emergencies.body,
        /מעבר ליעד המענה<\/span>\s*<span class="stat-value">\s*<span dir="ltr">\d+<\/span>\s*<\/span>\s*<span class="stat-note">\s*קרוב ליעד <span dir="ltr">\d+<\/span>/,
      );
      assert.equal(
        labeledCount(emergencies.body, 'קרוב ליעד'),
        labeledCount(list.body, 'קרוב ליעד'),
      );
      assert.doesNotMatch(list.body, /סגורות <span/);
      assert.match(list.body, /href="\/calls\?state=CLOSED"/);
      assert.match(list.body, /<option value="NEW"/);
      assert.match(list.body, /<option value="SCHEDULED"/);
      assert.doesNotMatch(list.body, /<option value="CLOSED"/);
      assert.match(emergencies.body, /name="emergency" value="1"/);
      assert.match(emergencies.body, /name="category"/);
      assert.match(emergencies.body, /name="state"/);

      await pool.query(
        `UPDATE call_category SET is_active = false WHERE code = 'GATES'`,
      );
      gatesOff = true;
      const inactive = await client.inject({ method: 'GET', url: '/calls' });
      assert.match(inactive.body, /שערים \(לא פעיל\)/);
      await pool.query(
        `UPDATE call_category SET is_active = true WHERE code = 'GATES'`,
      );
      gatesOff = false;

      const filtered = await client.inject({
        method: 'GET',
        url: '/calls/filtered',
      });
      const setAside = filtered.body.match(/data-filtered=/g)?.length ?? 0;
      assert.match(
        list.body,
        new RegExp(
          `מסוננות <span class="n"><span dir="ltr">${setAside}</span>`,
        ),
      );

      for (const key of graphKeys) delete process.env[key];
      process.env.GRAPH_TENANT_ID = 'tenant';
      process.env.GRAPH_CLIENT_ID = 'client';
      process.env.GRAPH_CLIENT_SECRET = 'secret';
      process.env.GRAPH_MAILBOX = 'box@test';
      const warned = await client.inject({ method: 'GET', url: '/calls' });
      const warningAt = warned.body.indexOf('תאריך התפוגה של הסוד לא הוגדר');
      const callAt = warned.body.indexOf(emergencyOld);
      assert.ok(warningAt >= 0 && callAt > warningAt);
      assert.match(
        warned.body.slice(warningAt, warningAt + 280),
        /href="\/settings"/,
      );

      const pastId = callId(list.body, pastOld);
      assert.ok(pastId);
      const closed = await client.inject({
        method: 'POST',
        url: `/calls/${pastId}/exit`,
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: form({ exit: 'ANSWERED', note: 'נסגרה אחרי היעד' }),
      });
      assert.equal(closed.statusCode, 303);
      const closedList = await client.inject({
        method: 'GET',
        url: '/calls?state=CLOSED',
      });
      const closedRow = article(closedList.body, pastOld);
      assert.doesNotMatch(closedRow, /בזמן|קרוב ליעד|מעבר ליעד/);
      assert.doesNotMatch(closedRow, /data-goal=/);
      assert.match(closedList.body, /מעבר ליעד המענה/);
    } finally {
      if (gatesOff) {
        await pool.query(
          `UPDATE call_category SET is_active = true WHERE code = 'GATES'`,
        );
      }
      for (const [key, value] of Object.entries(savedGraph)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      await cleanup(pool, domain);
      await app.close();
      await pool.end();
    }
  });
});
