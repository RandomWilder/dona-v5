// Slice 5.8. The settings screen, driven the way an administrator drives it.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { asOperator, signIn, signOutAll } from '../tests/support/session.ts';
import { buildApp } from './app.ts';
import { systemClock } from './kernel/clock.ts';
import { newId } from './kernel/ids.ts';
import { migratedPoolOrNull, skipReason } from './kernel/pg-support.ts';

const DOMAIN = 'settings-routes.test';

function form(fields: Record<string, string>): {
  headers: { 'content-type': string };
  payload: string;
} {
  return {
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    payload: new URLSearchParams(fields).toString(),
  };
}

describe('settings · catalogues', () => {
  it('an admin adds one of each; an operator is refused; nobody sees a name', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    const suffix = newId().slice(24);
    const obCode = `TEST_OB_${suffix}`;
    const typeKey = `test_dt_${suffix}`;
    const app = buildApp({ pool, version: '9.9.9-test' });
    await signOutAll(pool, DOMAIN);
    try {
      const admin = await signIn(pool, systemClock, {
        email: `admin@${DOMAIN}`,
        role: 'ADMIN',
      });
      const operator = await signIn(pool, systemClock, {
        email: `ops@${DOMAIN}`,
        role: 'OPERATOR',
      });
      const asAdmin = asOperator(app, admin);
      const asOps = asOperator(app, operator);

      const anon = await app.inject({ method: 'GET', url: '/settings' });
      assert.equal(anon.statusCode, 303);
      assert.equal(anon.headers.location, '/staff/login');

      const viewerGet = await asOps.inject({ method: 'GET', url: '/settings' });
      assert.equal(viewerGet.statusCode, 200);
      assert.match(viewerGet.body, /data-state="wired"/);
      assert.doesNotMatch(
        viewerGet.body,
        /action="\/settings\/obligation-types"/,
      );
      assert.doesNotMatch(viewerGet.body, /asset_type/);

      const refused = await asOps.inject({
        method: 'POST',
        url: '/settings/obligation-types',
        ...form({
          code: obCode,
          label_he: 'לא',
          default_responsible_party: 'TENANT',
        }),
      });
      assert.equal(refused.statusCode, 403);
      assert.deepEqual(refused.json(), {
        code: 'not_allowed',
        message: 'not_allowed',
      });

      const addOb = await asAdmin.inject({
        method: 'POST',
        url: '/settings/obligation-types',
        ...form({
          code: obCode,
          label_he: 'בדיקה',
          label_en: 'Test',
          default_responsible_party: 'TENANT',
          requires_evidence: 'true',
          is_active: 'true',
        }),
      });
      assert.equal(addOb.statusCode, 303);
      assert.equal(addOb.headers.location, '/settings?saved=obligation');

      const addDt = await asAdmin.inject({
        method: 'POST',
        url: '/settings/document-types',
        ...form({
          type_key: typeKey,
          label_he: 'מסמך בדיקה',
          verification_terms: 'בדיקה\nטופס',
          is_active: 'true',
        }),
      });
      assert.equal(addDt.statusCode, 303);
      assert.equal(addDt.headers.location, '/settings?saved=document');

      const page = await asAdmin.inject({
        method: 'GET',
        url: '/settings?saved=document',
      });
      assert.equal(page.statusCode, 200);
      assert.match(page.body, new RegExp(obCode));
      assert.match(page.body, new RegExp(typeKey));
      assert.match(page.body, /נשמר/);
      assert.match(page.body, /action="\/settings\/obligation-types"/);
      assert.doesNotMatch(page.body, /asset_type/);
      // **The never-a-phone guard is not asserted here, and its absence is the fix rather than a
      // gap.** It lives in `tests/ui/tokens.test.ts` over the `SCREENS` registry, which renders
      // this screen twice — admin and viewer — against a fixed `CSRF` constant. Asserting `/05\d/`
      // on a live HTTP response instead made the gate fail for weather: the CSRF token is
      // `sha256('csrf:' + session token)` rendered as 64 hex characters on every form, and a hex
      // run that long carries `05` followed by a digit about one session in five. Measured at 4
      // failures in 20 runs before this line came out, and the matching bytes were the token every
      // time. A second copy of a guard is how a guard dies (`tests/ui/tokens.test.ts`'s own rule);
      // this copy was also reading bytes the first copy deliberately controls.
    } finally {
      await pool.query('DELETE FROM document_type WHERE type_key = $1', [
        typeKey,
      ]);
      // **Deactivated, not deleted** — `obligation_type_is_never_deleted` refuses a DELETE, which is
      // 5.7's claim being the database's refusal rather than a comment. So this suite cannot clean
      // up the way the line above does, and a long-lived local database accumulates one row per run
      // that the settings screen then lists as פעיל. Deactivating is the path an administrator has,
      // and it is the one the test takes. CI gets a fresh container and never sees either.
      await pool.query(
        'UPDATE obligation_type SET is_active = false WHERE code = $1',
        [obCode],
      );
      await signOutAll(pool, DOMAIN);
      await app.close();
      await pool.end();
    }
  });
});
