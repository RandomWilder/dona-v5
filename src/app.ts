// The composition root. The walking skeleton (slice 1.3), rewired onto the kernel (slice 1.4), and
// given its first screens at 1.11.
//
// /health is the endpoint infra/smoke.sh asks, and the only claim it makes is one it can prove: the
// process is up *and* it can reach the database. "Deployed but silently broken" is what that script
// exists to make impossible (docs/pipeline.md §5).
//
// Modules are wired here and nowhere else, through their contract.ts. registerUiAssets has existed
// since the 1.4 kernel lift with nothing to serve; this is the slice that gives it a page to serve
// the stylesheet to.
import Fastify, { type FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { signedInChrome } from './chrome.ts';
import { registerEstateRoutes } from './estate/contract.ts';
import {
  listLinkedDocuments,
  listPromotedFieldsForUnit,
  registerDocumentRoutes,
  searchDocuments,
  signLinkedDocuments,
} from './evidence/contract.ts';
import { renderIndexPage } from './index-page.ts';
import { type Clock, systemClock } from './kernel/clock.ts';
import { httpStatus, KernelError, toErrorBody } from './kernel/errors.ts';
import type { Extractor } from './kernel/extraction.ts';
import {
  configuredBucket,
  createMemoryStore,
  type ObjectStore,
} from './kernel/objects.ts';
import type { OcrText } from './kernel/ocr.ts';
import { createPdfjsText, type PdfText } from './kernel/pdf.ts';
import { registerUiAssets } from './kernel/ui/assets.ts';
import { registerFormBodies } from './kernel/ui/forms.ts';
import type { WorkRunner } from './kernel/work.ts';
import {
  CSRF_FIELD,
  createUnconfiguredIdentity,
  csrfFrom,
  csrfTokenFor,
  type IdentityProvider,
  PERMISSIONS,
  type Permission,
  readSessionCookie,
  registerStaffRoutes,
  requireStaff,
  type StaffDeps,
  verifyCsrf,
} from './staff/contract.ts';
import {
  CALLS_STUB,
  renderIaMockup,
  renderStubPage,
  SETTINGS_STUB,
} from './stub-page.ts';
import {
  listIncompleteTenancies,
  listTenancyEvents,
  recordCompletenessException,
} from './tenancy/contract.ts';

export interface AppDeps {
  pool: Pool;
  version: string;
  /** Injected here and nowhere deeper. SPEC.md: the clock is a dependency, never a global read. */
  clock?: Clock;
  /**
   * Where a filed document's bytes go (slice 3.3). **Memory unless the caller says otherwise**, so a
   * test builds an app without reaching a bucket and `npm run dev` on a clean clone still starts;
   * `serve.ts` passes the configured store and prints which one it is.
   */
  objects?: ObjectStore;
  /** The PDF reader the verification guard reads text through. */
  pdf?: PdfText;
  /** The OCR reader. Absent or unconfigured leaves scans unverified. */
  ocr?: OcrText;
  extractor?: Extractor;
  work?: WorkRunner;
  /** The bucket a `storage_uri` names, which is not the same statement as which store is running. */
  bucket?: string;
  /**
   * Who signs in (slice 5.1, Google from 5.1b). **Unconfigured unless the caller says otherwise**,
   * on the same argument the object store makes: a test builds an app with no OAuth client, `npm
   * run dev` on a clean clone still starts, and `/staff/login` says the provider is not configured
   * rather than starting a redirect to nowhere.
   */
  identity?: IdentityProvider;
  /** Where Google is told to send an operator back. Absent, the request's own origin is used. */
  staffBaseUrl?: string;
  /** The Workspace domain to require, when Dona Dom's answer is known (slice 5.1b). */
  staffHostedDomain?: string | null;
  /**
   * Painted mockups at `/dev/mockups/:flow`. **Local `-dev` only** (slice 5.3). A stamped
   * revision must not serve a second product beside the live screens.
   */
  devMockups?: boolean;
}

/**
 * What a route declares about who may reach it. **Slice 5.2**, and the inversion the slice exists
 * for: before it, a route was open unless somebody remembered to guard it, and seven routes were
 * open for four weeks because nobody had. Now a route is refused unless somebody declared a stance,
 * and `public` is a word written next to a route rather than the absence of one.
 */
declare module 'fastify' {
  interface FastifyInstance {
    /** Every route this application registered and the stance it declared (slice 5.2). */
    stances: RouteStance[];
  }
}

export type Stance = Permission | 'public';

/** One row of the table the boot check walked, kept so a test can assert on the real thing. */
export interface RouteStance {
  method: string;
  url: string;
  stance: Stance | undefined;
  csrf?: 'in-body';
}

/**
 * The two the root owns and serves itself: the liveness probe `infra/smoke.sh` asks, and the
 * stylesheet and fonts every screen -- including the login screen, which is served to somebody with
 * no session by definition -- loads before anybody has signed in. They are listed here, in the
 * composition root, rather than declared in `src/kernel/`, because the stance vocabulary is this
 * application's and the kernel is not allowed to know it (SPEC.md rule 9).
 */
const ROOT_PUBLIC = ['/health', '/ui/tokens.css', '/ui/fonts/:file'];

function declaredStance(config: unknown): Stance | undefined {
  const asked = (config as { staff?: unknown } | undefined)?.staff;
  if (asked === 'public') return 'public';
  if (
    typeof asked === 'string' &&
    (PERMISSIONS as readonly string[]).includes(asked)
  ) {
    return asked as Permission;
  }
  return undefined;
}

export function buildApp(deps: AppDeps): FastifyInstance {
  const app = Fastify({ logger: false });

  const staffDeps: StaffDeps = {
    pool: deps.pool,
    clock: deps.clock ?? systemClock,
    identity: deps.identity ?? createUnconfiguredIdentity(),
    baseUrl: deps.staffBaseUrl,
    hostedDomain: deps.staffHostedDomain ?? null,
    chrome: signedInChrome,
  };

  // **The boot check. Slice 5.2, and it is the whole of the inversion.**
  //
  // A route that declares neither a permission nor `public` does not serve unguarded -- it stops
  // the process from starting, with the method and the path in the message. The failure mode this
  // replaces is the one this system actually had: a route added in a hurry, guarded by nobody,
  // discovered by nobody, and shipped. A test asserting "every route is guarded" can only assert it
  // about the routes that exist the day it is written; this asserts it about the next one.
  //
  // Registered before any route, because `onRoute` sees only what is registered after it.
  //
  // It also records the table it checked. `app.printRoutes()` shows paths and not config, so
  // without this a test asserting "the public surface is exactly these" would have to keep its own
  // copy of the list — which is the second copy this slice spent its whole design avoiding.
  const stances: RouteStance[] = [];
  app.addHook('onRoute', (route) => {
    if (route.method !== 'HEAD') {
      stances.push({
        method: String(route.method),
        url: route.url,
        stance: ROOT_PUBLIC.includes(route.url)
          ? 'public'
          : declaredStance(route.config),
        csrf: route.config?.csrf,
      });
    }
    if (ROOT_PUBLIC.includes(route.url)) return;
    // Fastify registers a HEAD beside every GET; it carries the GET's config and needs no second
    // declaration.
    if (route.method === 'HEAD') return;
    if (declaredStance(route.config) === undefined) {
      throw new Error(
        `route ${String(route.method)} ${route.url} declares no staff stance: ` +
          "add config: { staff: <permission> } or config: { staff: 'public' }",
      );
    }
  });

  // **The guard, and it is `requireStaff` -- one function, one call site.**
  //
  // `onRequest` rather than `preHandler`, because this hook runs before the body is parsed: an
  // unauthenticated 20 MB upload is refused before a byte of it is read.
  //
  // A request that matched no route reaches here with no config, and is treated as guarded rather
  // than as public. That is deliberate: answering 404 to an anonymous caller and a redirect to a
  // signed-out one would tell a stranger which paths exist.
  app.addHook('onRequest', async (request, reply) => {
    const stance =
      declaredStance(request.routeOptions?.config) ??
      (ROOT_PUBLIC.includes(request.routeOptions?.url ?? '')
        ? 'public'
        : undefined);
    // Derived here and nowhere else, so no screen computes it and none of them can compute it
    // differently. A request with no session gets none, and a screen with no token renders no form
    // that would need one.
    const token = readSessionCookie(request.headers.cookie);
    if (token !== null) request.csrf = csrfTokenFor(token);
    if (stance === 'public') return;
    try {
      // `stance` is undefined only for an unmatched path, where any permission refuses equally.
      request.staff = await requireStaff(
        staffDeps,
        request,
        stance ?? 'estate.read',
      );
    } catch (error) {
      // Not signed in is not a refusal: it is somebody who has not signed in, and it goes to the
      // login screen. A session whose account lost its role is a refusal, and it is byte-identical
      // to every other refusal this system makes (SPEC-staff.md).
      if (error instanceof KernelError && error.code === 'not_found') {
        return reply.code(303).header('location', '/staff/login').send();
      }
      throw error;
    }
  });

  // **The CSRF token, checked wherever a session could be riding.**
  //
  // `preHandler`, because it needs the parsed body. The condition is the presence of a session
  // cookie rather than the route's stance: a token defends a session's authority, so every unsafe
  // method that could carry one is in scope -- `POST /staff/logout` included, which is `public`
  // precisely so that an operator whose role was withdrawn can still sign out.
  //
  // `POST /documents` is the one exception and it is declared, not implicit: its body is a
  // multipart stream, and reading the field here would consume the stream its handler needs. It
  // carries `csrf: 'in-body'` and calls the same `verifyCsrf`.
  app.addHook('preHandler', async (request) => {
    if (request.method === 'GET' || request.method === 'HEAD') return;
    const config = request.routeOptions?.config as
      | { csrf?: unknown }
      | undefined;
    if (config?.csrf === 'in-body') return;
    const token = readSessionCookie(request.headers.cookie);
    if (token === null) return;
    verifyCsrf(
      token,
      (request.body as Record<string, unknown> | undefined)?.[CSRF_FIELD],
    );
  });

  // Slice 5.2. The session the guard resolved and the token derived from it, for the handlers that
  // need to name the operator and the screens that render a form.
  app.decorateRequest('staff', null);
  app.decorateRequest('csrf', null);
  app.decorate('stances', stances);

  // Fastify's own bodies never reach the wire: its 404 echoes the requested path back and its 500
  // carries the thrown message. Both render as SPEC.md's { code, message } instead. 1.3 wrote the
  // 503 body as a literal and deliberately left these two out, because writing the shape twice is
  // how two copies drift — kernel/errors.ts owns it from this slice, so they land now.
  app.setNotFoundHandler(async (_request, reply) => {
    const error = new KernelError('not_found', 'route not found');
    reply.code(httpStatus(error.code));
    return toErrorBody(error);
  });

  app.setErrorHandler(async (caught, _request, reply) => {
    const body = toErrorBody(caught);
    reply.code(httpStatus(body.code));
    return body;
  });

  app.get('/health', async (_request, reply) => {
    try {
      await deps.pool.query('SELECT 1');
      return { ok: true, version: deps.version, db: 'up' };
    } catch {
      // Never the caught error's text: a pg connection failure carries the connection string, and
      // toErrorBody exists so internals never reach the wire.
      const error = new KernelError('unavailable', 'database unreachable');
      reply.code(httpStatus(error.code));
      return { ok: false, version: deps.version, ...toErrorBody(error) };
    }
  });

  registerUiAssets(app);
  // One parser for every HTML form in this system (slice 5.1). Estate has posted one since 2.6 and
  // staff is the second module to, so it belongs to the root rather than to whichever module got
  // there first.
  registerFormBodies(app);
  // **The root index, moved here at 5.2** from `src/estate/internal/views.ts`, where 2.6 put it and
  // said it would stay only until a second *module* had a screen. Staff is that module. An index of
  // screens is not estate's fact -- it is the one page in this system whose nav spans two modules
  // and carries the way out.
  app.get('/', { config: { staff: 'estate.read' } }, async (request, reply) => {
    reply.header('content-type', 'text/html; charset=utf-8');
    reply.header('cache-control', 'no-store');
    reply.header('x-content-type-options', 'nosniff');
    return renderIndexPage({ csrf: csrfFrom(request) });
  });

  const stubHeaders = (reply: {
    header: (name: string, value: string) => unknown;
  }) => {
    reply.header('content-type', 'text/html; charset=utf-8');
    reply.header('cache-control', 'no-store');
    reply.header('x-content-type-options', 'nosniff');
  };

  app.get(
    '/calls',
    { config: { staff: 'estate.read' } },
    async (request, reply) => {
      stubHeaders(reply);
      return renderStubPage({ csrf: csrfFrom(request) }, CALLS_STUB, 'wired');
    },
  );
  app.get(
    '/settings',
    { config: { staff: 'estate.read' } },
    async (request, reply) => {
      stubHeaders(reply);
      return renderStubPage(
        { csrf: csrfFrom(request) },
        SETTINGS_STUB,
        'wired',
      );
    },
  );

  if (deps.devMockups === true) {
    app.get(
      '/dev/mockups/:flow',
      { config: { staff: 'estate.read' } },
      async (request, reply) => {
        const flow = (request.params as { flow: string }).flow;
        if (flow !== 'ia') {
          const error = new KernelError('not_found', 'route not found');
          reply.code(httpStatus(error.code));
          return toErrorBody(error);
        }
        stubHeaders(reply);
        return renderIaMockup(csrfFrom(request));
      },
    );
  }

  const clock = deps.clock ?? systemClock;
  const objects = deps.objects ?? createMemoryStore();
  const bucket = deps.bucket ?? configuredBucket();

  registerEstateRoutes(app, {
    pool: deps.pool,
    clock,
    chrome: signedInChrome,
    listLinkedDocuments: async (db, entityType, entityId) =>
      signLinkedDocuments(
        await listLinkedDocuments(db, entityType, entityId),
        objects,
        bucket,
        clock.now(),
      ),
    searchDocuments,
    listPromotedFieldsForUnit,
    listTenancyEvents,
    listIncompleteTenancies,
    recordCompletenessException,
  });
  // Slice 5.1, and from 5.2 no longer the only routes behind a session: every route this
  // application registers declares a stance above, and the hook calls `requireStaff` once.
  registerStaffRoutes(app, staffDeps);
  registerDocumentRoutes(app, {
    pool: deps.pool,
    clock,
    objects,
    pdf: deps.pdf ?? createPdfjsText(),
    ocr: deps.ocr,
    extractor: deps.extractor,
    work: deps.work,
    bucket,
    chrome: signedInChrome,
  });

  return app;
}
