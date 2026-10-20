// POLICY — a portal code is not stored, a send is capped, and a tenant session is not a
// staff session. #273. docs/pipeline.md §6.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildApp } from '../../src/app.ts';
import { createRecordingCodeSender } from '../../src/channel/contract.ts';
import { fixedClock } from '../../src/kernel/clock.ts';
import { asTenant } from '../support/session.ts';
import { policyPool, skipReason } from './support.ts';

const AT = new Date('2026-10-20T11:00:00.000Z');
const HOST = { host: 'tenant.localhost' };

function pairs(header: unknown): string[] {
  if (Array.isArray(header)) return header.map(String);
  if (typeof header === 'string') return [header];
  return [];
}

function pairNamed(header: unknown, name: string): string | null {
  for (const value of pairs(header)) {
    const pair = value.split(';')[0] ?? '';
    if (pair.startsWith(`${name}=`)) return pair;
  }
  return null;
}

function csrfOf(html: string): string {
  const match = /name="csrf" value="([^"]+)"/.exec(html);
  assert.ok(match?.[1]);
  return match[1];
}

async function send(
  app: {
    inject: (options: Record<string, unknown>) => Promise<{
      statusCode: number;
      headers: Record<string, unknown>;
      body: string;
    }>;
  },
  phone: string,
  remoteAddress: string,
): Promise<{
  statusCode: number;
  body: string;
  headers: Record<string, unknown>;
}> {
  const page = await app.inject({
    method: 'GET',
    url: '/',
    headers: HOST,
    remoteAddress,
  });
  return app.inject({
    method: 'POST',
    url: '/sign-in',
    headers: {
      ...HOST,
      cookie: pairNamed(page.headers['set-cookie'], 'dona_portal_form') ?? '',
      'content-type': 'application/x-www-form-urlencoded',
    },
    payload: `phone=${encodeURIComponent(phone)}&csrf=${csrfOf(page.body)}`,
    remoteAddress,
  });
}

describe('policy · portal sign-in codes', () => {
  it('stores a hash, caps sends, and writes an audit row either way', async (t) => {
    const pool = await policyPool();
    if (pool === null) return t.skip(skipReason);
    t.after(() => pool.end());
    await pool.query(
      `DELETE FROM portal_session WHERE portal_identity_id IN
         (SELECT portal_identity_id FROM portal_identity WHERE phone LIKE '+97252111%')`,
    );
    await pool.query(
      `DELETE FROM portal_sign_in_code WHERE phone LIKE '+97252111%' OR client_address = '10.73.1.9'`,
    );
    await pool.query(
      `DELETE FROM portal_identity WHERE phone LIKE '+97252111%'`,
    );
    await pool.query(
      `DELETE FROM audit_log WHERE action LIKE 'portal.%' AND at >= $1 AND at < $2`,
      [AT, new Date(AT.getTime() + 3 * 60 * 60 * 1000)],
    );

    const clock = fixedClock(AT);
    const sender = createRecordingCodeSender();
    const app = buildApp({
      pool,
      clock,
      version: '9.9.9-test',
      codeSender: sender,
    });
    t.after(() => app.close());

    const phone = '052-111-0001';
    const e164 = '+972521110001';
    const first = await send(app, phone, '10.73.1.9');
    assert.equal(first.statusCode, 303);
    const code = sender.sent[0]?.code;
    assert.ok(code);

    const { rows } = await pool.query<Record<string, unknown>>(
      `SELECT * FROM portal_sign_in_code WHERE phone = $1`,
      [e164],
    );
    assert.equal(rows.length, 1);
    const stored = JSON.stringify(rows[0]);
    assert.equal(stored.includes(code), false);
    assert.equal(Object.hasOwn(rows[0] ?? {}, 'code'), false);

    const { rows: audits } = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM audit_log
        WHERE action = 'portal.code.send' AND outcome = 'ok' AND at = $1`,
      [AT],
    );
    assert.equal(audits[0]?.n, '1');

    for (let n = 2; n <= 5; n += 1) {
      clock.advance(61_000);
      const again = await send(app, phone, '10.73.1.9');
      assert.equal(again.statusCode, 303, `send ${n}`);
    }
    clock.advance(61_000);
    const capped = await send(app, phone, '10.73.1.9');
    assert.equal(capped.statusCode, 200);
    assert.match(capped.body, /לא ניתן לשלוח עוד קוד היום/);
    assert.equal(sender.sent.length, 5);

    const { rows: refused } = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM audit_log
        WHERE action = 'portal.code.send' AND outcome = 'error' AND at = $1`,
      [clock.now()],
    );
    assert.equal(Number(refused[0]?.n ?? 0) >= 1, true);

    let refusedAtCap = false;
    for (let n = 2; n <= 21; n += 1) {
      const before = sender.sent.length;
      const other = `052-111-${String(n).padStart(4, '0')}`;
      const answer = await send(app, other, '10.73.1.9');
      if (before < 20) {
        assert.equal(answer.statusCode, 303, other);
      } else {
        assert.equal(answer.statusCode, 200);
        assert.match(answer.body, /לא ניתן לשלוח עוד קוד היום/);
        refusedAtCap = true;
        break;
      }
    }
    assert.equal(sender.sent.length, 20);
    assert.equal(refusedAtCap, true);
  });

  it('does not take a tenant session on the office host', async (t) => {
    const pool = await policyPool();
    if (pool === null) return t.skip(skipReason);
    t.after(() => pool.end());
    await pool.query(
      `DELETE FROM portal_session WHERE portal_identity_id IN
         (SELECT portal_identity_id FROM portal_identity WHERE phone = '+972521110099')`,
    );
    await pool.query(
      `DELETE FROM portal_sign_in_code WHERE phone = '+972521110099'`,
    );
    await pool.query(
      `DELETE FROM portal_identity WHERE phone = '+972521110099'`,
    );

    const clock = fixedClock(AT);
    const sender = createRecordingCodeSender();
    const app = buildApp({
      pool,
      clock,
      version: '9.9.9-test',
      codeSender: sender,
    });
    t.after(() => app.close());

    const tenant = await asTenant(app, '052-111-0099', sender, {
      remoteAddress: '10.73.1.10',
    });
    const { rows } = await pool.query<{ last_seen_at: Date }>(
      `SELECT last_seen_at FROM portal_session WHERE token_hash IS NOT NULL
         AND portal_identity_id IN
           (SELECT portal_identity_id FROM portal_identity WHERE phone = '+972521110099')`,
    );
    const seen = rows[0]?.last_seen_at.getTime();
    assert.ok(seen);

    clock.advance(60_000);
    const office = await app.inject({
      method: 'GET',
      url: '/estate',
      headers: { host: 'localhost', cookie: tenant.cookie },
    });
    assert.equal(office.statusCode, 303);
    assert.equal(office.headers.location, '/staff/login');

    const { rows: after } = await pool.query<{ last_seen_at: Date }>(
      `SELECT last_seen_at FROM portal_session
        WHERE portal_identity_id IN
          (SELECT portal_identity_id FROM portal_identity WHERE phone = '+972521110099')`,
    );
    assert.equal(after[0]?.last_seen_at.getTime(), seen);
  });
});
