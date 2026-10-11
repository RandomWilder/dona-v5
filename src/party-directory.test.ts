// #202. The אנשי קשר tab, driven the way the office drives it: a signed-in role
// opens the list, searches, and reads a profile. Nothing here calls the parties
// module except to put a row in place first.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { asOperator, signIn, signOutAll } from '../tests/support/session.ts';
import { buildApp } from './app.ts';
import { fixedClock } from './kernel/clock.ts';
import { newId } from './kernel/ids.ts';
import { migratedPoolOrNull, skipReason } from './kernel/pg-support.ts';
import {
  createParty,
  upsertParty,
  upsertPartyContact,
} from './parties/contract.ts';
import { normalisePhone } from './scope/contract.ts';
import {
  upsertTenancy,
  upsertTenancyParty,
  upsertTermsProfile,
} from './tenancy/contract.ts';

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

  it('labels each party from its tenancies, and filters by that label', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    // Late on the office day, so the next morning is inside the session's idle
    // window. The term still includes this day and excludes the next.
    const clock = fixedClock(new Date('2026-10-11T20:30:00.000Z'));
    const app = buildApp({ pool, version: '9.9.9-test', clock });
    await cleanupLabels(pool);
    const operator = await signIn(pool, clock, {
      email: `ops@${LABEL_DOMAIN}`,
      role: 'OPERATOR',
    });
    const terms = await upsertTermsProfile(pool, LABEL_TERMS);
    const primary = await labelledParty(pool, 'ראשי203');
    const coTenant = await labelledParty(pool, 'שותף203');
    const occupant = await labelledParty(pool, 'דייר203');
    const ended = await labelledParty(pool, 'עבר203');
    const early = await labelledParty(pool, 'מוקדם203');
    const draft = await labelledParty(pool, 'טיוטה203');
    const guarantor = await labelledParty(pool, 'ערב203');
    const both = await labelledParty(pool, 'כפול203');
    const changing = await labelledParty(pool, 'מחליף203');
    const unrelated = await labelledParty(pool, 'בודד203');
    const notStarted = await labelledParty(pool, 'עתיד203');
    const primaryLetting = await placeLetting(pool, terms.id, '2031', {
      status: 'ACTIVE',
      startDate: '2024-01-01',
      endDate: '2027-01-01',
      partyId: primary,
      role: 'PRIMARY_TENANT',
    });
    await placeLetting(pool, terms.id, '2032', {
      status: 'ACTIVE',
      startDate: '2024-02-01',
      endDate: '2027-01-01',
      partyId: coTenant,
      role: 'CO_TENANT',
    });
    await placeLetting(pool, terms.id, '2033', {
      status: 'ACTIVE',
      startDate: '2024-03-01',
      endDate: '2027-01-01',
      partyId: occupant,
      role: 'OCCUPANT',
    });
    await placeLetting(pool, terms.id, '2034', {
      status: 'ENDED',
      startDate: '2020-01-01',
      endDate: '2024-01-01',
      partyId: ended,
      role: 'PRIMARY_TENANT',
    });
    await placeLetting(pool, terms.id, '2035', {
      status: 'TERMINATED_EARLY',
      startDate: '2024-01-01',
      endDate: '2027-06-01',
      actualMoveOut: '2026-06-01',
      partyId: early,
      role: 'PRIMARY_TENANT',
    });
    await placeLetting(pool, terms.id, '2036', {
      status: 'DRAFT',
      startDate: '2024-01-01',
      endDate: '2027-01-01',
      partyId: draft,
      role: 'PRIMARY_TENANT',
    });
    await placeLetting(pool, terms.id, '2037', {
      status: 'ACTIVE',
      startDate: '2024-04-01',
      endDate: '2027-01-01',
      partyId: guarantor,
      role: 'GUARANTOR',
    });
    await placeLetting(pool, terms.id, '2038', {
      status: 'DRAFT',
      startDate: '2025-01-01',
      endDate: '2027-01-01',
      partyId: guarantor,
      role: 'GUARANTOR',
    });
    await placeLetting(pool, terms.id, '2039', {
      status: 'TERMINATED_EARLY',
      startDate: '2023-01-01',
      endDate: '2027-06-01',
      actualMoveOut: '2026-03-01',
      partyId: guarantor,
      role: 'GUARANTOR',
    });
    const bothLetting = await placeLetting(pool, terms.id, '2040', {
      status: 'ACTIVE',
      startDate: '2024-05-01',
      endDate: '2027-01-01',
      partyId: both,
      role: 'PRIMARY_TENANT',
    });
    const bothGuarantee = await placeLetting(pool, terms.id, '2041', {
      status: 'ACTIVE',
      startDate: '2024-06-01',
      endDate: '2027-01-01',
      partyId: both,
      role: 'GUARANTOR',
    });
    await placeLetting(pool, terms.id, '2042', {
      status: 'ACTIVE',
      startDate: '2024-01-01',
      endDate: '2026-10-11',
      partyId: changing,
      role: 'PRIMARY_TENANT',
    });
    await placeLetting(pool, terms.id, '2043', {
      status: 'ACTIVE',
      startDate: '2026-11-01',
      endDate: '2027-11-01',
      partyId: notStarted,
      role: 'PRIMARY_TENANT',
    });
    const client = asOperator(app, operator);
    const partyBefore = await partyRow(pool, changing);
    try {
      const list = await client.inject({ method: 'GET', url: '/parties' });
      assert.equal(list.statusCode, 200);
      const currentRow = rowOf(list.body, 'ראשי203 תווית203');
      assert.match(currentRow, /שוכר נוכחי/);
      assert.match(currentRow, /שוכר ראשי/);
      assert.match(currentRow, /דירה 2031/);
      assert.doesNotMatch(currentRow, /שוכר לשעבר/);
      const coRow = rowOf(list.body, 'שותף203 תווית203');
      assert.match(coRow, /שוכר נוכחי/);
      assert.match(coRow, /שוכר נוסף/);
      assert.doesNotMatch(coRow, /שוכר ראשי/);
      const occupantRow = rowOf(list.body, 'דייר203 תווית203');
      assert.match(occupantRow, /שוכר נוכחי/);
      assert.match(occupantRow, /דייר/);
      assert.doesNotMatch(occupantRow, /שוכר ראשי/);
      assert.doesNotMatch(occupantRow, /שוכר נוסף/);
      assert.match(rowOf(list.body, 'עבר203 תווית203'), /שוכר לשעבר/);
      assert.match(rowOf(list.body, 'מוקדם203 תווית203'), /שוכר לשעבר/);
      assert.doesNotMatch(rowOf(list.body, 'מוקדם203 תווית203'), /שוכר נוכחי/);
      assert.match(rowOf(list.body, 'טיוטה203 תווית203'), /טיוטת חוזה/);
      const guarantorRow = rowOf(list.body, 'ערב203 תווית203');
      assert.match(guarantorRow, /ערב · פעיל · דירה 2037/);
      assert.match(guarantorRow, /ערב · טיוטה · דירה 2038/);
      assert.match(guarantorRow, /ערב · עבר · דירה 2039/);
      assert.doesNotMatch(guarantorRow, /שוכר/);
      const bothRow = rowOf(list.body, 'כפול203 תווית203');
      assert.match(bothRow, /שוכר נוכחי · שוכר ראשי · דירה 2040/);
      assert.match(bothRow, /ערב · פעיל · דירה 2041/);
      assert.match(rowOf(list.body, 'מחליף203 תווית203'), /שוכר נוכחי/);
      assert.match(rowOf(list.body, 'בודד203 תווית203'), /אין קשר/);
      const waitingRow = rowOf(list.body, 'עתיד203 תווית203');
      assert.doesNotMatch(waitingRow, /שוכר/);
      assert.doesNotMatch(waitingRow, /אין קשר/);
      assert.doesNotMatch(waitingRow, /ערב/);

      const currentOnly = await client.inject({
        method: 'GET',
        url: `/parties?q=${encodeURIComponent(LABEL_FAMILY)}&label=current`,
      });
      assert.equal(currentOnly.statusCode, 200);
      assert.deepEqual(namesIn(currentOnly.body).sort(), [
        'דייר203 תווית203',
        'כפול203 תווית203',
        'מחליף203 תווית203',
        'ראשי203 תווית203',
        'שותף203 תווית203',
      ]);
      const pastOnly = await client.inject({
        method: 'GET',
        url: `/parties?q=${encodeURIComponent(LABEL_FAMILY)}&label=past`,
      });
      assert.deepEqual(namesIn(pastOnly.body).sort(), [
        'מוקדם203 תווית203',
        'עבר203 תווית203',
      ]);
      const draftOnly = await client.inject({
        method: 'GET',
        url: `/parties?q=${encodeURIComponent(LABEL_FAMILY)}&label=draft`,
      });
      assert.deepEqual(namesIn(draftOnly.body), ['טיוטה203 תווית203']);
      const guarantors = await client.inject({
        method: 'GET',
        url: `/parties?q=${encodeURIComponent(LABEL_FAMILY)}&label=guarantor`,
      });
      assert.deepEqual(namesIn(guarantors.body).sort(), [
        'כפול203 תווית203',
        'ערב203 תווית203',
      ]);
      const noRelationship = await client.inject({
        method: 'GET',
        url: `/parties?q=${encodeURIComponent(LABEL_FAMILY)}&label=none`,
      });
      assert.deepEqual(namesIn(noRelationship.body), ['בודד203 תווית203']);
      const searched = await client.inject({
        method: 'GET',
        url: `/parties?q=${encodeURIComponent('ראשי203')}&label=current`,
      });
      assert.deepEqual(namesIn(searched.body), ['ראשי203 תווית203']);
      const missed = await client.inject({
        method: 'GET',
        url: `/parties?q=${encodeURIComponent('ראשי203')}&label=past`,
      });
      assert.deepEqual(namesIn(missed.body), []);
      assert.match(missed.body, /אין התאמה/);

      const profile = await client.inject({
        method: 'GET',
        url: `/parties/${primary}`,
      });
      assert.equal(profile.statusCode, 200);
      assert.match(
        profile.body,
        new RegExp(
          `href="/estate/tenancies/${primaryLetting}"[^>]*>שוכר נוכחי · שוכר ראשי · דירה 2031`,
        ),
      );
      const bothProfile = await client.inject({
        method: 'GET',
        url: `/parties/${both}`,
      });
      assert.match(
        bothProfile.body,
        new RegExp(`href="/estate/tenancies/${bothLetting}"`),
      );
      assert.match(
        bothProfile.body,
        new RegExp(`href="/estate/tenancies/${bothGuarantee}"`),
      );
      const guarantorProfile = await client.inject({
        method: 'GET',
        url: `/parties/${guarantor}`,
      });
      assert.match(guarantorProfile.body, /ערב · פעיל · דירה 2037/);
      assert.doesNotMatch(guarantorProfile.body, /שוכר/);
      const alone = await client.inject({
        method: 'GET',
        url: `/parties/${unrelated}`,
      });
      assert.match(alone.body, /אין קשר/);
      assert.doesNotMatch(alone.body, /\/estate\/tenancies\//);

      clock.advance(40 * 60 * 1000);
      const later = await client.inject({
        method: 'GET',
        url: `/parties?q=${encodeURIComponent('מחליף203')}`,
      });
      const laterRow = rowOf(later.body, 'מחליף203 תווית203');
      assert.match(laterRow, /שוכר לשעבר/);
      assert.doesNotMatch(laterRow, /שוכר נוכחי/);
      assert.deepEqual(await partyRow(pool, changing), partyBefore);
      const stillActive = await pool.query<{ status: string }>(
        `SELECT status FROM tenancy t
           JOIN tenancy_party tp ON tp.tenancy_id = t.tenancy_id
          WHERE tp.party_id = $1`,
        [changing],
      );
      assert.equal(stillActive.rows[0]?.status, 'ACTIVE');
    } finally {
      await cleanupLabels(pool);
      await pool.end();
    }
  });
});

const LABEL_DOMAIN = 'party-labels.test';
const LABEL_FAMILY = 'תווית203';
const LABEL_TERMS = 'label-203-terms';

function namesIn(html: string): string[] {
  const start = html.indexOf('<tbody>');
  if (start < 0) return [];
  const body = html.slice(start, html.indexOf('</tbody>'));
  const names: string[] = [];
  const pattern = />([^<]*תווית203)<\/a>/g;
  for (const match of body.matchAll(pattern)) {
    const name = match[1];
    if (name) names.push(name);
  }
  return names;
}

async function partyRow(
  pool: import('pg').Pool,
  partyId: string,
): Promise<unknown[]> {
  const result = await pool.query(
    `SELECT party_kind, given_name, family_name, legal_name, full_name,
            national_id, preferred_language
       FROM party
      WHERE party_id = $1`,
    [partyId],
  );
  return result.rows;
}

async function labelledParty(
  pool: import('pg').Pool,
  givenName: string,
): Promise<string> {
  const made = await createParty(pool, {
    kind: 'PERSON',
    givenName,
    familyName: LABEL_FAMILY,
    preferredLanguage: 'he',
  });
  return made.id;
}

async function placeLetting(
  pool: import('pg').Pool,
  termsProfileId: string,
  unitNumber: string,
  spec: {
    status: 'DRAFT' | 'ACTIVE' | 'ENDED' | 'TERMINATED_EARLY';
    startDate: string;
    endDate: string;
    actualMoveOut?: string;
    partyId: string;
    role: 'PRIMARY_TENANT' | 'CO_TENANT' | 'OCCUPANT' | 'GUARANTOR';
  },
): Promise<string> {
  const buildingId = newId();
  const unitId = newId();
  await pool.query(
    `INSERT INTO building (building_id, name, address_line, city, handover_date,
                           warranty_end_date, status)
     VALUES ($1, $2, $3, 'שוהם', '2020-01-01', '2022-01-01', 'ACTIVE')`,
    [buildingId, `label-203-${buildingId}`, `רחוב תווית ${buildingId}`],
  );
  await pool.query(
    `INSERT INTO space (space_id, building_id, space_kind, name)
     VALUES ($1, $2, 'UNIT', $3)`,
    [unitId, buildingId, `דירה ${unitNumber}`],
  );
  await pool.query(
    `INSERT INTO unit (unit_id, unit_number, rooms, has_mamad, condition_status)
     VALUES ($1, $2, 3.5, false, 'READY')`,
    [unitId, unitNumber],
  );
  const tenancy = await upsertTenancy(pool, {
    unitId,
    startDate: spec.startDate,
    endDate: spec.endDate,
    status: spec.status,
    termsProfileId,
    noticeDate: null,
    actualMoveOut: spec.actualMoveOut ?? null,
  });
  await upsertTenancyParty(pool, {
    tenancyId: tenancy.id,
    partyId: spec.partyId,
    role: spec.role,
    isServiceContact: spec.role !== 'GUARANTOR',
  });
  return tenancy.id;
}

async function cleanupLabels(pool: import('pg').Pool): Promise<void> {
  await pool.query(
    `DELETE FROM tenancy_party
      WHERE party_id IN (SELECT party_id FROM party WHERE family_name = $1)`,
    [LABEL_FAMILY],
  );
  await pool.query(
    `DELETE FROM tenancy_event
      WHERE tenancy_id IN (
        SELECT tenancy_id FROM tenancy
         WHERE unit_id IN (
           SELECT space_id FROM space
            WHERE building_id IN (
              SELECT building_id FROM building WHERE name LIKE 'label-203-%'
            )
         )
      )`,
  );
  await pool.query(
    `DELETE FROM tenancy
      WHERE unit_id IN (
        SELECT space_id FROM space
         WHERE building_id IN (
           SELECT building_id FROM building WHERE name LIKE 'label-203-%'
         )
      )`,
  );
  await pool.query(
    `DELETE FROM unit
      WHERE unit_id IN (
        SELECT space_id FROM space
         WHERE building_id IN (
           SELECT building_id FROM building WHERE name LIKE 'label-203-%'
         )
      )`,
  );
  await pool.query(
    `DELETE FROM space
      WHERE building_id IN (
        SELECT building_id FROM building WHERE name LIKE 'label-203-%'
      )`,
  );
  await pool.query(`DELETE FROM building WHERE name LIKE 'label-203-%'`);
  await pool.query(`DELETE FROM terms_profile WHERE name = $1`, [LABEL_TERMS]);
  await pool.query(`DELETE FROM party WHERE family_name = $1`, [LABEL_FAMILY]);
  await signOutAll(pool, LABEL_DOMAIN);
}
