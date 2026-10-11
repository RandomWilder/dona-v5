// #206. Contacts on the profile, driven the way the office drives them: a signed-in
// operator posts a form, and the page or the row that comes back is the answer.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Pool } from 'pg';
import { asOperator, signIn, signOutAll } from '../tests/support/session.ts';
import { buildApp } from './app.ts';
import { fixedClock } from './kernel/clock.ts';
import { migratedPoolOrNull, skipReason } from './kernel/pg-support.ts';
import { createParty, upsertPartyContact } from './parties/contract.ts';

const AT = new Date('2026-10-11T09:00:00.000Z');
const DOMAIN = 'party-contacts.test';
const FAMILY = 'קשקוש206';
const POST = {
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
};

function rowOf(html: string, name: string): string {
  const at = html.indexOf(`>${name}</a>`);
  assert.ok(at > 0, name);
  return html.slice(html.lastIndexOf('<tr', at), html.indexOf('</tr>', at));
}

function contactId(html: string, value: string, action: string): string {
  const at = html.indexOf(value);
  assert.ok(at > 0, value);
  const li = html.slice(html.lastIndexOf('<li', at), html.indexOf('</li>', at));
  const found = li.match(new RegExp(`/contacts/([0-9a-f-]{36})/${action}`));
  assert.ok(found?.[1], `${value} ${action}`);
  return found[1];
}

async function cleanup(pool: Pool): Promise<void> {
  await pool.query(
    `DELETE FROM party_contact
      WHERE party_id IN (SELECT party_id FROM party WHERE family_name = $1)`,
    [FAMILY],
  );
  await pool.query('DELETE FROM party WHERE family_name = $1', [FAMILY]);
  await signOutAll(pool, DOMAIN);
}

async function stored(
  pool: Pool,
  partyId: string,
): Promise<
  {
    contact_id: string;
    channel: string;
    value: string;
    label: string | null;
    is_primary: boolean;
    valid_from: string;
    valid_to: string | null;
  }[]
> {
  const result = await pool.query<{
    contact_id: string;
    channel: string;
    value: string;
    label: string | null;
    is_primary: boolean;
    valid_from: string;
    valid_to: string | null;
  }>(
    `SELECT contact_id, channel, value, label, is_primary,
            valid_from::text AS valid_from, valid_to::text AS valid_to
       FROM party_contact
      WHERE party_id = $1
      ORDER BY value`,
    [partyId],
  );
  return result.rows;
}

async function audits(pool: Pool, action: string, actorId: string) {
  const result = await pool.query<{
    actor_role: string | null;
    subject_id: string | null;
    inputs: string;
  }>(
    `SELECT actor_role, subject_id, inputs::text AS inputs
       FROM audit_log
      WHERE action = $1 AND actor_id = $2
      ORDER BY at`,
    [action, actorId],
  );
  return result.rows;
}

describe('parties · contacts on the profile', { concurrency: false }, () => {
  it('stores a phone in the international form, and an email folded', async (t) => {
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
    const person = await createParty(pool, {
      kind: 'PERSON',
      givenName: 'עמיתא206',
      familyName: FAMILY,
      preferredLanguage: 'he',
    });
    const client = asOperator(app, operator);
    try {
      for (const [typed, from] of [
        ['052-206-1001', '2026-04-01'],
        ['052 206 1002', ''],
        ['0522061003', '2026-10-11'],
      ] as const) {
        const saved = await client.inject({
          method: 'POST',
          url: `/parties/${person.id}/contacts`,
          ...POST,
          payload: `channel=PHONE&value=${encodeURIComponent(typed)}&label=&valid_from=${from}`,
        });
        assert.equal(saved.statusCode, 303, typed);
      }
      const email = await client.inject({
        method: 'POST',
        url: `/parties/${person.id}/contacts`,
        ...POST,
        payload: `channel=EMAIL&value=${encodeURIComponent('Yosef206@Example.test')}&label=${encodeURIComponent('יוסי – סדרן')}&valid_from=2026-10-11`,
      });
      assert.equal(email.statusCode, 303);

      const rows = await stored(pool, person.id);
      assert.deepEqual(
        rows.map((row) => [row.channel, row.value, row.valid_from, row.label]),
        [
          ['PHONE', '+972522061001', '2026-04-01', null],
          ['PHONE', '+972522061002', '2026-10-11', null],
          ['PHONE', '+972522061003', '2026-10-11', null],
          ['EMAIL', 'yosef206@example.test', '2026-10-11', 'יוסי – סדרן'],
        ],
      );
      const page = await client.inject({
        method: 'GET',
        url: `/parties/${person.id}`,
      });
      assert.equal(page.statusCode, 200);
      assert.ok(page.body.includes('+972522061001'));
      assert.equal(page.body.includes('052-206-1001'), false);
      assert.ok(page.body.includes('יוסי – סדרן'));
      assert.ok(page.body.includes('yosef206@example.test'));

      const before = rows.length;
      const bad = await client.inject({
        method: 'POST',
        url: `/parties/${person.id}/contacts`,
        ...POST,
        payload: 'channel=PHONE&value=123&valid_from=2026-10-11',
      });
      assert.equal(bad.statusCode, 400);
      assert.match(bad.body, /המספר אינו תקין/);
      assert.equal((await stored(pool, person.id)).length, before);

      const written = await audits(
        pool,
        'parties.contact.add',
        operator.staffAccountId,
      );
      assert.equal(written.length, 4);
      for (const row of written) {
        assert.equal(row.actor_role, 'OPERATOR');
        assert.equal(row.subject_id, person.id);
        const inputs = JSON.parse(row.inputs) as {
          partyId?: string;
          contactId?: string;
          channel?: string;
        };
        assert.equal(inputs.partyId, person.id);
        assert.match(inputs.contactId ?? '', /^[0-9a-f-]{36}$/);
        assert.ok(inputs.channel === 'PHONE' || inputs.channel === 'EMAIL');
        assert.equal(row.inputs.includes('+972'), false);
        assert.equal(row.inputs.includes('יוסי'), false);
      }
    } finally {
      await cleanup(pool);
      await pool.end();
    }
  });

  it('refuses a number another party holds, names them, and writes nothing', async (t) => {
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
    const holder = await createParty(pool, {
      kind: 'PERSON',
      givenName: 'יוסף206',
      familyName: FAMILY,
      preferredLanguage: 'he',
    });
    const next = await createParty(pool, {
      kind: 'PERSON',
      givenName: 'רינה206',
      familyName: FAMILY,
      preferredLanguage: 'he',
    });
    await upsertPartyContact(pool, {
      partyId: holder.id,
      channel: 'PHONE',
      value: '+972522062001',
      isPrimary: true,
      validFrom: '2020-01-01',
      validTo: null,
      verifiedAt: null,
    });
    const client = asOperator(app, operator);
    try {
      const refused = await client.inject({
        method: 'POST',
        url: `/parties/${next.id}/contacts`,
        ...POST,
        payload: 'channel=PHONE&value=052-206-2001&valid_from=2026-10-11',
      });
      assert.equal(refused.statusCode, 409);
      assert.match(refused.body, /המספר פתוח אצל/);
      assert.match(refused.body, /יוסף206 קשקוש206/);
      assert.match(refused.body, new RegExp(`href="/parties/${holder.id}"`));
      assert.equal((await stored(pool, next.id)).length, 0);
      assert.equal(
        (await audits(pool, 'parties.contact.add', operator.staffAccountId))
          .length,
        0,
      );

      const holderPage = await client.inject({
        method: 'GET',
        url: `/parties/${holder.id}`,
      });
      const closing = contactId(holderPage.body, '+972522062001', 'close');
      const closed = await client.inject({
        method: 'POST',
        url: `/parties/${holder.id}/contacts/${closing}/close`,
        ...POST,
        payload: 'valid_to=2026-10-11',
      });
      assert.equal(closed.statusCode, 303);
      const sameDay = await client.inject({
        method: 'POST',
        url: `/parties/${next.id}/contacts`,
        ...POST,
        payload: 'channel=PHONE&value=052-206-2001&valid_from=2026-10-11',
      });
      assert.equal(sameDay.statusCode, 409);
      assert.match(sameDay.body, /המספר רשום על/);
      assert.equal(sameDay.body.includes('המספר פתוח אצל'), false);
      assert.equal((await stored(pool, next.id)).length, 0);

      const following = await client.inject({
        method: 'POST',
        url: `/parties/${next.id}/contacts`,
        ...POST,
        payload: 'channel=PHONE&value=052-206-2001&valid_from=2026-10-12',
      });
      assert.equal(following.statusCode, 303);
      assert.deepEqual(
        (await stored(pool, next.id)).map((row) => [row.value, row.valid_from]),
        [['+972522062001', '2026-10-12']],
      );
      const kept = await stored(pool, holder.id);
      assert.equal(kept.length, 1);
      assert.equal(kept[0]?.valid_to, '2026-10-11');
      const gone = await client.inject({
        method: 'DELETE',
        url: `/parties/${holder.id}/contacts/${kept[0]?.contact_id}`,
        ...POST,
        payload: '',
      });
      assert.equal(gone.statusCode, 404);
      assert.equal((await stored(pool, holder.id)).length, 1);

      const after = await client.inject({
        method: 'GET',
        url: `/parties/${holder.id}`,
      });
      assert.match(after.body, /סגור/);
      assert.match(after.body, /2020-01-01/);
      assert.match(after.body, /2026-10-11/);
      assert.equal(after.body.includes('/close'), false);
      const closeAudit = await audits(
        pool,
        'parties.contact.close',
        operator.staffAccountId,
      );
      assert.equal(closeAudit.length, 1);
      assert.equal(closeAudit[0]?.actor_role, 'OPERATOR');
      assert.equal(closeAudit[0]?.subject_id, holder.id);
      const closeInputs = JSON.parse(closeAudit[0]?.inputs ?? '{}') as {
        partyId?: string;
        contactId?: string;
        channel?: string;
      };
      assert.equal(closeInputs.partyId, holder.id);
      assert.equal(closeInputs.contactId, closing);
      assert.equal(closeInputs.channel, 'PHONE');
      assert.equal(closeAudit[0]?.inputs.includes('+972'), false);
    } finally {
      await cleanup(pool);
      await pool.end();
    }
  });

  it('marks one contact primary, and the directory row shows it', async (t) => {
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
    const person = await createParty(pool, {
      kind: 'PERSON',
      givenName: 'עמיתא206',
      familyName: FAMILY,
      preferredLanguage: 'he',
    });
    await upsertPartyContact(pool, {
      partyId: person.id,
      channel: 'PHONE',
      value: '+972522063001',
      isPrimary: true,
      validFrom: '2024-01-01',
      validTo: null,
      verifiedAt: null,
    });
    await upsertPartyContact(pool, {
      partyId: person.id,
      channel: 'PHONE',
      value: '+972522063002',
      isPrimary: false,
      validFrom: '2020-01-01',
      validTo: null,
      verifiedAt: null,
    });
    const client = asOperator(app, operator);
    try {
      const page = await client.inject({
        method: 'GET',
        url: `/parties/${person.id}`,
      });
      const id = contactId(page.body, '+972522063002', 'primary');
      const marked = await client.inject({
        method: 'POST',
        url: `/parties/${person.id}/contacts/${id}/primary`,
        ...POST,
        payload: '',
      });
      assert.equal(marked.statusCode, 303);
      const list = await client.inject({
        method: 'GET',
        url: `/parties?q=${encodeURIComponent('עמיתא206')}`,
      });
      const row = rowOf(list.body, `עמיתא206 ${FAMILY}`);
      assert.ok(row.includes('+972522063002'));
      assert.equal(row.includes('+972522063001'), false);

      const written = await audits(
        pool,
        'parties.contact.primary',
        operator.staffAccountId,
      );
      assert.equal(written.length, 1);
      assert.equal(written[0]?.actor_role, 'OPERATOR');
      assert.equal(written[0]?.subject_id, person.id);
      const inputs = JSON.parse(written[0]?.inputs ?? '{}') as {
        partyId?: string;
        contactId?: string;
        channel?: string;
      };
      assert.equal(inputs.partyId, person.id);
      assert.equal(inputs.contactId, id);
      assert.equal(inputs.channel, 'PHONE');
    } finally {
      await cleanup(pool);
      await pool.end();
    }
  });

  it('a phone search matches a closed contact and marks it as a former number', async (t) => {
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
    const person = await createParty(pool, {
      kind: 'PERSON',
      givenName: 'עמיתא206',
      familyName: FAMILY,
      preferredLanguage: 'he',
    });
    await upsertPartyContact(pool, {
      partyId: person.id,
      channel: 'PHONE',
      value: '+972522064001',
      isPrimary: true,
      validFrom: '2024-01-01',
      validTo: null,
      verifiedAt: null,
    });
    await upsertPartyContact(pool, {
      partyId: person.id,
      channel: 'PHONE',
      value: '+972522064099',
      isPrimary: false,
      validFrom: '2022-01-01',
      validTo: '2025-03-01',
      verifiedAt: null,
    });
    const client = asOperator(app, operator);
    try {
      const former = await client.inject({
        method: 'GET',
        url: `/parties?q=${encodeURIComponent('052-206-4099')}`,
      });
      assert.equal(former.statusCode, 200);
      assert.match(former.body, /עמיתא206/);
      assert.match(former.body, /מספר לשעבר/);
      const current = await client.inject({
        method: 'GET',
        url: `/parties?q=${encodeURIComponent('052-206-4001')}`,
      });
      assert.match(current.body, /עמיתא206/);
      assert.equal(current.body.includes('מספר לשעבר'), false);
    } finally {
      await cleanup(pool);
      await pool.end();
    }
  });

  it('refuses a viewer, and writes no contact and no audit', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    const clock = fixedClock(AT);
    const app = buildApp({ pool, version: '9.9.9-test', clock });
    await cleanup(pool);
    const viewer = await signIn(pool, clock, {
      email: `view@${DOMAIN}`,
      role: 'VIEWER',
    });
    const person = await createParty(pool, {
      kind: 'PERSON',
      givenName: 'עמיתא206',
      familyName: FAMILY,
      preferredLanguage: 'he',
    });
    const existing = await upsertPartyContact(pool, {
      partyId: person.id,
      channel: 'PHONE',
      value: '+972522065001',
      isPrimary: false,
      validFrom: '2024-01-01',
      validTo: null,
      verifiedAt: null,
    });
    const client = asOperator(app, viewer);
    try {
      const added = await client.inject({
        method: 'POST',
        url: `/parties/${person.id}/contacts`,
        ...POST,
        payload: 'channel=PHONE&value=052-206-5002&valid_from=2026-10-11',
      });
      assert.equal(added.statusCode, 403);
      const marked = await client.inject({
        method: 'POST',
        url: `/parties/${person.id}/contacts/${existing.id}/primary`,
        ...POST,
        payload: '',
      });
      assert.equal(marked.statusCode, 403);
      const closed = await client.inject({
        method: 'POST',
        url: `/parties/${person.id}/contacts/${existing.id}/close`,
        ...POST,
        payload: 'valid_to=2026-10-11',
      });
      assert.equal(closed.statusCode, 403);
      const rows = await stored(pool, person.id);
      assert.equal(rows.length, 1);
      assert.equal(rows[0]?.is_primary, false);
      assert.equal(rows[0]?.valid_to, null);
      assert.equal(
        (await audits(pool, 'parties.contact.add', viewer.staffAccountId))
          .length,
        0,
      );
      assert.equal(
        (await audits(pool, 'parties.contact.primary', viewer.staffAccountId))
          .length,
        0,
      );
      assert.equal(
        (await audits(pool, 'parties.contact.close', viewer.staffAccountId))
          .length,
        0,
      );
    } finally {
      await cleanup(pool);
      await pool.end();
    }
  });
});
