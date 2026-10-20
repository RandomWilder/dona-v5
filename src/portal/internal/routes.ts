// The tenant host's sign-in. Every route is `tenant: 'public'` because a permission does not
// exist yet; the session is what this file checks, and a missing one is the phone screen.

import type { IncomingHttpHeaders } from 'node:http';
import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import type { CodeChannel, CodeSender } from '../../channel/contract.ts';
import { createAuditLog } from '../../kernel/audit.ts';
import { type Clock, dayIn } from '../../kernel/clock.ts';
import { KernelError } from '../../kernel/errors.ts';
import { csrfTokenFor, verifyCsrf } from '../../staff/contract.ts';
import { describeChallenge, requestCode, verifyCode } from './codes.ts';
import { portalText } from './copy.ts';
import {
  acknowledgeNotice,
  chosenOptIns,
  loadNotice,
  shownTextId,
} from './legal.ts';
import {
  beginAuthentication,
  beginRegistration,
  finishAuthentication,
  finishRegistration,
  listPasskeys,
  removePasskey,
} from './passkeys.ts';
import { nationalDisplay } from './phone.ts';
import {
  challengeCookie,
  clearedCookie,
  formCookie,
  mintPortalSession,
  newOpaqueToken,
  PORTAL_CHALLENGE_COOKIE,
  PORTAL_FORM_COOKIE,
  PORTAL_SESSION_COOKIE,
  readPortalCookie,
  resolvePortalSession,
  revokeEveryPortalSession,
  revokePortalSession,
  sessionCookie,
} from './sessions.ts';
import {
  renderCodePage,
  renderHomePage,
  renderNoticeFullPage,
  renderNoticePage,
  renderPasskeyOffer,
  renderPasskeysPage,
  renderPhonePage,
} from './views.ts';

const TENANT = { config: { tenant: 'public' } } as const;

export interface PortalDeps {
  pool: Pool;
  clock: Clock;
  sender: CodeSender;
}

function secureOf(request: {
  protocol: string;
  headers: IncomingHttpHeaders;
}): boolean {
  // Cloud Run terminates TLS and says so in this header. The socket here is plain http.
  // Same decision the staff session already makes.
  const forwarded = request.headers['x-forwarded-proto'];
  const value = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  return value === 'https' || request.protocol === 'https';
}

function addressOf(request: { ip: string }): string {
  const ip = request.ip.trim();
  return (ip.length > 0 ? ip : 'unknown').slice(0, 64);
}

function field(body: unknown, name: string): string {
  const value = (body as Record<string, unknown> | undefined)?.[name];
  return typeof value === 'string' ? value : '';
}

function csrfOk(token: string | null, body: unknown): boolean {
  if (token === null) return false;
  try {
    verifyCsrf(token, field(body, 'csrf'));
    return true;
  } catch (error) {
    if (error instanceof KernelError) return false;
    throw error;
  }
}

function html(
  reply: {
    header: (name: string, value: string | string[]) => unknown;
    code: (status: number) => unknown;
  },
  body: string,
  cookies: string[] = [],
): string {
  reply.header('content-type', 'text/html; charset=utf-8');
  reply.header('cache-control', 'no-store');
  reply.header('x-content-type-options', 'nosniff');
  if (cookies.length > 0) reply.header('set-cookie', cookies);
  return body;
}

function go(
  reply: {
    header: (name: string, value: string | string[]) => unknown;
    code: (status: number) => unknown;
  },
  location: string,
  cookies: string[],
): string {
  reply.code(303);
  reply.header('location', location);
  if (cookies.length > 0) reply.header('set-cookie', cookies);
  return '';
}

function waitSeconds(retryAt: Date, now: Date): number {
  return Math.max(0, Math.ceil((retryAt.getTime() - now.getTime()) / 1000));
}

function preferred(sender: CodeSender): CodeChannel {
  if (sender.channels.includes('whatsapp')) return 'whatsapp';
  if (sender.channels.includes('sms')) return 'sms';
  return 'whatsapp';
}

function captionKey(sender: CodeSender): string {
  const whatsapp = sender.channels.includes('whatsapp');
  const sms = sender.channels.includes('sms');
  if (whatsapp && sms) return 'sign_in.caption_both';
  if (sms) return 'sign_in.caption_sms';
  if (whatsapp) return 'sign_in.caption';
  return 'sign_in.unavailable';
}

function otherChannel(
  sender: CodeSender,
  sent: CodeChannel,
): CodeChannel | null {
  if (
    !sender.channels.includes('whatsapp') ||
    !sender.channels.includes('sms')
  ) {
    return null;
  }
  return sent === 'whatsapp' ? 'sms' : 'whatsapp';
}

function chosen(
  sender: CodeSender,
  raw: string,
  fallback: CodeChannel,
): CodeChannel {
  if ((raw === 'whatsapp' || raw === 'sms') && sender.channels.includes(raw)) {
    return raw;
  }
  return fallback;
}

export function registerPortalRoutes(
  app: FastifyInstance,
  deps: PortalDeps,
): void {
  const audit = createAuditLog(deps.pool, deps.clock);
  const { pool, clock, sender } = deps;

  app.get('/', TENANT, async (request, reply) => {
    const secure = secureOf(request);
    const token = readPortalCookie(
      request.headers.cookie,
      PORTAL_SESSION_COOKIE,
    );
    if (token !== null) {
      const session = await resolvePortalSession(pool, clock, token);
      if (session !== null) {
        if (await noticeDue(session.portalIdentityId)) {
          return go(reply, '/notice', []);
        }
        return html(reply, renderHomePage({ csrf: csrfTokenFor(token) }));
      }
    }
    const form = newOpaqueToken();
    return phoneScreen(
      request,
      reply,
      {
        csrf: csrfTokenFor(form),
        notice: null,
        canSend: sender.channels.length > 0,
      },
      [
        formCookie(form, secure),
        ...(token === null
          ? []
          : [clearedCookie(PORTAL_SESSION_COOKIE, secure)]),
      ],
    );
  });

  app.post('/sign-in', TENANT, async (request, reply) => {
    const secure = secureOf(request);
    const form = readPortalCookie(request.headers.cookie, PORTAL_FORM_COOKIE);
    if (!csrfOk(form, request.body)) {
      const next = newOpaqueToken();
      return phoneScreen(
        request,
        reply,
        {
          csrf: csrfTokenFor(next),
          notice: 'sign_in.retry',
          canSend: sender.channels.length > 0,
        },
        [formCookie(next, secure)],
      );
    }
    if (sender.channels.length === 0) {
      const next = newOpaqueToken();
      return phoneScreen(
        request,
        reply,
        {
          csrf: csrfTokenFor(next),
          notice: 'sign_in.unavailable',
          canSend: false,
        },
        [formCookie(next, secure)],
      );
    }
    const issued = await requestCode(pool, clock, audit, sender, {
      phoneRaw: field(request.body, 'phone'),
      address: addressOf(request),
      channel: preferred(sender),
    });
    if ('notice' in issued) {
      const next = newOpaqueToken();
      return phoneScreen(
        request,
        reply,
        {
          csrf: csrfTokenFor(next),
          notice: issued.notice,
          canSend: true,
        },
        [formCookie(next, secure)],
      );
    }
    return go(reply, '/sign-in/code', [
      challengeCookie(issued.challenge, secure),
      clearedCookie(PORTAL_FORM_COOKIE, secure),
    ]);
  });

  app.get('/sign-in/code', TENANT, async (request, reply) => {
    const challenge = readPortalCookie(
      request.headers.cookie,
      PORTAL_CHALLENGE_COOKIE,
    );
    if (challenge === null) return go(reply, '/', []);
    const described = await describeChallenge(pool, clock, challenge);
    if (described === null) {
      return go(reply, '/', [
        clearedCookie(PORTAL_CHALLENGE_COOKIE, secureOf(request)),
      ]);
    }
    return html(
      reply,
      renderCodePage({
        csrf: csrfTokenFor(challenge),
        phone: described.phone,
        channel: described.channel,
        alternate: otherChannel(sender, described.channel),
        waitSeconds: waitSeconds(described.retryAt, clock.now()),
        notice: described.notice,
      }),
    );
  });

  app.post('/sign-in/code', TENANT, async (request, reply) => {
    const secure = secureOf(request);
    const challenge = readPortalCookie(
      request.headers.cookie,
      PORTAL_CHALLENGE_COOKIE,
    );
    if (challenge === null || !csrfOk(challenge, request.body)) {
      return go(reply, '/', []);
    }
    const result = await verifyCode(
      pool,
      clock,
      audit,
      challenge,
      field(request.body, 'code'),
      (portalIdentityId) => mintPortalSession(pool, clock, portalIdentityId),
    );
    if (result.status === 'missing') return go(reply, '/', []);
    if (result.status === 'notice') {
      return html(
        reply,
        renderCodePage({
          csrf: csrfTokenFor(challenge),
          phone: result.phone,
          channel: result.channel,
          alternate: otherChannel(sender, result.channel),
          waitSeconds: waitSeconds(result.retryAt, clock.now()),
          notice: result.notice,
        }),
      );
    }
    if (result.newDevice) {
      const entry = {
        actorKind: 'tenant' as const,
        actorId: result.portalIdentityId,
        action: 'portal.session.new_device',
        subjectId: result.portalIdentityId,
        inputs: { channel: result.channel },
      };
      try {
        await sender.notify({ to: result.phone, channel: result.channel });
        await audit.write(entry, { outcome: 'ok' });
      } catch (error) {
        await audit.write(entry, {
          outcome: 'error',
          code: error instanceof KernelError ? error.code : 'unavailable',
          message: 'notice was not sent',
        });
      }
    }
    return go(reply, '/passkey', [
      sessionCookie(result.token, result.expiresAt, secure),
      clearedCookie(PORTAL_CHALLENGE_COOKIE, secure),
    ]);
  });

  app.post('/sign-in/code/send', TENANT, async (request, reply) => {
    const secure = secureOf(request);
    const challenge = readPortalCookie(
      request.headers.cookie,
      PORTAL_CHALLENGE_COOKIE,
    );
    if (challenge === null || !csrfOk(challenge, request.body)) {
      return go(reply, '/', []);
    }
    const described = await describeChallenge(pool, clock, challenge);
    if (described === null) return go(reply, '/', []);
    const issued = await requestCode(pool, clock, audit, sender, {
      phoneRaw: described.phone,
      address: addressOf(request),
      channel: chosen(
        sender,
        field(request.body, 'channel'),
        described.channel,
      ),
    });
    if ('notice' in issued) {
      return html(
        reply,
        renderCodePage({
          csrf: csrfTokenFor(challenge),
          phone: described.phone,
          channel: described.channel,
          alternate: otherChannel(sender, described.channel),
          waitSeconds: waitSeconds(described.retryAt, clock.now()),
          notice: issued.notice,
        }),
      );
    }
    return go(reply, '/sign-in/code', [
      challengeCookie(issued.challenge, secure),
    ]);
  });

  app.post('/sign-out', TENANT, async (request, reply) => {
    const secure = secureOf(request);
    const token = readPortalCookie(
      request.headers.cookie,
      PORTAL_SESSION_COOKIE,
    );
    if (token !== null) await revokePortalSession(pool, clock, token);
    return go(reply, '/', [clearedCookie(PORTAL_SESSION_COOKIE, secure)]);
  });

  app.post('/sign-out/all', TENANT, async (request, reply) => {
    const secure = secureOf(request);
    const token = readPortalCookie(
      request.headers.cookie,
      PORTAL_SESSION_COOKIE,
    );
    if (token !== null) {
      const session = await resolvePortalSession(pool, clock, token);
      if (session !== null) {
        await revokeEveryPortalSession(pool, clock, session.portalIdentityId);
        await audit.write(
          {
            actorKind: 'tenant',
            actorId: session.portalIdentityId,
            action: 'portal.session.end_all',
            subjectId: session.portalIdentityId,
            inputs: {},
          },
          { outcome: 'ok' },
        );
      }
    }
    return go(reply, '/', [clearedCookie(PORTAL_SESSION_COOKIE, secure)]);
  });

  async function phoneScreen(
    request: { protocol: string; headers: IncomingHttpHeaders },
    reply: {
      header: (name: string, value: string | string[]) => unknown;
      code: (status: number) => unknown;
    },
    screen: { csrf: string; notice: string | null; canSend: boolean },
    cookies: string[],
  ): Promise<string> {
    let options: unknown = { publicKey: {} };
    try {
      options = await beginAuthentication(pool, clock, ceremonyOf(request));
    } catch {
      // A challenge that cannot be issued leaves the code form working. The
      // passkey button then shows its failure, which is the same page without
      // the ceremony.
    }
    return html(
      reply,
      renderPhonePage({
        csrf: screen.csrf,
        notice: screen.notice,
        caption: captionKey(sender),
        canSend: screen.canSend,
        options,
      }),
      cookies,
    );
  }

  function ceremonyOf(request: {
    protocol: string;
    headers: IncomingHttpHeaders;
  }): { origin: string; rpId: string } {
    const hostHeader = request.headers.host;
    const host = (
      Array.isArray(hostHeader) ? (hostHeader[0] ?? '') : (hostHeader ?? '')
    ).trim();
    const hostname = host.split(':')[0] ?? '';
    if (hostname === '' || host.includes('/') || /\s/.test(host)) {
      throw new KernelError('invalid', 'passkey was not accepted');
    }
    return {
      origin: `${secureOf(request) ? 'https' : 'http'}://${host}`,
      rpId: hostname,
    };
  }

  function jsonReply(
    reply: {
      header: (name: string, value: string | string[]) => unknown;
      code: (status: number) => unknown;
    },
    status: number,
    body: Record<string, unknown>,
    cookies: string[] = [],
  ): string {
    reply.code(status);
    reply.header('content-type', 'application/json; charset=utf-8');
    reply.header('cache-control', 'no-store');
    reply.header('x-content-type-options', 'nosniff');
    if (cookies.length > 0) reply.header('set-cookie', cookies);
    return JSON.stringify(body);
  }

  const refused = { code: 'invalid', message: 'passkey was not accepted' };

  async function openSession(cookie: string | undefined): Promise<{
    token: string;
    portalIdentityId: string;
    phone: string;
  } | null> {
    const token = readPortalCookie(cookie, PORTAL_SESSION_COOKIE);
    if (token === null) return null;
    const session = await resolvePortalSession(pool, clock, token);
    if (session === null) return null;
    return {
      token,
      portalIdentityId: session.portalIdentityId,
      phone: session.phone,
    };
  }

  async function noticeDue(identityId: string): Promise<boolean> {
    const screen = await loadNotice(pool, identityId, clock.now());
    return screen?.due === true;
  }

  function posted(body: unknown, name: string): string | null {
    const value = field(body, name);
    return value === '' ? null : value;
  }

  app.get('/passkey', TENANT, async (request, reply) => {
    const open = await openSession(request.headers.cookie);
    if (open === null) return go(reply, '/', []);
    const options = await beginRegistration(
      pool,
      clock,
      {
        portalIdentityId: open.portalIdentityId,
        accountName: nationalDisplay(open.phone),
        displayName: portalText('brand'),
      },
      ceremonyOf(request),
    );
    return html(
      reply,
      renderPasskeyOffer({ csrf: csrfTokenFor(open.token), options }),
    );
  });

  app.post('/passkey/later', TENANT, async (request, reply) => {
    const open = await openSession(request.headers.cookie);
    if (open === null || !csrfOk(open.token, request.body)) {
      return go(reply, '/', []);
    }
    return go(
      reply,
      (await noticeDue(open.portalIdentityId)) ? '/notice' : '/',
      [],
    );
  });

  app.post('/passkey/register', TENANT, async (request, reply) => {
    const open = await openSession(request.headers.cookie);
    const clientDataJSON = posted(request.body, 'clientDataJSON');
    const attestationObject = posted(request.body, 'attestationObject');
    if (
      open === null ||
      !csrfOk(open.token, request.body) ||
      clientDataJSON === null ||
      attestationObject === null
    ) {
      return jsonReply(reply, 400, refused);
    }
    try {
      await finishRegistration(pool, clock, audit, open.portalIdentityId, {
        clientDataJSON,
        attestationObject,
      });
    } catch (error) {
      if (error instanceof KernelError) return jsonReply(reply, 400, refused);
      throw error;
    }
    return jsonReply(reply, 200, { ok: true });
  });

  app.post('/passkey/sign-in', TENANT, async (request, reply) => {
    const form = readPortalCookie(request.headers.cookie, PORTAL_FORM_COOKIE);
    const id = posted(request.body, 'id');
    const clientDataJSON = posted(request.body, 'clientDataJSON');
    const authenticatorData = posted(request.body, 'authenticatorData');
    const signature = posted(request.body, 'signature');
    const userHandle = posted(request.body, 'userHandle');
    if (
      !csrfOk(form, request.body) ||
      id === null ||
      clientDataJSON === null ||
      authenticatorData === null ||
      signature === null ||
      userHandle === null
    ) {
      return jsonReply(reply, 400, refused);
    }
    try {
      const identityId = await finishAuthentication(pool, clock, {
        id,
        clientDataJSON,
        authenticatorData,
        signature,
        userHandle,
      });
      const minted = await mintPortalSession(pool, clock, identityId);
      return jsonReply(reply, 200, { ok: true }, [
        sessionCookie(minted.token, minted.expiresAt, secureOf(request)),
      ]);
    } catch (error) {
      if (error instanceof KernelError) return jsonReply(reply, 400, refused);
      throw error;
    }
  });

  async function passkeyPage(
    reply: {
      header: (name: string, value: string | string[]) => unknown;
      code: (status: number) => unknown;
    },
    token: string,
    identityId: string,
    notice: string | null,
  ): Promise<string> {
    const rows = await listPasskeys(pool, identityId);
    return html(
      reply,
      renderPasskeysPage({
        csrf: csrfTokenFor(token),
        notice,
        passkeys: rows.map((row) => ({
          id: row.passkeyId,
          added: dayIn(row.addedOn, clock.zone),
        })),
      }),
    );
  }

  app.get('/notice', TENANT, async (request, reply) => {
    const open = await openSession(request.headers.cookie);
    if (open === null) return go(reply, '/', []);
    const screen = await loadNotice(pool, open.portalIdentityId, clock.now());
    if (screen === null || !screen.due) return go(reply, '/', []);
    return html(
      reply,
      renderNoticePage({
        csrf: csrfTokenFor(open.token),
        privacy: screen.privacy,
        terms: screen.terms,
        optIns: screen.optIns,
      }),
    );
  });

  app.get('/notice/full', TENANT, async (request, reply) => {
    const open = await openSession(request.headers.cookie);
    if (open === null) return go(reply, '/', []);
    const screen = await loadNotice(pool, open.portalIdentityId, clock.now());
    if (screen === null) return go(reply, '/', []);
    return html(
      reply,
      renderNoticeFullPage({
        privacy: screen.privacy,
        terms: screen.terms,
      }),
    );
  });

  app.post('/notice', TENANT, async (request, reply) => {
    const open = await openSession(request.headers.cookie);
    if (open === null || !csrfOk(open.token, request.body)) {
      return go(reply, '/', []);
    }
    const screen = await loadNotice(pool, open.portalIdentityId, clock.now());
    if (screen === null) return go(reply, '/', []);
    const privacyId = shownTextId(request.body, 'privacy');
    const termsId = shownTextId(request.body, 'terms');
    const recorded =
      privacyId !== null &&
      termsId !== null &&
      (await acknowledgeNotice(
        pool,
        clock,
        open.portalIdentityId,
        { privacyId, termsId },
        chosenOptIns(
          request.body,
          screen.optIns.map((opt) => opt.key),
        ),
      ));
    if (!recorded) {
      return html(
        reply,
        renderNoticePage({
          csrf: csrfTokenFor(open.token),
          privacy: screen.privacy,
          terms: screen.terms,
          optIns: screen.optIns,
        }),
      );
    }
    return go(reply, '/', []);
  });

  app.get('/passkeys', TENANT, async (request, reply) => {
    const open = await openSession(request.headers.cookie);
    if (open === null) return go(reply, '/', []);
    if (await noticeDue(open.portalIdentityId)) return go(reply, '/notice', []);
    return passkeyPage(reply, open.token, open.portalIdentityId, null);
  });

  app.post('/passkeys/remove', TENANT, async (request, reply) => {
    const open = await openSession(request.headers.cookie);
    if (open === null) return go(reply, '/', []);
    if (await noticeDue(open.portalIdentityId)) return go(reply, '/notice', []);
    if (!csrfOk(open.token, request.body)) {
      return passkeyPage(
        reply,
        open.token,
        open.portalIdentityId,
        'sign_in.retry',
      );
    }
    const removed = await removePasskey(
      pool,
      clock,
      audit,
      open.portalIdentityId,
      field(request.body, 'passkey'),
    );
    return passkeyPage(
      reply,
      open.token,
      open.portalIdentityId,
      removed ? null : 'passkeys.missing',
    );
  });
}
