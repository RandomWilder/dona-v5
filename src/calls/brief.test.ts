// The call page's brief. #252. One turn after identification, after the
// emergency is already on the page, and a refresh appends.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { seedOccupancy } from '../../tests/policy/fixtures.ts';
import { asOperator, signIn, signOutAll } from '../../tests/support/session.ts';
import { buildApp } from '../app.ts';
import { fixedClock } from '../kernel/clock.ts';
import { embeddingColumnDimensions } from '../kernel/config.ts';
import { createFakeEmbedder } from '../kernel/embeddings.ts';
import { createFakeExtractor } from '../kernel/extraction.ts';
import { newId } from '../kernel/ids.ts';
import { migratedPoolOrNull, skipReason } from '../kernel/pg-support.ts';
import { createParty } from '../parties/contract.ts';

const AT = new Date('2026-10-17T09:00:00.000Z');

function form(fields: Record<string, string>): string {
  return new URLSearchParams(fields).toString();
}

describe('calls · the call brief', () => {
  it('shows an emergency before the brief is written, then keeps both turns', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    const domain = 'calls-brief.test';
    const clock = fixedClock(AT);
    const queued: Array<() => Promise<void>> = [];
    const extractor = createFakeExtractor(() => ({
      answers: false,
      text: '',
      hit_indexes: [],
    }));
    const app = buildApp({
      pool,
      version: '9.9.9-test',
      clock,
      extractor,
      embedder: createFakeEmbedder(embeddingColumnDimensions),
      briefSchedule: (work) => {
        queued.push(work);
      },
    });
    await pool.query(
      `DELETE FROM service_call_transition
        WHERE service_call_id IN (
          SELECT service_call_id FROM service_call WHERE opened_by IN (
            SELECT staff_account_id FROM staff_account WHERE email LIKE $1
          )
        )`,
      [`%@${domain}`],
    );
    await pool.query(
      `DELETE FROM service_call WHERE opened_by IN (
         SELECT staff_account_id FROM staff_account WHERE email LIKE $1
       )`,
      [`%@${domain}`],
    );
    await signOutAll(pool, domain);
    const who = await signIn(pool, clock, {
      email: `ops@${domain}`,
      role: 'OPERATOR',
    });
    const client = asOperator(app, who);
    const party = await createParty(pool, {
      kind: 'PERSON',
      givenName: 'נורית',
      familyName: 'בריף',
      preferredLanguage: 'he',
    });
    try {
      const created = await client.inject({
        method: 'POST',
        url: '/calls',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: form({
          channel: 'PHONE',
          description: 'יש שריפה במטבח',
          sender: 'unknown',
        }),
      });
      assert.equal(created.statusCode, 303);
      const list = await client.inject({ method: 'GET', url: '/calls' });
      const callId = list.body.match(
        /href="\/calls\/([0-9a-f-]{36})">יש שריפה במטבח/,
      )?.[1];
      assert.ok(callId);
      const identified = await client.inject({
        method: 'POST',
        url: `/calls/${callId}/identify`,
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: form({ party_id: party.id }),
      });
      assert.equal(identified.statusCode, 303);
      assert.equal(extractor.calls.length, 0);
      const writing = await client.inject({
        method: 'GET',
        url: `/calls/${callId}`,
      });
      assert.match(writing.body, /data-emergency="true"/);
      assert.match(writing.body, /data-brief="writing"/);
      assert.match(writing.body, /התקציר נכתב/);
      assert.equal(extractor.calls.length, 0);
      assert.equal(queued.length, 1);
      const run = queued[0];
      assert.ok(run);
      await run();
      const ready = await client.inject({
        method: 'GET',
        url: `/calls/${callId}`,
      });
      assert.match(ready.body, /data-brief="ready"/);
      assert.match(ready.body, /data-brief-turns="1"/);
      assert.match(ready.body, /אין במסמכים האלה תשובה לשאלה הזו/);
      assert.match(ready.body, /data-emergency="true"/);
      const refreshed = await client.inject({
        method: 'POST',
        url: `/calls/${callId}/brief`,
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: form({}),
      });
      assert.equal(refreshed.statusCode, 303);
      const again = await client.inject({
        method: 'GET',
        url: `/calls/${callId}`,
      });
      assert.match(again.body, /data-brief-turns="2"/);
    } finally {
      await pool.query(
        `DELETE FROM service_call_transition
          WHERE service_call_id IN (
            SELECT service_call_id FROM service_call WHERE opened_by = $1
          )`,
        [who.staffAccountId],
      );
      await pool.query(`DELETE FROM service_call WHERE opened_by = $1`, [
        who.staffAccountId,
      ]);
      await pool.query('DELETE FROM party WHERE party_id = $1', [party.id]);
      await signOutAll(pool, domain);
      await app.close();
      await pool.end();
    }
  });

  it('tells a guarantor why there is no brief', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    const domain = 'calls-brief-guarantor.test';
    const clock = fixedClock(AT);
    const app = buildApp({ pool, version: '9.9.9-test', clock });
    await signOutAll(pool, domain);
    const who = await signIn(pool, clock, {
      email: `ops@${domain}`,
      role: 'OPERATOR',
    });
    const client = asOperator(app, who);
    const tenancy = await seedOccupancy(pool, `252-${newId().slice(0, 4)}`, {
      phone: `+972501${newId()
        .replace(/[^0-9]/g, '')
        .padEnd(7, '1')
        .slice(0, 7)}`,
      contactFrom: '2026-01-01',
      contactTo: null,
      tenancyFrom: '2026-01-01',
      tenancyTo: '2027-01-01',
    });
    const guarantorId = newId();
    try {
      await pool.query(
        `INSERT INTO party (party_id, party_kind, family_name)
         VALUES ($1, 'PERSON', 'ערב בלבד')`,
        [guarantorId],
      );
      await pool.query(
        `INSERT INTO tenancy_party (tenancy_id, party_id, role, is_service_contact)
         VALUES ($1, $2, 'GUARANTOR', false)`,
        [tenancy.tenancyId, guarantorId],
      );
      const created = await client.inject({
        method: 'POST',
        url: '/calls',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: form({
          channel: 'PHONE',
          description: 'שאלה של ערב',
          sender: 'unknown',
        }),
      });
      assert.equal(created.statusCode, 303);
      const list = await client.inject({ method: 'GET', url: '/calls' });
      const callId = list.body.match(
        /href="\/calls\/([0-9a-f-]{36})">שאלה של ערב/,
      )?.[1];
      assert.ok(callId);
      const refused = await client.inject({
        method: 'POST',
        url: `/calls/${callId}/identify`,
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: form({ party_id: guarantorId }),
      });
      assert.equal(refused.statusCode, 400);
      assert.match(refused.body, /data-brief="guarantor"/);
      assert.match(refused.body, /אין תקציר, אין שרשור ואין טיוטה/);
    } finally {
      await pool.query(
        `DELETE FROM service_call_transition
          WHERE service_call_id IN (
            SELECT service_call_id FROM service_call WHERE opened_by = $1
          )`,
        [who.staffAccountId],
      );
      await pool.query(`DELETE FROM service_call WHERE opened_by = $1`, [
        who.staffAccountId,
      ]);
      await pool.query(`DELETE FROM tenancy_party WHERE tenancy_id = $1`, [
        tenancy.tenancyId,
      ]);
      await pool.query(`DELETE FROM tenancy WHERE tenancy_id = $1`, [
        tenancy.tenancyId,
      ]);
      await pool.query(`DELETE FROM party_contact WHERE party_id = $1`, [
        tenancy.partyId,
      ]);
      await pool.query(`DELETE FROM party WHERE party_id IN ($1, $2)`, [
        tenancy.partyId,
        guarantorId,
      ]);
      await pool.query(`DELETE FROM unit WHERE unit_id = $1`, [tenancy.unitId]);
      await pool.query(`DELETE FROM space WHERE space_id = $1`, [
        tenancy.unitId,
      ]);
      await signOutAll(pool, domain);
      await app.close();
      await pool.end();
    }
  });
});
