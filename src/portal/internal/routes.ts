// The tenant host's sign-in. Every route is `tenant: 'public'` because a permission does not
// exist yet; the session is what this file checks, and a missing one is the phone screen.

import type { IncomingHttpHeaders } from 'node:http';
import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import type { CodeSender } from '../../channel/contract.ts';
import { createAuditLog } from '../../kernel/audit.ts';
import type { Clock } from '../../kernel/clock.ts';
import { KernelError } from '../../kernel/errors.ts';
import { csrfTokenFor, verifyCsrf } from '../../staff/contract.ts';
import { describeChallenge, requestCode, verifyCode } from './codes.ts';
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
import { renderCodePage, renderHomePage, renderPhonePage } from './views.ts';

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
        return html(reply, renderHomePage({ csrf: csrfTokenFor(token) }));
      }
    }
    const form = newOpaqueToken();
    return html(
      reply,
      renderPhonePage({ csrf: csrfTokenFor(form), notice: null }),
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
      return html(
        reply,
        renderPhonePage({ csrf: csrfTokenFor(next), notice: 'sign_in.retry' }),
        [formCookie(next, secure)],
      );
    }
    const issued = await requestCode(pool, clock, audit, sender, {
      phoneRaw: field(request.body, 'phone'),
      address: addressOf(request),
    });
    if ('notice' in issued) {
      const next = newOpaqueToken();
      return html(
        reply,
        renderPhonePage({ csrf: csrfTokenFor(next), notice: issued.notice }),
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
          waitSeconds: waitSeconds(result.retryAt, clock.now()),
          notice: result.notice,
        }),
      );
    }
    return go(reply, '/', [
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
    });
    if ('notice' in issued) {
      return html(
        reply,
        renderCodePage({
          csrf: csrfTokenFor(challenge),
          phone: described.phone,
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
}
