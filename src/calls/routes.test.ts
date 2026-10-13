// #182. The קריאות tab, driven the way the office drives it: a form post, then the list.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Pool } from 'pg';
import { seedOccupancy } from '../../tests/policy/fixtures.ts';
import { asOperator, signIn, signOutAll } from '../../tests/support/session.ts';
import { buildApp } from '../app.ts';
import {
  type IncomingMessage,
  receiveIncoming,
  type SortVerdict,
} from '../channel/contract.ts';
import { upsertDocumentType } from '../evidence/contract.ts';
import { fixedClock } from '../kernel/clock.ts';
import { createMemoryStore } from '../kernel/objects.ts';
import { createFakePdfText } from '../kernel/pdf.ts';
import {
  inRolledBackTransaction,
  migratedPoolOrNull,
  skipReason,
} from '../kernel/pg-support.ts';
import { createParty, upsertPartyContact } from '../parties/contract.ts';
import { openIntakeCall } from './contract.ts';

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

function dialogOf(html: string): string {
  const start = html.indexOf('<dialog');
  const end = html.indexOf('</dialog>');
  assert.ok(start >= 0 && end > start, 'dialog');
  return html.slice(start, end);
}

function splitCall(html: string, id: string): string {
  const at = html.indexOf(`data-split-call="${id}"`);
  assert.ok(at >= 0, id);
  const start = html.lastIndexOf('<a', at);
  const end = html.indexOf('</a>', at);
  assert.ok(start >= 0 && end > start, id);
  return html.slice(start, end);
}

function article(html: string, description: string): string {
  const at = html.indexOf(`>${description}</a>`);
  assert.ok(at >= 0, description);
  const start = html.lastIndexOf('<article', at);
  const end = html.indexOf('</article>', at);
  assert.ok(start >= 0 && end > start);
  return html.slice(start, end);
}

function listedId(html: string, description: string): string {
  const found = html.match(
    new RegExp(`href="/calls/([0-9a-f-]{36})">${description}</a>`),
  );
  assert.ok(found?.[1], description);
  return found[1];
}

/** List, split row, preview, and the call page all say היה חירום. The stored flag mark stays. */
async function assertPastEmergency(
  client: ReturnType<typeof asOperator>,
  id: string,
  description: string,
  stored: 'true' | 'false',
): Promise<void> {
  const closedList = await client.inject({
    method: 'GET',
    url: '/calls?state=CLOSED&view=list',
  });
  const row = article(closedList.body, description);
  assert.match(row, /<span class="chip">היה חירום<\/span>/);
  assert.doesNotMatch(row, /<span class="chip">חירום<\/span>/);
  assert.match(row, new RegExp(`data-emergency="${stored}"`));

  const split = await client.inject({
    method: 'GET',
    url: `/calls?state=CLOSED&call=${id}`,
  });
  const listed = splitCall(split.body, id);
  assert.match(listed, /<span class="chip">היה חירום<\/span>/);
  assert.doesNotMatch(listed, /<span class="chip">חירום<\/span>/);
  assert.match(listed, new RegExp(`data-emergency="${stored}"`));
  const preview = region(split.body, `data-preview="${id}"`, '</section>');
  assert.match(preview, /<span class="chip">היה חירום<\/span>/);
  assert.doesNotMatch(preview, /<span class="chip">חירום<\/span>/);

  const page = await client.inject({ method: 'GET', url: `/calls/${id}` });
  const head = region(page.body, '<header class="page-head"', '</header>');
  assert.match(head, /<span class="chip">היה חירום<\/span>/);
  assert.doesNotMatch(head, /<span class="chip">חירום<\/span>/);
  assert.match(page.body, new RegExp(`data-emergency="${stored}"`));
}

function layoutOf(html: string, name: 'split' | 'list'): string {
  const start = html.indexOf(`data-layout="${name}"`);
  assert.ok(start >= 0, name);
  const next =
    name === 'list'
      ? html.indexOf('data-layout="split"', start)
      : html.indexOf('<dialog', start);
  return html.slice(start, next > start ? next : html.length);
}

function previewId(html: string): string {
  const found = html.match(/data-preview="([0-9a-f-]{36})"/);
  assert.ok(found?.[1]);
  return found[1];
}

function firstSplitId(html: string): string {
  const found = html.match(/data-split-call="([0-9a-f-]{36})"/);
  assert.ok(found?.[1]);
  return found[1];
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

// The badge and the list are two reads, and other files open, flag and close calls on this database
// while this one runs. Pages read while the open book held still are pages whose counts must agree;
// a set that straddled another file's write is read again. The open book is every column of every
// open call, not only how many there are: a flag set elsewhere moves the emergency count and leaves
// the total where it was.
type Page = Awaited<ReturnType<ReturnType<typeof asOperator>['inject']>>;

async function quietPages(
  pool: import('pg').Pool,
  client: ReturnType<typeof asOperator>,
  urls: readonly string[],
): Promise<Page[]> {
  const openBook = async (): Promise<string> => {
    const { rows } = await pool.query<{ book: string | null }>(
      `SELECT md5(string_agg(c::text, ',' ORDER BY c.service_call_id)) AS book
         FROM service_call c
        WHERE state <> 'CLOSED' AND returned_at IS NULL`,
    );
    return rows[0]?.book ?? '';
  };
  for (let attempt = 1; ; attempt += 1) {
    const before = await openBook();
    const pages: Page[] = [];
    for (const url of urls) {
      pages.push(await client.inject({ method: 'GET', url }));
    }
    if ((await openBook()) === before || attempt === 20) return pages;
  }
}

async function quietCallsPage(
  pool: import('pg').Pool,
  client: ReturnType<typeof asOperator>,
): Promise<Page> {
  const [page] = await quietPages(pool, client, ['/calls']);
  assert.ok(page);
  return page;
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

  it('opens a log dialog on the filtered list and keeps a refused name', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    const clock = fixedClock(AT);
    const app = buildApp({ pool, version: '9.9.9-test', clock });
    const domain = 'calls-routes-dialog.test';
    await cleanup(pool, domain);
    const who = await signIn(pool, clock, { email: `ops@${domain}` });
    const client = asOperator(app, who);
    try {
      const opened = await client.inject({
        method: 'GET',
        url: '/calls?emergency=1&goal=late&log=1',
      });
      assert.equal(opened.statusCode, 200);
      assert.doesNotMatch(opened.body, /<script/);
      assert.doesNotMatch(opened.body, /\binert\b/);
      const box = dialogOf(opened.body);
      assert.match(box, /<dialog\b[^>]*\bopen\b/);
      assert.doesNotMatch(box, /aria-modal="true"/);
      assert.match(box, /value="PHONE"/);
      assert.match(box, /value="WALK_IN"/);
      assert.doesNotMatch(box, /value="EMAIL"|value="WHATSAPP"/);
      assert.match(box, /נרשם/);
      assert.match(box, /שם ידוע/);
      assert.match(box, /לא ידוע/);
      assert.match(box, /placeholder="שם"/);
      assert.match(box, /את הפונה אפשר לזהות אחר כך מעמוד הקריאה/);
      assert.match(
        box,
        /<form method="post" action="\/calls\?emergency=1&amp;goal=late&amp;log=1">/,
      );
      const cancel = box.match(/<a\b[^>]*>ביטול<\/a>/);
      assert.ok(cancel);
      assert.match(cancel[0], /href="\/calls\?emergency=1&amp;goal=late"/);
      assert.doesNotMatch(cancel[0], /log=1/);
      const outside = opened.body.replace(box, '');
      assert.match(outside, /<h1>קריאות<\/h1>/);
      assert.match(outside, /אין קריאות תואמות|data-call=/);

      const refused = await client.inject({
        method: 'POST',
        url: '/calls?emergency=1&goal=late&log=1',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: form({
          channel: 'WALK_IN',
          description: 'נזילה שנשמרה',
          sender: 'named',
          sender_name: '   ',
        }),
      });
      assert.equal(refused.statusCode, 400);
      const kept = dialogOf(refused.body);
      assert.match(kept, /<dialog\b[^>]*\bopen\b/);
      assert.match(kept, /יש לציין את הפונה, או לסמן שלא ידוע/);
      assert.match(kept, /נזילה שנשמרה/);
      assert.match(
        kept,
        /value="WALK_IN"[^>]*\bchecked\b|\bchecked\b[^>]*value="WALK_IN"/,
      );
      assert.match(
        kept,
        /value="named"[^>]*\bchecked\b|\bchecked\b[^>]*value="named"/,
      );
      assert.match(kept, /value=" {3}"/);
      const refusedCancel = kept.match(/<a\b[^>]*>ביטול<\/a>/);
      assert.ok(refusedCancel);
      assert.match(
        refusedCancel[0],
        /href="\/calls\?emergency=1&amp;goal=late"/,
      );
      assert.doesNotMatch(refusedCancel[0], /log=1/);

      const list = await client.inject({ method: 'GET', url: '/calls' });
      assert.equal(list.statusCode, 200);
      assert.doesNotMatch(list.body, /<dialog/);
      assert.match(
        list.body,
        /<a\b[^>]*href="\/calls\?log=1"[^>]*>רישום קריאה<\/a>/,
      );
      assert.doesNotMatch(list.body, /נזילה שנשמרה/);
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
      const plumbing =
        afterId.body.match(
          /name="category_id" value="([0-9a-f-]{36})" \/> אינסטלציה/,
        )?.[1] ??
        afterId.body.match(
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
      const answered = region(page.body, 'data-exit="ANSWERED"', '</details>');
      const forwarded = region(
        page.body,
        'data-exit="FORWARDED"',
        '</details>',
      );
      const duplicate = region(
        page.body,
        'data-exit="DUPLICATE"',
        '</details>',
      );
      const cancelled = region(
        page.body,
        'data-exit="CANCELLED"',
        '</details>',
      );
      assert.match(answered, /סגירה — נענתה/);
      assert.match(answered, /הסגירה סופית/);
      assert.match(answered, /הודעה חדשה פותחת קריאה חדשה/);
      assert.match(answered, /name="note"/);
      assert.doesNotMatch(answered, /name="department"|name="dup"/);
      assert.match(forwarded, /סגירה — הועברה/);
      assert.match(forwarded, /name="note"/);
      assert.match(forwarded, /name="department"/);
      assert.doesNotMatch(forwarded, /name="dup"/);
      assert.match(duplicate, /סגירה — כפולה/);
      assert.match(duplicate, /name="dup"/);
      assert.doesNotMatch(duplicate, /name="note"|name="department"/);
      assert.match(cancelled, /סגירה — בוטלה/);
      assert.match(cancelled, /name="note"/);
      assert.doesNotMatch(cancelled, /name="department"|name="dup"/);
      assert.doesNotMatch(page.body, /data-exit="[^"]*" open/);

      const refused = await client.inject({
        method: 'POST',
        url: `/calls/${questionId}/exit`,
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: form({ exit: 'ANSWERED', note: '   ' }),
      });
      assert.equal(refused.statusCode, 400);
      assert.match(refused.body, /יש לכתוב סיבה/);
      assert.match(refused.body, /data-call-state="NEW"/);
      const kept = region(refused.body, 'data-exit="ANSWERED"', '</details>');
      assert.match(kept, /data-exit="ANSWERED" open/);
      assert.match(kept, /<textarea[^>]*name="note"[^>]*> {3}<\/textarea>/);
      assert.doesNotMatch(
        region(refused.body, 'data-exit="FORWARDED"', '</details>'),
        / open/,
      );

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
      assert.doesNotMatch(closedPage.body, /class="steps"/);
      assert.match(closedPage.body, /נענתה/);
      assert.match(closedPage.body, /עניתי בטלפון/);
      assert.match(closedPage.body, /ops@calls-routes-exit\.test/);
      assert.doesNotMatch(closedPage.body, /name="exit"/);
      assert.doesNotMatch(closedPage.body, /לא שומר איש קשר/);
      assert.doesNotMatch(closedPage.body, /\/emergency|החזרה למסוננות/);
      assert.match(closedPage.body, /אין פעולות/);

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
      const flaggedHead = region(
        page.body,
        '<header class="page-head"',
        '</header>',
      );
      assert.match(flaggedHead, /הסרת סימון חירום/);
      assert.match(flaggedHead, /\/emergency/);
      assert.doesNotMatch(page.body, /<h2>חירום<\/h2>/);
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
      assert.match(
        article(list.body, emergencyFresh),
        /<span class="chip">חירום<\/span>/,
      );
      assert.doesNotMatch(article(list.body, emergencyFresh), /היה חירום/);
      assert.doesNotMatch(
        article(list.body, fresh),
        /<span class="chip">חירום<\/span>|היה חירום/,
      );
      const oldId = listedId(list.body, emergencyOld);
      assert.match(
        splitCall(list.body, oldId),
        /<span class="chip">חירום<\/span>/,
      );
      assert.doesNotMatch(splitCall(list.body, oldId), /היה חירום/);
      const focused = await client.inject({
        method: 'GET',
        url: `/calls?call=${oldId}`,
      });
      const openPreview = region(
        focused.body,
        `data-preview="${oldId}"`,
        '</section>',
      );
      assert.match(openPreview, /<span class="chip">חירום<\/span>/);
      assert.doesNotMatch(openPreview, /היה חירום/);
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

      const [book, emergencies] = await quietPages(pool, client, [
        '/calls',
        '/calls?emergency=1',
      ]);
      assert.ok(book && emergencies);
      const openTotal = railCount(emergencies.body);
      assert.equal(labeledCount(emergencies.body, 'פתוחות'), openTotal);
      assert.equal(labeledCount(book.body, 'פתוחות'), railCount(book.body));
      for (const label of ['חירום', 'לא בזמן', 'לבדיקה'] as const) {
        assert.equal(
          labeledCount(emergencies.body, label),
          labeledCount(book.body, label),
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
        labeledCount(book.body, 'קרוב ליעד'),
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

  it('shows where an open call is, and a filed attachment in ordinary units', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    const domain = 'where-219.test';
    const sender = `tenant@${domain}`;
    const original = 'На кухне течёт кран';
    const translation = 'הברז במטבח מטפטף';
    const echo = 'חזרנו אליך';
    const description = 'נזילה במטבח';
    const bytes = Buffer.alloc(247808);
    Buffer.from('%PDF-1.4\n').copy(bytes);
    try {
      await inRolledBackTransaction(pool, async (db) => {
        const clock = fixedClock(AT);
        const objects = createMemoryStore();
        const app = buildApp({
          pool: db as unknown as Pool,
          version: '9.9.9-test',
          clock,
          objects,
          bucket: 'dona-v5-test-where-219',
          pdf: createFakePdfText([]),
        });
        await seedOccupancy(db, '2191', {
          phone: '+972502191191',
          email: sender,
          contactFrom: '2026-01-01',
          contactTo: null,
          tenancyFrom: '2026-01-01',
          tenancyTo: '2027-01-01',
        });
        await upsertDocumentType(db, {
          typeKey: 'paper_219',
          labelHe: 'מסמך מקריאה',
          labelEn: null,
          verificationTerms: null,
          isActive: true,
        });
        const who = await signIn(db as unknown as Pool, clock, {
          email: `ops@${domain}`,
          role: 'OPERATOR',
        });
        const client = asOperator(app, who);
        const verdict: SortVerdict = {
          label: 'call',
          categoryCode: null,
          summary: description,
        };
        const door = (bodyHe: string | null) => ({
          sorter: {
            async sort() {
              return verdict;
            },
            async translate() {
              return { bodyHe };
            },
          },
          matchesEmergency: async () => false,
          objects,
        });
        const arrived = await receiveIncoming(
          db,
          clock,
          door(translation),
          message(domain, {
            body: original,
            attachments: [
              {
                fileName: 'lease.pdf',
                contentType: 'application/pdf',
                byteSize: bytes.length,
                bytes,
              },
            ],
          }),
        );
        assert.equal(arrived.kind, 'call');
        if (arrived.kind !== 'call') return;
        clock.advance(60_000);
        const echoed = await receiveIncoming(
          db,
          clock,
          door(null),
          message(domain, {
            externalMessageId: 'echo',
            body: echo,
            echo: true,
            receivedAt: clock.now(),
          }),
        );
        assert.equal(echoed.kind, 'echo');

        const page = await client.inject({
          method: 'GET',
          url: `/calls/${arrived.callId}`,
        });
        assert.equal(page.statusCode, 200);
        assert.doesNotMatch(page.body, /<script/);
        assert.match(page.body, /data-call-state="IDENTIFIED"/);

        const head = region(
          page.body,
          '<header class="page-head"',
          '</header>',
        );
        assert.match(head, new RegExp(`<h1>${description}</h1>`));
        assert.match(head, /דוא״ל/);
        assert.match(head, /דקה · בזמן/);
        assert.doesNotMatch(head, /<span class="chip">חירום<\/span>/);

        const strip = region(page.body, '<ol class="steps"', '</ol>');
        assert.match(strip, /aria-label="מצב הקריאה"/);
        const labels = [...strip.matchAll(/<li([^>]*)>([^<]+)<\/li>/g)].map(
          (match) => ({ attrs: match[1] ?? '', label: match[2] }),
        );
        assert.deepEqual(
          labels.map((step) => step.label),
          [
            'חדשה',
            'זוהתה',
            'מוינה',
            'אחריות נקבעה',
            'חלונות נאספו',
            'הוצעה',
            'נקבעה',
            'סגורה',
          ],
        );
        assert.match(labels[0]?.attrs ?? '', /is-done/);
        assert.match(labels[1]?.attrs ?? '', /aria-current="step"/);
        assert.doesNotMatch(labels[2]?.attrs ?? '', /is-done|aria-current/);
        assert.doesNotMatch(strip, /<a\b|<button\b/);

        const thread = region(page.body, '<ol class="timeline"', '</ol>');
        const kinds = [
          ...thread.matchAll(
            /data-kind="([A-Z]+)"(?: data-echo="(true|false)")?/g,
          ),
        ].map((match) =>
          match[1] === 'MESSAGE' ? `MESSAGE:${match[2]}` : match[1],
        );
        assert.deepEqual(kinds, [
          'MESSAGE:false',
          'OPENED',
          'IDENTIFIED',
          'MESSAGE:true',
        ]);
        const translated = thread.match(/data-translation="yes"[^>]*>([^<]*)</);
        assert.equal(translated?.[1], `תרגום: ${translation}`);
        const inbound = [
          ...thread.matchAll(/<p class="message">([\s\S]*?)<\/p>/g),
        ].find((match) => match[1]?.includes(original));
        assert.ok(inbound);
        assert.doesNotMatch(inbound[1] ?? '', new RegExp(translation));
        assert.match(thread, new RegExp(echo));

        assert.match(
          page.body,
          new RegExp(`<dt>נרשם</dt><dd><span dir="ltr">${sender}</span></dd>`),
        );
        assert.match(
          page.body,
          /<dt>פונה<\/dt><dd><a href="\/parties\/[0-9a-f-]{36}">Tenant of 2191<\/a><\/dd>/,
        );
        assert.match(page.body, /<p class="back"><a href="\/calls">/);
        assert.match(page.body, /name="category_id"/);

        const file = region(page.body, '<div class="file"', '</div>');
        assert.match(file, /data-size="247808"/);
        assert.match(file, /242 KB/);
        assert.match(file, /תייק כמסמך/);
        const open = file.match(/href="(\/calls\/[^"]+\/files\/0)"/);
        assert.ok(open?.[1]);
        const opened = await client.inject({ method: 'GET', url: open[1] });
        assert.equal(opened.statusCode, 200);
        assert.equal(opened.headers['content-type'], 'application/pdf');

        const filing = page.body.match(
          /<form method="post" action="(\/calls\/[^"]+\/files\/0)">/,
        );
        assert.ok(filing?.[1]);
        const posted = await client.inject({
          method: 'POST',
          url: filing[1],
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          payload: form({ type_key: 'paper_219' }),
        });
        assert.equal(posted.statusCode, 303);
        const afterFile = await client.inject({
          method: 'GET',
          url: `/calls/${arrived.callId}`,
        });
        const filed = region(afterFile.body, '<div class="file"', '</div>');
        assert.match(filed, /תויק/);
        assert.match(filed, /data-document="[0-9a-f-]{36}"/);
        assert.match(filed, /href="\/documents\/[0-9a-f-]{36}\/read"/);
        assert.doesNotMatch(filed, /לא מתוייק/);
        assert.match(filed, /242 KB/);

        const flagged = await client.inject({
          method: 'POST',
          url: `/calls/${arrived.callId}/emergency`,
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          payload: form({ action: 'flag' }),
        });
        assert.equal(flagged.statusCode, 303);
        const urgent = await client.inject({
          method: 'GET',
          url: `/calls/${arrived.callId}`,
        });
        assert.match(
          region(urgent.body, '<header class="page-head"', '</header>'),
          /חירום/,
        );
        assert.match(urgent.body, /data-emergency="true"/);
        await app.close();
      });
    } finally {
      await pool.end();
    }
  });

  it('works an open call from the aside', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    const domain = 'aside-220.test';
    const held = `held@${domain}`;
    try {
      await inRolledBackTransaction(pool, async (db) => {
        const clock = fixedClock(AT);
        const app = buildApp({
          pool: db as unknown as Pool,
          version: '9.9.9-test',
          clock,
        });
        const who = await signIn(db as unknown as Pool, clock, {
          email: `ops@${domain}`,
          role: 'OPERATOR',
        });
        const client = asOperator(app, who);
        await db.query(
          `UPDATE call_category
              SET is_active = false
            WHERE is_active
              AND code NOT IN (
                'PLUMBING', 'ELECTRICAL', 'AIR_CONDITIONING',
                'LOCKS', 'GATES', 'ADMINISTRATIVE'
              )`,
        );
        const party = await createParty(db, {
          kind: 'PERSON',
          givenName: 'יעל',
          familyName: 'מזוהה',
          preferredLanguage: 'he',
        });
        await upsertPartyContact(db, {
          partyId: party.id,
          channel: 'EMAIL',
          value: held,
          isPrimary: true,
          validFrom: '2026-01-01',
          validTo: null,
          verifiedAt: null,
        });
        const phone = await client.inject({
          method: 'POST',
          url: '/calls',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          payload: form({
            channel: 'PHONE',
            description: 'טלפון מהדלפק',
            sender: 'unknown',
          }),
        });
        assert.equal(phone.statusCode, 303);
        const listed = await client.inject({ method: 'GET', url: '/calls' });
        const phoneId = callId(listed.body, 'טלפון מהדלפק');
        assert.ok(phoneId);
        const desk = await client.inject({
          method: 'GET',
          url: `/calls/${phoneId}`,
        });
        const head = region(
          desk.body,
          '<header class="page-head"',
          '</header>',
        );
        assert.match(head, new RegExp(`/calls/${phoneId}/emergency`));
        assert.match(head, /סימון חירום/);
        assert.match(head, new RegExp(`/calls/${phoneId}/return`));
        assert.match(head, /החזרה למסוננות/);
        const aside = region(
          desk.body,
          '<aside class="call-aside ',
          '</aside>',
        );
        assert.match(aside, /זיהוי הפונה/);
        assert.match(aside, /מקשר את הקריאה הזו בלבד/);
        assert.match(aside, /name="exit"/);
        assert.doesNotMatch(aside, /\/emergency|\/return|שמירת איש קשר/);
        assert.doesNotMatch(desk.body, /<h2>חירום<\/h2>|<h2>לא קריאה<\/h2>/);
        assert.doesNotMatch(
          desk.body,
          /<section class="glass sheet">[\s\S]*זיהוי הפונה/,
        );

        const found = await client.inject({
          method: 'GET',
          url: `/calls/${phoneId}?q=${encodeURIComponent('יעל מזוהה')}`,
        });
        const choices = region(
          found.body,
          '<fieldset class="choice"',
          '</fieldset>',
        );
        assert.match(choices, /יעל מזוהה/);
        assert.doesNotMatch(choices, new RegExp(held));
        assert.doesNotMatch(choices, /דייר|שוכר|ערב|@/);

        const arrived = await receiveIncoming(
          db,
          clock,
          {
            sorter: {
              async sort() {
                return {
                  label: 'call' as const,
                  categoryCode: null,
                  summary: 'הדלת חורקת',
                };
              },
              async translate() {
                return { bodyHe: null };
              },
            },
            matchesEmergency: async () => false,
          },
          message(domain, {
            senderAddress: `stranger@${domain}`,
            body: 'הדלת חורקת',
            externalMessageId: 'door',
          }),
        );
        assert.equal(arrived.kind, 'call');
        if (arrived.kind !== 'call') return;
        const mail = await client.inject({
          method: 'GET',
          url: `/calls/${arrived.callId}`,
        });
        assert.match(mail.body, /data-call-state="NEW"/);
        assert.doesNotMatch(mail.body, /שמירת איש קשר/);
        const identified = await client.inject({
          method: 'POST',
          url: `/calls/${arrived.callId}/identify`,
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          payload: form({ party_id: party.id }),
        });
        assert.equal(identified.statusCode, 303);
        const named = await client.inject({
          method: 'GET',
          url: `/calls/${arrived.callId}`,
        });
        const work = region(
          named.body,
          '<aside class="call-aside ',
          '</aside>',
        );
        assert.match(work, /שמירת איש קשר/);
        assert.match(work, /type="radio"[^>]*name="category_id"/);
        assert.doesNotMatch(work, /<select name="category_id"/);
        assert.match(
          named.body,
          new RegExp(
            `<dt>פונה</dt><dd><a href="/parties/${party.id}">יעל מזוהה</a></dd>`,
          ),
        );
        const viewer = asOperator(
          app,
          await signIn(db as unknown as Pool, clock, {
            email: `view@${domain}`,
            role: 'VIEWER',
          }),
        );
        const withheld = await viewer.inject({
          method: 'GET',
          url: `/calls/${arrived.callId}`,
        });
        assert.match(withheld.body, /<dt>פונה<\/dt><dd>יעל מזוהה<\/dd>/);
        assert.doesNotMatch(withheld.body, /href="\/parties\//);
        const saved = await client.inject({
          method: 'POST',
          url: `/calls/${arrived.callId}/contact`,
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          payload: form({}),
        });
        assert.equal(saved.statusCode, 303);

        await db.query(
          `INSERT INTO call_category (category_id, code, label_he, label_en, is_active)
           VALUES ('a2200007-0000-4000-8000-000000000007', 'PAINT', 'צבע', 'Paint', true)
           ON CONFLICT (code) DO UPDATE
             SET is_active = true, label_he = EXCLUDED.label_he`,
        );
        const long = await client.inject({
          method: 'GET',
          url: `/calls/${arrived.callId}`,
        });
        const longAside = region(
          long.body,
          '<aside class="call-aside ',
          '</aside>',
        );
        assert.match(longAside, /<select name="category_id"/);
        assert.match(
          longAside,
          /<option value="[0-9a-f-]{36}"[^>]*>צבע<\/option>/,
        );
        assert.doesNotMatch(longAside, /type="radio"[^>]*name="category_id"/);

        const plumbing = named.body.match(
          /name="category_id" value="([0-9a-f-]{36})" \/> אינסטלציה/,
        )?.[1];
        assert.ok(plumbing);
        const triaged = await client.inject({
          method: 'POST',
          url: `/calls/${arrived.callId}/category`,
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          payload: form({ category_id: plumbing }),
        });
        assert.equal(triaged.statusCode, 303);
        await db.query(
          `UPDATE service_call SET state = 'RESPONSIBILITY_SET' WHERE service_call_id = $1`,
          [arrived.callId],
        );
        const later = await client.inject({
          method: 'GET',
          url: `/calls/${arrived.callId}`,
        });
        assert.match(later.body, /data-call-state="RESPONSIBILITY_SET"/);
        const laterAside = region(
          later.body,
          '<aside class="call-aside ',
          '</aside>',
        );
        assert.doesNotMatch(
          laterAside,
          /name="category_id"|name="q"|זיהוי הפונה/,
        );
        assert.match(laterAside, /name="exit"/);
        assert.match(laterAside, /שמירת איש קשר/);

        const forwarded = await client.inject({
          method: 'POST',
          url: `/calls/${phoneId}/exit`,
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          payload: form({ exit: 'FORWARDED', department: 'כספים' }),
        });
        assert.equal(forwarded.statusCode, 400);
        const keptForward = region(
          forwarded.body,
          'data-exit="FORWARDED"',
          '</details>',
        );
        assert.match(keptForward, /data-exit="FORWARDED" open/);
        assert.match(keptForward, /value="כספים"/);
        const sent = await client.inject({
          method: 'POST',
          url: `/calls/${phoneId}/exit`,
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          payload: form({
            exit: 'FORWARDED',
            note: 'אין זה אצלנו',
            department: 'כספים',
          }),
        });
        assert.equal(sent.statusCode, 303);

        const cancel = await client.inject({
          method: 'POST',
          url: '/calls',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          payload: form({
            channel: 'WALK_IN',
            description: 'ביטול מהדלפק',
            sender: 'unknown',
          }),
        });
        assert.equal(cancel.statusCode, 303);
        const afterCancelLog = await client.inject({
          method: 'GET',
          url: '/calls',
        });
        const cancelId = callId(afterCancelLog.body, 'ביטול מהדלפק');
        assert.ok(cancelId);
        const sentBack = await client.inject({
          method: 'POST',
          url: `/calls/${cancelId}/return`,
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          payload: form({}),
        });
        assert.equal(sentBack.statusCode, 303);
        const parked = await client.inject({
          method: 'GET',
          url: `/calls/${cancelId}`,
        });
        const parkedAside = region(
          parked.body,
          '<aside class="call-aside ',
          '</aside>',
        );
        assert.match(parkedAside, /זיהוי הפונה/);
        assert.match(parkedAside, /הצלה/);
        assert.doesNotMatch(parkedAside, /name="exit"/);
        const restored = await client.inject({
          method: 'POST',
          url: '/calls/filtered',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          payload: form({ call_id: cancelId }),
        });
        assert.equal(restored.statusCode, 303);
        const cancelled = await client.inject({
          method: 'POST',
          url: `/calls/${cancelId}/exit`,
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          payload: form({ exit: 'CANCELLED', note: 'הפונה ביטל' }),
        });
        assert.equal(cancelled.statusCode, 303);
        const closedCancel = await client.inject({
          method: 'GET',
          url: `/calls/${cancelId}`,
        });
        assert.match(closedCancel.body, /בוטלה/);
        assert.match(closedCancel.body, /הפונה ביטל/);
        assert.doesNotMatch(closedCancel.body, /\/emergency|החזרה למסוננות/);

        const back = await client.inject({
          method: 'POST',
          url: `/calls/${arrived.callId}/return`,
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          payload: form({}),
        });
        assert.equal(back.statusCode, 303);
        assert.equal(back.headers.location, '/calls/filtered');
        const returned = await client.inject({
          method: 'GET',
          url: `/calls/${arrived.callId}`,
        });
        const returnedHead = region(
          returned.body,
          '<header class="page-head"',
          '</header>',
        );
        assert.doesNotMatch(returnedHead, /החזרה למסוננות/);
        assert.match(returnedHead, /\/emergency/);
        const rescue = region(
          returned.body,
          '<aside class="call-aside ',
          '</aside>',
        );
        assert.match(rescue, /הצלה/);
        assert.match(
          rescue,
          new RegExp(`name="call_id" value="${arrived.callId}"`),
        );
        assert.doesNotMatch(
          rescue,
          /name="exit"|name="category_id"|זיהוי הפונה|שמירת איש קשר/,
        );
        await app.close();
      });
    } finally {
      await pool.end();
    }
  });

  it('narrows the filtered list by origin and rescues either one', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    const domain = 'filtered-origin.test';
    const clock = fixedClock(AT);
    const app = buildApp({ pool, version: '9.9.9-test', clock });
    await cleanupIntake(pool, domain);
    const who = await signIn(pool, clock, {
      email: `ops@${domain}`,
      role: 'OPERATOR',
    });
    const client = asOperator(app, who);
    const arrived = '6 באוק\u05F3, 15:00';
    const returnedAt = '6 באוק\u05F3, 15:30';
    const rescueWords = 'הצלה — זו קריאה';
    try {
      const noise = await receiveIncoming(
        pool,
        clock,
        {
          sorter: {
            async sort() {
              return { label: 'noise', categoryCode: null, summary: null };
            },
            async translate() {
              return { bodyHe: null };
            },
          },
          matchesEmergency: async () => false,
        },
        message(domain, {
          externalMessageId: 'leaflet',
          externalThreadId: 'leaflet',
          subject: 'עלון החנות',
          body: 'ניוזלטר',
        }),
      );
      assert.equal(noise.kind, 'filtered');
      const drip = await receiveIncoming(
        pool,
        clock,
        {
          sorter: {
            async sort() {
              return {
                label: 'call',
                categoryCode: 'PLUMBING',
                summary: 'ברז מטפטף',
              };
            },
            async translate() {
              return { bodyHe: null };
            },
          },
          matchesEmergency: async () => false,
        },
        message(domain, {
          sourceChannel: 'WHATSAPP',
          externalMessageId: 'drip',
          externalThreadId: 'drip',
          body: 'ברז מטפטף',
        }),
      );
      assert.equal(drip.kind, 'call');
      const open = await client.inject({ method: 'GET', url: '/calls' });
      const dripId = callId(open.body, 'ברז מטפטף');
      assert.ok(dripId);
      clock.advance(HALF_HOUR);
      const sentBack = await client.inject({
        method: 'POST',
        url: `/calls/${dripId}/return`,
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: form({}),
      });
      assert.equal(sentBack.statusCode, 303);

      const all = await client.inject({
        method: 'GET',
        url: '/calls/filtered',
      });
      assert.equal(all.statusCode, 200);
      assert.doesNotMatch(all.body, /<script/);
      const noiseRow = filteredArticle(all.body, 'עלון החנות');
      const officeRow = filteredArticle(all.body, 'ברז מטפטף');
      assert.match(noiseRow, /data-filtered="message"/);
      assert.match(noiseRow, /data-sorter="noise"/);
      assert.match(noiseRow, /מסווג: רעש/);
      assert.match(noiseRow, /דוא\u05F4ל/);
      assert.match(noiseRow, new RegExp(arrived));
      assert.match(noiseRow, new RegExp(rescueWords));
      assert.match(officeRow, /data-filtered="call"/);
      assert.match(officeRow, /data-sorter="call"/);
      assert.match(officeRow, /מסווג: קריאה/);
      assert.match(officeRow, /data-office="returned"/);
      assert.match(officeRow, /משרד: הוחזר/);
      assert.match(officeRow, /וואטסאפ/);
      assert.match(officeRow, new RegExp(returnedAt));
      assert.match(officeRow, new RegExp(`href="/calls/${dripId}"`));
      assert.match(officeRow, new RegExp(rescueWords));
      assertCountsMatchRows(all.body);
      const sorterTotal = originCount(all.body, 'המסווג');
      const officeTotal = originCount(all.body, 'המשרד');

      const sorter = await client.inject({
        method: 'GET',
        url: '/calls/filtered?origin=sorter',
      });
      assert.match(sorter.body, /עלון החנות/);
      assert.doesNotMatch(sorter.body, /ברז מטפטף/);
      assert.doesNotMatch(sorter.body, /data-filtered="call"/);
      assert.equal(originCount(sorter.body, 'המסווג'), sorterTotal);
      assert.equal(originCount(sorter.body, 'המשרד'), officeTotal);
      assert.ok(originCount(sorter.body, 'המשרד') >= 1);
      assert.match(
        sorter.body,
        /href="\/calls\/filtered\?origin=sorter" aria-current="true"/,
      );

      const office = await client.inject({
        method: 'GET',
        url: '/calls/filtered?origin=office',
      });
      assert.match(office.body, /ברז מטפטף/);
      assert.doesNotMatch(office.body, /עלון החנות/);
      assert.doesNotMatch(office.body, /data-filtered="message"/);
      assert.equal(originCount(office.body, 'המסווג'), sorterTotal);
      assert.equal(originCount(office.body, 'המשרד'), officeTotal);
      assert.match(
        office.body,
        /href="\/calls\/filtered\?origin=office" aria-current="true"/,
      );

      const unknown = await client.inject({
        method: 'GET',
        url: '/calls/filtered?origin=nope',
      });
      assert.match(unknown.body, /עלון החנות/);
      assert.match(unknown.body, /ברז מטפטף/);

      const parked = await client.inject({
        method: 'GET',
        url: `/calls/${dripId}`,
      });
      const parkedAside = region(
        parked.body,
        '<aside class="call-aside ',
        '</aside>',
      );
      assert.match(parkedAside, new RegExp(rescueWords));

      const restored = await client.inject({
        method: 'POST',
        url: '/calls/filtered',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: form({ call_id: dripId }),
      });
      assert.equal(restored.statusCode, 303);
      assert.equal(restored.headers.location, `/calls/${dripId}`);
      const back = await client.inject({ method: 'GET', url: '/calls' });
      assert.match(back.body, /ברז מטפטף/);
      const afterCall = await client.inject({
        method: 'GET',
        url: '/calls/filtered?origin=office',
      });
      assert.doesNotMatch(afterCall.body, /ברז מטפטף/);

      const leafletId = noise.kind === 'filtered' ? noise.messageId : '';
      const rescued = await client.inject({
        method: 'POST',
        url: '/calls/filtered',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: form({ message_id: leafletId }),
      });
      assert.equal(rescued.statusCode, 303);
      assert.match(
        String(rescued.headers.location),
        /^\/calls\/[0-9a-f-]{36}$/,
      );
      const openAgain = await client.inject({ method: 'GET', url: '/calls' });
      assert.match(openAgain.body, /עלון החנות/);
      const afterNoise = await client.inject({
        method: 'GET',
        url: '/calls/filtered?origin=sorter',
      });
      assert.doesNotMatch(afterNoise.body, /עלון החנות/);
    } finally {
      await cleanupIntake(pool, domain);
      await app.close();
      await pool.end();
    }
  });

  it('opens the split inbox, and the list view only when asked', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    const clock = fixedClock(AT);
    const app = buildApp({ pool, version: '9.9.9-test', clock });
    const domain = 'calls-routes-split.test';
    await cleanup(pool, domain);
    const who = await signIn(pool, clock, {
      email: `ops@${domain}`,
      role: 'OPERATOR',
    });
    const client = asOperator(app, who);
    const party = await createParty(pool, {
      kind: 'PERSON',
      givenName: 'יעל',
      familyName: 'בתצוגה',
      preferredLanguage: 'he',
    });
    const desk = 'קריאה לדלפק';
    const named = 'קריאה לפונה';
    try {
      for (const description of [desk, named]) {
        const opened = await client.inject({
          method: 'POST',
          url: '/calls',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          payload: form({
            channel: 'PHONE',
            description,
            sender: 'unknown',
          }),
        });
        assert.equal(opened.statusCode, 303);
      }
      const first = await quietCallsPage(pool, client);
      const deskId = listedId(first.body, desk);
      const namedId = listedId(first.body, named);

      const page = await client.inject({ method: 'GET', url: '/calls' });
      assert.equal(page.statusCode, 200);
      assert.doesNotMatch(
        page.body,
        /<script|type="search"|name="q"|name="search"/,
      );
      assert.match(page.body, /data-layout="list"/);
      assert.match(page.body, /data-layout="split"/);
      const listed = page.body.match(/data-call="/g)?.length ?? 0;
      const splitRows = page.body.match(/data-split-call="/g)?.length ?? 0;
      assert.ok(listed >= 2);
      assert.equal(splitRows, listed);
      const splitPane = layoutOf(page.body, 'split');
      const splitSummary = splitPane.match(
        /data-split-summary>([\s\S]*?)<\/p>/,
      );
      assert.ok(splitSummary?.[1]);
      assert.match(splitSummary[1], /פתוחות/);
      assert.match(splitSummary[1], /חירום/);
      assert.match(splitSummary[1], /מעבר ליעד/);
      assert.doesNotMatch(splitSummary[1], /לא בזמן|לבדיקה/);
      assert.doesNotMatch(splitPane, /טלפון או הגעה|stat-row/);
      assert.match(splitPane, /href="\/calls\?view=list"/);
      const listPane = layoutOf(page.body, 'list');
      assert.match(listPane, /טלפון או הגעה/);
      assert.match(listPane, /stat-row/);
      assert.match(listPane, /דורש טיפול עכשיו|data-call=/);

      const list = await client.inject({
        method: 'GET',
        url: `/calls?view=list&call=${namedId}`,
      });
      assert.match(list.body, /data-layout="list"/);
      assert.doesNotMatch(
        list.body,
        /data-layout="split"|data-split-call=|data-preview=/,
      );
      assert.match(list.body, /data-call="/);
      assert.match(list.body, /טלפון או הגעה/);
      assert.match(list.body, /href="\/calls"/);

      const chosen = await client.inject({
        method: 'GET',
        url: `/calls?state=NEW&call=${namedId}`,
      });
      assert.match(chosen.body, new RegExp(`data-preview="${namedId}"`));
      assert.match(chosen.body, /name="state" value="NEW"/);
      assert.match(
        chosen.body,
        new RegExp(`href="/calls\\?state=NEW&amp;call=${namedId}"`),
      );
      const preview = region(
        chosen.body,
        `data-preview="${namedId}"`,
        '</section>',
      );
      assert.match(preview, /data-requester>טרם זוהה</);
      assert.match(preview, /data-next-step/);
      assert.match(preview, new RegExp(`href="/calls/${namedId}"`));
      assert.match(preview, new RegExp(`data-excerpt>${named}</`));

      const identified = await client.inject({
        method: 'POST',
        url: `/calls/${namedId}/identify`,
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: form({ party_id: party.id }),
      });
      assert.equal(identified.statusCode, 303);
      const withName = await client.inject({
        method: 'GET',
        url: `/calls?call=${namedId}`,
      });
      const namedPreview = region(
        withName.body,
        `data-preview="${namedId}"`,
        '</section>',
      );
      assert.match(namedPreview, /data-requester>יעל בתצוגה</);
      assert.doesNotMatch(namedPreview, /href="\/parties\//);
      assert.match(namedPreview, /data-next-step/);

      await pool.query(
        `UPDATE service_call SET sorter_summary = 'סיכום הדלפק' WHERE service_call_id = $1`,
        [deskId],
      );
      const summarised = await client.inject({
        method: 'GET',
        url: `/calls?call=${deskId}`,
      });
      const deskPreview = region(
        summarised.body,
        `data-preview="${deskId}"`,
        '</section>',
      );
      assert.match(deskPreview, /data-excerpt>סיכום הדלפק</);
      assert.match(deskPreview, /data-next-step/);

      const inbound = `${'א'.repeat(240)}TAIL`;
      const arrived = await receiveIncoming(
        pool,
        clock,
        {
          sorter: {
            async sort() {
              return {
                label: 'call' as const,
                categoryCode: null,
                summary: 'כותרת קצרה',
              };
            },
            async translate() {
              return { bodyHe: null };
            },
          },
          matchesEmergency: async () => false,
        },
        message(domain, {
          senderAddress: `reader@${domain}`,
          body: inbound,
          externalMessageId: 'split-body',
        }),
      );
      assert.equal(arrived.kind, 'call');
      if (arrived.kind !== 'call') return;
      const mailed = await client.inject({
        method: 'GET',
        url: `/calls?call=${arrived.callId}`,
      });
      const mailedPreview = region(
        mailed.body,
        `data-preview="${arrived.callId}"`,
        '</section>',
      );
      assert.match(
        mailedPreview,
        new RegExp(`data-excerpt>${'א'.repeat(240)}…</`),
      );
      assert.doesNotMatch(mailedPreview, /data-excerpt>[^<]*TAIL/);
      assert.doesNotMatch(mailedPreview, /data-excerpt>כותרת קצרה</);

      const flagged = await client.inject({
        method: 'POST',
        url: `/calls/${namedId}/emergency`,
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: form({ action: 'flag' }),
      });
      assert.equal(flagged.statusCode, 303);
      const outside = await client.inject({
        method: 'GET',
        url: `/calls?emergency=1&call=${deskId}`,
      });
      assert.doesNotMatch(
        outside.body,
        new RegExp(`data-split-call="${deskId}"`),
      );
      assert.match(outside.body, new RegExp(`data-split-call="${namedId}"`));
      assert.equal(previewId(outside.body), firstSplitId(outside.body));
      assert.notEqual(previewId(outside.body), deskId);
      assert.match(outside.body, /name="emergency" value="1"/);

      const missing = await client.inject({
        method: 'GET',
        url: '/calls?call=00000000-0000-4000-8000-000000000099',
      });
      assert.equal(previewId(missing.body), firstSplitId(missing.body));
      assert.notEqual(
        previewId(missing.body),
        '00000000-0000-4000-8000-000000000099',
      );

      const closed = await client.inject({
        method: 'POST',
        url: `/calls/${deskId}/exit`,
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: form({ exit: 'ANSWERED', note: 'נסגרה מהתצוגה' }),
      });
      assert.equal(closed.statusCode, 303);
      const skipped = await client.inject({
        method: 'GET',
        url: `/calls?call=${deskId}`,
      });
      assert.doesNotMatch(skipped.body, new RegExp(`data-preview="${deskId}"`));
      assert.equal(previewId(skipped.body), firstSplitId(skipped.body));

      const empty = await client.inject({
        method: 'GET',
        url: '/calls?category=00000000-0000-4000-8000-000000000099',
      });
      assert.match(empty.body, /אין קריאות תואמות/);
      assert.doesNotMatch(empty.body, /data-split-call=/);
      assert.doesNotMatch(empty.body, /data-preview="[0-9a-f]/);

      await pool.query(
        `UPDATE service_call
            SET state = 'RESPONSIBILITY_SET',
                category_id = (
                  SELECT category_id FROM call_category
                   WHERE is_active ORDER BY code LIMIT 1
                )
          WHERE service_call_id = $1`,
        [namedId],
      );
      const later = await client.inject({
        method: 'GET',
        url: `/calls?call=${namedId}`,
      });
      const laterPreview = region(
        later.body,
        `data-preview="${namedId}"`,
        '</section>',
      );
      assert.match(laterPreview, /data-requester>יעל בתצוגה</);
      assert.doesNotMatch(laterPreview, /data-next-step|href="\/parties\//);
    } finally {
      await cleanup(pool, domain);
      await cleanupIntake(pool, domain);
      await app.close();
      await pool.end();
    }
  });

  it('shows a closed call its outcome, once, and refuses to change it', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    const domain = 'closed-223.test';
    const sender = `tenant@${domain}`;
    const bytes = Buffer.alloc(128);
    Buffer.from('%PDF-1.4\n').copy(bytes);
    try {
      await inRolledBackTransaction(pool, async (db) => {
        const clock = fixedClock(AT);
        const objects = createMemoryStore();
        const app = buildApp({
          pool: db as unknown as Pool,
          version: '9.9.9-test',
          clock,
          objects,
          bucket: 'dona-v5-test-closed-223',
          pdf: createFakePdfText([]),
        });
        const who = await signIn(db as unknown as Pool, clock, {
          email: `ops@${domain}`,
          role: 'OPERATOR',
        });
        const client = asOperator(app, who);
        const party = await createParty(db, {
          kind: 'PERSON',
          givenName: 'יעל',
          familyName: 'סגורה',
          preferredLanguage: 'he',
        });
        await seedOccupancy(db, '2231', {
          phone: '+972502231231',
          email: sender,
          contactFrom: '2026-01-01',
          contactTo: null,
          tenancyFrom: '2026-01-01',
          tenancyTo: '2027-01-01',
        });
        await upsertDocumentType(db, {
          typeKey: 'paper_223',
          labelHe: 'מסמך מקריאה סגורה',
          labelEn: null,
          verificationTerms: null,
          isActive: true,
        });
        const plumbing = await db.query<{ category_id: string }>(
          `SELECT category_id FROM call_category WHERE code = 'PLUMBING'`,
        );
        const categoryId = plumbing.rows[0]?.category_id;
        assert.ok(categoryId);

        const log = async (description: string): Promise<string> => {
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
          const listed = await client.inject({
            method: 'GET',
            url: '/calls?view=list',
          });
          const id = callId(listed.body, description);
          assert.ok(id, description);
          return id;
        };
        const exitTo = async (
          id: string,
          fields: Record<string, string>,
        ): Promise<string> => {
          const closed = await client.inject({
            method: 'POST',
            url: `/calls/${id}/exit`,
            headers: { 'content-type': 'application/x-www-form-urlencoded' },
            payload: form(fields),
          });
          assert.equal(closed.statusCode, 303);
          assert.equal(closed.headers.location, `/calls/${id}?receipt=1`);
          return String(closed.headers.location);
        };

        await log('מקור לקבלה');
        const answeredId = await log('שאלה שנענתה');
        const answeredAt = await exitTo(answeredId, {
          exit: 'ANSWERED',
          note: 'עניתי בטלפון',
        });
        const forwardedId = await log('בקשה שהועברה');
        await exitTo(forwardedId, {
          exit: 'FORWARDED',
          note: 'שייך לכספים',
          department: 'כספים',
        });
        const duplicateId = await log('עותק של שנענתה');
        await exitTo(duplicateId, {
          exit: 'DUPLICATE',
          duplicate_of: answeredId,
        });
        const cancelledId = await log('בקשה שבוטלה');
        await exitTo(cancelledId, {
          exit: 'CANCELLED',
          note: 'הפונה ביטל',
        });

        const arrivals: [string, string][] = [
          [answeredAt, 'נענתה'],
          [`/calls/${forwardedId}?receipt=1`, 'הועברה'],
          [`/calls/${duplicateId}?receipt=1`, 'כפולה'],
          [`/calls/${cancelledId}?receipt=1`, 'בוטלה'],
        ];
        for (const [url, name] of arrivals) {
          const arrival = await client.inject({ method: 'GET', url });
          const receipt = region(arrival.body, 'data-receipt=', '</p>');
          assert.match(receipt, new RegExp(name));
          const bare = url.split('?')[0] ?? url;
          const reloaded = await client.inject({ method: 'GET', url: bare });
          assert.doesNotMatch(reloaded.body, /data-receipt=/);
        }

        const openList = await client.inject({
          method: 'GET',
          url: '/calls?view=list',
        });
        const first = openList.body.match(/data-call="([0-9a-f-]{36})"/)?.[1];
        assert.ok(first);
        const withNext = await client.inject({
          method: 'GET',
          url: answeredAt,
        });
        const receipt = region(withNext.body, 'data-receipt=', '</p>');
        assert.match(receipt, new RegExp(`href="/calls/${first}"`));
        assert.match(receipt, /הקריאה הבאה/);

        const answered = await client.inject({
          method: 'GET',
          url: `/calls/${answeredId}`,
        });
        assert.doesNotMatch(
          answered.body,
          /class="steps"|aria-label="מצב הקריאה"/,
        );
        const outcome = region(answered.body, 'data-outcome=', '</section>');
        assert.match(outcome, /ops@closed-223\.test/);
        assert.match(outcome, /עכשיו/);
        assert.match(outcome, /עניתי בטלפון/);
        const passed = [...outcome.matchAll(/<li>([^<]*)<\/li>/g)].map(
          (match) => match[1],
        );
        assert.deepEqual(passed, ['חדשה', 'סגורה']);
        const head = region(
          answered.body,
          '<header class="page-head"',
          '</header>',
        );
        assert.match(head, /6 באוק\u05F3, 15:00/);
        assert.match(head, /<p class="back"><a href="\/calls\?state=CLOSED">/);
        const forwarded = await client.inject({
          method: 'GET',
          url: `/calls/${forwardedId}`,
        });
        assert.match(
          region(forwarded.body, 'data-outcome=', '</section>'),
          /כספים/,
        );
        const duplicate = await client.inject({
          method: 'GET',
          url: `/calls/${duplicateId}`,
        });
        assert.match(
          region(duplicate.body, 'data-outcome=', '</section>'),
          new RegExp(`href="/calls/${answeredId}"`),
        );
        const cancelled = await client.inject({
          method: 'GET',
          url: `/calls/${cancelledId}`,
        });
        assert.match(
          region(cancelled.body, 'data-outcome=', '</section>'),
          /הפונה ביטל/,
        );

        const durations: [number, string][] = [
          [59 * 60 * 1000, '59 דקות'],
          [60 * 60 * 1000, 'שעה'],
          [23 * 60 * 60 * 1000, '23 שעות'],
          [24 * 60 * 60 * 1000, 'יום'],
        ];
        for (const [wait, words] of durations) {
          const id = await log(`משך ${words}`);
          await db.query(
            `UPDATE service_call SET opened_at = $2 WHERE service_call_id = $1`,
            [id, new Date(clock.now().getTime() - wait)],
          );
          await exitTo(id, { exit: 'ANSWERED', note: 'נסגרה לבדיקת משך' });
          const page = await client.inject({
            method: 'GET',
            url: `/calls/${id}`,
          });
          assert.match(
            region(page.body, 'data-outcome=', '</section>'),
            new RegExp(words),
          );
        }

        const lateId = await log('קריאה ישנה מאוד');
        await db.query(
          `UPDATE service_call SET opened_at = $2 WHERE service_call_id = $1`,
          [lateId, new Date(clock.now().getTime() - 400 * 24 * 60 * 60 * 1000)],
        );
        await exitTo(lateId, { exit: 'ANSWERED', note: 'נסגרה באיחור' });
        const late = await client.inject({
          method: 'GET',
          url: `/calls/${lateId}`,
        });
        const stage = region(late.body, '<div class="calls', '</main>');
        assert.match(stage, /400 ימים/);
        assert.doesNotMatch(stage, /בזמן|קרוב ליעד|מעבר ליעד/);
        assert.doesNotMatch(stage, /data-goal=/);

        clock.advance(60_000);
        const older = await openIntakeCall(db, clock, {
          sourceChannel: 'EMAIL',
          description: 'המשך ישן',
          senderAddress: `older@${domain}`,
          emergency: false,
          toReview: false,
          sorterLabel: 'call',
          summary: null,
          proposedCategoryId: null,
          predecessorId: answeredId,
          openedBy: null,
          sorterModel: null,
          sorterPrompt: null,
        });
        clock.advance(60_000);
        const newer = await openIntakeCall(db, clock, {
          sourceChannel: 'EMAIL',
          description: 'המשך חדש',
          senderAddress: `newer@${domain}`,
          emergency: false,
          toReview: false,
          sorterLabel: 'call',
          summary: null,
          proposedCategoryId: null,
          predecessorId: answeredId,
          openedBy: null,
          sorterModel: null,
          sorterPrompt: null,
        });
        const continued = await client.inject({
          method: 'GET',
          url: `/calls/${answeredId}`,
        });
        const later = region(
          continued.body,
          'data-continuations',
          '</section>',
        );
        assert.ok(later.indexOf('המשך חדש') < later.indexOf('המשך ישן'));
        assert.ok(later.indexOf(newer.id) < later.indexOf(older.id));
        assert.doesNotMatch(later, /עותק של שנענתה/);
        const duplicates = region(
          continued.body,
          'חוזרות על קריאה זו',
          '</section>',
        );
        assert.match(duplicates, /עותק של שנענתה/);
        assert.doesNotMatch(duplicates, /המשך חדש|המשך ישן/);

        const fireId = await log('יש השריפה בדירה');
        const identified = await client.inject({
          method: 'POST',
          url: `/calls/${fireId}/identify`,
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          payload: form({ party_id: party.id }),
        });
        assert.equal(identified.statusCode, 303);
        await exitTo(fireId, { exit: 'ANSWERED', note: 'השריפה כובתה' });
        const fire = await client.inject({
          method: 'GET',
          url: `/calls/${fireId}`,
        });
        assert.match(fire.body, /היה חירום/);
        assert.match(fire.body, /data-emergency="true"/);
        assert.doesNotMatch(
          region(fire.body, '<header class="page-head"', '</header>'),
          /<span class="chip">חירום<\/span>/,
        );
        const firePassed = [
          ...region(fire.body, 'data-outcome=', '</section>').matchAll(
            /<li>([^<]*)<\/li>/g,
          ),
        ].map((match) => match[1]);
        assert.deepEqual(firePassed, ['חדשה', 'זוהתה', 'סגורה']);
        assert.match(fire.body, /אין פעולות/);
        assert.doesNotMatch(
          fire.body,
          /name="exit"|name="category_id"|name="q"|סימון חירום|הסרת סימון חירום|החזרה למסוננות|זיהוי הפונה/,
        );
        const posts: { url: string; body: Record<string, string> }[] = [
          { url: `/calls/${fireId}/emergency`, body: { action: 'clear' } },
          { url: `/calls/${fireId}/emergency`, body: { action: 'flag' } },
          { url: `/calls/${fireId}/return`, body: {} },
          {
            url: `/calls/${fireId}/exit`,
            body: { exit: 'ANSWERED', note: 'שוב' },
          },
          { url: `/calls/${fireId}/identify`, body: { party_id: party.id } },
          {
            url: `/calls/${fireId}/category`,
            body: { category_id: categoryId },
          },
        ];
        for (const post of posts) {
          const refused = await client.inject({
            method: 'POST',
            url: post.url,
            headers: { 'content-type': 'application/x-www-form-urlencoded' },
            payload: form(post.body),
          });
          assert.equal(refused.statusCode, 400, post.url);
        }
        const still = await client.inject({
          method: 'GET',
          url: `/calls/${fireId}`,
        });
        assert.match(still.body, /data-call-state="CLOSED"/);
        assert.match(still.body, /data-emergency="true"/);
        assert.match(still.body, /היה חירום/);
        const profile = await client.inject({
          method: 'GET',
          url: `/parties/${party.id}`,
        });
        const row = region(profile.body, 'id="party-calls"', '</section>');
        assert.match(row, /<span class="chip">חירום<\/span>/);
        assert.doesNotMatch(row, /היה חירום/);

        const clearedId = await log('סומנה ואז הוסרה');
        const flagged = await client.inject({
          method: 'POST',
          url: `/calls/${clearedId}/emergency`,
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          payload: form({ action: 'flag' }),
        });
        assert.equal(flagged.statusCode, 303);
        const clearing = await client.inject({
          method: 'POST',
          url: `/calls/${clearedId}/emergency`,
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          payload: form({ action: 'clear' }),
        });
        assert.equal(clearing.statusCode, 303);
        await exitTo(clearedId, { exit: 'CANCELLED', note: 'ירד מהאש' });
        const was = await client.inject({
          method: 'GET',
          url: `/calls/${clearedId}`,
        });
        assert.match(was.body, /היה חירום/);
        assert.match(was.body, /data-emergency="false"/);
        await assertPastEmergency(client, fireId, 'יש השריפה בדירה', 'true');
        await assertPastEmergency(
          client,
          clearedId,
          'סומנה ואז הוסרה',
          'false',
        );

        const stranger = `stranger@${domain}`;
        const arrived = await receiveIncoming(
          db,
          clock,
          {
            sorter: {
              async sort() {
                return {
                  label: 'call' as const,
                  categoryCode: null,
                  summary: null,
                };
              },
              async translate() {
                return { bodyHe: null };
              },
            },
            matchesEmergency: async () => false,
          },
          message(domain, {
            senderAddress: stranger,
            body: 'הדלת חורקת אחרי הסגירה',
            externalMessageId: `${domain}-save`,
            externalThreadId: `${domain}-save`,
          }),
        );
        assert.equal(arrived.kind, 'call');
        if (arrived.kind !== 'call') return;
        const named = await client.inject({
          method: 'POST',
          url: `/calls/${arrived.callId}/identify`,
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          payload: form({ party_id: party.id }),
        });
        assert.equal(named.statusCode, 303);
        await exitTo(arrived.callId, {
          exit: 'ANSWERED',
          note: 'נשמר אחרי הסגירה',
        });
        const savable = await client.inject({
          method: 'GET',
          url: `/calls/${arrived.callId}`,
        });
        const aside = region(
          savable.body,
          '<aside class="call-aside ',
          '</aside>',
        );
        assert.equal(aside.match(/שמירת איש קשר/g)?.length, 1);
        assert.doesNotMatch(aside, /<h2|אין פעולות|ההודעה הבאה/);
        assert.match(
          savable.body,
          new RegExp(
            `<dt>פונה</dt><dd><a href="/parties/${party.id}">יעל סגורה</a></dd>`,
          ),
        );
        const saved = await client.inject({
          method: 'POST',
          url: `/calls/${arrived.callId}/contact`,
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          payload: form({}),
        });
        assert.equal(saved.statusCode, 303);
        const viewer = asOperator(
          app,
          await signIn(db as unknown as Pool, clock, {
            email: `view@${domain}`,
            role: 'VIEWER',
          }),
        );
        const withheld = await viewer.inject({
          method: 'GET',
          url: `/calls/${arrived.callId}`,
        });
        assert.match(withheld.body, /<dt>פונה<\/dt><dd>יעל סגורה<\/dd>/);
        assert.doesNotMatch(withheld.body, /href="\/parties\//);
        assert.match(
          withheld.body,
          /<p class="back"><a href="\/calls\?state=CLOSED">/,
        );

        const filed = await receiveIncoming(
          db,
          clock,
          {
            sorter: {
              async sort() {
                return {
                  label: 'call' as const,
                  categoryCode: null,
                  summary: null,
                };
              },
              async translate() {
                return { bodyHe: null };
              },
            },
            matchesEmergency: async () => false,
            objects,
          },
          message(domain, {
            senderAddress: sender,
            body: 'מצורף אחרי הסגירה',
            externalMessageId: `${domain}-file`,
            externalThreadId: `${domain}-file`,
            attachments: [
              {
                fileName: 'note.pdf',
                contentType: 'application/pdf',
                byteSize: bytes.length,
                bytes,
              },
            ],
          }),
        );
        assert.equal(filed.kind, 'call');
        if (filed.kind !== 'call') return;
        await exitTo(filed.callId, {
          exit: 'ANSWERED',
          note: 'נסגר עם קובץ',
        });
        const filePage = await client.inject({
          method: 'GET',
          url: `/calls/${filed.callId}`,
        });
        assert.match(filePage.body, /אין פעולות/);
        assert.match(filePage.body, /תייק כמסמך/);
        const filing = filePage.body.match(
          /<form method="post" action="(\/calls\/[^"]+\/files\/0)">/,
        );
        assert.ok(filing?.[1]);
        const posted = await client.inject({
          method: 'POST',
          url: filing[1],
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          payload: form({ type_key: 'paper_223' }),
        });
        assert.equal(posted.statusCode, 303);
        const afterFile = await client.inject({
          method: 'GET',
          url: `/calls/${filed.callId}`,
        });
        assert.match(
          region(afterFile.body, '<div class="file"', '</div>'),
          /תויק/,
        );

        await db.query('LOCK TABLE service_call IN SHARE ROW EXCLUSIVE MODE');
        await db.query(
          `UPDATE service_call
              SET state = 'CLOSED', exit_kind = 'CANCELLED', exit_note = 'ריקון',
                  exit_department = NULL, duplicate_of = NULL,
                  closed_at = $2, closed_by = $1
            WHERE state <> 'CLOSED' AND returned_at IS NULL`,
          [who.staffAccountId, clock.now()],
        );
        const empty = await client.inject({
          method: 'GET',
          url: '/calls?view=list',
        });
        assert.equal(empty.body.includes('data-call="'), false);
        const noNext = await client.inject({ method: 'GET', url: answeredAt });
        const quiet = region(noNext.body, 'data-receipt=', '</p>');
        assert.match(quiet, /נענתה/);
        assert.doesNotMatch(quiet, /data-next-call|הקריאה הבאה/);
        await app.close();
      });
    } finally {
      await pool.end();
    }
  });

  // #224. The clock is in 2020, so the closes every other file makes on this database, at their
  // own clocks, are after this one's now and outside every window this test reads.
  it('shows the closed calls of the last thirty days by day, by exit, and pages back', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    const domain = 'closed-224.test';
    const day = 24 * 60 * 60 * 1000;
    // A Wednesday, 12:00 in the office's zone.
    const now = new Date('2020-03-04T10:00:00.000Z');
    try {
      await inRolledBackTransaction(pool, async (db) => {
        const clock = fixedClock(now);
        const app = buildApp({
          pool: db as unknown as Pool,
          version: '9.9.9-test',
          clock,
        });
        const who = await signIn(db as unknown as Pool, clock, {
          email: `ops@${domain}`,
          role: 'OPERATOR',
        });
        const client = asOperator(app, who);
        const party = await createParty(db, {
          kind: 'PERSON',
          givenName: 'רון',
          familyName: 'ישן',
          preferredLanguage: 'he',
        });

        const closeAt = async (
          description: string,
          exit: Record<string, string>,
          closedAt: Date,
        ): Promise<string> => {
          const created = await client.inject({
            method: 'POST',
            url: '/calls',
            headers: { 'content-type': 'application/x-www-form-urlencoded' },
            payload: form({ channel: 'PHONE', description, sender: 'unknown' }),
          });
          assert.equal(created.statusCode, 303);
          const listed = await client.inject({
            method: 'GET',
            url: '/calls?view=list',
          });
          const id = callId(listed.body, description);
          assert.ok(id, description);
          const closed = await client.inject({
            method: 'POST',
            url: `/calls/${id}/exit`,
            headers: { 'content-type': 'application/x-www-form-urlencoded' },
            payload: form(exit),
          });
          assert.equal(closed.statusCode, 303);
          await db.query(
            `UPDATE service_call SET opened_at = $2, closed_at = $3
              WHERE service_call_id = $1`,
            [id, new Date(closedAt.getTime() - 60 * 60 * 1000), closedAt],
          );
          return id;
        };
        const answered = { exit: 'ANSWERED', note: 'נענתה בטלפון' };
        const cancelled = { exit: 'CANCELLED', note: 'בוטלה' };

        // 00:10 on Wednesday and 23:50 on Tuesday, in the office's zone.
        const afterMidnight = await closeAt(
          'נסגרה אחרי חצות',
          answered,
          new Date('2020-03-03T22:10:00.000Z'),
        );
        await closeAt(
          'נסגרה לפני חצות',
          { exit: 'FORWARDED', note: 'לכספים', department: 'כספים' },
          new Date('2020-03-03T21:50:00.000Z'),
        );
        await closeAt(
          'נסגרה ביום ראשון',
          cancelled,
          new Date('2020-03-01T08:00:00.000Z'),
        );
        await closeAt(
          'נסגרה בשבת',
          answered,
          new Date('2020-02-29T08:00:00.000Z'),
        );
        await closeAt(
          'נסגרה בדיוק לפני חודש',
          answered,
          new Date(now.getTime() - 30 * day),
        );
        await closeAt(
          'נסגרה לפני חודש וחצי',
          answered,
          new Date(now.getTime() - 45 * day),
        );
        const oldest = await closeAt(
          'נסגרה לפני חודשיים וחצי',
          cancelled,
          new Date(now.getTime() - 75 * day),
        );
        await db.query(
          `UPDATE service_call SET requester_party_id = $2 WHERE service_call_id = $1`,
          [oldest, party.id],
        );

        const listed = (html: string): string[] =>
          [...html.matchAll(/href="\/calls\/[0-9a-f-]{36}">([^<]*)<\/a>/g)].map(
            (match) => match[1] ?? '',
          );
        const headings = (html: string): string[] =>
          [...html.matchAll(/<h2>([^<]*)<\/h2>/g)].map(
            (match) => match[1] ?? '',
          );

        const recent = await client.inject({
          method: 'GET',
          url: '/calls?state=CLOSED&view=list',
        });
        const recentList = layoutOf(recent.body, 'list');
        assert.deepEqual(listed(recentList), [
          'נסגרה אחרי חצות',
          'נסגרה לפני חצות',
          'נסגרה ביום ראשון',
          'נסגרה בשבת',
        ]);
        assert.deepEqual(headings(recentList), [
          'היום',
          'אתמול',
          'השבוע',
          'קודם',
        ]);
        const row = article(recentList, 'נסגרה אחרי חצות');
        assert.match(row, /נענתה/);
        assert.match(row, /00:10/);
        assert.doesNotMatch(row, /שעות|בזמן|קרוב ליעד|מעבר ליעד|data-goal=/);
        assert.match(
          recentList,
          /href="\/calls\?state=CLOSED&amp;view=list&amp;page=1"[^>]*>30 הימים הקודמים</,
        );

        const exits = (html: string): Record<string, number> => {
          const nav = region(html, 'aria-label="סינון לפי יציאה"', '</nav>');
          const counts: Record<string, number> = {};
          for (const label of ['הכל', 'נענתה', 'הועברה', 'כפולה', 'בוטלה']) {
            const found = nav.match(
              new RegExp(`${label} <span class="n"><span dir="ltr">(\\d+)<`),
            );
            assert.ok(found, label);
            counts[label] = Number(found[1]);
          }
          return counts;
        };
        assert.deepEqual(exits(recentList), {
          הכל: 4,
          נענתה: 2,
          הועברה: 1,
          כפולה: 0,
          בוטלה: 1,
        });
        const onlyAnswered = await client.inject({
          method: 'GET',
          url: '/calls?state=CLOSED&view=list&exit=ANSWERED',
        });
        const answeredList = layoutOf(onlyAnswered.body, 'list');
        assert.deepEqual(listed(answeredList), [
          'נסגרה אחרי חצות',
          'נסגרה בשבת',
        ]);
        assert.equal(exits(answeredList).נענתה, 2);
        assert.match(answeredList, /exit=ANSWERED&amp;page=1"/);
        const forwarded = await client.inject({
          method: 'GET',
          url: '/calls?state=CLOSED&view=list&exit=FORWARDED',
        });
        const forwardedList = layoutOf(forwarded.body, 'list');
        assert.deepEqual(listed(forwardedList), ['נסגרה לפני חצות']);
        assert.doesNotMatch(forwardedList, /30 הימים הקודמים/);
        const duplicates = await client.inject({
          method: 'GET',
          url: '/calls?state=CLOSED&view=list&exit=DUPLICATE',
        });
        assert.match(layoutOf(duplicates.body, 'list'), /אין קריאות תואמות\./);
        const category = await db.query<{ category_id: string }>(
          `SELECT category_id FROM call_category WHERE code = 'PLUMBING'`,
        );
        const byCategory = await client.inject({
          method: 'GET',
          url: `/calls?state=CLOSED&view=list&category=${category.rows[0]?.category_id}`,
        });
        const categoryList = layoutOf(byCategory.body, 'list');
        assert.match(categoryList, /אין קריאות תואמות\./);
        assert.equal(exits(categoryList).הכל, 0);
        assert.doesNotMatch(categoryList, /30 הימים הקודמים/);

        const pages: string[][] = [];
        let url: string | null = '/calls?state=CLOSED&view=list&page=1';
        while (url !== null) {
          const page = await client.inject({ method: 'GET', url });
          const list = layoutOf(page.body, 'list');
          pages.push(listed(list));
          const older = list.match(
            /href="([^"]*)"[^>]*>30 הימים הקודמים</,
          )?.[1];
          url = older === undefined ? null : older.replaceAll('&amp;', '&');
          assert.ok(pages.length < 5, 'paging ends');
        }
        assert.deepEqual(pages, [
          ['נסגרה בדיוק לפני חודש', 'נסגרה לפני חודש וחצי'],
          ['נסגרה לפני חודשיים וחצי'],
        ]);

        const split = await client.inject({
          method: 'GET',
          url: `/calls?state=CLOSED&call=${afterMidnight}`,
        });
        const preview = region(
          split.body,
          `data-preview="${afterMidnight}"`,
          '</section>',
        );
        assert.match(preview, /data-preview-outcome/);
        assert.match(preview, /נענתה/);
        assert.match(preview, /נענתה בטלפון/);
        assert.match(preview, /ops@closed-224\.test/);
        assert.doesNotMatch(
          preview,
          /data-excerpt|data-next-step|class="steps"/,
        );
        assert.deepEqual(
          headings(
            region(split.body, 'data-layout="split"', 'aria-label="תצוגה"'),
          ),
          ['היום', 'אתמול', 'השבוע', 'קודם'],
        );

        const own = await client.inject({
          method: 'GET',
          url: `/calls/${oldest}`,
        });
        assert.equal(own.statusCode, 200);
        assert.match(own.body, /data-outcome=/);
        const profile = await client.inject({
          method: 'GET',
          url: `/parties/${party.id}`,
        });
        assert.equal(profile.statusCode, 200);
        assert.match(profile.body, new RegExp(`href="/calls/${oldest}"`));

        // A Monday: yesterday is the Sunday, so there is no week heading.
        const mondayClock = fixedClock(new Date('2020-03-02T10:00:00.000Z'));
        const monday = buildApp({
          pool: db as unknown as Pool,
          version: '9.9.9-test',
          clock: mondayClock,
        });
        const onMonday = await asOperator(monday, who).inject({
          method: 'GET',
          url: '/calls?state=CLOSED&view=list',
        });
        const mondayList = layoutOf(onMonday.body, 'list');
        assert.deepEqual(listed(mondayList), [
          'נסגרה ביום ראשון',
          'נסגרה בשבת',
          'נסגרה בדיוק לפני חודש',
        ]);
        assert.deepEqual(headings(mondayList), ['אתמול', 'קודם']);
        await monday.close();

        const laterClock = fixedClock(new Date(now.getTime() + 200 * day));
        const later = buildApp({
          pool: db as unknown as Pool,
          version: '9.9.9-test',
          clock: laterClock,
        });
        const laterWho = await signIn(db as unknown as Pool, laterClock, {
          email: `later@${domain}`,
          role: 'OPERATOR',
        });
        const quiet = await asOperator(later, laterWho).inject({
          method: 'GET',
          url: '/calls?state=CLOSED&view=list',
        });
        const quietList = layoutOf(quiet.body, 'list');
        assert.deepEqual(listed(quietList), []);
        assert.match(quietList, /אין קריאות שנסגרו ב־30 הימים האלה\./);
        assert.doesNotMatch(quietList, /אין קריאות תואמות/);
        // 200 days on, the newest close is 200.5 days back: page 6, past five empty windows.
        assert.match(
          quietList,
          /href="\/calls\?state=CLOSED&amp;view=list&amp;page=6"/,
        );
        const skipped = await asOperator(later, laterWho).inject({
          method: 'GET',
          url: '/calls?state=CLOSED&view=list&page=6',
        });
        assert.deepEqual(listed(layoutOf(skipped.body, 'list')), [
          'נסגרה אחרי חצות',
          'נסגרה לפני חצות',
          'נסגרה ביום ראשון',
          'נסגרה בשבת',
        ]);
        await later.close();
        await app.close();
      });
    } finally {
      await pool.end();
    }
  });
});

function message(
  domain: string,
  over: Partial<IncomingMessage> = {},
): IncomingMessage {
  return {
    sourceChannel: 'EMAIL',
    externalMessageId: `${domain}-${over.externalMessageId ?? '1'}`,
    externalThreadId: `${domain}-thread`,
    senderAddress: `tenant@${domain}`,
    receivedAt: AT,
    subject: null,
    body: 'נזילה',
    ...over,
  };
}

function region(html: string, startMark: string, endMark: string): string {
  const start = html.indexOf(startMark);
  const end = html.indexOf(endMark, start);
  assert.ok(start >= 0 && end > start, startMark);
  return html.slice(start, end + endMark.length);
}

function filteredArticle(html: string, title: string): string {
  const at = html.indexOf(`>${title}<`);
  assert.ok(at >= 0, title);
  const start = html.lastIndexOf('<article', at);
  const end = html.indexOf('</article>', at);
  assert.ok(start >= 0 && end > start, title);
  return html.slice(start, end);
}

function originCount(html: string, label: string): number {
  const found = html.match(
    new RegExp(`${label} <span class="n"><span dir="ltr">(\\d+)</span>`),
  );
  assert.ok(found, label);
  return Number(found[1]);
}

function assertCountsMatchRows(html: string): void {
  const sorter = html.match(/data-filtered="message"/g)?.length ?? 0;
  const office = html.match(/data-filtered="call"/g)?.length ?? 0;
  assert.equal(originCount(html, 'המסווג'), sorter);
  assert.equal(originCount(html, 'המשרד'), office);
  assert.equal(originCount(html, 'הכל'), sorter + office);
}

async function cleanupIntake(pool: Pool, domain: string): Promise<void> {
  const like = `%@${domain}`;
  await pool.query(
    `DELETE FROM message
      WHERE sender_address LIKE $1
         OR service_call_id IN (
           SELECT service_call_id FROM service_call WHERE sender_label LIKE $1
         )`,
    [like],
  );
  await pool.query(
    `DELETE FROM service_call_transition
      WHERE service_call_id IN (
        SELECT service_call_id FROM service_call WHERE sender_label LIKE $1
      )`,
    [like],
  );
  await pool.query(
    `DELETE FROM audit_log
      WHERE subject_id IN (
        SELECT service_call_id::text FROM service_call WHERE sender_label LIKE $1
      )`,
    [like],
  );
  await pool.query(`DELETE FROM service_call WHERE sender_label LIKE $1`, [
    like,
  ]);
  await pool.query(
    `DELETE FROM conversation WHERE external_thread_id LIKE $1`,
    [`${domain}-%`],
  );
  await signOutAll(pool, domain);
}
