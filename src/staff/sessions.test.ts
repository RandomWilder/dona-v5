// The session's own properties, against a real database.
//
// **The acceptance assertion of slice 5.1 lives here**: the value in the column is not the value in
// the cookie, and the whole table can be read without learning one. `tests/policy/staff-session.test.ts`
// says no column *named* for a token holds one; this says the column that exists holds a hash of the
// thing the browser carries, which is the same claim from the other side.
//
// The clock is injected, so 12 hours and 60 idle minutes are walked rather than slept through
// (SPEC.md, "Time comes from the injected clock").
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';
import { fixedClock } from '../kernel/clock.ts';
import { newId } from '../kernel/ids.ts';
import { migratedPoolOrNull, skipReason } from '../kernel/pg-support.ts';
import {
  hashToken,
  mintSession,
  readSessionCookie,
  resolveSession,
  revokeSession,
  SESSION_ABSOLUTE_MS,
  SESSION_COOKIE,
  SESSION_IDLE_MS,
  sessionCookie,
} from './contract.ts';

const AT = new Date('2026-10-04T06:00:00.000Z');

async function anAccount(
  pool: import('pg').Pool,
  clock: { now: () => Date },
  role: string | null,
): Promise<string> {
  const id = newId(clock);
  await pool.query(
    `INSERT INTO staff_account (staff_account_id, idp_local_id, email, role, created_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [id, `idp-${id}`, `${id}@example.test`, role, clock.now()],
  );
  return id;
}

describe('the staff session', () => {
  it('stores a hash and never the token', async (t) => {
    const pool = await migratedPoolOrNull();
    if (pool === null) return t.skip(skipReason);
    const clock = fixedClock(AT);
    const accountId = await anAccount(pool, clock, 'ADMIN');
    // One hook, in order: the rows this case wrote, then the pool. Two hooks would end the pool
    // before the deletes ran, which is a leaked fixture and a red suite on the next run.
    t.after(async () => {
      await pool.query(
        'DELETE FROM staff_session WHERE staff_account_id = $1',
        [accountId],
      );
      await pool.query(
        'DELETE FROM staff_account WHERE staff_account_id = $1',
        [accountId],
      );
      await pool.end();
    });

    const { token } = await mintSession(pool, clock, accountId);

    // The cookie value appears in no column of the row it created. Asserted over the row as a
    // whole rather than over `token_hash` alone: a later migration that added a convenience copy
    // of the token somewhere else would pass the narrower assertion.
    const { rows } = await pool.query<Record<string, unknown>>(
      'SELECT * FROM staff_session WHERE staff_account_id = $1',
      [accountId],
    );
    assert.equal(rows.length, 1);
    const row = rows[0] as Record<string, unknown>;
    for (const [column, value] of Object.entries(row)) {
      assert.notEqual(String(value), token, `${column} holds the cookie value`);
    }
    assert.equal(
      row.token_hash,
      createHash('sha256').update(token).digest('hex'),
    );
    assert.equal(row.token_hash, hashToken(token));
    // And the hash is not usable as a cookie: presenting it resolves to nothing.
    assert.equal(
      await resolveSession(pool, clock, String(row.token_hash)),
      null,
    );
  });

  it('resolves, then stops resolving when it is revoked', async (t) => {
    const pool = await migratedPoolOrNull();
    if (pool === null) return t.skip(skipReason);
    const clock = fixedClock(AT);
    const accountId = await anAccount(pool, clock, 'OPERATOR');
    // One hook, in order: the rows this case wrote, then the pool. Two hooks would end the pool
    // before the deletes ran, which is a leaked fixture and a red suite on the next run.
    t.after(async () => {
      await pool.query(
        'DELETE FROM staff_session WHERE staff_account_id = $1',
        [accountId],
      );
      await pool.query(
        'DELETE FROM staff_account WHERE staff_account_id = $1',
        [accountId],
      );
      await pool.end();
    });

    const { token } = await mintSession(pool, clock, accountId);
    const session = await resolveSession(pool, clock, token);
    assert.equal(session?.role, 'OPERATOR');
    assert.equal(session?.staffAccountId, accountId);

    await revokeSession(pool, clock, token);
    assert.equal(await resolveSession(pool, clock, token), null);
  });

  it('expires on the absolute bound and on the idle bound, and the two are different', async (t) => {
    const pool = await migratedPoolOrNull();
    if (pool === null) return t.skip(skipReason);
    const clock = fixedClock(AT);
    const accountId = await anAccount(pool, clock, 'ADMIN');
    // One hook, in order: the rows this case wrote, then the pool. Two hooks would end the pool
    // before the deletes ran, which is a leaked fixture and a red suite on the next run.
    t.after(async () => {
      await pool.query(
        'DELETE FROM staff_session WHERE staff_account_id = $1',
        [accountId],
      );
      await pool.query(
        'DELETE FROM staff_account WHERE staff_account_id = $1',
        [accountId],
      );
      await pool.end();
    });

    // Idle: nothing touches it for an hour and a minute, and it is gone — even though the absolute
    // bound has eleven hours to run.
    const idle = await mintSession(pool, clock, accountId);
    clock.advance(SESSION_IDLE_MS + 60_000);
    assert.equal(await resolveSession(pool, clock, idle.token), null);

    // Absolute: kept warm inside the idle bound the whole way, and still gone at twelve hours.
    // This is the half a sliding expiry alone would never enforce.
    const long = await mintSession(pool, clock, accountId);
    for (
      let elapsed = 0;
      elapsed < SESSION_ABSOLUTE_MS;
      elapsed += SESSION_IDLE_MS / 2
    ) {
      clock.advance(SESSION_IDLE_MS / 2);
      const alive = await resolveSession(pool, clock, long.token);
      if (alive === null) {
        assert.ok(
          elapsed + SESSION_IDLE_MS / 2 >= SESSION_ABSOLUTE_MS,
          `session died at ${elapsed}ms, before the absolute bound`,
        );
        break;
      }
    }
    clock.advance(SESSION_ABSOLUTE_MS);
    assert.equal(await resolveSession(pool, clock, long.token), null);
  });

  it('stops resolving the moment the account loses its role or is disabled', async (t) => {
    // A withdrawal is meant to take effect on the next request, not on the next sign-in — which is
    // why the account is joined at resolve time rather than trusted from mint time.
    const pool = await migratedPoolOrNull();
    if (pool === null) return t.skip(skipReason);
    const clock = fixedClock(AT);
    const accountId = await anAccount(pool, clock, 'ADMIN');
    // One hook, in order: the rows this case wrote, then the pool. Two hooks would end the pool
    // before the deletes ran, which is a leaked fixture and a red suite on the next run.
    t.after(async () => {
      await pool.query(
        'DELETE FROM staff_session WHERE staff_account_id = $1',
        [accountId],
      );
      await pool.query(
        'DELETE FROM staff_account WHERE staff_account_id = $1',
        [accountId],
      );
      await pool.end();
    });

    const { token } = await mintSession(pool, clock, accountId);
    await pool.query(
      'UPDATE staff_account SET role = NULL WHERE staff_account_id = $1',
      [accountId],
    );
    // The session still exists; what it resolves to holds no permission, which is what the guard
    // reads. A role-less holder of a live session is refused on every route.
    assert.equal((await resolveSession(pool, clock, token))?.role, null);

    await pool.query(
      'UPDATE staff_account SET disabled_at = $2 WHERE staff_account_id = $1',
      [accountId, clock.now()],
    );
    assert.equal(await resolveSession(pool, clock, token), null);
  });
});

describe('the session cookie', () => {
  it('is HttpOnly and SameSite=Lax, and Secure only where the request was', () => {
    // SameSite=Lax is this slice's real cross-site defence and is stated as such: the CSRF token is
    // slice 5.2's, in the change that gives POST /documents one worth having (SPEC-staff.md).
    const secure = sessionCookie(
      'abc',
      new Date(AT.getTime() + 3600_000),
      true,
    );
    assert.match(secure, /^dona_session=abc; /);
    assert.match(secure, /HttpOnly/);
    assert.match(secure, /SameSite=Lax/);
    assert.match(secure, /Secure/);
    // Locally the request arrives over http, and a Secure cookie is never sent back over http — so
    // keeping the attribute unconditionally would mean sign-in silently never works on :3000.
    assert.doesNotMatch(sessionCookie('abc', AT, false), /Secure/);
  });

  it('reads its own name out of a header carrying several', () => {
    assert.equal(readSessionCookie(`a=1; ${SESSION_COOKIE}=xyz; b=2`), 'xyz');
    assert.equal(readSessionCookie('a=1; b=2'), null);
    assert.equal(readSessionCookie(`${SESSION_COOKIE}=`), null);
    assert.equal(readSessionCookie(undefined), null);
  });
});
