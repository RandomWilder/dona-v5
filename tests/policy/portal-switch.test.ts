// POLICY — the building switch refuses while a current legal text is a placeholder. #277.
// docs/pipeline.md §6. The page names the text and the language, and nothing is written.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildApp } from '../../src/app.ts';
import {
  buildingInPortal,
  setBuildingPortal,
} from '../../src/estate/contract.ts';
import { auditsForSubject } from '../../src/kernel/audit.ts';
import { fixedClock } from '../../src/kernel/clock.ts';
import { newId } from '../../src/kernel/ids.ts';
import { inRolledBackTransaction } from '../../src/kernel/pg-support.ts';
import { addOperator } from '../../src/staff/contract.ts';
import { asOperator, signIn, signOutAll } from '../support/session.ts';
import { policyPool, skipReason } from './support.ts';

const AT = new Date('2026-10-20T12:00:00.000Z');
const DOMAIN = 'portal-switch.policy';
const CITY = 'עיר מתג מדיניות';
const ADDRESS = 'רחוב מתג 1';
const FORM = { 'content-type': 'application/x-www-form-urlencoded' };

async function cleanup(pool: {
  query: (sql: string, params?: unknown[]) => Promise<unknown>;
}): Promise<void> {
  await pool.query(
    `DELETE FROM audit_log
      WHERE action = 'estate.portal_switch'
        AND subject_id IN (SELECT building_id::text FROM building WHERE city = $1)`,
    [CITY],
  );
  await pool.query(`DELETE FROM building WHERE city = $1`, [CITY]);
}

describe('policy · the portal switch refuses a placeholder', () => {
  it('names the text and the language and writes nothing', async (t) => {
    const pool = await policyPool();
    if (pool === null) return t.skip(skipReason);
    const clock = fixedClock(AT);
    const app = buildApp({ pool, clock, version: '9.9.9-test' });
    t.after(async () => {
      await cleanup(pool);
      await signOutAll(pool, DOMAIN);
      await app.close();
      await pool.end();
    });
    await signOutAll(pool, DOMAIN);
    await cleanup(pool);

    const buildingId = newId(clock);
    await pool.query(
      `INSERT INTO building (building_id, name, address_line, city, handover_date,
                             warranty_end_date, status)
       VALUES ($1, 'בניין מתג', $2, $3, '2026-01-01', '2027-01-01', 'ACTIVE')`,
      [buildingId, ADDRESS, CITY],
    );
    const admin = await signIn(pool, clock, {
      email: `admin@${DOMAIN}`,
      role: 'ADMIN',
    });
    const client = asOperator(app, admin);

    const posted = await client.inject({
      method: 'POST',
      url: `/estate/inventory/${buildingId}/portal`,
      headers: FORM,
      payload: 'enabled=on',
    });
    assert.equal(posted.statusCode, 303);
    assert.equal(posted.headers.location, `/estate/inventory/${buildingId}`);

    const page = await client.inject({
      method: 'GET',
      url: `/estate/inventory/${buildingId}`,
    });
    assert.equal(page.statusCode, 200);
    assert.match(page.body, /הודעת פרטיות/);
    assert.match(page.body, /עברית/);
    assert.match(page.body, /Privacy notice/);
    assert.match(page.body, /אנגלית/);
    assert.match(page.body, /לא ניתן להדליק את הפורטל/);
    assert.match(page.body, /role="switch"/);
    assert.doesNotMatch(page.body, /role="switch"[^>]*checked/);

    const audits = (await auditsForSubject(pool, buildingId)).filter(
      (row) => row.action === 'estate.portal_switch',
    );
    assert.equal(audits.length, 0);
  });

  it('ignores a placeholder once a later version has replaced it', async (t) => {
    const pool = await policyPool();
    if (pool === null) return t.skip(skipReason);
    t.after(() => pool.end());
    const clock = fixedClock(AT);
    await inRolledBackTransaction(pool, async (db) => {
      const buildingId = newId(clock);
      await db.query(
        `INSERT INTO building (building_id, name, address_line, city, handover_date,
                               warranty_end_date, status)
         VALUES ($1, 'בניין גרסה', 'רחוב גרסה 2', 'עיר גרסה', '2026-01-01',
                 '2027-01-01', 'ACTIVE')`,
        [buildingId],
      );
      const { account } = await addOperator(db, clock, {
        email: 'version@portal-switch.policy',
        role: 'ADMIN',
      });
      const current = await db.query<{ legal_text_id: string }>(
        `SELECT DISTINCT ON (language, kind, opt_in_key) legal_text_id
           FROM portal_legal_text
          WHERE created_at <= $1
          ORDER BY language, kind, opt_in_key, version DESC`,
        [AT],
      );
      const [kept, ...rest] = current.rows;
      assert.ok(kept);
      const blockerId = newId(clock);
      await db.query(
        `INSERT INTO portal_legal_text
           (legal_text_id, kind, language, version, opt_in_key, title, summary,
            body, placeholder, created_at)
         SELECT $1, kind, language, version + 1, opt_in_key, 'נוסח חסום', summary,
                body, true, $2
           FROM portal_legal_text
          WHERE legal_text_id = $3`,
        [blockerId, AT, kept.legal_text_id],
      );
      for (const row of rest) {
        await db.query(
          `INSERT INTO portal_legal_text
             (legal_text_id, kind, language, version, opt_in_key, title, summary,
              body, placeholder, created_at)
           SELECT $1, kind, language, version + 1, opt_in_key, title, summary,
                  body, false, $2
             FROM portal_legal_text
            WHERE legal_text_id = $3`,
          [newId(clock), AT, row.legal_text_id],
        );
      }
      const refused = await setBuildingPortal(
        db,
        clock,
        { staffAccountId: account.staffAccountId, role: 'ADMIN' },
        buildingId,
        true,
      );
      assert.equal('blocked' in refused, true);
      if (!('blocked' in refused)) return;
      assert.deepEqual(
        refused.blocked.map((item) => item.title),
        ['נוסח חסום'],
      );
      assert.equal(await buildingInPortal(db, buildingId), false);

      await db.query(
        `INSERT INTO portal_legal_text
           (legal_text_id, kind, language, version, opt_in_key, title, summary,
            body, placeholder, created_at)
         SELECT $1, kind, language, version + 1, opt_in_key, title, summary,
                body, false, $2
           FROM portal_legal_text
          WHERE legal_text_id = $3`,
        [newId(clock), AT, blockerId],
      );
      const on = await setBuildingPortal(
        db,
        clock,
        { staffAccountId: account.staffAccountId, role: 'ADMIN' },
        buildingId,
        true,
      );
      assert.deepEqual(on, { enabled: true });
      const audits = (await auditsForSubject(db, buildingId)).filter(
        (row) => row.action === 'estate.portal_switch',
      );
      assert.equal(audits.length, 1);
      assert.equal(audits[0]?.actorId, account.staffAccountId);
      assert.equal(audits[0]?.at.toISOString(), AT.toISOString());
      assert.equal(audits[0]?.inputs.enabled, true);

      const off = await setBuildingPortal(
        db,
        clock,
        { staffAccountId: account.staffAccountId, role: 'ADMIN' },
        buildingId,
        false,
      );
      assert.deepEqual(off, { enabled: false });
      assert.equal(await buildingInPortal(db, buildingId), false);
      const both = (await auditsForSubject(db, buildingId)).filter(
        (row) => row.action === 'estate.portal_switch',
      );
      assert.equal(both.length, 2);
      assert.deepEqual(both.map((row) => row.inputs.enabled).sort(), [
        false,
        true,
      ]);
    });
  });
});
