// Passkeys and the new-device notice, driven the way a tenant drives them. #275.
import assert from 'node:assert/strict';
import type { KeyObject } from 'node:crypto';
import {
  createHash,
  generateKeyPairSync,
  randomBytes,
  sign,
} from 'node:crypto';
import { describe, it } from 'node:test';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.ts';
import { createRecordingCodeSender } from '../channel/contract.ts';
import { fixedClock } from '../kernel/clock.ts';
import { KernelError } from '../kernel/errors.ts';
import { migratedPoolOrNull, skipReason } from '../kernel/pg-support.ts';
import { csrfTokenFor } from '../staff/contract.ts';

const AT = new Date('2026-10-20T15:05:00.000Z');
const HOST = { host: 'tenant.localhost' };
const PHONE = '052-127-5001';
const ORIGIN = 'http://tenant.localhost';
const RP_ID = 'tenant.localhost';

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

function hiddenOf(html: string, name: string): string {
  const match = new RegExp(`name="${name}" value="([^"]*)"`).exec(html);
  return match?.[1] ?? '';
}

async function acknowledge(
  app: FastifyInstance,
  cookie: string,
): Promise<void> {
  const notice = await app.inject({
    method: 'GET',
    url: '/notice',
    headers: { ...HOST, cookie },
  });
  if (notice.statusCode === 303) return;
  const posted = await app.inject({
    method: 'POST',
    url: '/notice',
    headers: {
      ...HOST,
      cookie,
      'content-type': 'application/x-www-form-urlencoded',
    },
    payload: `csrf=${csrfOf(notice.body)}&privacy=${hiddenOf(notice.body, 'privacy')}&terms=${hiddenOf(notice.body, 'terms')}`,
  });
  assert.equal(posted.statusCode, 303);
}

function optionsOf(html: string): {
  publicKey: { challenge: string; user?: { id: string } };
} {
  const raw = /data-portal-passkey-options value="([^"]*)"/.exec(html)?.[1];
  assert.ok(raw);
  const json = raw
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&');
  return JSON.parse(json) as {
    publicKey: { challenge: string; user?: { id: string } };
  };
}

function cborUint(value: number): Buffer {
  return Buffer.from([value]);
}

function cborNeg(value: number): Buffer {
  return Buffer.from([0x20 | (-1 - value)]);
}

function cborText(value: string): Buffer {
  const text = Buffer.from(value, 'utf8');
  return Buffer.concat([Buffer.from([0x60 | text.length]), text]);
}

function cborBytes(value: Buffer): Buffer {
  if (value.length < 24) {
    return Buffer.concat([Buffer.from([0x40 | value.length]), value]);
  }
  return Buffer.concat([Buffer.from([0x58, value.length]), value]);
}

function cborMap(entries: Array<[Buffer, Buffer]>): Buffer {
  return Buffer.concat([
    Buffer.from([0xa0 + entries.length]),
    ...entries.flat(),
  ]);
}

function authenticator(): {
  credentialId: Buffer;
  privateKey: KeyObject;
  register: (challenge: string) => {
    clientDataJSON: string;
    attestationObject: string;
  };
  assert: (challenge: string) => {
    id: string;
    clientDataJSON: string;
    authenticatorData: string;
    signature: string;
    userHandle: string;
  };
} {
  const { publicKey, privateKey } = generateKeyPairSync('ec', {
    namedCurve: 'P-256',
  });
  const jwk = publicKey.export({ format: 'jwk' });
  const x = Buffer.from(String(jwk.x), 'base64url');
  const y = Buffer.from(String(jwk.y), 'base64url');
  const credentialId = randomBytes(16);
  const cose = cborMap([
    [cborUint(1), cborUint(2)],
    [cborUint(3), cborNeg(-7)],
    [cborNeg(-1), cborUint(1)],
    [cborNeg(-2), cborBytes(x)],
    [cborNeg(-3), cborBytes(y)],
  ]);
  const rpHash = createHash('sha256').update(RP_ID).digest();
  return {
    credentialId,
    privateKey,
    register(challenge) {
      const client = Buffer.from(
        JSON.stringify({
          type: 'webauthn.create',
          challenge,
          origin: ORIGIN,
        }),
      );
      const auth = Buffer.concat([
        rpHash,
        Buffer.from([0x45]),
        Buffer.from([0, 0, 0, 0]),
        Buffer.alloc(16),
        Buffer.from([0x00, credentialId.length]),
        credentialId,
        cose,
      ]);
      const attestation = cborMap([
        [cborText('fmt'), cborText('none')],
        [cborText('attStmt'), Buffer.from([0xa0])],
        [cborText('authData'), cborBytes(auth)],
      ]);
      return {
        clientDataJSON: client.toString('base64url'),
        attestationObject: attestation.toString('base64url'),
      };
    },
    assert(challenge) {
      const client = Buffer.from(
        JSON.stringify({ type: 'webauthn.get', challenge, origin: ORIGIN }),
      );
      const auth = Buffer.concat([
        rpHash,
        Buffer.from([0x05]),
        Buffer.from([0, 0, 0, 1]),
      ]);
      const signed = Buffer.concat([
        auth,
        createHash('sha256').update(client).digest(),
      ]);
      return {
        id: credentialId.toString('base64url'),
        clientDataJSON: client.toString('base64url'),
        authenticatorData: auth.toString('base64url'),
        signature: sign('sha256', signed, privateKey).toString('base64url'),
        userHandle: '',
      };
    },
  };
}

async function cleanup(pool: {
  query: (sql: string, params?: unknown[]) => Promise<unknown>;
}): Promise<void> {
  await pool.query(
    `DELETE FROM portal_passkey WHERE portal_identity_id IN
       (SELECT portal_identity_id FROM portal_identity WHERE phone LIKE '+972521275%')`,
  );
  await pool.query(
    `DELETE FROM portal_passkey_challenge
      WHERE portal_identity_id IN
        (SELECT portal_identity_id FROM portal_identity WHERE phone LIKE '+972521275%')
         OR (portal_identity_id IS NULL AND expires_at >= $1 AND expires_at < $2)`,
    [AT, new Date(AT.getTime() + 2 * 60 * 60 * 1000)],
  );
  await pool.query(
    `DELETE FROM portal_session WHERE portal_identity_id IN
       (SELECT portal_identity_id FROM portal_identity WHERE phone LIKE '+972521275%')`,
  );
  await pool.query(
    `DELETE FROM portal_sign_in_code WHERE phone LIKE '+972521275%'`,
  );
  await pool.query(
    `DELETE FROM portal_identity WHERE phone LIKE '+972521275%'`,
  );
  await pool.query(
    `DELETE FROM audit_log WHERE action LIKE 'portal.%' AND at >= $1 AND at < $2`,
    [AT, new Date(AT.getTime() + 2 * 60 * 60 * 1000)],
  );
}

describe('portal passkeys', () => {
  it('offers a passkey after a code, and declining leaves the tenant signed in', async (t) => {
    const pool = await migratedPoolOrNull();
    if (pool === null) return t.skip(skipReason);
    t.after(() => pool.end());
    await cleanup(pool);
    const clock = fixedClock(AT);
    const sender = createRecordingCodeSender();
    const app = buildApp({
      pool,
      clock,
      version: '9.9.9-test',
      codeSender: sender,
    });
    t.after(() => app.close());

    const phone = await app.inject({
      method: 'GET',
      url: '/',
      headers: HOST,
    });
    assert.equal((phone.body.match(/class="tp-primary"/g) ?? []).length, 1);
    assert.match(
      phone.body,
      /<button class="tp-text-btn" type="button" data-portal-passkey="get">כניסה מהירה<\/button>/,
    );

    const sent = await app.inject({
      method: 'POST',
      url: '/sign-in',
      headers: {
        ...HOST,
        cookie:
          pairNamed(phone.headers['set-cookie'], 'dona_portal_form') ?? '',
        'content-type': 'application/x-www-form-urlencoded',
      },
      payload: `phone=${encodeURIComponent(PHONE)}&csrf=${csrfOf(phone.body)}`,
    });
    const challenge =
      pairNamed(sent.headers['set-cookie'], 'dona_portal_code') ?? '';
    const codePage = await app.inject({
      method: 'GET',
      url: '/sign-in/code',
      headers: { ...HOST, cookie: challenge },
    });
    const verified = await app.inject({
      method: 'POST',
      url: '/sign-in/code',
      headers: {
        ...HOST,
        cookie: challenge,
        'content-type': 'application/x-www-form-urlencoded',
      },
      payload: `code=${sender.sent[0]?.code}&csrf=${csrfOf(codePage.body)}`,
    });
    assert.equal(verified.statusCode, 303);
    assert.equal(verified.headers.location, '/passkey');
    assert.equal(sender.notices.length, 0);
    const session =
      pairNamed(verified.headers['set-cookie'], 'dona_portal') ?? '';
    const offer = await app.inject({
      method: 'GET',
      url: '/passkey',
      headers: { ...HOST, cookie: session },
    });
    assert.equal(offer.statusCode, 200);
    assert.match(offer.body, /כניסה מהירה בפעם הבאה/);
    assert.match(offer.body, /בלי לחכות לקוד/);
    assert.match(offer.body, /המפתח נשאר רק בטלפון שלכם/);
    assert.match(offer.body, /אפשר להוסיף או להסיר מתי שתרצו/);
    assert.equal((offer.body.match(/class="tp-primary"/g) ?? []).length, 1);
    assert.match(
      offer.body,
      /<button class="tp-primary" type="button" data-portal-passkey="create">הפעלת כניסה מהירה<\/button>/,
    );
    assert.match(
      offer.body,
      /<button class="tp-text-btn" type="submit">לא עכשיו<\/button>/,
    );
    assert.match(offer.body, /data-portal-passkey-options value="/);
    assert.doesNotMatch(offer.body, /\/passkey\/register\/options/);
    assert.equal(optionsOf(offer.body).publicKey.challenge.length > 0, true);

    const later = await app.inject({
      method: 'POST',
      url: '/passkey/later',
      headers: {
        ...HOST,
        cookie: session,
        'content-type': 'application/x-www-form-urlencoded',
      },
      payload: `csrf=${csrfOf(offer.body)}`,
    });
    assert.equal(later.statusCode, 303);
    assert.equal(later.headers.location, '/notice');
    await acknowledge(app, session);
    const home = await app.inject({
      method: 'GET',
      url: '/',
      headers: { ...HOST, cookie: session },
    });
    assert.match(home.body, /אין כאן עדיין מה להציג/);

    clock.advance(61_000);
    const again = await app.inject({
      method: 'GET',
      url: '/',
      headers: HOST,
    });
    const resent = await app.inject({
      method: 'POST',
      url: '/sign-in',
      headers: {
        ...HOST,
        cookie:
          pairNamed(again.headers['set-cookie'], 'dona_portal_form') ?? '',
        'content-type': 'application/x-www-form-urlencoded',
      },
      payload: `phone=${encodeURIComponent(PHONE)}&csrf=${csrfOf(again.body)}`,
    });
    const next =
      pairNamed(resent.headers['set-cookie'], 'dona_portal_code') ?? '';
    const fresh = await app.inject({
      method: 'GET',
      url: '/sign-in/code',
      headers: { ...HOST, cookie: next },
    });
    const returned = await app.inject({
      method: 'POST',
      url: '/sign-in/code',
      headers: {
        ...HOST,
        cookie: next,
        'content-type': 'application/x-www-form-urlencoded',
      },
      payload: `code=${sender.sent[1]?.code}&csrf=${csrfOf(fresh.body)}`,
    });
    assert.equal(returned.headers.location, '/passkey');
    assert.equal(sender.notices.length, 1);
    assert.equal(sender.notices[0]?.to, '+972521275001');
    assert.equal(sender.notices[0]?.channel, 'whatsapp');
    const { rows } = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM audit_log
        WHERE action = 'portal.session.new_device' AND outcome = 'ok'
          AND at >= $1 AND at < $2`,
      [AT, new Date(AT.getTime() + 2 * 60 * 60 * 1000)],
    );
    assert.equal(rows[0]?.n, '1');
  });

  it('registers a passkey, signs in with it, and removes it', async (t) => {
    const pool = await migratedPoolOrNull();
    if (pool === null) return t.skip(skipReason);
    t.after(() => pool.end());
    await cleanup(pool);
    const clock = fixedClock(AT);
    const sender = createRecordingCodeSender();
    const app = buildApp({
      pool,
      clock,
      version: '9.9.9-test',
      codeSender: sender,
    });
    t.after(() => app.close());
    const device = authenticator();

    const phone = await app.inject({ method: 'GET', url: '/', headers: HOST });
    const sent = await app.inject({
      method: 'POST',
      url: '/sign-in',
      headers: {
        ...HOST,
        cookie:
          pairNamed(phone.headers['set-cookie'], 'dona_portal_form') ?? '',
        'content-type': 'application/x-www-form-urlencoded',
      },
      payload: `phone=${encodeURIComponent(PHONE)}&csrf=${csrfOf(phone.body)}`,
    });
    const challenge =
      pairNamed(sent.headers['set-cookie'], 'dona_portal_code') ?? '';
    const codePage = await app.inject({
      method: 'GET',
      url: '/sign-in/code',
      headers: { ...HOST, cookie: challenge },
    });
    const verified = await app.inject({
      method: 'POST',
      url: '/sign-in/code',
      headers: {
        ...HOST,
        cookie: challenge,
        'content-type': 'application/x-www-form-urlencoded',
      },
      payload: `code=${sender.sent[0]?.code}&csrf=${csrfOf(codePage.body)}`,
    });
    const session =
      pairNamed(verified.headers['set-cookie'], 'dona_portal') ?? '';
    const token = session.slice(session.indexOf('=') + 1);
    const offer = await app.inject({
      method: 'GET',
      url: '/passkey',
      headers: { ...HOST, cookie: session },
    });
    assert.equal(offer.statusCode, 200);
    assert.doesNotMatch(offer.body, /\/passkey\/register\/options/);
    const creation = optionsOf(offer.body);
    assert.ok(creation.publicKey.user);
    const registered = device.register(creation.publicKey.challenge);
    const saved = await app.inject({
      method: 'POST',
      url: '/passkey/register',
      headers: {
        ...HOST,
        cookie: session,
        'content-type': 'application/json',
      },
      payload: JSON.stringify({
        csrf: csrfTokenFor(token),
        clientDataJSON: registered.clientDataJSON,
        attestationObject: registered.attestationObject,
      }),
    });
    assert.equal(saved.statusCode, 200);
    const added = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM audit_log
        WHERE action = 'portal.passkey.add' AND outcome = 'ok'
          AND at >= $1`,
      [AT],
    );
    assert.equal(added.rows[0]?.n, '1');

    await acknowledge(app, session);
    const list = await app.inject({
      method: 'GET',
      url: '/passkeys',
      headers: { ...HOST, cookie: session },
    });
    assert.match(list.body, /מפתח כניסה/);
    assert.match(list.body, /2026-10-20/);
    assert.match(list.body, /הסרה/);
    const passkeyId = /name="passkey" value="([^"]+)"/.exec(list.body)?.[1];
    assert.ok(passkeyId);

    await app.inject({
      method: 'POST',
      url: '/sign-out',
      headers: {
        ...HOST,
        cookie: session,
        'content-type': 'application/x-www-form-urlencoded',
      },
      payload: `csrf=${csrfTokenFor(token)}`,
    });
    const signedOut = await app.inject({
      method: 'GET',
      url: '/',
      headers: { ...HOST, cookie: session },
    });
    assert.match(signedOut.body, /שליחת קוד/);
    const codesBefore = sender.sent.length;
    const gate = await app.inject({ method: 'GET', url: '/', headers: HOST });
    const form =
      pairNamed(gate.headers['set-cookie'], 'dona_portal_form') ?? '';
    assert.doesNotMatch(gate.body, /\/passkey\/sign-in\/options/);
    const assertion = optionsOf(gate.body);
    const proved = device.assert(assertion.publicKey.challenge);
    proved.userHandle = creation.publicKey.user.id;
    const entered = await app.inject({
      method: 'POST',
      url: '/passkey/sign-in',
      headers: {
        ...HOST,
        cookie: form,
        'content-type': 'application/json',
      },
      payload: JSON.stringify({ csrf: csrfOf(gate.body), ...proved }),
    });
    assert.equal(entered.statusCode, 200);
    assert.equal(sender.sent.length, codesBefore);
    assert.equal(sender.notices.length, 0);
    const next = pairNamed(entered.headers['set-cookie'], 'dona_portal') ?? '';
    await acknowledge(app, next);
    const inside = await app.inject({
      method: 'GET',
      url: '/',
      headers: { ...HOST, cookie: next },
    });
    assert.match(inside.body, /אין כאן עדיין מה להציג/);
    const nextToken = next.slice(next.indexOf('=') + 1);

    const removed = await app.inject({
      method: 'POST',
      url: '/passkeys/remove',
      headers: {
        ...HOST,
        cookie: next,
        'content-type': 'application/x-www-form-urlencoded',
      },
      payload: `passkey=${passkeyId}&csrf=${csrfTokenFor(nextToken)}`,
    });
    assert.equal(removed.statusCode, 200);
    assert.match(removed.body, /אין עדיין מפתח כניסה/);
    const removals = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM audit_log
        WHERE action = 'portal.passkey.remove' AND outcome = 'ok' AND at >= $1`,
      [AT],
    );
    assert.equal(removals.rows[0]?.n, '1');

    const after = await app.inject({ method: 'GET', url: '/', headers: HOST });
    const afterForm =
      pairNamed(after.headers['set-cookie'], 'dona_portal_form') ?? '';
    const retryBody = optionsOf(after.body);
    const retry = device.assert(retryBody.publicKey.challenge);
    retry.userHandle = creation.publicKey.user.id;
    const denied = await app.inject({
      method: 'POST',
      url: '/passkey/sign-in',
      headers: {
        ...HOST,
        cookie: afterForm,
        'content-type': 'application/json',
      },
      payload: JSON.stringify({ csrf: csrfOf(after.body), ...retry }),
    });
    assert.equal(denied.statusCode, 400);
    assert.equal(pairNamed(denied.headers['set-cookie'], 'dona_portal'), null);
  });

  it('keeps the sign-in when the new-device notice cannot be sent', async (t) => {
    const pool = await migratedPoolOrNull();
    if (pool === null) return t.skip(skipReason);
    t.after(() => pool.end());
    await cleanup(pool);
    const clock = fixedClock(AT);
    const recording = createRecordingCodeSender();
    let calls = 0;
    const sender = {
      channels: recording.channels,
      sent: recording.sent,
      notices: recording.notices,
      send: recording.send.bind(recording),
      async notify(): Promise<void> {
        calls += 1;
        throw new KernelError('unavailable', 'notice was not sent');
      },
    };
    const app = buildApp({
      pool,
      clock,
      version: '9.9.9-test',
      codeSender: sender,
    });
    t.after(() => app.close());
    const phone = '052-127-5002';

    async function enter(): Promise<{
      statusCode: number;
      location: unknown;
      cookie: string | null;
    }> {
      const page = await app.inject({ method: 'GET', url: '/', headers: HOST });
      const sent = await app.inject({
        method: 'POST',
        url: '/sign-in',
        headers: {
          ...HOST,
          cookie:
            pairNamed(page.headers['set-cookie'], 'dona_portal_form') ?? '',
          'content-type': 'application/x-www-form-urlencoded',
        },
        payload: `phone=${encodeURIComponent(phone)}&csrf=${csrfOf(page.body)}`,
      });
      const challenge =
        pairNamed(sent.headers['set-cookie'], 'dona_portal_code') ?? '';
      const codePage = await app.inject({
        method: 'GET',
        url: '/sign-in/code',
        headers: { ...HOST, cookie: challenge },
      });
      const verified = await app.inject({
        method: 'POST',
        url: '/sign-in/code',
        headers: {
          ...HOST,
          cookie: challenge,
          'content-type': 'application/x-www-form-urlencoded',
        },
        payload: `code=${sender.sent.at(-1)?.code}&csrf=${csrfOf(codePage.body)}`,
      });
      return {
        statusCode: verified.statusCode,
        location: verified.headers.location,
        cookie: pairNamed(verified.headers['set-cookie'], 'dona_portal'),
      };
    }

    const first = await enter();
    assert.equal(first.statusCode, 303);
    assert.equal(calls, 0);
    clock.advance(61_000);
    const second = await enter();
    assert.equal(second.statusCode, 303);
    assert.equal(second.location, '/passkey');
    assert.ok(second.cookie);
    assert.equal(calls, 1);
    const homeCookie = second.cookie ?? '';
    await acknowledge(app, homeCookie);
    const home = await app.inject({
      method: 'GET',
      url: '/',
      headers: { ...HOST, cookie: homeCookie },
    });
    assert.match(home.body, /אין כאן עדיין מה להציג/);
    const { rows } = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM audit_log
        WHERE action = 'portal.session.new_device' AND outcome = 'error'
          AND at >= $1`,
      [AT],
    );
    assert.equal(rows[0]?.n, '1');
  });
});
