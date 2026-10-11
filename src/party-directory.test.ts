// #202. The אנשי קשר tab, driven the way the office drives it: a signed-in role
// opens the list, searches, and reads a profile. Nothing here calls the parties
// module except to put a row in place first.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { asOperator, signIn, signOutAll } from '../tests/support/session.ts';
import { buildApp } from './app.ts';
import { fixedClock } from './kernel/clock.ts';
import { migratedPoolOrNull, skipReason } from './kernel/pg-support.ts';
import {
  createParty,
  upsertParty,
  upsertPartyContact,
} from './parties/contract.ts';
import { normalisePhone } from './scope/contract.ts';

const AT = new Date('2026-10-11T09:00:00.000Z');
const DOMAIN = 'party-directory.test';
const SECRET = 'PD202-9f3c1a';
const PERSON = 'עמיתא202 קשקוש202';
const COMPANY = 'מיזוג202 הדגמה202';
const PHONE = '+972599000202';
const CLOSED_PHONE = '+972599000299';
const OTHER_PHONE = '+972599000277';
const EMAIL = 'Dana202@Example.test';

function rowOf(html: string, name: string): string {
  const at = html.indexOf(`>${name}</a>`);
  assert.ok(at > 0, name);
  const start = html.lastIndexOf('<tr', at);
  const end = html.indexOf('</tr>', at);
  return html.slice(start, end);
}

async function cleanup(pool: import('pg').Pool): Promise<void> {
  await pool.query(
    `DELETE FROM party_contact
      WHERE party_id IN (
        SELECT party_id FROM party
         WHERE family_name = 'קשקוש202'
            OR legal_name = $1
            OR national_id = $2
      )`,
    [COMPANY, SECRET],
  );
  await pool.query(
    `DELETE FROM party
      WHERE family_name = 'קשקוש202'
         OR legal_name = $1
         OR national_id = $2`,
    [COMPANY, SECRET],
  );
  await signOutAll(pool, DOMAIN);
}

describe('parties · the אנשי קשר tab', { concurrency: false }, () => {
  it('lists every party for an operator and an admin, and refuses a viewer', async (t) => {
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
    const admin = await signIn(pool, clock, {
      email: `admin@${DOMAIN}`,
      role: 'ADMIN',
    });
    const viewer = await signIn(pool, clock, {
      email: `view@${DOMAIN}`,
      role: 'VIEWER',
    });
    const person = await createParty(pool, {
      kind: 'PERSON',
      givenName: 'עמיתא202',
      familyName: 'קשקוש202',
      preferredLanguage: 'fr',
    });
    const company = await createParty(pool, {
      kind: 'COMPANY',
      legalName: COMPANY,
      preferredLanguage: 'he',
    });
    const identified = await upsertParty(pool, {
      kind: 'PERSON',
      givenName: 'נסתר202',
      familyName: 'קשקוש202',
      nationalId: SECRET,
      preferredLanguage: 'he',
    });
    await upsertPartyContact(pool, {
      partyId: person.id,
      channel: 'PHONE',
      value: PHONE,
      isPrimary: true,
      validFrom: '2024-03-01',
      validTo: null,
      verifiedAt: null,
    });
    await upsertPartyContact(pool, {
      partyId: person.id,
      channel: 'EMAIL',
      value: EMAIL,
      isPrimary: true,
      validFrom: '2024-03-01',
      validTo: null,
      verifiedAt: null,
    });
    await upsertPartyContact(pool, {
      partyId: person.id,
      channel: 'PHONE',
      value: CLOSED_PHONE,
      isPrimary: false,
      validFrom: '2022-01-01',
      validTo: '2025-03-01',
      verifiedAt: null,
    });
    await upsertPartyContact(pool, {
      partyId: person.id,
      channel: 'PHONE',
      value: OTHER_PHONE,
      isPrimary: false,
      validFrom: '2024-06-01',
      validTo: null,
      verifiedAt: null,
    });
    await upsertPartyContact(pool, {
      partyId: company.id,
      channel: 'PHONE',
      value: normalisePhone('03-555-0100'),
      isPrimary: true,
      validFrom: '2023-01-01',
      validTo: null,
      verifiedAt: null,
    });
    try {
      const ops = asOperator(app, operator);
      const list = await ops.inject({ method: 'GET', url: '/parties' });
      assert.equal(list.statusCode, 200);
      assert.match(list.body, /אנשי קשר/);
      assert.match(list.body, /href="\/parties"/);
      const personRow = rowOf(list.body, PERSON);
      assert.match(personRow, new RegExp(`href="/parties/${person.id}"`));
      assert.ok(personRow.includes(PHONE));
      assert.match(personRow, /Dana202@Example\.test/);
      assert.match(personRow, /צרפתית/);
      assert.equal(personRow.includes(OTHER_PHONE), false);
      assert.equal(personRow.includes(CLOSED_PHONE), false);
      const companyRow = rowOf(list.body, COMPANY);
      assert.match(companyRow, new RegExp(`href="/parties/${company.id}"`));
      assert.match(companyRow, /\+97235550100/);
      assert.match(companyRow, /עברית/);
      assert.match(list.body, new RegExp(`href="/parties/${identified.id}"`));
      assert.doesNotMatch(list.body, new RegExp(SECRET));

      const home = await ops.inject({ method: 'GET', url: '/' });
      assert.equal(home.statusCode, 200);
      assert.match(home.body, /href="\/parties"/);
      assert.match(home.body, />אנשי קשר</);

      const asAdmin = asOperator(app, admin);
      const adminList = await asAdmin.inject({
        method: 'GET',
        url: '/parties',
      });
      assert.equal(adminList.statusCode, 200);
      assert.match(adminList.body, new RegExp(PERSON));
      assert.doesNotMatch(adminList.body, new RegExp(SECRET));
      const adminFound = await asAdmin.inject({
        method: 'GET',
        url: `/parties?q=${encodeURIComponent('עמיתא202')}`,
      });
      assert.equal(adminFound.statusCode, 200);
      assert.match(adminFound.body, new RegExp(PERSON));
      assert.doesNotMatch(adminFound.body, new RegExp(SECRET));
      const adminProfile = await asAdmin.inject({
        method: 'GET',
        url: `/parties/${identified.id}`,
      });
      assert.equal(adminProfile.statusCode, 200);
      assert.match(adminProfile.body, /נסתר202/);
      assert.doesNotMatch(adminProfile.body, new RegExp(SECRET));
      assert.doesNotMatch(adminProfile.body, /••••/);
      assert.doesNotMatch(adminProfile.body, /national_id/);

      const asViewer = asOperator(app, viewer);
      const refused = await asViewer.inject({ method: 'GET', url: '/parties' });
      assert.equal(refused.statusCode, 403);
      assert.deepEqual(refused.json(), {
        code: 'not_allowed',
        message: 'not_allowed',
      });
      const viewerHome = await asViewer.inject({ method: 'GET', url: '/' });
      assert.equal(viewerHome.statusCode, 200);
      assert.doesNotMatch(viewerHome.body, /אנשי קשר/);
      assert.doesNotMatch(viewerHome.body, /href="\/parties"/);

      const profileRefused = await asViewer.inject({
        method: 'GET',
        url: `/parties/${person.id}`,
      });
      assert.equal(profileRefused.statusCode, 403);
      assert.doesNotMatch(profileRefused.body, new RegExp(SECRET));
      const searchRefused = await asViewer.inject({
        method: 'GET',
        url: `/parties?q=${encodeURIComponent('עמיתא202')}`,
      });
      assert.equal(searchRefused.statusCode, 403);
    } finally {
      await cleanup(pool);
      await pool.end();
    }
  });

  it('finds a party by any word of a name, by a phone in any form, and by an email in any case', async (t) => {
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
      givenName: 'עמיתא202',
      familyName: 'קשקוש202',
      preferredLanguage: 'he',
    });
    await createParty(pool, {
      kind: 'COMPANY',
      legalName: COMPANY,
      preferredLanguage: 'he',
    });
    await upsertPartyContact(pool, {
      partyId: person.id,
      channel: 'PHONE',
      value: PHONE,
      isPrimary: true,
      validFrom: '2024-03-01',
      validTo: null,
      verifiedAt: null,
    });
    await upsertPartyContact(pool, {
      partyId: person.id,
      channel: 'EMAIL',
      value: EMAIL,
      isPrimary: true,
      validFrom: '2024-03-01',
      validTo: null,
      verifiedAt: null,
    });
    await upsertPartyContact(pool, {
      partyId: person.id,
      channel: 'PHONE',
      value: CLOSED_PHONE,
      isPrimary: false,
      validFrom: '2022-01-01',
      validTo: '2025-03-01',
      verifiedAt: null,
    });
    const client = asOperator(app, operator);
    try {
      for (const [word, name, other] of [
        ['עמיתא202', PERSON, COMPANY],
        ['קשקוש202', PERSON, COMPANY],
        ['מיזוג202', COMPANY, PERSON],
        ['הדגמה202', COMPANY, PERSON],
      ] as const) {
        const found = await client.inject({
          method: 'GET',
          url: `/parties?q=${encodeURIComponent(word)}`,
        });
        assert.equal(found.statusCode, 200, word);
        assert.match(found.body, new RegExp(name), word);
        assert.doesNotMatch(found.body, new RegExp(other), word);
      }
      const fragment = await client.inject({
        method: 'GET',
        url: `/parties?q=${encodeURIComponent('קשק')}`,
      });
      assert.equal(fragment.statusCode, 200);
      assert.doesNotMatch(fragment.body, new RegExp(PERSON));
      assert.doesNotMatch(fragment.body, new RegExp(COMPANY));

      for (const typed of [
        '0599000202',
        '059 900 0202',
        '059-900-0202',
        '+972599000202',
        '059-900-0299',
      ]) {
        const found = await client.inject({
          method: 'GET',
          url: `/parties?q=${encodeURIComponent(typed)}`,
        });
        assert.equal(found.statusCode, 200, typed);
        assert.match(found.body, new RegExp(PERSON), typed);
        assert.doesNotMatch(found.body, new RegExp(COMPANY), typed);
      }

      const email = await client.inject({
        method: 'GET',
        url: `/parties?q=${encodeURIComponent('dana202@example.test')}`,
      });
      assert.equal(email.statusCode, 200);
      assert.match(email.body, new RegExp(PERSON));
      assert.doesNotMatch(email.body, new RegExp(COMPANY));
      assert.match(email.body, /Dana202@Example\.test/);
    } finally {
      await cleanup(pool);
      await pool.end();
    }
  });

  it('opens a read-only profile with the split name and every contact, and never an identifier', async (t) => {
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
      givenName: 'עמיתא202',
      familyName: 'קשקוש202',
      preferredLanguage: 'ar',
    });
    const company = await createParty(pool, {
      kind: 'COMPANY',
      legalName: COMPANY,
      preferredLanguage: 'en',
    });
    const identified = await upsertParty(pool, {
      kind: 'PERSON',
      givenName: 'נסתר202',
      familyName: 'קשקוש202',
      nationalId: SECRET,
      preferredLanguage: 'he',
    });
    await upsertPartyContact(pool, {
      partyId: person.id,
      channel: 'PHONE',
      value: PHONE,
      isPrimary: true,
      validFrom: '2024-03-01',
      validTo: null,
      verifiedAt: null,
    });
    await upsertPartyContact(pool, {
      partyId: person.id,
      channel: 'EMAIL',
      value: EMAIL,
      isPrimary: true,
      validFrom: '2024-03-01',
      validTo: null,
      verifiedAt: null,
    });
    await upsertPartyContact(pool, {
      partyId: person.id,
      channel: 'PHONE',
      value: CLOSED_PHONE,
      isPrimary: false,
      validFrom: '2022-01-01',
      validTo: '2025-03-01',
      verifiedAt: null,
    });
    const client = asOperator(app, operator);
    try {
      const profile = await client.inject({
        method: 'GET',
        url: `/parties/${person.id}`,
      });
      assert.equal(profile.statusCode, 200);
      assert.match(profile.body, /שם פרטי/);
      assert.match(profile.body, /עמיתא202/);
      assert.match(profile.body, /שם משפחה/);
      assert.match(profile.body, /קשקוש202/);
      assert.match(profile.body, /אדם/);
      assert.match(profile.body, /ערבית/);
      assert.ok(profile.body.includes(PHONE));
      assert.match(profile.body, /פתוח/);
      assert.match(profile.body, /ראשי/);
      assert.match(profile.body, /2024-03-01/);
      assert.match(profile.body, /Dana202@Example\.test/);
      assert.ok(profile.body.includes(CLOSED_PHONE));
      assert.match(profile.body, /סגור/);
      assert.match(profile.body, /2022-01-01/);
      assert.match(profile.body, /2025-03-01/);
      assert.match(profile.body, /href="\/parties"/);
      assert.doesNotMatch(profile.body, /עריכ/);
      assert.doesNotMatch(profile.body, new RegExp(SECRET));
      assert.doesNotMatch(profile.body, /national_id/);

      const firm = await client.inject({
        method: 'GET',
        url: `/parties/${company.id}`,
      });
      assert.equal(firm.statusCode, 200);
      assert.match(firm.body, /שם משפטי/);
      assert.match(firm.body, new RegExp(COMPANY));
      assert.match(firm.body, /חברה/);
      assert.match(firm.body, /אנגלית/);
      assert.doesNotMatch(firm.body, /שם פרטי/);
      assert.doesNotMatch(firm.body, /שם משפחה/);

      const hidden = await client.inject({
        method: 'GET',
        url: `/parties/${identified.id}`,
      });
      assert.equal(hidden.statusCode, 200);
      assert.match(hidden.body, /נסתר202/);
      assert.doesNotMatch(hidden.body, new RegExp(SECRET));
      assert.doesNotMatch(hidden.body, /••••/);
    } finally {
      await cleanup(pool);
      await pool.end();
    }
  });
});
