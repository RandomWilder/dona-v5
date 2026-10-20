import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { PORTAL_SESSION_COOKIE, portalCookie } from './contract.ts';
import { israeliMobile, nationalDisplay } from './internal/phone.ts';

describe('an Israeli mobile', () => {
  it('accepts the national number the field collects, and refuses the rest', () => {
    assert.equal(israeliMobile('50-000-0191'), '+972500000191');
    assert.equal(israeliMobile('050-000-0191'), '+972500000191');
    assert.equal(israeliMobile('+972 50 000 0191'), '+972500000191');
    assert.equal(israeliMobile('03-555-1234'), null);
    assert.equal(israeliMobile('+1 415 555 2671'), null);
    assert.equal(israeliMobile('not-a-number'), null);
  });

  it('shows the number the way it is dialled', () => {
    assert.equal(nationalDisplay('+972500000191'), '050-000-0191');
  });
});

describe('portal copy', () => {
  it('keeps the sentences in the copy rows', () => {
    const views = readFileSync(
      new URL('./internal/views.ts', import.meta.url),
      'utf8',
    );
    const routes = readFileSync(
      new URL('./internal/routes.ts', import.meta.url),
      'utf8',
    );
    assert.doesNotMatch(views, /\p{Script=Hebrew}/u);
    assert.doesNotMatch(routes, /\p{Script=Hebrew}/u);
  });
});

describe('the tenant session cookie', () => {
  it('is host-only, HttpOnly, Strict, and Secure when the request is', () => {
    const expires = new Date('2026-11-19T09:41:00.000Z');
    const secure = portalCookie(PORTAL_SESSION_COOKIE, 'abc', {
      secure: true,
      expires,
    });
    assert.match(secure, /^dona_portal=abc;/);
    assert.match(secure, /HttpOnly/);
    assert.match(secure, /SameSite=Strict/);
    assert.match(secure, /Secure/);
    assert.match(secure, /Path=\//);
    assert.doesNotMatch(secure, /Domain=/);

    const local = portalCookie(PORTAL_SESSION_COOKIE, 'abc', {
      secure: false,
      expires,
    });
    assert.doesNotMatch(local, /Secure/);
  });
});
