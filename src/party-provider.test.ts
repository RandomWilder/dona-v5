// #208. Marking a company a service provider, from the profile, the way the
// office does it: a signed-in operator posts the form, and the label and the
// filter are what comes back.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Pool } from 'pg';
import { asOperator, signIn, signOutAll } from '../tests/support/session.ts';
import { buildApp } from './app.ts';
import { fixedClock } from './kernel/clock.ts';
import { migratedPoolOrNull, skipReason } from './kernel/pg-support.ts';
import { createParty } from './parties/contract.ts';

const AT = new Date('2026-10-11T09:00:00.000Z');
const DOMAIN = 'party-provider.test';
const COMPANY = 'מיזוג208';
const FAMILY = 'קשקוש208';
const POST = {
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
};

async function cleanup(pool: Pool): Promise<void> {
  await pool.query(
    `DELETE FROM provider
      WHERE party_id IN (
        SELECT party_id FROM party
         WHERE legal_name = $1 OR family_name = $2
      )`,
    [COMPANY, FAMILY],
  );
  await pool.query(
    `DELETE FROM audit_log
      WHERE action = 'estate.provider.link'
        AND subject_id IN (
          SELECT party_id::text FROM party
           WHERE legal_name = $1 OR family_name = $2
        )`,
    [COMPANY, FAMILY],
  );
  await pool.query(
    `DELETE FROM party WHERE legal_name = $1 OR family_name = $2`,
    [COMPANY, FAMILY],
  );
  await signOutAll(pool, DOMAIN);
}

async function audits(pool: Pool, actorId: string) {
  const result = await pool.query<{
    actor_role: string | null;
    subject_id: string | null;
    inputs: string;
  }>(
    `SELECT actor_role, subject_id, inputs::text AS inputs
       FROM audit_log
      WHERE action = 'estate.provider.link' AND actor_id = $1
      ORDER BY at`,
    [actorId],
  );
  return result.rows;
}

describe('parties · a service provider', { concurrency: false }, () => {
  it('marks a company, labels it, and returns it from the filter', async (t) => {
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
    const company = await createParty(pool, {
      kind: 'COMPANY',
      legalName: COMPANY,
      preferredLanguage: 'he',
    });
    const client = asOperator(app, operator);
    try {
      const before = await client.inject({
        method: 'GET',
        url: `/parties/${company.id}`,
      });
      assert.equal(before.statusCode, 200);
      assert.match(before.body, /id="provider"/);
      assert.match(before.body, /צוות פנימי/);
      assert.match(before.body, /קבלן/);
      assert.match(before.body, /אחריות יזם/);
      assert.match(before.body, /אין קשר/);

      const marked = await client.inject({
        method: 'POST',
        url: `/parties/${company.id}/provider`,
        ...POST,
        payload: 'kind=CONTRACTOR',
      });
      assert.equal(marked.statusCode, 303);
      const profile = await client.inject({
        method: 'GET',
        url: `/parties/${company.id}`,
      });
      assert.match(profile.body, /<span class="chip">ספק שירות · קבלן<\/span>/);
      assert.equal(profile.body.includes('href="/estate/tenancies/'), false);
      assert.equal(profile.body.includes('אין קשר'), false);

      const written = await audits(pool, operator.staffAccountId);
      assert.equal(written.length, 1);
      assert.equal(written[0]?.actor_role, 'OPERATOR');
      assert.equal(written[0]?.subject_id, company.id);
      const inputs = JSON.parse(written[0]?.inputs ?? '{}') as {
        partyId?: string;
        kind?: string;
        providerId?: string;
      };
      assert.equal(inputs.partyId, company.id);
      assert.equal(inputs.kind, 'CONTRACTOR');
      assert.match(inputs.providerId ?? '', /^[0-9a-f-]{36}$/);
      assert.equal(written[0]?.inputs.includes(COMPANY), false);

      const filtered = await client.inject({
        method: 'GET',
        url: `/parties?q=${encodeURIComponent(COMPANY)}&label=provider`,
      });
      assert.match(filtered.body, /ספק שירות · קבלן/);
      assert.match(filtered.body, new RegExp(`>${COMPANY}</a>`));
      const none = await client.inject({
        method: 'GET',
        url: `/parties?q=${encodeURIComponent(COMPANY)}&label=none`,
      });
      assert.match(none.body, /אין התאמה/);

      const changed = await client.inject({
        method: 'POST',
        url: `/parties/${company.id}/provider`,
        ...POST,
        payload: 'kind=IN_HOUSE_CREW',
      });
      assert.equal(changed.statusCode, 303);
      const after = await client.inject({
        method: 'GET',
        url: `/parties/${company.id}`,
      });
      assert.match(after.body, /ספק שירות · צוות פנימי/);
      const rows = await pool.query<{ n: string; provider_kind: string }>(
        `SELECT count(*)::text AS n, max(provider_kind) AS provider_kind
           FROM provider WHERE party_id = $1`,
        [company.id],
      );
      assert.equal(rows.rows[0]?.n, '1');
      assert.equal(rows.rows[0]?.provider_kind, 'IN_HOUSE_CREW');
      assert.equal((await audits(pool, operator.staffAccountId)).length, 2);
    } finally {
      await cleanup(pool);
      await pool.end();
    }
  });

  it('refuses a person and a viewer, and writes no provider', async (t) => {
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
    const viewer = await signIn(pool, clock, {
      email: `view@${DOMAIN}`,
      role: 'VIEWER',
    });
    const person = await createParty(pool, {
      kind: 'PERSON',
      givenName: 'עמיתא208',
      familyName: FAMILY,
      preferredLanguage: 'he',
    });
    const company = await createParty(pool, {
      kind: 'COMPANY',
      legalName: COMPANY,
      preferredLanguage: 'he',
    });
    try {
      const page = await asOperator(app, operator).inject({
        method: 'GET',
        url: `/parties/${person.id}`,
      });
      assert.equal(page.body.includes('id="provider"'), false);
      const refused = await asOperator(app, operator).inject({
        method: 'POST',
        url: `/parties/${person.id}/provider`,
        ...POST,
        payload: 'kind=CONTRACTOR',
      });
      assert.equal(refused.statusCode, 400);
      assert.match(refused.body, /אדם אינו ספק שירות/);
      const blocked = await asOperator(app, viewer).inject({
        method: 'POST',
        url: `/parties/${company.id}/provider`,
        ...POST,
        payload: 'kind=CONTRACTOR',
      });
      assert.equal(blocked.statusCode, 403);
      const rows = await pool.query(
        `SELECT 1 FROM provider WHERE party_id IN ($1, $2)`,
        [person.id, company.id],
      );
      assert.equal(rows.rowCount, 0);
      assert.equal((await audits(pool, operator.staffAccountId)).length, 0);
      assert.equal((await audits(pool, viewer.staffAccountId)).length, 0);
    } finally {
      await cleanup(pool);
      await pool.end();
    }
  });
});
