// #207. Creating a party by hand, driven the way the office drives it: a signed-in
// operator posts the form on אנשי קשר and lands on the new profile, or the form
// comes back with the reason and no row.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Pool } from 'pg';
import { asOperator, signIn, signOutAll } from '../tests/support/session.ts';
import { buildApp } from './app.ts';
import { fixedClock } from './kernel/clock.ts';
import { migratedPoolOrNull, skipReason } from './kernel/pg-support.ts';
import {
  createParty,
  upsertParty,
  upsertPartyContact,
} from './parties/contract.ts';

const AT = new Date('2026-10-11T09:00:00.000Z');
const DOMAIN = 'party-create.test';
const FAMILY = 'קשקוש207';
const LEGAL = 'מיזוג207 הדגמה';
const POST = {
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
};

async function cleanup(pool: Pool): Promise<void> {
  await pool.query(
    `DELETE FROM party_contact
      WHERE party_id IN (
        SELECT party_id FROM party
         WHERE family_name = $1 OR legal_name = $2
      )`,
    [FAMILY, LEGAL],
  );
  await pool.query(
    'DELETE FROM party WHERE family_name = $1 OR legal_name = $2',
    [FAMILY, LEGAL],
  );
  await signOutAll(pool, DOMAIN);
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

function partyIdFrom(location: unknown): string {
  const id = String(location ?? '').match(/^\/parties\/([0-9a-f-]{36})$/)?.[1];
  assert.ok(id, `location ${String(location)}`);
  return id;
}

describe('parties · create by hand', { concurrency: false }, () => {
  it('creates a person with a family name and one phone, and opens the profile', async (t) => {
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
    const client = asOperator(app, operator);
    try {
      const list = await client.inject({ method: 'GET', url: '/parties' });
      assert.equal(list.statusCode, 200);
      assert.match(list.body, /href="\/parties\/new\?kind=person"/);
      assert.match(list.body, /href="\/parties\/new\?kind=company"/);

      const form = await client.inject({
        method: 'GET',
        url: '/parties/new?kind=person',
      });
      assert.equal(form.statusCode, 200);
      assert.match(form.body, /אדם חדש/);
      assert.equal(form.body.includes('name="identifier"'), false);

      const created = await client.inject({
        method: 'POST',
        url: '/parties',
        ...POST,
        payload: `kind=PERSON&given_name=${encodeURIComponent('עמיתא207')}&family_name=${encodeURIComponent(FAMILY)}&language=ar&contact=${encodeURIComponent('052-207-1001')}`,
      });
      assert.equal(created.statusCode, 303);
      const partyId = partyIdFrom(created.headers.location);

      const profile = await client.inject({
        method: 'GET',
        url: `/parties/${partyId}`,
      });
      assert.equal(profile.statusCode, 200);
      assert.match(profile.body, new RegExp(`<h1>עמיתא207 ${FAMILY}</h1>`));
      assert.match(profile.body, /ערבית/);
      assert.match(profile.body, /\+972522071001/);
      assert.equal(profile.body.includes('052-207-1001'), false);
      assert.match(profile.body, /2026-10-11/);
      assert.match(profile.body, /ראשי/);
      assert.match(profile.body, /יצירה/);

      const found = await client.inject({
        method: 'GET',
        url: `/parties?q=${encodeURIComponent(FAMILY)}`,
      });
      assert.match(found.body, /\+972522071001/);

      const written = await audits(
        pool,
        'parties.create',
        operator.staffAccountId,
      );
      assert.equal(written.length, 1);
      const row = written[0];
      assert.ok(row);
      assert.equal(row.actor_role, 'OPERATOR');
      assert.equal(row.subject_id, partyId);
      const inputs = JSON.parse(row.inputs) as {
        partyId?: string;
        channel?: string;
      };
      assert.equal(inputs.partyId, partyId);
      assert.equal(inputs.channel, 'PHONE');
      // The party id is a random uuid, and one in a hundred or so contains "052" by chance.
      const scrubbed = row.inputs.replaceAll(partyId, '');
      assert.equal(scrubbed.includes('+972'), false);
      assert.equal(scrubbed.includes('052'), false);
      assert.equal(scrubbed.includes('2071001'), false);
      assert.equal(row.inputs.includes('national_id'), false);
      assert.equal(
        (await audits(pool, 'parties.contact.add', operator.staffAccountId))
          .length,
        0,
      );
    } finally {
      await cleanup(pool);
      await pool.end();
    }
  });

  it('creates a company with a legal name and one email', async (t) => {
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
    const client = asOperator(app, operator);
    try {
      const form = await client.inject({
        method: 'GET',
        url: '/parties/new?kind=company',
      });
      assert.equal(form.statusCode, 200);
      assert.match(form.body, /חברה חדשה/);
      assert.equal(form.body.includes('name="identifier"'), false);

      const created = await client.inject({
        method: 'POST',
        url: '/parties',
        ...POST,
        payload: `kind=COMPANY&legal_name=${encodeURIComponent(LEGAL)}&language=ru&contact=${encodeURIComponent('Office207@Example.test')}`,
      });
      assert.equal(created.statusCode, 303);
      const profile = await client.inject({
        method: 'GET',
        url: `/parties/${partyIdFrom(created.headers.location)}`,
      });
      assert.equal(profile.statusCode, 200);
      assert.match(profile.body, new RegExp(`<h1>${LEGAL}</h1>`));
      assert.match(profile.body, /רוסית/);
      assert.match(profile.body, /office207@example\.test/);
      assert.equal(profile.body.includes('Office207@Example.test'), false);

      const found = await client.inject({
        method: 'GET',
        url: `/parties?q=${encodeURIComponent('מיזוג207')}`,
      });
      assert.match(found.body, /office207@example\.test/);
    } finally {
      await cleanup(pool);
      await pool.end();
    }
  });

  it('refuses a party with neither a contact nor a national id, and writes nothing', async (t) => {
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
    const client = asOperator(app, operator);
    try {
      const person = await client.inject({
        method: 'POST',
        url: '/parties',
        ...POST,
        payload: `kind=PERSON&given_name=${encodeURIComponent('ריק207')}&family_name=${encodeURIComponent(FAMILY)}&language=he&contact=`,
      });
      assert.equal(person.statusCode, 400);
      assert.match(
        person.body,
        /אי אפשר ליצור איש קשר בלי פרטי קשר ובלי ת\.ז\./,
      );
      assert.match(person.body, /אדם חדש/);

      const company = await client.inject({
        method: 'POST',
        url: '/parties',
        ...POST,
        payload: `kind=COMPANY&legal_name=${encodeURIComponent(LEGAL)}&language=he&contact=`,
      });
      assert.equal(company.statusCode, 400);
      assert.match(
        company.body,
        /אי אפשר ליצור איש קשר בלי פרטי קשר ובלי ת\.ז\./,
      );
      assert.match(company.body, /חברה חדשה/);

      const badPhone = await client.inject({
        method: 'POST',
        url: '/parties',
        ...POST,
        payload: `kind=PERSON&given_name=${encodeURIComponent('שגוי207')}&family_name=${encodeURIComponent(FAMILY)}&language=he&contact=123`,
      });
      assert.equal(badPhone.statusCode, 400);
      assert.match(badPhone.body, /המספר אינו תקין/);

      for (const word of ['ריק207', 'שגוי207', 'מיזוג207']) {
        const found = await client.inject({
          method: 'GET',
          url: `/parties?q=${encodeURIComponent(word)}`,
        });
        assert.match(found.body, /אין התאמה/);
        assert.equal(found.body.includes(`>${word}<`), false);
      }
    } finally {
      await cleanup(pool);
      await pool.end();
    }
  });

  it('refuses a contact or a national id another party holds, and leaves no party', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    const clock = fixedClock(AT);
    const app = buildApp({ pool, version: '9.9.9-test', clock });
    await cleanup(pool);
    const nationalId = await unusedIdentifier(pool);
    const holder = await createParty(pool, {
      kind: 'PERSON',
      givenName: 'מחזיק207',
      familyName: FAMILY,
      preferredLanguage: 'he',
    });
    await upsertPartyContact(pool, {
      partyId: holder.id,
      channel: 'PHONE',
      value: '+972522071099',
      isPrimary: true,
      validFrom: '2026-01-01',
      validTo: null,
      verifiedAt: null,
    });
    const identified = await upsertParty(pool, {
      kind: 'PERSON',
      givenName: 'מזוהה207',
      familyName: FAMILY,
      nationalId,
      preferredLanguage: 'he',
    });
    const admin = await signIn(pool, clock, {
      email: `admin@${DOMAIN}`,
      role: 'ADMIN',
    });
    const client = asOperator(app, admin);
    try {
      const phone = await client.inject({
        method: 'POST',
        url: '/parties',
        ...POST,
        payload: `kind=PERSON&given_name=${encodeURIComponent('חדש207')}&family_name=${encodeURIComponent(FAMILY)}&language=he&contact=${encodeURIComponent('052-207-1099')}`,
      });
      assert.equal(phone.statusCode, 409);
      assert.match(phone.body, /המספר פתוח אצל/);
      assert.match(phone.body, new RegExp(`href="/parties/${holder.id}"`));
      assert.match(phone.body, /מחזיק207/);

      const identifier = await client.inject({
        method: 'POST',
        url: '/parties',
        ...POST,
        payload: `kind=PERSON&given_name=${encodeURIComponent('כפול207')}&family_name=${encodeURIComponent(FAMILY)}&language=he&contact=&identifier=${encodeURIComponent(nationalId)}`,
      });
      assert.equal(identifier.statusCode, 409);
      assert.match(identifier.body, /הת\.ז\. כבר רשומה על/);
      assert.match(
        identifier.body,
        new RegExp(`href="/parties/${identified.id}"`),
      );
      assert.match(identifier.body, /מזוהה207/);

      for (const word of ['חדש207', 'כפול207']) {
        const found = await client.inject({
          method: 'GET',
          url: `/parties?q=${encodeURIComponent(word)}`,
        });
        assert.match(found.body, /אין התאמה/);
      }
      const still = await client.inject({
        method: 'GET',
        url: `/parties/${holder.id}`,
      });
      assert.match(still.body, /\+972522071099/);
    } finally {
      await cleanup(pool);
      await pool.end();
    }
  });

  it('lets an administrator record a national id, and refuses one from an operator', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    const clock = fixedClock(AT);
    const app = buildApp({ pool, version: '9.9.9-test', clock });
    await cleanup(pool);
    const nationalId = await unusedIdentifier(pool);
    const operator = await signIn(pool, clock, {
      email: `ops@${DOMAIN}`,
      role: 'OPERATOR',
    });
    const admin = await signIn(pool, clock, {
      email: `admin@${DOMAIN}`,
      role: 'ADMIN',
    });
    const asOps = asOperator(app, operator);
    const asAdmin = asOperator(app, admin);
    try {
      const forged = await asOps.inject({
        method: 'POST',
        url: '/parties',
        ...POST,
        payload: `kind=PERSON&given_name=${encodeURIComponent('חסום207')}&family_name=${encodeURIComponent(FAMILY)}&language=he&contact=${encodeURIComponent('052-207-1008')}&identifier=${encodeURIComponent(nationalId)}`,
      });
      assert.equal(forged.statusCode, 403);
      assert.equal(forged.json().code, 'not_allowed');
      const absent = await asOps.inject({
        method: 'GET',
        url: `/parties?q=${encodeURIComponent('חסום207')}`,
      });
      assert.match(absent.body, /אין התאמה/);

      const form = await asAdmin.inject({
        method: 'GET',
        url: '/parties/new?kind=person',
      });
      assert.match(form.body, /name="identifier"/);

      const created = await asAdmin.inject({
        method: 'POST',
        url: '/parties',
        ...POST,
        payload: `kind=PERSON&given_name=${encodeURIComponent('מנהל207')}&family_name=${encodeURIComponent(FAMILY)}&language=he&contact=&identifier=${encodeURIComponent(nationalId)}`,
      });
      assert.equal(created.statusCode, 303);
      const partyId = partyIdFrom(created.headers.location);
      const profile = await asAdmin.inject({
        method: 'GET',
        url: `/parties/${partyId}`,
      });
      assert.match(profile.body, /מנהל207/);
      assert.match(profile.body, new RegExp(`•{5}${nationalId.slice(-4)}`));
      assert.equal(profile.body.includes(nationalId), false);

      const written = await audits(
        pool,
        'parties.create',
        admin.staffAccountId,
      );
      assert.equal(written.length, 1);
      const row = written[0];
      assert.ok(row);
      assert.equal(row.actor_role, 'ADMIN');
      assert.equal(row.subject_id, partyId);
      assert.equal(row.inputs.includes(nationalId), false);
      assert.equal(row.inputs.includes('national_id'), false);
      assert.equal(
        (await audits(pool, 'parties.national_id.write', admin.staffAccountId))
          .length,
        0,
      );
      assert.equal(
        (await audits(pool, 'parties.create', operator.staffAccountId)).length,
        0,
      );
    } finally {
      await cleanup(pool);
      await pool.end();
    }
  });
});

async function unusedIdentifier(pool: Pool): Promise<string> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const digits = crypto.randomUUID().replace(/\D/g, '');
    const nine = digits.slice(-9).padStart(9, '7');
    const nationalId = nine.startsWith('0') ? `7${nine.slice(1)}` : nine;
    const taken = await pool.query(
      `SELECT 1 FROM party
        WHERE national_id_key = party_national_id_key('PERSON', $1)
           OR national_id_key = party_national_id_key('COMPANY', $1)`,
      [nationalId],
    );
    if (taken.rowCount === 0) return nationalId;
  }
  throw new Error('could not allocate an identifier');
}
