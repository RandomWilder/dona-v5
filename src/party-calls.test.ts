// #209. The calls a party opened, on its profile. Newest first, and only the
// ones that name this party as requester.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Pool } from 'pg';
import { asOperator, signIn, signOutAll } from '../tests/support/session.ts';
import { buildApp } from './app.ts';
import {
  flagEmergency,
  identifyCall,
  openCall,
  setCallCategory,
} from './calls/contract.ts';
import { fixedClock } from './kernel/clock.ts';
import { migratedPoolOrNull, skipReason } from './kernel/pg-support.ts';
import { createParty } from './parties/contract.ts';

const AT = new Date('2026-10-11T09:00:00.000Z');
const NEWER = new Date('2026-10-02T11:10:00.000Z');
const OLDER = new Date('2026-09-18T06:02:00.000Z');
const DOMAIN = 'party-calls.test';
const FAMILY = 'קשקוש209';
const LEAK = 'נזילה209א';
const KEY = 'מפתח209ב';
const GATE = 'שער209ג';
const STRANGER = 'אנונימי209ד';
const PLUMBING = 'a1830001-0000-4000-8000-000000000001';

function callsSection(html: string): string {
  const at = html.indexOf('id="party-calls"');
  assert.ok(at > 0);
  return html.slice(at);
}

function callRow(html: string, description: string): string {
  const section = callsSection(html);
  const at = section.indexOf(`>${description}</a>`);
  assert.ok(at > 0, description);
  const start = section.lastIndexOf('<li', at);
  const end = section.indexOf('</li>', at);
  return section.slice(start, end);
}

async function cleanup(pool: Pool): Promise<void> {
  await pool.query(
    `DELETE FROM service_call_transition
      WHERE service_call_id IN (
        SELECT service_call_id FROM service_call
         WHERE description IN ($1, $2, $3, $4)
      )`,
    [LEAK, KEY, GATE, STRANGER],
  );
  await pool.query(
    `DELETE FROM audit_log
      WHERE subject_id IN (
        SELECT service_call_id::text FROM service_call
         WHERE description IN ($1, $2, $3, $4)
      )`,
    [LEAK, KEY, GATE, STRANGER],
  );
  await pool.query(
    `DELETE FROM service_call WHERE description IN ($1, $2, $3, $4)`,
    [LEAK, KEY, GATE, STRANGER],
  );
  await pool.query(`DELETE FROM party WHERE family_name = $1`, [FAMILY]);
  await signOutAll(pool, DOMAIN);
}

describe('parties · calls on the profile', { concurrency: false }, () => {
  it('lists the calls this party opened, newest first, and none for a party who opened none', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    const clock = fixedClock(AT);
    const app = buildApp({ pool, version: '9.9.9-test', clock });
    await cleanup(pool);
    const operator = await signIn(pool, clock, {
      email: `ops@${DOMAIN}`,
      role: 'OPERATOR',
    });
    const opener = {
      openedBy: operator.staffAccountId,
      actorId: operator.staffAccountId,
      actorRole: 'OPERATOR',
    };
    const dana = await createParty(pool, {
      kind: 'PERSON',
      givenName: 'דנה209',
      familyName: FAMILY,
      preferredLanguage: 'he',
    });
    const neighbour = await createParty(pool, {
      kind: 'PERSON',
      givenName: 'רחל209',
      familyName: FAMILY,
      preferredLanguage: 'he',
    });
    const quiet = await createParty(pool, {
      kind: 'PERSON',
      givenName: 'שקט209',
      familyName: FAMILY,
      preferredLanguage: 'he',
    });
    const client = asOperator(app, operator);
    try {
      const leak = await openCall(pool, fixedClock(NEWER), {
        sourceChannel: 'PHONE',
        description: LEAK,
        sender: { kind: 'unknown' },
        openedBy: opener.openedBy,
      });
      await identifyCall(pool, clock, {
        callId: leak.id,
        partyId: dana.id,
        actorId: opener.actorId,
        actorRole: opener.actorRole,
      });
      await setCallCategory(pool, clock, {
        callId: leak.id,
        categoryId: PLUMBING,
        actorId: opener.actorId,
        actorRole: opener.actorRole,
      });
      await flagEmergency(pool, clock, {
        callId: leak.id,
        actorId: opener.actorId,
        actorRole: opener.actorRole,
      });
      const key = await openCall(pool, fixedClock(OLDER), {
        sourceChannel: 'PHONE',
        description: KEY,
        sender: { kind: 'unknown' },
        openedBy: opener.openedBy,
      });
      await identifyCall(pool, clock, {
        callId: key.id,
        partyId: dana.id,
        actorId: opener.actorId,
        actorRole: opener.actorRole,
      });
      const gate = await openCall(pool, clock, {
        sourceChannel: 'WALK_IN',
        description: GATE,
        sender: { kind: 'unknown' },
        openedBy: opener.openedBy,
      });
      await identifyCall(pool, clock, {
        callId: gate.id,
        partyId: neighbour.id,
        actorId: opener.actorId,
        actorRole: opener.actorRole,
      });
      await openCall(pool, clock, {
        sourceChannel: 'PHONE',
        description: STRANGER,
        sender: { kind: 'unknown' },
        openedBy: opener.openedBy,
      });

      const profile = await client.inject({
        method: 'GET',
        url: `/parties/${dana.id}`,
      });
      assert.equal(profile.statusCode, 200);
      const section = callsSection(profile.body);
      assert.equal(section.includes('אין קריאות'), false);
      const leakAt = section.indexOf(`>${LEAK}</a>`);
      const keyAt = section.indexOf(`>${KEY}</a>`);
      assert.ok(leakAt >= 0 && keyAt > leakAt);
      assert.equal(section.includes(GATE), false);
      assert.equal(section.includes(STRANGER), false);

      const leakRow = callRow(profile.body, LEAK);
      assert.match(leakRow, new RegExp(`href="/calls/${leak.id}"`));
      assert.match(leakRow, /2026-10-02/);
      assert.match(leakRow, /אינסטלציה/);
      assert.match(leakRow, /מוינה/);
      assert.match(leakRow, /data-emergency="true"/);
      assert.match(leakRow, /חירום/);

      const keyRow = callRow(profile.body, KEY);
      assert.match(keyRow, new RegExp(`href="/calls/${key.id}"`));
      assert.match(keyRow, /2026-09-18/);
      assert.match(keyRow, /טרם נבחרה/);
      assert.match(keyRow, /זוהתה/);
      assert.match(keyRow, /data-emergency="false"/);
      assert.match(keyRow, />לא</);
      assert.equal(keyRow.includes('חירום'), false);

      const empty = await client.inject({
        method: 'GET',
        url: `/parties/${quiet.id}`,
      });
      assert.equal(empty.statusCode, 200);
      const none = callsSection(empty.body);
      assert.match(none, /אין קריאות/);
      assert.equal(none.includes(LEAK), false);
      assert.equal(none.includes(KEY), false);
      assert.equal(none.includes(GATE), false);

      const other = await client.inject({
        method: 'GET',
        url: `/parties/${neighbour.id}`,
      });
      const theirs = callsSection(other.body);
      assert.match(theirs, new RegExp(`href="/calls/${gate.id}"`));
      assert.equal(theirs.includes(LEAK), false);
      assert.equal(theirs.includes(KEY), false);
    } finally {
      await cleanup(pool);
      await pool.end();
    }
  });
});
