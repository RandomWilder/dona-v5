// POLICY CASE — a national id reaches a profile only when an administrator asks to see it.
//
// #204. The directory and every search answer carry no national_id. The profile carries it only
// for a caller holding party.national_id.read who asked to reveal it. Written before the routes,
// and red until they exist: a search echoes the typed value back into the box, and the reveal
// route is not there.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildApp } from '../../src/app.ts';
import { fixedClock } from '../../src/kernel/clock.ts';
import { hasIdentifierRun } from '../../src/kernel/identifier.ts';
import { upsertParty } from '../../src/parties/contract.ts';
import { asOperator, signIn, signOutAll } from '../support/session.ts';
import { policyPool, skipReason } from './support.ts';

const AT = new Date('2026-10-11T09:00:00.000Z');
const DOMAIN = 'party-nid-policy.test';
const FAMILY = 'מדיניות204';

function anIdentifier(): string {
  const digits = crypto.randomUUID().replace(/\D/g, '');
  const nine = digits.slice(-9).padStart(9, '7');
  return nine.startsWith('0') ? `7${nine.slice(1)}` : nine;
}

describe('policy · a national id reaches a profile only when an administrator asks', () => {
  it('is absent from the directory and the search, and present only on a reveal', async (t) => {
    const pool = await policyPool();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    const clock = fixedClock(AT);
    const app = buildApp({ pool, version: '9.9.9-test', clock });
    const nationalId = anIdentifier();
    assert.equal(hasIdentifierRun(nationalId), true);
    await signOutAll(pool, DOMAIN);
    const admin = await signIn(pool, clock, {
      email: `admin@${DOMAIN}`,
      role: 'ADMIN',
    });
    const operator = await signIn(pool, clock, {
      email: `ops@${DOMAIN}`,
      role: 'OPERATOR',
    });
    const party = await upsertParty(pool, {
      kind: 'PERSON',
      familyName: FAMILY,
      nationalId,
      preferredLanguage: 'he',
    });
    const asAdmin = asOperator(app, admin);
    const asOps = asOperator(app, operator);
    try {
      const directory = await asAdmin.inject({
        method: 'GET',
        url: '/parties',
      });
      assert.equal(directory.statusCode, 200);
      assert.equal(directory.body.includes(nationalId), false);
      assert.equal(hasIdentifierRun(directory.body), false);

      const byName = await asAdmin.inject({
        method: 'GET',
        url: `/parties?q=${encodeURIComponent(FAMILY)}`,
      });
      assert.equal(byName.statusCode, 200);
      assert.equal(byName.body.includes(nationalId), false);

      const byId = await asAdmin.inject({
        method: 'GET',
        url: `/parties?q=${encodeURIComponent(nationalId)}`,
      });
      assert.equal(byId.statusCode, 200);
      assert.equal(byId.body.includes(nationalId), false);
      assert.equal(hasIdentifierRun(byId.body), false);

      const opsSearch = await asOps.inject({
        method: 'GET',
        url: `/parties?q=${encodeURIComponent(nationalId)}`,
      });
      assert.equal(opsSearch.statusCode, 403);
      assert.equal(opsSearch.body.includes(nationalId), false);

      const profile = await asAdmin.inject({
        method: 'GET',
        url: `/parties/${party.id}`,
      });
      assert.equal(profile.statusCode, 200);
      assert.equal(profile.body.includes(nationalId), false);
      assert.equal(hasIdentifierRun(profile.body), false);

      const opsProfile = await asOps.inject({
        method: 'GET',
        url: `/parties/${party.id}`,
      });
      assert.equal(opsProfile.statusCode, 200);
      assert.equal(opsProfile.body.includes(nationalId), false);

      const opsReveal = await asOps.inject({
        method: 'POST',
        url: `/parties/${party.id}/national-id/reveal`,
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: '',
      });
      assert.equal(opsReveal.statusCode, 403);
      assert.equal(opsReveal.body.includes(nationalId), false);

      const revealed = await asAdmin.inject({
        method: 'POST',
        url: `/parties/${party.id}/national-id/reveal`,
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: '',
      });
      assert.equal(revealed.statusCode, 200);
      assert.equal(revealed.body.includes(nationalId), true);
    } finally {
      await pool.query('DELETE FROM party WHERE family_name = $1', [FAMILY]);
      await signOutAll(pool, DOMAIN);
      await pool.end();
    }
  });
});
