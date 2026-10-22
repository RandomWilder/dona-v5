// #277. The building page shows the portal switch. Posting it needs portal.switch.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { asOperator, signIn, signOutAll } from '../../tests/support/session.ts';
import { buildApp } from '../app.ts';
import { fixedClock } from '../kernel/clock.ts';
import { newId } from '../kernel/ids.ts';
import { migratedPoolOrNull, skipReason } from '../kernel/pg-support.ts';
import { buildingInPortal } from './contract.ts';

const AT = new Date('2026-10-20T12:00:00.000Z');
const DOMAIN = 'estate-portal-switch.test';
const CITY = 'עיר מתג נכסים';
const FORM = { 'content-type': 'application/x-www-form-urlencoded' };

async function cleanup(pool: {
  query: (sql: string, params?: unknown[]) => Promise<unknown>;
}): Promise<void> {
  await pool.query(`DELETE FROM building WHERE city = $1`, [CITY]);
}

describe('estate · the portal switch on the building page', () => {
  it('shows an operator the state and refuses the change', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) return t.skip(skipReason);
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
       VALUES ($1, 'בניין מפעיל', 'רחוב מפעיל 4', $2, '2026-01-01', '2027-01-01',
               'ACTIVE')`,
      [buildingId, CITY],
    );
    const operator = await signIn(pool, clock, {
      email: `operator@${DOMAIN}`,
      role: 'OPERATOR',
    });
    const client = asOperator(app, operator);
    const page = await client.inject({
      method: 'GET',
      url: `/estate/inventory/${buildingId}`,
    });
    assert.equal(page.statusCode, 200);
    assert.match(page.body, /הבניין בפורטל/);
    assert.match(page.body, /role="switch"[^>]*disabled/);
    assert.doesNotMatch(
      page.body,
      new RegExp(`/estate/inventory/${buildingId}/portal`),
    );

    const posted = await client.inject({
      method: 'POST',
      url: `/estate/inventory/${buildingId}/portal`,
      headers: FORM,
      payload: 'enabled=on',
    });
    assert.equal(posted.statusCode, 403);
    assert.equal(await buildingInPortal(pool, buildingId), false);
  });
});
