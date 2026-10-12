// #202. The אנשי קשר tab, driven the way the office drives it: a signed-in role
// opens the list, searches, and reads a profile. #204 adds the ת.ז.: masked,
// revealed, searched and written. #205 corrects a name and a language.
// Nothing here calls the parties module except to put a row in place first.
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

async function unusedIdentifier(pool: import('pg').Pool): Promise<string> {
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

async function unusedLeadingZero(
  pool: import('pg').Pool,
): Promise<{ stored: string; dropped: string }> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const digits = crypto.randomUUID().replace(/\D/g, '');
    const eight = digits.slice(-8).padStart(8, '3');
    const dropped = eight.startsWith('0') ? `3${eight.slice(1)}` : eight;
    const stored = `0${dropped}`;
    const taken = await pool.query(
      `SELECT 1 FROM party
        WHERE national_id_key = party_national_id_key('PERSON', $1)`,
      [stored],
    );
    if (taken.rowCount === 0) return { stored, dropped };
  }
  throw new Error('could not allocate an identifier');
}

async function audits(
  pool: import('pg').Pool,
  action: string,
  actorId: string,
): Promise<
  {
    actor_role: string | null;
    subject_id: string | null;
    inputs: string;
  }[]
> {
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

async function storedId(
  pool: import('pg').Pool,
  partyId: string,
): Promise<string | null> {
  const result = await pool.query<{ national_id: string | null }>(
    `SELECT national_id FROM party WHERE party_id = $1`,
    [partyId],
  );
  return result.rows[0]?.national_id ?? null;
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
      assert.match(adminProfile.body, /•••••3c1a/);
      assert.match(adminProfile.body, /גילוי/);
      assert.doesNotMatch(adminProfile.body, new RegExp(SECRET));
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

  it('opens a profile with the split name and every contact, and never an identifier', async (t) => {
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
      assert.match(profile.body, /name="family_name"/);
      assert.match(profile.body, /name="given_name"/);
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
      assert.match(hidden.body, /ת\.ז\./);
      assert.match(hidden.body, /•••••3c1a/);
      assert.doesNotMatch(hidden.body, new RegExp(SECRET));
      assert.doesNotMatch(hidden.body, /גילוי/);
      assert.doesNotMatch(hidden.body, /national-id/);
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

  it('masks, reveals, searches and writes a ת.ז., and refuses an operator', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    const clock = fixedClock(AT);
    const app = buildApp({ pool, version: '9.9.9-test', clock });
    const admin = await signIn(pool, clock, {
      email: `admin-id@${DOMAIN}`,
      role: 'ADMIN',
    });
    const operator = await signIn(pool, clock, {
      email: `ops-id@${DOMAIN}`,
      role: 'OPERATOR',
    });
    const nationalId = await unusedIdentifier(pool);
    const leading = await unusedLeadingZero(pool);
    const held = await upsertParty(pool, {
      kind: 'PERSON',
      givenName: 'ספרות204',
      familyName: 'מזהה204',
      nationalId,
      preferredLanguage: 'he',
    });
    const dropped = await upsertParty(pool, {
      kind: 'PERSON',
      givenName: 'אפס204',
      familyName: 'מזהה204',
      nationalId: leading.stored,
      preferredLanguage: 'he',
    });
    const blank = await createParty(pool, {
      kind: 'PERSON',
      givenName: 'ריק204',
      familyName: 'מזהה204',
      preferredLanguage: 'he',
    });
    const companyNumber = await unusedIdentifier(pool);
    const firm = await upsertParty(pool, {
      kind: 'COMPANY',
      legalName: 'חברה204 בע״מ',
      nationalId: companyNumber,
      preferredLanguage: 'he',
    });
    const line = await createParty(pool, {
      kind: 'PERSON',
      givenName: 'קו204',
      familyName: 'מזהה204',
      preferredLanguage: 'he',
    });
    const landlineTail = crypto
      .randomUUID()
      .replace(/\D/g, '')
      .slice(-7)
      .padStart(7, '4');
    const landlineNumber = `03-${landlineTail.slice(0, 3)}-${landlineTail.slice(3)}`;
    assert.equal(held.inserted, true);
    assert.equal(dropped.inserted, true);
    assert.equal(firm.inserted, true);
    await upsertPartyContact(pool, {
      partyId: line.id,
      channel: 'PHONE',
      value: normalisePhone(landlineNumber),
      isPrimary: true,
      validFrom: '2024-01-01',
      validTo: null,
      verifiedAt: null,
    });
    const asAdmin = asOperator(app, admin);
    const asOps = asOperator(app, operator);
    const post = {
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    };
    try {
      const directory = await asAdmin.inject({
        method: 'GET',
        url: '/parties',
      });
      assert.equal(directory.body.includes(nationalId), false);
      assert.doesNotMatch(directory.body, /•••••/);

      for (const typed of [
        `${nationalId.slice(0, 3)}-${nationalId.slice(3, 6)}-${nationalId.slice(6)}`,
        `${nationalId.slice(0, 3)} ${nationalId.slice(3, 6)} ${nationalId.slice(6)}`,
        nationalId,
      ]) {
        const found = await asAdmin.inject({
          method: 'GET',
          url: `/parties?q=${encodeURIComponent(typed)}`,
        });
        assert.equal(found.statusCode, 200, typed);
        assert.match(found.body, /ספרות204/, typed);
        assert.doesNotMatch(found.body, /אפס204/, typed);
        assert.equal(found.body.includes(nationalId), false, typed);
        assert.equal(found.body.includes(typed), false, typed);
        assert.doesNotMatch(found.body, /•••••/, typed);
        assert.match(found.body, /חיפוש לפי ת\.ז\./);
      }
      const byCompany = await asAdmin.inject({
        method: 'GET',
        url: `/parties?q=${encodeURIComponent(companyNumber)}`,
      });
      assert.equal(byCompany.statusCode, 200);
      assert.match(byCompany.body, /חברה204/);
      assert.equal(byCompany.body.includes(companyNumber), false);

      const empty = await asOps.inject({
        method: 'GET',
        url: `/parties/${blank.id}`,
      });
      assert.equal(empty.statusCode, 200);
      assert.match(empty.body, /<dt>ת\.ז\.<\/dt><dd>—<\/dd>/);
      assert.doesNotMatch(empty.body, /גילוי/);
      assert.doesNotMatch(empty.body, /national-id/);

      const byDropped = await asAdmin.inject({
        method: 'GET',
        url: `/parties?q=${encodeURIComponent(leading.dropped)}`,
      });
      assert.equal(byDropped.statusCode, 200);
      assert.match(byDropped.body, /אפס204/);
      assert.equal(byDropped.body.includes(leading.stored), false);
      assert.equal(byDropped.body.includes(leading.dropped), false);

      const searched = await audits(
        pool,
        'parties.national_id.search',
        admin.staffAccountId,
      );
      assert.ok(searched.length >= 4);
      for (const row of searched) {
        assert.equal(row.actor_role, 'ADMIN');
        assert.equal(row.inputs.includes(nationalId), false);
        assert.equal(row.inputs.includes(leading.stored), false);
        assert.equal(row.inputs.includes(leading.dropped), false);
        assert.equal(row.inputs.includes(companyNumber), false);
      }
      assert.equal(
        searched.some((row) => row.inputs.includes(firm.id)),
        true,
      );
      assert.equal(
        searched.some((row) => row.inputs.includes(held.id)),
        true,
      );
      assert.equal(
        searched.some((row) => row.inputs.includes(dropped.id)),
        true,
      );

      const opsSearch = await asOps.inject({
        method: 'GET',
        url: `/parties?q=${encodeURIComponent(nationalId)}`,
      });
      assert.equal(opsSearch.statusCode, 403);
      assert.equal(opsSearch.body.includes(nationalId), false);
      const opsAudits = await audits(
        pool,
        'parties.national_id.search',
        operator.staffAccountId,
      );
      assert.equal(opsAudits.length, 0);

      const landline = await asOps.inject({
        method: 'GET',
        url: `/parties?q=${encodeURIComponent(landlineNumber)}`,
      });
      assert.equal(landline.statusCode, 200);
      assert.match(landline.body, /קו204/);

      const opsReveal = await asOps.inject({
        method: 'POST',
        url: `/parties/${held.id}/national-id/reveal`,
        ...post,
        payload: '',
      });
      assert.equal(opsReveal.statusCode, 403);
      assert.equal(opsReveal.body.includes(nationalId), false);
      assert.equal(
        (
          await audits(
            pool,
            'parties.national_id.reveal',
            operator.staffAccountId,
          )
        ).length,
        0,
      );

      const revealed = await asAdmin.inject({
        method: 'POST',
        url: `/parties/${held.id}/national-id/reveal`,
        ...post,
        payload: '',
      });
      assert.equal(revealed.statusCode, 200);
      assert.equal(revealed.body.includes(nationalId), true);
      const revealAudit = await audits(
        pool,
        'parties.national_id.reveal',
        admin.staffAccountId,
      );
      assert.equal(revealAudit.length, 1);
      assert.equal(revealAudit[0]?.actor_role, 'ADMIN');
      assert.equal(revealAudit[0]?.subject_id, held.id);
      assert.equal(revealAudit[0]?.inputs.includes(nationalId), false);
      assert.equal(revealAudit[0]?.inputs.includes(held.id), true);

      const opsWrite = await asOps.inject({
        method: 'POST',
        url: `/parties/${blank.id}/national-id`,
        ...post,
        payload: `identifier=${encodeURIComponent(nationalId)}`,
      });
      assert.equal(opsWrite.statusCode, 403);
      assert.equal(opsWrite.body.includes(nationalId), false);
      assert.equal(await storedId(pool, blank.id), null);

      const hyphenated = `${nationalId.slice(0, 3)}-${nationalId.slice(3, 6)}-${nationalId.slice(6)}`;
      const clash = await asAdmin.inject({
        method: 'POST',
        url: `/parties/${blank.id}/national-id`,
        ...post,
        payload: `identifier=${encodeURIComponent(hyphenated)}`,
      });
      assert.equal(clash.statusCode, 409);
      assert.match(clash.body, /הת\.ז\. כבר רשומה על/);
      assert.match(clash.body, new RegExp(`href="/parties/${held.id}"`));
      assert.match(clash.body, /ספרות204/);
      assert.equal(clash.body.includes(nationalId), false);
      assert.equal(clash.body.includes(hyphenated), false);
      assert.equal(await storedId(pool, blank.id), null);
      assert.equal(
        (await audits(pool, 'parties.national_id.write', admin.staffAccountId))
          .length,
        0,
      );

      const fresh = await unusedIdentifier(pool);
      const saved = await asAdmin.inject({
        method: 'POST',
        url: `/parties/${blank.id}/national-id`,
        ...post,
        payload: `identifier=${encodeURIComponent(fresh)}`,
      });
      assert.equal(saved.statusCode, 303);
      assert.equal(saved.headers.location, `/parties/${blank.id}`);
      assert.equal(await storedId(pool, blank.id), fresh);
      const written = await audits(
        pool,
        'parties.national_id.write',
        admin.staffAccountId,
      );
      assert.equal(written.length, 1);
      assert.equal(written[0]?.actor_role, 'ADMIN');
      assert.equal(written[0]?.subject_id, blank.id);
      assert.equal(written[0]?.inputs.includes(fresh), false);
      assert.match(written[0]?.inputs ?? '', /national_id/);
      const after = await asAdmin.inject({
        method: 'GET',
        url: `/parties/${blank.id}`,
      });
      assert.equal(after.statusCode, 200);
      assert.match(after.body, new RegExp(`•••••${fresh.slice(-4)}`));
      assert.equal(after.body.includes(fresh), false);

      const corrected = `${fresh.slice(0, 3)}-${fresh.slice(3, 6)}-${fresh.slice(6)}`;
      const again = await asAdmin.inject({
        method: 'POST',
        url: `/parties/${blank.id}/national-id`,
        ...post,
        payload: `identifier=${encodeURIComponent(corrected)}`,
      });
      assert.equal(again.statusCode, 303);
      assert.equal(await storedId(pool, blank.id), corrected);
      const keys = await pool.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM party
          WHERE national_id_key = party_national_id_key('PERSON', $1)`,
        [fresh],
      );
      assert.equal(keys.rows[0]?.n, '1');
    } finally {
      await pool.query(
        `DELETE FROM audit_log
          WHERE action IN (
            'parties.national_id.search',
            'parties.national_id.reveal',
            'parties.national_id.write'
          )
            AND actor_id = ANY($1::text[])`,
        [[admin.staffAccountId, operator.staffAccountId]],
      );
      await pool.query(
        `DELETE FROM party_contact
          WHERE party_id IN (SELECT party_id FROM party WHERE family_name = 'מזהה204')`,
      );
      await pool.query(
        `DELETE FROM party WHERE family_name = 'מזהה204' OR legal_name = 'חברה204 בע״מ'`,
      );
      await signOutAll(pool, DOMAIN);
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

const EDIT_DOMAIN = 'party-edit.test';
const EDIT_FAMILY = 'קשקוש205';
const EDIT_LEGAL = 'מיזוג205 בע״מ';

async function cleanupEdits(pool: import('pg').Pool): Promise<void> {
  await pool.query(
    `DELETE FROM audit_log
      WHERE action LIKE 'parties.%'
        AND actor_id IN (
          SELECT staff_account_id::text FROM staff_account WHERE email LIKE $1
        )`,
    [`%@${EDIT_DOMAIN}`],
  );
  await pool.query(
    `DELETE FROM party
      WHERE family_name LIKE '%205%'
         OR given_name LIKE '%205%'
         OR legal_name LIKE '%205%'`,
  );
  await signOutAll(pool, EDIT_DOMAIN);
}

describe('parties · correcting a name', { concurrency: false }, () => {
  it("an operator corrects a person's name and language, and the audit names the fields", async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    const clock = fixedClock(AT);
    const app = buildApp({ pool, version: '9.9.9-test', clock });
    await cleanupEdits(pool);
    const operator = await signIn(pool, clock, {
      email: `ops@${EDIT_DOMAIN}`,
      role: 'OPERATOR',
    });
    const person = await createParty(pool, {
      kind: 'PERSON',
      givenName: 'עמיתא205',
      familyName: EDIT_FAMILY,
      preferredLanguage: 'he',
    });
    const client = asOperator(app, operator);
    try {
      const saved = await client.inject({
        method: 'POST',
        url: `/parties/${person.id}`,
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: `given_name=${encodeURIComponent('נועה205')}&family_name=${encodeURIComponent(EDIT_FAMILY)}&language=en`,
      });
      assert.equal(saved.statusCode, 303);
      assert.equal(saved.headers.location, `/parties/${person.id}`);

      const page = await client.inject({
        method: 'GET',
        url: `/parties/${person.id}`,
      });
      assert.equal(page.statusCode, 200);
      assert.match(page.body, /נועה205 קשקוש205/);
      assert.match(page.body, /אנגלית/);

      const written = await audits(
        pool,
        'parties.identity.write',
        operator.staffAccountId,
      );
      assert.equal(written.length, 1);
      assert.equal(written[0]?.actor_role, 'OPERATOR');
      assert.equal(written[0]?.subject_id, person.id);
      const inputs = JSON.parse(written[0]?.inputs ?? '{}') as {
        partyId?: string;
        fields?: string[];
      };
      assert.equal(inputs.partyId, person.id);
      assert.deepEqual([...(inputs.fields ?? [])].sort(), [
        'given_name',
        'preferred_language',
      ]);
      assert.equal(written[0]?.inputs.includes('נועה205'), false);
    } finally {
      await cleanupEdits(pool);
      await pool.end();
    }
  });

  it('accepts an empty given name and shows the family name alone', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    const clock = fixedClock(AT);
    const app = buildApp({ pool, version: '9.9.9-test', clock });
    await cleanupEdits(pool);
    const operator = await signIn(pool, clock, {
      email: `ops@${EDIT_DOMAIN}`,
      role: 'OPERATOR',
    });
    const person = await createParty(pool, {
      kind: 'PERSON',
      givenName: 'עמיתא205',
      familyName: EDIT_FAMILY,
      preferredLanguage: 'he',
    });
    const client = asOperator(app, operator);
    try {
      const saved = await client.inject({
        method: 'POST',
        url: `/parties/${person.id}`,
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: `given_name=&family_name=${encodeURIComponent(EDIT_FAMILY)}&language=he`,
      });
      assert.equal(saved.statusCode, 303);
      const page = await client.inject({
        method: 'GET',
        url: `/parties/${person.id}`,
      });
      assert.match(page.body, new RegExp(`<h1>${EDIT_FAMILY}</h1>`));
      assert.doesNotMatch(page.body, /<h1>[^<]*עמיתא205/);
    } finally {
      await cleanupEdits(pool);
      await pool.end();
    }
  });

  it("an operator corrects a company's legal name and language", async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    const clock = fixedClock(AT);
    const app = buildApp({ pool, version: '9.9.9-test', clock });
    await cleanupEdits(pool);
    const operator = await signIn(pool, clock, {
      email: `ops@${EDIT_DOMAIN}`,
      role: 'OPERATOR',
    });
    const company = await createParty(pool, {
      kind: 'COMPANY',
      legalName: EDIT_LEGAL,
      preferredLanguage: 'he',
    });
    const client = asOperator(app, operator);
    try {
      const saved = await client.inject({
        method: 'POST',
        url: `/parties/${company.id}`,
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: `legal_name=${encodeURIComponent('קירור205 בע״מ')}&language=ru`,
      });
      assert.equal(saved.statusCode, 303);
      const page = await client.inject({
        method: 'GET',
        url: `/parties/${company.id}`,
      });
      assert.match(page.body, /<h1>קירור205 בע״מ<\/h1>/);
      assert.match(page.body, /רוסית/);
      const written = await audits(
        pool,
        'parties.identity.write',
        operator.staffAccountId,
      );
      assert.equal(written.length, 1);
      const inputs = JSON.parse(written[0]?.inputs ?? '{}') as {
        fields?: string[];
      };
      assert.deepEqual([...(inputs.fields ?? [])].sort(), [
        'legal_name',
        'preferred_language',
      ]);
      assert.equal(written[0]?.inputs.includes('קירור205'), false);
    } finally {
      await cleanupEdits(pool);
      await pool.end();
    }
  });

  it('refuses a name the kind cannot carry, and leaves the row unchanged', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    const clock = fixedClock(AT);
    const app = buildApp({ pool, version: '9.9.9-test', clock });
    await cleanupEdits(pool);
    const operator = await signIn(pool, clock, {
      email: `ops@${EDIT_DOMAIN}`,
      role: 'OPERATOR',
    });
    const person = await createParty(pool, {
      kind: 'PERSON',
      givenName: 'עמיתא205',
      familyName: EDIT_FAMILY,
      preferredLanguage: 'he',
    });
    const client = asOperator(app, operator);
    try {
      const refused = await client.inject({
        method: 'POST',
        url: `/parties/${person.id}`,
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: `given_name=${encodeURIComponent('עמיתא205')}&family_name=${encodeURIComponent(EDIT_FAMILY)}&legal_name=${encodeURIComponent('קירור205 בע״מ')}&language=he`,
      });
      assert.equal(refused.statusCode, 400);
      assert.match(refused.body, /a person has no legal name/);
      assert.match(
        refused.body,
        new RegExp(`<h1>עמיתא205 ${EDIT_FAMILY}</h1>`),
      );
      assert.equal(
        (await audits(pool, 'parties.identity.write', operator.staffAccountId))
          .length,
        0,
      );

      const blank = await client.inject({
        method: 'POST',
        url: `/parties/${person.id}`,
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: 'given_name=&family_name=&language=he',
      });
      assert.equal(blank.statusCode, 400);
      assert.match(blank.body, /family_name must be 1 to 200 characters/);
      const still = await client.inject({
        method: 'GET',
        url: `/parties/${person.id}`,
      });
      assert.match(still.body, new RegExp(`<h1>עמיתא205 ${EDIT_FAMILY}</h1>`));

      const company = await createParty(pool, {
        kind: 'COMPANY',
        legalName: EDIT_LEGAL,
        preferredLanguage: 'he',
      });
      const companyRefused = await client.inject({
        method: 'POST',
        url: `/parties/${company.id}`,
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: `given_name=${encodeURIComponent('עמיתא205')}&family_name=${encodeURIComponent(EDIT_FAMILY)}&legal_name=${encodeURIComponent(EDIT_LEGAL)}&language=he`,
      });
      assert.equal(companyRefused.statusCode, 400);
      assert.match(
        companyRefused.body,
        /a company has a legal name and no person name/,
      );
      assert.match(companyRefused.body, new RegExp(`<h1>${EDIT_LEGAL}</h1>`));
    } finally {
      await cleanupEdits(pool);
      await pool.end();
    }
  });

  it('lists the edit history newest first, and never a national id value', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    const clock = fixedClock(AT);
    const app = buildApp({ pool, version: '9.9.9-test', clock });
    await cleanupEdits(pool);
    const operator = await signIn(pool, clock, {
      email: `ops@${EDIT_DOMAIN}`,
      role: 'OPERATOR',
    });
    const admin = await signIn(pool, clock, {
      email: `admin@${EDIT_DOMAIN}`,
      role: 'ADMIN',
    });
    const person = await createParty(pool, {
      kind: 'PERSON',
      givenName: 'עמיתא205',
      familyName: EDIT_FAMILY,
      preferredLanguage: 'he',
    });
    const nationalId = await unusedIdentifier(pool);
    const asOps = asOperator(app, operator);
    const asAdmin = asOperator(app, admin);
    const post = {
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    };
    try {
      const identified = await asAdmin.inject({
        method: 'POST',
        url: `/parties/${person.id}/national-id`,
        ...post,
        payload: `identifier=${encodeURIComponent(nationalId)}`,
      });
      assert.equal(identified.statusCode, 303);
      clock.advance(60_000);
      const renamed = await asOps.inject({
        method: 'POST',
        url: `/parties/${person.id}`,
        ...post,
        payload: `given_name=${encodeURIComponent('נועה205')}&family_name=${encodeURIComponent(EDIT_FAMILY)}&language=he`,
      });
      assert.equal(renamed.statusCode, 303);
      clock.advance(60_000);
      const relabelled = await asOps.inject({
        method: 'POST',
        url: `/parties/${person.id}`,
        ...post,
        payload: `given_name=${encodeURIComponent('נועה205')}&family_name=${encodeURIComponent(EDIT_FAMILY)}&language=en`,
      });
      assert.equal(relabelled.statusCode, 303);

      const page = await asOps.inject({
        method: 'GET',
        url: `/parties/${person.id}`,
      });
      const history = page.body.slice(page.body.indexOf('id="party-history"'));
      assert.ok(history.startsWith('id="party-history"'));
      const languageAt = history.indexOf('שפה');
      const givenAt = history.indexOf('שם פרטי');
      const identifierAt = history.indexOf('>ת.ז.<');
      assert.ok(languageAt >= 0 && languageAt < givenAt);
      assert.ok(givenAt < identifierAt);
      assert.ok(
        history.indexOf('2026-10-11 12:02') <
          history.indexOf('2026-10-11 12:01'),
      );
      assert.ok(
        history.indexOf('2026-10-11 12:01') <
          history.indexOf('2026-10-11 12:00'),
      );
      assert.match(history, new RegExp(operator.email));
      assert.match(history, new RegExp(admin.email));
      assert.equal(history.includes(nationalId), false);
      assert.equal(history.includes('נועה205'), false);
    } finally {
      await cleanupEdits(pool);
      await pool.end();
    }
  });

  it('refuses a viewer the edit route', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    const clock = fixedClock(AT);
    const app = buildApp({ pool, version: '9.9.9-test', clock });
    await cleanupEdits(pool);
    const viewer = await signIn(pool, clock, {
      email: `view@${EDIT_DOMAIN}`,
      role: 'VIEWER',
    });
    const person = await createParty(pool, {
      kind: 'PERSON',
      givenName: 'עמיתא205',
      familyName: EDIT_FAMILY,
      preferredLanguage: 'he',
    });
    const client = asOperator(app, viewer);
    try {
      const refused = await client.inject({
        method: 'POST',
        url: `/parties/${person.id}`,
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: `given_name=${encodeURIComponent('נועה205')}&family_name=${encodeURIComponent(EDIT_FAMILY)}&language=en`,
      });
      assert.equal(refused.statusCode, 403);
      const still = await pool.query<{ full_name: string }>(
        'SELECT full_name FROM party WHERE party_id = $1',
        [person.id],
      );
      assert.equal(still.rows[0]?.full_name, `עמיתא205 ${EDIT_FAMILY}`);
      assert.equal(
        (await audits(pool, 'parties.identity.write', viewer.staffAccountId))
          .length,
        0,
      );
    } finally {
      await cleanupEdits(pool);
      await pool.end();
    }
  });

  it('says how many other parties share the name, and links to them', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    const clock = fixedClock(AT);
    const app = buildApp({ pool, version: '9.9.9-test', clock });
    await cleanupEdits(pool);
    const operator = await signIn(pool, clock, {
      email: `ops@${EDIT_DOMAIN}`,
      role: 'OPERATOR',
    });
    const first = await createParty(pool, {
      kind: 'PERSON',
      givenName: 'עמיתא205',
      familyName: EDIT_FAMILY,
      preferredLanguage: 'he',
    });
    const second = await createParty(pool, {
      kind: 'PERSON',
      givenName: 'עמיתא205',
      familyName: EDIT_FAMILY,
      preferredLanguage: 'ar',
    });
    const only = await createParty(pool, {
      kind: 'PERSON',
      givenName: 'רות205',
      familyName: EDIT_FAMILY,
      preferredLanguage: 'he',
    });
    const client = asOperator(app, operator);
    try {
      const shared = await client.inject({
        method: 'GET',
        url: `/parties/${first.id}`,
      });
      const hintAt = shared.body.indexOf('class="party-same"');
      const hint = shared.body.slice(
        hintAt,
        shared.body.indexOf('</p>', hintAt),
      );
      assert.match(hint, /עוד 1 בשם זה/);
      assert.match(hint, new RegExp(`href="/parties/${second.id}"`));
      assert.doesNotMatch(hint, new RegExp(`href="/parties/${first.id}"`));
      assert.doesNotMatch(hint, /<form/);
      assert.equal(
        (await audits(pool, 'parties.identity.write', operator.staffAccountId))
          .length,
        0,
      );

      const alone = await client.inject({
        method: 'GET',
        url: `/parties/${only.id}`,
      });
      assert.equal(alone.body.includes('class="party-same"'), false);
    } finally {
      await cleanupEdits(pool);
      await pool.end();
    }
  });
});
