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

import {
  createServer as createHttp2Server,
  type Http2ServerRequest,
  type Http2ServerResponse,
} from 'node:http2';
import Fastify, { type FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import {
  changeNonWorkingDate,
  composeDutyReply,
  countOpenCalls,
  getCall,
  listCategories,
  listPortalCalls,
  readEmergencySettings,
  readHandlingGoal,
  readNonWorkingDates,
  readPortalCall,
  readReplyShare,
  readReplyTarget,
  readResponseGoal,
  registerCallsRoutes,
  saveEmergencySettings,
  saveHandlingGoal,
  saveReplyTarget,
  saveResponseGoal,
  startCallBrief,
  tenantStatus,
  upsertCategory,
} from './calls/contract.ts';
import {
  type CodeSender,
  createUnavailableCodeSender,
  emergencyMatch,
  fileAttachment as fileCallAttachment,
  graphMailboxFrom,
  holdAttachment,
  listHolds,
  listMessagesOnCall,
  listNoiseMessages,
  type MalwareScanner,
  mailboxWarning,
  openHold,
  readAttachment,
  receiveIncoming,
  registerChannelRoutes,
  removeHold,
  replyOnInboundEmail,
  rescueNoise,
  type Sorter,
  secretWarning,
  type WhatsappFetch,
  whatsappFrom,
  whatsappWarning,
} from './channel/contract.ts';
import { signedInChrome } from './chrome.ts';
import { contactRules } from './contact-rules.ts';
import { renderMockup } from './dev-mockups.ts';
import { renderErrorPage, wantsHtml, wayBack } from './error-page.ts';
import { registerEstateRoutes } from './estate/contract.ts';
import {
  addressMatches,
  apartmentMatches,
  COLUMN_MAP,
  fileDocument,
  listDocumentTypes,
  listLinkedDocuments,
  listPromotedFieldsForUnit,
  listTenancyDocumentFacts,
  listUnopenedLeases,
  parseStorageUri,
  registerDocumentRoutes,
  runOfficeTurn,
  searchDocuments,
  signLinkedDocuments,
  upsertDocumentType,
} from './evidence/contract.ts';
import { renderIndexPage } from './index-page.ts';
import { createAuditLog } from './kernel/audit.ts';
import {
  addDays,
  type Clock,
  calendarDate,
  systemClock,
  today,
} from './kernel/clock.ts';
import {
  createSettings,
  readExtractionSettings,
  readOcrSettings,
} from './kernel/config.ts';
import {
  createUnconfiguredEmbedder,
  type Embedder,
} from './kernel/embeddings.ts';
import { httpStatus, KernelError, toErrorBody } from './kernel/errors.ts';
import {
  createUnconfiguredExtractor,
  type Extractor,
} from './kernel/extraction.ts';
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
import { listPartyNames } from './parties/contract.ts';
import { registerPartyDirectoryRoutes } from './party-directory.ts';
import { registerPolicyRoutes } from './policy/contract.ts';
import {
  PORTAL_SESSION_COOKIE,
  readPortalCookie,
  registerPortalRoutes,
} from './portal/contract.ts';
import {
  parseCategoryForm,
  parseDocumentTypeForm,
  parseEmergencyForm,
  parseHandlingGoalForm,
  parseNonWorkingDateForm,
  parseObligationTypeForm,
  parseReplyTargetForm,
  parseResponseGoalForm,
  renderSettingsPage,
} from './settings-page.ts';
import {
  CSRF_FIELD,
  can,
  createUnconfiguredIdentity,
  csrfFrom,
  csrfTokenFor,
  type IdentityProvider,
  PERMISSIONS,
  type Permission,
  type Role,
  readSessionCookie,
  registerStaffRoutes,
  requireStaff,
  type StaffDeps,
  verifyCsrf,
} from './staff/contract.ts';
import {
  activateTenancy,
  activationGate,
  endTenancyEarly,
  expireDueTenancies,
  getTenancy,
  listActivationQueue,
  listIncompleteTenancies,
  listObligationTypes,
  listTenancyBook,
  listTenancyEvents,
  listTenancyParties,
  reassignParkingSpace,
  reassignStorageSpace,
  recordCompletenessException,
  upsertObligationType,
} from './tenancy/contract.ts';

export interface AppDeps {
  pool: Pool;
  version: string;
  /**
   * #269. Where the one line for an unexpected outcome goes. stderr by default, which Cloud Run
   * reads as a structured entry; a test passes a collector.
   */
  logError?: (line: string) => void;
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
  embedder?: Embedder;
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
  /**
   * The tenant host: one hostname, or several separated by commas. Absent or empty,
   * `tenant.localhost`, which resolves to this machine and is never the office. #272, #291.
   */
  tenantHost?: string;
  /** The Workspace domain to require, when Dona Dom's answer is known (slice 5.1b). */
  staffHostedDomain?: string | null;
  /**
   * Painted mockups at `/dev/mockups/:flow`. **Local `-dev` only** (slice 5.3). A stamped
   * revision must not serve a second product beside the live screens.
   */
  devMockups?: boolean;
  /**
   * The one Outlook reply. Wired only when the mailbox is configured.
   * The duty reply and the office reply both call it. #256.
   */
  graphReply?: (reply: {
    messageId: string;
    body: string;
  }) => Promise<{ externalMessageId: string }>;
  /**
   * The real sorter. Absent in tests, which inject a fake at the door.
   * Present on staging and in production, where the dev form uses it too.
   */
  sorter?: Sorter;
  /**
   * When the call brief's model runs. Absent, it is deferred until after the
   * response. Tests pass one they can hold.
   */
  briefSchedule?: (work: () => Promise<void>) => void;
  /**
   * Cleartext HTTP/2. **Set only by `serve.ts` when `K_SERVICE` is present.**
   *
   * Cloud Run caps an HTTP/1 request at 32 MiB and answers with its own page before this process
   * runs. The upload bound is 100 MB (SPEC-evidence.md). End-to-end HTTP/2 is what makes that bound
   * the one the hosted service follows. Local `npm run dev` leaves this unset and stays HTTP/1.
   */
  http2?: boolean;
  /** WhatsApp media download. Absent, the webhook calls Meta. */
  whatsappFetch?: WhatsappFetch;
  /**
   * Malware scan for every channel's attachments. Absent, a file is stored
   * and cannot be opened. `serve.ts` passes the local scanner when `K_SERVICE`
   * is unset.
   */
  scanner?: MalwareScanner;
  /**
   * Delivers a portal sign-in code. Absent, sends are refused. `serve.ts` passes the log
   * sender on a laptop and the refusing sender on a revision (#273).
   */
  codeSender?: CodeSender;
}

/**
 * Megabytes of HTTP/2 session buffer.
 *
 * Node's default is 10, which is under the upload bound: a scan the parser is still copying can
 * close the session. 128 sits above 100 MB and inside the 2 GiB the revision is given for that scan.
 */
export const h2cSessionMib = 128;

/** The cleartext HTTP/2 server Cloud Run talks to once `--use-http2` is set. */
export function createH2cServer(
  handler: (req: Http2ServerRequest, res: Http2ServerResponse) => void,
): ReturnType<typeof createHttp2Server> {
  return createHttp2Server({ maxSessionMemory: h2cSessionMib }, handler);
}

/**
 * What a route declares about who may reach it. **Slice 5.2**, and the inversion the slice exists
 * for: before it, a route was open unless somebody remembered to guard it, and seven routes were
 * open for four weeks because nobody had. Now a route is refused unless somebody declared a stance,
 * and `public` is a word written next to a route rather than the absence of one.
 */
declare module 'fastify' {
  interface FastifyContextConfig {
    /** The tenant audience. #272. `public` is the only value until a tenant permission exists. */
    tenant?: string;
  }

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
  /** Staff stance. Absent on a tenant route. */
  stance: Stance | undefined;
  /** Which host serves the route. Absent on the probe and the shared assets. */
  audience?: 'office' | 'tenant';
  csrf?: 'in-body';
}

/** Hostname the tenant host answers on when nothing else is configured. #272. */
export const DEFAULT_TENANT_HOST = 'tenant.localhost';

/**
 * The hostnames `TENANT_HOST` names. Each entry is read the way one hostname is: lower case,
 * port dropped, IPv6 brackets removed. An empty entry matches nothing. Nothing left is the
 * default. #291.
 */
function tenantHostNames(setting: string | undefined): readonly string[] {
  const names = (setting ?? '')
    .split(',')
    .map((entry) => hostnameOf(entry))
    .filter((name) => name !== '');
  return names.length === 0 ? [DEFAULT_TENANT_HOST] : names;
}

/** What the process prints for the tenant host. The whole list, already normalised. #291. */
export function tenantHostLine(setting: string | undefined): string {
  return `tenant host: ${tenantHostNames(setting).join(', ')}`;
}

/** The tenant session's cookie. Read on the tenant host only. #273. */
export const TENANT_SESSION_COOKIE = PORTAL_SESSION_COOKIE;

type Audience = 'office' | 'tenant';

function hostnameOf(host: string | undefined): string {
  if (host === undefined) return '';
  const value = host.trim().toLowerCase();
  if (value.startsWith('[')) {
    const end = value.indexOf(']');
    return end === -1 ? value : value.slice(1, end);
  }
  const colon = value.lastIndexOf(':');
  if (colon > -1 && !value.slice(0, colon).includes(':')) {
    return value.slice(0, colon);
  }
  return value;
}

/**
 * HTTP/1 sends `Host`. HTTP/2, which is what Cloud Run speaks, sends `:authority` and no `Host`.
 * Either one is the host. A missing one is not the tenant host.
 */
export function hostOf(headers: {
  host?: string | string[];
  ':authority'?: string | string[];
}): string {
  const pick = (value: string | string[] | undefined) =>
    Array.isArray(value) ? value[0] : value;
  return hostnameOf(pick(headers.host) ?? pick(headers[':authority']));
}

function pathOf(url: string): string {
  const query = url.indexOf('?');
  return query === -1 ? url : url.slice(0, query);
}

/**
 * A route pattern against a request path. One segment per `:name`. Enough for the paths this
 * application registers; the router itself still does the serving.
 */
function patternMatches(pattern: string, path: string): boolean {
  const left = pattern.split('/');
  const right = path.split('/');
  if (left.length !== right.length) return false;
  for (let i = 0; i < left.length; i++) {
    const part = left[i] ?? '';
    if (part.startsWith(':')) continue;
    if (part !== right[i]) return false;
  }
  return true;
}

/**
 * The routes the root owns and serves itself: the liveness probe `infra/smoke.sh` asks, and the
 * stylesheet and fonts every screen -- including the login screen, which is served to somebody with
 * no session by definition -- loads before anybody has signed in. They are listed here, in the
 * composition root, rather than declared in `src/kernel/`, because the stance vocabulary is this
 * application's and the kernel is not allowed to know it (SPEC.md rule 9). They are not an
 * audience: both hosts serve them. #272.
 */
const ROOT_PUBLIC = [
  '/health',
  '/ui/tokens.css',
  '/ui/portal.css',
  '/ui/fonts/:file',
  '/ui/icons/:file',
];

/** Absent is not the same as a typo: a typo next to a tenant stance must not boot as tenant. */
function declaredStance(config: unknown): Stance | 'absent' | 'invalid' {
  const asked = (config as { staff?: unknown } | undefined)?.staff;
  if (asked === undefined) return 'absent';
  if (asked === 'public') return 'public';
  if (
    typeof asked === 'string' &&
    (PERMISSIONS as readonly string[]).includes(asked)
  ) {
    return asked as Permission;
  }
  return 'invalid';
}

/** `public` is the only tenant stance until a tenant permission exists. Anything else is a typo. */
function declaredTenant(config: unknown): 'public' | 'absent' | 'invalid' {
  const asked = (config as { tenant?: unknown } | undefined)?.tenant;
  if (asked === undefined) return 'absent';
  if (asked === 'public') return 'public';
  return 'invalid';
}

const NO_STANCE =
  'declares no staff stance: ' +
  "add config: { staff: <permission> } or config: { staff: 'public' } or config: { tenant: 'public' }";

/**
 * **#269. One line for an `unavailable` outcome, so a 503 is explained by the application log.**
 *
 * A kernel error carries a message and details written to be safe on the wire, so they are safe
 * here. Any other error is named by its class, its database code and its constraint, and never by
 * its message or `detail`: a pg error's detail quotes the row (`Key (address_key)=(...)`), and a
 * row is a tenant's data. The route is the pattern, never the URL, which can carry a search.
 */
function unexpectedLine(caught: unknown, route: string | undefined): string {
  const where = { severity: 'ERROR', route: route ?? null };
  if (caught instanceof KernelError) {
    return JSON.stringify({
      ...where,
      code: caught.code,
      message: caught.message,
      ...(caught.details === undefined ? {} : { details: caught.details }),
    });
  }
  const foreign = (caught ?? {}) as {
    name?: unknown;
    code?: unknown;
    constraint?: unknown;
  };
  const text = (value: unknown) => (typeof value === 'string' ? value : null);
  return JSON.stringify({
    ...where,
    code: 'unavailable',
    error: text(foreign.name),
    pgCode: text(foreign.code),
    constraint: text(foreign.constraint),
  });
}

export function buildApp(deps: AppDeps): FastifyInstance {
  const tenantHosts = new Set(tenantHostNames(deps.tenantHost));
  const audienceOf = (headers: {
    host?: string | string[];
    ':authority'?: string | string[];
  }): Audience => (tenantHosts.has(hostOf(headers)) ? 'tenant' : 'office');
  // Unconstrained routes (the probe, the assets, Fastify's own 404) still match a request that
  // carries an audience. A constrained route matches only its own host.
  //
  // The strategy is cast because find-my-way's type says the store holds a handler, and the
  // library stores a bitmap. The cast is the type, not the behaviour.
  const audienceConstraint = {
    name: 'audience',
    mustMatchWhenDerived: false,
    storage() {
      const values = new Map<string, unknown>();
      return {
        get: (value: string) => values.get(value) ?? null,
        set: (value: string, stored: unknown) => {
          values.set(value, stored);
        },
      };
    },
    deriveConstraint: (req: {
      headers: { host?: string | string[]; ':authority'?: string | string[] };
    }) => audienceOf(req.headers),
    validate(value: unknown) {
      if (value !== 'office' && value !== 'tenant') {
        throw new Error('audience must be office or tenant');
      }
    },
  };
  const app = (
    deps.http2
      ? Fastify({
          logger: false,
          routerOptions: {
            constraints: { audience: audienceConstraint as never },
          },
          http2: true,
          serverFactory: (handler) =>
            createH2cServer(
              handler as (
                req: Http2ServerRequest,
                res: Http2ServerResponse,
              ) => void,
            ),
        })
      : Fastify({
          logger: false,
          routerOptions: {
            constraints: { audience: audienceConstraint as never },
          },
        })
  ) as FastifyInstance;

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
  // A route that declares neither a staff stance nor a tenant stance does not serve unguarded -- it
  // stops the process from starting, with the method and the path in the message. The failure mode
  // this replaces is the one this system actually had: a route added in a hurry, guarded by nobody,
  // discovered by nobody, and shipped. A test asserting "every route is guarded" can only assert it
  // about the routes that exist the day it is written; this asserts it about the next one.
  //
  // Registered before any route, because `onRoute` sees only what is registered after it.
  //
  // It also records the table it checked. `app.printRoutes()` shows paths and not config, so
  // without this a test asserting "the public surface is exactly these" would have to keep its own
  // copy of the list — which is the second copy this slice spent its whole design avoiding.
  const stances: RouteStance[] = [];
  // Tenant paths, recorded here because Fastify's 404 wildcard is unconstrained and would also
  // match a tenant-audience lookup. The office host uses this list to answer "not found" for a
  // tenant route without sending a stranger to the staff login.
  const tenantRoutes: { method: string; url: string }[] = [];
  app.addHook('onRoute', (route) => {
    const shared = ROOT_PUBLIC.includes(route.url);
    const tenant = shared ? 'absent' : declaredTenant(route.config);
    const staff = shared ? 'public' : declaredStance(route.config);
    const tenantOnly = tenant === 'public' && staff === 'absent';
    const officeOnly =
      tenant === 'absent' && staff !== 'absent' && staff !== 'invalid';
    if (!shared) {
      if (tenantOnly) {
        route.constraints = { ...route.constraints, audience: 'tenant' };
      } else if (officeOnly) {
        route.constraints = { ...route.constraints, audience: 'office' };
      } else if (route.method !== 'HEAD') {
        throw new Error(
          `route ${String(route.method)} ${route.url} ${NO_STANCE}`,
        );
      }
    }
    if (tenant === 'public') {
      tenantRoutes.push({ method: String(route.method), url: route.url });
    }
    if (route.method === 'HEAD') return;
    stances.push({
      method: String(route.method),
      url: route.url,
      stance:
        tenant === 'public' || staff === 'absent' || staff === 'invalid'
          ? undefined
          : staff,
      audience: shared ? undefined : tenant === 'public' ? 'tenant' : 'office',
      csrf: route.config?.csrf,
    });
  });

  // **The guard, and it is `requireStaff` -- one function, one call site.**
  //
  // `onRequest` rather than `preHandler`, because this hook runs before the body is parsed: an
  // unauthenticated 100 MB upload is refused before a byte of it is read.
  //
  // A request that matched no route reaches here with no config, and on the office host is treated
  // as guarded rather than as public. That is deliberate: answering 404 to an anonymous caller and
  // a redirect to a signed-out one would tell a stranger which paths exist. A tenant route on the
  // office host, and anything on the tenant host that is not a tenant route, is not found — and
  // the staff cookie is not read on the way there. #272.
  app.addHook('onRequest', async (request, reply) => {
    const audience = audienceOf(request.headers);
    if (audience === 'tenant') {
      const url = request.routeOptions?.url ?? '';
      const tenant = declaredTenant(request.routeOptions?.config);
      if (
        !request.is404 &&
        (ROOT_PUBLIC.includes(url) || tenant === 'public')
      ) {
        const portalToken = readPortalCookie(
          request.headers.cookie,
          PORTAL_SESSION_COOKIE,
        );
        if (portalToken !== null) request.csrf = csrfTokenFor(portalToken);
        return;
      }
      // Not a tenant route. Do not read `dona_session`: it is not a session on this host.
      // Sent here rather than via callNotFound: this hook also runs inside the 404 route, and
      // calling it again from there would re-enter the hook.
      return reply.code(missingRoute.status).send(missingRoute.body);
    }
    if (request.is404) {
      const path = pathOf(request.url);
      const tenantRoute = tenantRoutes.some(
        (route) =>
          route.method === request.method && patternMatches(route.url, path),
      );
      if (tenantRoute) {
        return reply.code(missingRoute.status).send(missingRoute.body);
      }
    }
    const declared = declaredStance(request.routeOptions?.config);
    const stance =
      declared === 'absent' || declared === 'invalid'
        ? ROOT_PUBLIC.includes(request.routeOptions?.url ?? '')
          ? 'public'
          : undefined
        : declared;
    // Derived here and nowhere else, so no screen computes it and none of them can compute it
    // differently. A request with no session gets none, and a screen with no token renders no form
    // that would need one. The tenant cookie is not this cookie, and it is not read here.
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
      request.openCalls = await countOpenCalls(deps.pool);
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
  // Multipart bodies are the exception and they are declared, not implicit: reading the
  // field here would consume the stream the handler needs. Each carries `csrf: 'in-body'`
  // and calls the same `verifyCsrf`. The early-end route is one, because the notice letter
  // is a file.
  app.addHook('preHandler', async (request) => {
    // A staff cookie on the tenant host is not a session, so it is not read here. The portal
    // cookie is. Sign-in posts carry no session yet; their token is the form or the challenge,
    // and those routes check it themselves.
    if (audienceOf(request.headers) === 'tenant') {
      if (request.method === 'GET' || request.method === 'HEAD') return;
      const path = pathOf(request.url);
      if (path === '/sign-in' || path.startsWith('/sign-in/')) return;
      const portalConfig = request.routeOptions?.config as
        | { csrf?: unknown }
        | undefined;
      if (portalConfig?.csrf === 'in-body') return;
      const portalToken = readPortalCookie(
        request.headers.cookie,
        PORTAL_SESSION_COOKIE,
      );
      if (portalToken === null) return;
      verifyCsrf(
        portalToken,
        (request.body as Record<string, unknown> | undefined)?.[CSRF_FIELD],
      );
      return;
    }
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
  const missingRoute = (() => {
    const error = new KernelError('not_found', 'route not found');
    return { status: httpStatus(error.code), body: toErrorBody(error) };
  })();
  app.setNotFoundHandler(async (_request, reply) => {
    reply.code(missingRoute.status);
    return missingRoute.body;
  });

  const stubHeaders = (reply: {
    header: (name: string, value: string) => unknown;
  }) => {
    reply.header('content-type', 'text/html; charset=utf-8');
    reply.header('cache-control', 'no-store');
    reply.header('x-content-type-options', 'nosniff');
  };

  // **#233.** A browser gets the Hebrew page in the shell; everything else keeps the shape, byte for
  // byte (SPEC.md §Error shape).
  const logError = deps.logError ?? ((line: string) => console.error(line));
  app.setErrorHandler(async (caught, request, reply) => {
    const body = toErrorBody(caught);
    reply.code(httpStatus(body.code));
    if (body.code === 'unavailable') {
      logError(unexpectedLine(caught, request.routeOptions?.url));
    }
    if (!wantsHtml(request.headers.accept)) return body;
    const staff = request.staff;
    stubHeaders(reply);
    return renderErrorPage({
      code: body.code,
      back: wayBack(request.headers.referer, request.headers.host),
      signedIn:
        staff == null
          ? undefined
          : {
              csrf: csrfFrom(request),
              mayFile: can(staff.role, 'documents.write'),
              mayReadParties: can(staff.role, 'party.read'),
              openCalls: request.openCalls,
            },
    });
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
    return renderIndexPage({
      csrf: csrfFrom(request),
      mayFile: can(request.staff?.role ?? null, 'documents.write'),
      mayReadParties: can(request.staff?.role ?? null, 'party.read'),
      openCalls: request.openCalls,
    });
  });

  function chosenPeriod(
    query: { from?: string; to?: string } | undefined,
    day: string,
  ): { from: string; to: string } {
    try {
      const from = calendarDate(query?.from ?? '');
      const to = calendarDate(query?.to ?? '');
      return from <= to ? { from, to } : { from: to, to: from };
    } catch {
      return { from: addDays(day, -29), to: day };
    }
  }

  const SETTINGS_READ = { config: { staff: 'estate.read' } } as const;
  const SETTINGS_WRITE = { config: { staff: 'settings.write' } } as const;

  const settingsPage = async (
    request: {
      staff?: { role: Role | null } | null;
      csrf?: string | null;
      openCalls?: number;
    },
    reply: { header: (name: string, value: string) => unknown },
    saved?:
      | 'obligation'
      | 'document'
      | 'category'
      | 'emergency'
      | 'goal'
      | 'handling'
      | 'dates'
      | 'reply',
    period?: { from?: string; to?: string },
  ) => {
    stubHeaders(reply);
    const role = request.staff?.role ?? null;
    const clock = deps.clock ?? systemClock;
    const replyTarget = await readReplyTarget(deps.pool);
    const periodDates = chosenPeriod(period, today(clock));
    const share = await readReplyShare(
      deps.pool,
      clock.zone,
      periodDates.from,
      periodDates.to,
      replyTarget.days,
    );
    return renderSettingsPage({
      csrf: csrfFrom(request),
      mayWrite: can(role, 'settings.write'),
      mayFile: can(role, 'documents.write'),
      mayReadParties: can(role, 'party.read'),
      openCalls: request.openCalls,
      state: 'wired',
      obligations: await listObligationTypes(deps.pool),
      documents: await listDocumentTypes(deps.pool, { activeOnly: false }),
      categories: await listCategories(deps.pool),
      emergency: await readEmergencySettings(deps.pool),
      goal: await readResponseGoal(deps.pool),
      handling: await readHandlingGoal(deps.pool),
      nonWorkingDates: await readNonWorkingDates(deps.pool),
      replyTarget,
      share,
      saved,
    });
  };

  app.get('/settings', SETTINGS_READ, async (request, reply) => {
    const query = request.query as {
      saved?: string;
      from?: string;
      to?: string;
    };
    const saved = query.saved;
    return settingsPage(
      request,
      reply,
      saved === 'obligation' ||
        saved === 'document' ||
        saved === 'category' ||
        saved === 'emergency' ||
        saved === 'goal' ||
        saved === 'handling' ||
        saved === 'dates' ||
        saved === 'reply'
        ? saved
        : undefined,
      { from: query.from, to: query.to },
    );
  });
  app.post(
    '/settings/obligation-types',
    SETTINGS_WRITE,
    async (request, reply) => {
      await upsertObligationType(
        deps.pool,
        parseObligationTypeForm(request.body),
      );
      return reply
        .code(303)
        .header('location', '/settings?saved=obligation')
        .send();
    },
  );
  app.post(
    '/settings/document-types',
    SETTINGS_WRITE,
    async (request, reply) => {
      await upsertDocumentType(deps.pool, parseDocumentTypeForm(request.body));
      return reply
        .code(303)
        .header('location', '/settings?saved=document')
        .send();
    },
  );
  app.post('/settings/emergency', SETTINGS_WRITE, async (request, reply) => {
    const staff = request.staff;
    if (staff == null) throw new KernelError('not_allowed', 'not_allowed');
    const clock = deps.clock ?? systemClock;
    await saveEmergencySettings(deps.pool, clock, {
      ...parseEmergencyForm(request.body),
      actorId: staff.staffAccountId,
      actorRole: staff.role,
    });
    return reply
      .code(303)
      .header('location', '/settings?saved=emergency')
      .send();
  });
  app.post(
    '/settings/response-goal',
    SETTINGS_WRITE,
    async (request, reply) => {
      const staff = request.staff;
      if (staff == null) throw new KernelError('not_allowed', 'not_allowed');
      const clock = deps.clock ?? systemClock;
      await saveResponseGoal(deps.pool, clock, {
        ...parseResponseGoalForm(request.body),
        actorId: staff.staffAccountId,
        actorRole: staff.role,
      });
      return reply.code(303).header('location', '/settings?saved=goal').send();
    },
  );
  app.post(
    '/settings/handling-clock',
    SETTINGS_WRITE,
    async (request, reply) => {
      const staff = request.staff;
      if (staff == null) throw new KernelError('not_allowed', 'not_allowed');
      const clock = deps.clock ?? systemClock;
      await saveHandlingGoal(deps.pool, clock, {
        ...parseHandlingGoalForm(request.body),
        actorId: staff.staffAccountId,
        actorRole: staff.role,
      });
      return reply
        .code(303)
        .header('location', '/settings?saved=handling')
        .send();
    },
  );
  app.post(
    '/settings/answer-target',
    SETTINGS_WRITE,
    async (request, reply) => {
      const staff = request.staff;
      if (staff == null) throw new KernelError('not_allowed', 'not_allowed');
      const clock = deps.clock ?? systemClock;
      await saveReplyTarget(deps.pool, clock, {
        ...parseReplyTargetForm(request.body),
        actorId: staff.staffAccountId,
        actorRole: staff.role,
      });
      return reply.code(303).header('location', '/settings?saved=reply').send();
    },
  );
  app.post(
    '/settings/non-working-dates',
    SETTINGS_WRITE,
    async (request, reply) => {
      const staff = request.staff;
      if (staff == null) throw new KernelError('not_allowed', 'not_allowed');
      const clock = deps.clock ?? systemClock;
      await changeNonWorkingDate(deps.pool, clock, {
        ...parseNonWorkingDateForm(request.body),
        actorId: staff.staffAccountId,
        actorRole: staff.role,
      });
      return reply.code(303).header('location', '/settings?saved=dates').send();
    },
  );
  app.post('/settings/categories', SETTINGS_WRITE, async (request, reply) => {
    await upsertCategory(deps.pool, parseCategoryForm(request.body));
    return reply
      .code(303)
      .header('location', '/settings?saved=category')
      .send();
  });

  // Slice 6.1: the flow is read off `mockups/<flow>.html` rather than named in a condition, so the
  // file guard four scans is the file the director clicks and no paint can hide in TypeScript.
  if (deps.devMockups === true) {
    app.get(
      '/dev/mockups/:flow',
      { config: { staff: 'estate.read' } },
      async (request, reply) => {
        const flow = (request.params as { flow: string }).flow;
        try {
          const painted = renderMockup(flow, csrfFrom(request));
          stubHeaders(reply);
          return painted;
        } catch (error) {
          if (!(error instanceof KernelError)) throw error;
          reply.code(httpStatus(error.code));
          return toErrorBody(error);
        }
      },
    );
  }

  const clock = deps.clock ?? systemClock;
  const objects = deps.objects ?? createMemoryStore();
  const bucket = deps.bucket ?? configuredBucket();
  const pdf = deps.pdf ?? createPdfjsText();

  registerEstateRoutes(app, {
    pool: deps.pool,
    columnMap: COLUMN_MAP,
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
    expireDueTenancies,
    listIncompleteTenancies: (db) =>
      listIncompleteTenancies(db, clock, listTenancyDocumentFacts),
    listActivationQueue: (db) =>
      listActivationQueue(db, clock, listTenancyDocumentFacts),
    listTenancyBook: (db, unitId) =>
      listTenancyBook(db, clock, listTenancyDocumentFacts, unitId),
    listUnopenedLeases: async (db) =>
      signLinkedDocuments(
        await listUnopenedLeases(db),
        objects,
        bucket,
        clock.now(),
      ),
    recordCompletenessException,
    getTenancy,
    listTenancyParties,
    listPartyNames,
    activationGate: (db, tenancyId) =>
      activationGate(db, clock, tenancyId, listTenancyDocumentFacts, {
        addressMatches,
        apartmentMatches,
      }),
    activateTenancy: (db, spec) =>
      activateTenancy(db, clock, spec, listTenancyDocumentFacts),
    reassignParkingSpace: (db, spec) => reassignParkingSpace(db, clock, spec),
    reassignStorageSpace: (db, spec) => reassignStorageSpace(db, clock, spec),
    endTenancyEarly: (db, spec) => endTenancyEarly(db, clock, spec),
    fileTerminationNotice: async (spec) => {
      const settings = createSettings(deps.pool);
      const [extraction, ocr] = await Promise.all([
        readExtractionSettings(settings),
        readOcrSettings(settings),
      ]);
      const result = await fileDocument(
        {
          db: deps.pool,
          objects,
          pdf,
          ocr: deps.ocr,
          ocrVersion: ocr.processorVersion,
          extractor: deps.extractor,
          embedder: deps.embedder,
          extractModel: extraction.model,
          extractReasoningEffort: extraction.reasoningEffort,
          work: deps.work,
          audit: createAuditLog(deps.pool, clock),
          clock,
          bucket,
        },
        {
          bytes: spec.bytes,
          typeKey: 'termination_notice',
          place: { kind: 'UNIT', id: spec.unitId },
          tenancyId: spec.tenancyId,
          filedBy: spec.filedBy,
        },
      );
      if (!result.filed) {
        throw new KernelError('invalid', 'the notice could not be filed');
      }
      return result.documentId;
    },
    runOfficeTurn: async (spec) => {
      const extraction = await readExtractionSettings(
        createSettings(deps.pool),
      );
      const audit = createAuditLog(deps.pool, clock);
      const entry = {
        actorKind: 'staff' as const,
        actorId: spec.staffAccountId,
        action: 'evidence.office_turn',
        subjectId: spec.bound.id,
        inputs: {
          boundKind: spec.bound.kind,
        },
      };
      try {
        await runOfficeTurn(
          {
            db: deps.pool,
            clock,
            extractor: deps.extractor ?? createUnconfiguredExtractor(),
            embedder: deps.embedder ?? createUnconfiguredEmbedder(),
            model: extraction.model,
            reasoningEffort: extraction.reasoningEffort,
          },
          {
            staffAccountId: spec.staffAccountId,
            bound: spec.bound,
            question: spec.question,
          },
        );
        await audit.write(entry, { outcome: 'ok' });
      } catch (error) {
        const details =
          error instanceof KernelError ? error.details : undefined;
        await audit.write(
          {
            ...entry,
            inputs: {
              ...entry.inputs,
              name: details?.name,
              status: details?.status,
              providerCode: details?.providerCode,
              providerMessage: details?.providerMessage,
            },
          },
          {
            outcome: 'error',
            code: error instanceof KernelError ? error.code : 'unavailable',
            message: error instanceof Error ? error.message : undefined,
          },
        );
        throw error;
      }
    },
  });
  // Slice 5.1, and from 5.2 no longer the only routes behind a session: every route this
  // application registers declares a stance above, and the hook calls `requireStaff` once.
  registerStaffRoutes(app, staffDeps);
  registerPartyDirectoryRoutes(app, { pool: deps.pool, clock });
  const brief =
    deps.extractor && deps.embedder
      ? {
          extractor: deps.extractor,
          embedder: deps.embedder,
          schedule: deps.briefSchedule,
        }
      : undefined;
  const onCallIdentified = brief
    ? (callId: string) =>
        startCallBrief(
          {
            db: deps.pool,
            clock,
            extractor: brief.extractor,
            embedder: brief.embedder,
            schedule: brief.schedule,
          },
          callId,
        )
    : undefined;
  const graphReply = deps.graphReply;
  registerCallsRoutes(app, {
    pool: deps.pool,
    clock,
    brief,
    chrome: signedInChrome,
    devIntake: deps.devMockups === true,
    messagesOnCall: (callId) => listMessagesOnCall(deps.pool, callId),
    sendEmailReply:
      graphReply === undefined
        ? undefined
        : (callId, body) =>
            replyOnInboundEmail(deps.pool, callId, body, graphReply),
    listNoise: () => listNoiseMessages(deps.pool),
    rescueNoise: (spec) => rescueNoise(deps.pool, clock, spec),
    mailboxWarning: () =>
      graphMailboxFrom(process.env)
        ? mailboxWarning(deps.pool, clock)
        : Promise.resolve(false),
    secretWarning: () => {
      const outlook = graphMailboxFrom(process.env);
      return outlook ? secretWarning(outlook, clock) : null;
    },
    whatsappWarning: () =>
      whatsappFrom(process.env)
        ? whatsappWarning(deps.pool, clock)
        : Promise.resolve(false),
    openAttachment: (spec) => readAttachment(deps.pool, objects, spec),
    fileAttachment: (spec) =>
      fileCallAttachment(deps.pool, clock, { objects, pdf, bucket }, spec),
    documentTypes: async () => {
      const types = await listDocumentTypes(deps.pool, { activeOnly: true });
      return types.map((type) => ({
        typeKey: type.typeKey,
        labelHe: type.labelHe,
      }));
    },
  });
  registerChannelRoutes(app, {
    pool: deps.pool,
    clock,
    chrome: signedInChrome,
    devIntake: deps.devMockups === true,
    sorter: deps.sorter,
    objects,
    scanner: deps.scanner,
    whatsappFetch: deps.whatsappFetch,
    onCallIdentified,
  });
  const portalSorter: Sorter = deps.sorter ?? {
    async sort() {
      throw new Error('sorter is not configured');
    },
    async translate() {
      return { bodyHe: null };
    },
  };
  registerPortalRoutes(app, {
    pool: deps.pool,
    clock,
    readDocument: async (storageUri) => {
      const { path } = parseStorageUri(storageUri, bucket);
      return (await objects.read(path)).bytes;
    },
    sender: deps.codeSender ?? createUnavailableCodeSender(),
    calls: {
      list: (partyIds) => listPortalCalls(deps.pool, partyIds),
      read: (callId, partyIds) => readPortalCall(deps.pool, callId, partyIds),
      status: tenantStatus,
    },
    messagesOnCall: (callId) => listMessagesOnCall(deps.pool, callId),
    listReportFiles: (ownerId, submissionId) =>
      listHolds(deps.pool, ownerId, submissionId),
    removeReportFile: (ownerId, submissionId, holdId) =>
      removeHold(deps.pool, ownerId, submissionId, holdId),
    readReportFile: (ownerId, holdId) =>
      openHold(deps.pool, objects, ownerId, holdId),
    saveReportFile: (file) =>
      holdAttachment(deps.pool, clock, objects, deps.scanner, file),
    loadReport: async () => {
      const [categories, duty] = await Promise.all([
        listCategories(deps.pool, { activeOnly: true }),
        readEmergencySettings(deps.pool),
      ]);
      return {
        categories: categories.map((row) => ({
          id: row.id,
          code: row.code,
          labelHe: row.labelHe,
        })),
        dutyPhone: duty.phone,
      };
    },
    replyLine: async () => {
      const target = await readReplyTarget(deps.pool);
      return target.shown ? { days: target.days } : null;
    },
    submitReport: async (report) => {
      const outcome = await receiveIncoming(
        deps.pool,
        clock,
        {
          sorter: portalSorter,
          matchesEmergency: emergencyMatch(deps.pool),
          objects,
          scanner: deps.scanner,
          onCallIdentified,
        },
        {
          sourceChannel: 'PORTAL',
          externalMessageId: report.key,
          externalThreadId: report.key,
          senderAddress: report.phone,
          receivedAt: clock.now(),
          body: report.body,
          suggestedCategoryId: report.categoryId,
          entryPermission: report.entry,
          tenancyId: report.tenancyId,
          holds: {
            ownerId: report.ownerId,
            submissionId: report.key,
            ids: (await listHolds(deps.pool, report.ownerId, report.key)).map(
              (file) => file.id,
            ),
          },
          followCallId: report.predecessorId,
        },
      );
      const callId = outcome.kind === 'filtered' ? null : outcome.callId;
      if (callId === null) return null;
      const call = await getCall(deps.pool, callId);
      if (call?.callNumber === undefined) return null;
      const duty = call.emergency.flagged
        ? composeDutyReply(await readEmergencySettings(deps.pool))
        : null;
      return { callId: call.id, callNumber: call.callNumber, duty };
    },
    submitQuestion: async (question) => {
      const outcome = await receiveIncoming(
        deps.pool,
        clock,
        {
          sorter: portalSorter,
          matchesEmergency: emergencyMatch(deps.pool),
          objects,
          scanner: deps.scanner,
          onCallIdentified,
        },
        {
          sourceChannel: 'PORTAL',
          externalMessageId: question.key,
          externalThreadId: question.key,
          senderAddress: question.phone,
          receivedAt: clock.now(),
          body: question.body,
        },
      );
      const callId = outcome.kind === 'filtered' ? null : outcome.callId;
      if (callId === null) return null;
      const call = await getCall(deps.pool, callId);
      if (call?.callNumber === undefined) return null;
      const duty = call.emergency.flagged
        ? composeDutyReply(await readEmergencySettings(deps.pool))
        : null;
      return { callNumber: call.callNumber, duty };
    },
    submitFollowUp: async (follow) => {
      const held = await listHolds(deps.pool, follow.ownerId, follow.key);
      const outcome = await receiveIncoming(
        deps.pool,
        clock,
        {
          sorter: portalSorter,
          matchesEmergency: emergencyMatch(deps.pool),
          objects,
          scanner: deps.scanner,
          onCallIdentified,
        },
        {
          sourceChannel: 'PORTAL',
          externalMessageId: follow.key,
          externalThreadId: follow.callId,
          senderAddress: follow.phone,
          receivedAt: clock.now(),
          body: follow.body,
          followCallId: follow.callId,
          holds:
            held.length === 0
              ? undefined
              : {
                  ownerId: follow.ownerId,
                  submissionId: follow.key,
                  ids: held.map((file) => file.id),
                },
        },
      );
      if (outcome.kind === 'filtered' || outcome.callId === null) return null;
      return { callId: outcome.callId };
    },
  });
  registerDocumentRoutes(app, {
    pool: deps.pool,
    clock,
    objects,
    pdf,
    ocr: deps.ocr,
    extractor: deps.extractor,
    embedder: deps.embedder,
    work: deps.work,
    bucket,
    chrome: signedInChrome,
    contacts: contactRules,
  });
  registerPolicyRoutes(app, {
    pool: deps.pool,
    clock,
    objects,
    pdf,
    embedder: deps.embedder ?? createUnconfiguredEmbedder(),
    ocr: deps.ocr,
    bucket,
    chrome: signedInChrome,
  });

  return app;
}
