// The tenant host's sign-in. Every route is `tenant: 'public'` because a permission does not
// exist yet; the session is what this file checks, and a missing one is the phone screen.

import type { IncomingHttpHeaders } from 'node:http';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Pool } from 'pg';
import type { CodeChannel, CodeSender } from '../../channel/contract.ts';
import { createAuditLog } from '../../kernel/audit.ts';
import { type Clock, dayIn, today } from '../../kernel/clock.ts';
import { KernelError } from '../../kernel/errors.ts';
import { newId } from '../../kernel/ids.ts';
import { validId } from '../../kernel/validate.ts';
import {
  listPortalDocuments,
  type PortalDocumentKind,
  type PortalTenancy,
  resolvePortalDocument,
  resolvePortalTenancies,
} from '../../scope/contract.ts';
import { csrfTokenFor, verifyCsrf } from '../../staff/contract.ts';
import {
  callCard,
  nextVisit,
  type ShownCall,
  type TenantStatus,
  threadScreen,
} from './call-screen.ts';
import { describeChallenge, requestCode, verifyCode } from './codes.ts';
import { portalLanguages, portalText, runPortalLanguage } from './copy.ts';
import { portalManifest, portalWorkerSource } from './install.ts';
import {
  languageReturn,
  PORTAL_LANG_COOKIE,
  PORTAL_LANG_MAX_AGE,
  startingLanguage,
} from './language.ts';
import {
  displayDate,
  greetingKey,
  hourInZone,
  leasePercent,
  monthsRemaining,
} from './lease.ts';
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
  PORTAL_CHOICE_COOKIE,
  PORTAL_FORM_COOKIE,
  PORTAL_SESSION_COOKIE,
  portalCookie,
  readPortalCookie,
  resolvePortalSession,
  revokeEveryPortalSession,
  revokePortalSession,
  SESSION_ABSOLUTE_MS,
  sessionCookie,
} from './sessions.ts';
import {
  type PortalChoice,
  renderAskPage,
  renderAskReceived,
  renderCodePage,
  renderFlatPage,
  renderHomePage,
  renderMissingPage,
  renderMorePage,
  renderNoAccessPage,
  renderNoticeFullPage,
  renderNoticePage,
  renderPasskeyOffer,
  renderPasskeysPage,
  renderPhonePage,
  renderPortalCallPage,
  renderPortalCallsPage,
  renderReportPage,
  renderReportReceived,
} from './views.ts';
import { zoned } from './when.ts';

const TENANT = { config: { tenant: 'public' } } as const;

export interface PortalQuestion {
  phone: string;
  key: string;
  body: string;
}

export interface PortalReceipt {
  callNumber: number;
  duty: string | null;
}

export interface PortalReport {
  phone: string;
  ownerId: string;
  key: string;
  body: string;
  categoryId: string;
  entry: 'YES' | 'ARRANGE' | 'HOME';
  tenancyId: string;
  /** A closed call this report continues. Null on a report that stands alone. */
  predecessorId: string | null;
}

export interface PortalFollowUp {
  phone: string;
  ownerId: string;
  key: string;
  body: string;
  callId: string;
}

export interface PortalReportReceipt {
  callId: string;
  callNumber: number;
  duty: string | null;
}

export interface PortalDeps {
  pool: Pool;
  clock: Clock;
  sender: CodeSender;
  /** The tenancy file's bytes. The composition root reads the object store. */
  readDocument: (storageUri: string) => Promise<Buffer>;
  /**
   * The intake door. The composition root wires it, because this module
   * reaching calls or channel pulls a cycle through the building switch.
   */
  submitQuestion?: (question: PortalQuestion) => Promise<PortalReceipt | null>;
  /** Active categories and the duty phone from /settings. */
  loadReport: () => Promise<{
    categories: readonly { id: string; code: string; labelHe: string }[];
    dutyPhone: string;
  }>;
  /** The intake door for a report. Absent in a process that has not wired it. */
  submitReport?: (report: PortalReport) => Promise<PortalReportReceipt | null>;
  /** A follow-up on a call the tenant can already read. */
  submitFollowUp?: (
    follow: PortalFollowUp,
  ) => Promise<{ callId: string } | null>;
  /** A file on a report that is not a call yet. Clean files come back as rows. */
  listReportFiles?: (
    ownerId: string,
    submissionId: string,
  ) => Promise<{ id: string; fileName: string; contentType: string }[]>;
  saveReportFile?: (file: {
    ownerId: string;
    submissionId: string;
    fileName: string;
    bytes: Buffer;
  }) => Promise<
    | { status: 'clean' }
    | {
        status: 'refused';
        reason: 'type' | 'size' | 'infected' | 'unavailable' | 'many';
      }
  >;
  removeReportFile?: (
    ownerId: string,
    submissionId: string,
    holdId: string,
  ) => Promise<void>;
  /** The picture on a thumbnail. Only the tenant who added that file. */
  readReportFile?: (
    ownerId: string,
    holdId: string,
  ) => Promise<{ bytes: Buffer; contentType: string; fileName: string } | null>;
  /**
   * The tenant's calls. Wired at the composition root: this file importing
   * the calls contract pulls the brief through the building switch.
   */
  calls: {
    list(partyIds: readonly string[]): Promise<ShownCall[]>;
    read(
      callId: string,
      partyIds: readonly string[],
    ): Promise<ShownCall | null>;
    status(state: string, exitKind: string | null): TenantStatus;
  };
  /** Messages on a call. Wired beside the calls, for the same cycle. */
  messagesOnCall(
    callId: string,
  ): Promise<readonly { at: Date; body: string; echo: boolean }[]>;
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

function idOrEmpty(raw: string | undefined, label: string): string {
  try {
    return validId(raw ?? '', label);
  } catch (error) {
    if (!(error instanceof KernelError)) throw error;
    return '';
  }
}

// The same four kinds evidence stores. Importing that map from here cycles
// through estate, which already imports this module.
const FILE_TYPE: Record<PortalDocumentKind, string> = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  png: 'image/png',
  tif: 'image/tiff',
};

function fileType(kind: PortalDocumentKind): string {
  return FILE_TYPE[kind];
}

function contentDisposition(fileName: string): string {
  const ascii = fileName.replace(/[^A-Za-z0-9._ -]/g, '').trim() || 'file';
  const utf8 = encodeURIComponent(fileName);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${utf8}`;
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

function languageNow(
  cookie: string | undefined,
  preferred: string | null,
): string {
  return startingLanguage({
    chosen: readPortalCookie(cookie, PORTAL_LANG_COOKIE),
    preferred,
  });
}

function paint<T>(language: string, body: () => T): T {
  return runPortalLanguage(language, body);
}

async function preferredLanguage(
  pool: Pool,
  clock: Clock,
  cookie: string | undefined,
  phone: string,
  actorId: string,
): Promise<string | null> {
  const chosen = readPortalCookie(cookie, PORTAL_LANG_COOKIE);
  if (chosen !== null && portalLanguages().includes(chosen)) return null;
  const rows = await resolvePortalTenancies(pool, phone, clock, {
    actor: { actorKind: 'tenant', actorId },
  });
  const open = rows.filter((row) => row.portalEnabled);
  const picked = readPortalCookie(cookie, PORTAL_CHOICE_COOKIE);
  const match =
    open.find((row) => row.tenancyId === picked) ?? open[0] ?? rows[0];
  return match?.preferredLanguage ?? null;
}

const REPORT_TEXT_MAX = 4000;

interface ReportForm {
  submission: string;
  step: 1 | 2 | 3;
  categoryId: string;
  description: string;
  entry: 'YES' | 'ARRANGE' | 'HOME' | '';
  notice: string | null;
  predecessorId: string;
}

function dutyHref(phone: string): string {
  const compact = phone.replace(/[^\d+]/g, '');
  if (compact.startsWith('+')) return `tel:${compact}`;
  if (compact.startsWith('0')) return `tel:+972${compact.slice(1)}`;
  return `tel:${compact}`;
}

const FILE_NOTICE = {
  type: 'report.file_type',
  size: 'report.file_size',
  infected: 'report.file_infected',
  unavailable: 'report.file_unavailable',
  many: 'report.file_many',
} as const;

function readReport(body: unknown): {
  csrf: string;
  key: string | null;
  categoryId: string;
  description: string;
  entry: ReportForm['entry'];
  step: 1 | 2 | 3;
  action: 'back' | 'send' | 'next';
  remove: string | null;
  file: { fileName: string; bytes: Buffer } | null;
  oversized: boolean;
  predecessor: string;
} {
  let key: string | null = null;
  try {
    key = validId(field(body, 'submission'), 'submission');
  } catch (error) {
    if (!(error instanceof KernelError)) throw error;
  }
  const stepRaw = field(body, 'step');
  const actionRaw = field(body, 'action');
  const entryRaw = field(body, 'entry');
  let remove: string | null = null;
  try {
    const raw = field(body, 'remove');
    remove = raw === '' ? null : validId(raw, 'file');
  } catch (error) {
    if (!(error instanceof KernelError)) throw error;
  }
  let predecessor = '';
  try {
    const raw = field(body, 'predecessor');
    predecessor = raw === '' ? '' : validId(raw, 'call');
  } catch (error) {
    if (!(error instanceof KernelError)) throw error;
  }
  return {
    csrf: field(body, 'csrf'),
    key,
    predecessor,
    categoryId: field(body, 'category'),
    description: field(body, 'description').trim(),
    entry:
      entryRaw === 'YES' || entryRaw === 'ARRANGE' || entryRaw === 'HOME'
        ? entryRaw
        : '',
    step: stepRaw === '2' ? 2 : stepRaw === '3' ? 3 : 1,
    action:
      actionRaw === 'back' ? 'back' : actionRaw === 'send' ? 'send' : 'next',
    remove,
    file: null,
    oversized: false,
  };
}

async function readBody(request: FastifyRequest): Promise<{
  fields: Record<string, string>;
  file: { fileName: string; bytes: Buffer } | null;
  oversized: boolean;
}> {
  const header = request.headers['content-type'];
  const type = Array.isArray(header) ? header[0] : header;
  if (!type?.includes('multipart/form-data')) {
    const fields: Record<string, string> = {};
    const body = request.body;
    if (body !== null && typeof body === 'object') {
      for (const [name, value] of Object.entries(
        body as Record<string, unknown>,
      )) {
        if (typeof value === 'string') fields[name] = value;
      }
    }
    return { fields, file: null, oversized: false };
  }
  const fields: Record<string, string> = {};
  let file: { fileName: string; bytes: Buffer } | null = null;
  let oversized = false;
  // The published type omits this flag. The runtime reads it, and a cut file
  // stays a sentence on the report instead of a bare 413.
  const limited = { throwFileSizeLimit: false } as Parameters<
    FastifyRequest['parts']
  >[0];
  for await (const part of request.parts(limited)) {
    if (part.type === 'file') {
      const stream = part.file;
      const chunks: Buffer[] = [];
      let truncated = false;
      if (stream) {
        for await (const chunk of stream) {
          if (stream.truncated) {
            truncated = true;
            chunks.length = 0;
            continue;
          }
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        }
      }
      if (truncated || stream?.truncated) {
        oversized = true;
        continue;
      }
      const read = Buffer.concat(chunks);
      if (part.fieldname === 'file' && read.length > 0 && file === null) {
        file = { fileName: part.filename ?? 'file', bytes: read };
      }
      continue;
    }
    if (part.fieldname !== '' && fields[part.fieldname] === undefined) {
      fields[part.fieldname] = String(part.value ?? '');
    }
  }
  return { fields, file, oversized };
}

async function readPostedReport(
  request: FastifyRequest,
): Promise<ReturnType<typeof readReport>> {
  const posted = await readBody(request);
  return {
    ...readReport(posted.fields),
    file: posted.file,
    oversized: posted.oversized,
  };
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

  app.get('/manifest.webmanifest', TENANT, async (request, reply) => {
    const language = languageNow(request.headers.cookie, null);
    reply
      .header('content-type', 'application/manifest+json; charset=utf-8')
      .header('cache-control', 'no-cache')
      .header('x-content-type-options', 'nosniff');
    return JSON.stringify(paint(language, () => portalManifest()));
  });

  app.get('/sw.js', TENANT, async (_request, reply) => {
    reply
      .header('content-type', 'text/javascript; charset=utf-8')
      .header('cache-control', 'no-cache')
      .header('x-content-type-options', 'nosniff');
    return portalWorkerSource();
  });

  app.get('/', TENANT, async (request, reply) => {
    const secure = secureOf(request);
    const token = readPortalCookie(
      request.headers.cookie,
      PORTAL_SESSION_COOKIE,
    );
    if (token !== null) {
      const session = await resolvePortalSession(pool, clock, token);
      if (session !== null) {
        const who = await openPortal(request.headers.cookie, token, session);
        if (who.kind === 'notice') return go(reply, '/notice', []);
        return html(reply, await homePage(who));
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
          : [
              clearedCookie(PORTAL_SESSION_COOKIE, secure),
              clearedCookie(PORTAL_CHOICE_COOKIE, secure),
            ]),
      ],
    );
  });

  interface OpenPortal {
    kind: 'open';
    token: string;
    phone: string;
    identityId: string;
    language: string;
    rows: PortalTenancy[];
    chosen: PortalTenancy | null;
  }

  async function openPortal(
    cookie: string | undefined,
    token: string,
    session: { portalIdentityId: string; phone: string },
  ): Promise<{ kind: 'notice'; language: string } | OpenPortal> {
    const rows = await resolvePortalTenancies(pool, session.phone, clock, {
      actor: { actorKind: 'tenant', actorId: session.portalIdentityId },
    });
    const open = rows.filter((row) => row.portalEnabled);
    const picked = readPortalCookie(cookie, PORTAL_CHOICE_COOKIE);
    const chosen =
      open.find((row) => row.tenancyId === picked) ?? open[0] ?? null;
    const language = languageNow(
      cookie,
      (chosen ?? rows[0])?.preferredLanguage ?? null,
    );
    if (await noticeDue(session.portalIdentityId, language)) {
      return { kind: 'notice', language };
    }
    return {
      kind: 'open',
      token,
      phone: session.phone,
      identityId: session.portalIdentityId,
      language,
      rows: open,
      chosen,
    };
  }

  function choicesOf(rows: readonly PortalTenancy[]): PortalChoice[] {
    return rows.map((row) => ({
      id: row.tenancyId,
      label: `${portalText('flat.unit')} ${row.unitNumber} · ${row.addressLine}`,
      city: row.city,
    }));
  }

  function greetingFor(row: PortalTenancy): string {
    const hello = portalText(greetingKey(hourInZone(clock.now(), clock.zone)));
    const name = row.givenName?.trim() || row.fullName.trim();
    return name === '' ? hello : `${hello}, ${name}`;
  }

  function reached(who: OpenPortal): string[] {
    return [...new Set(who.rows.map((row) => row.partyId))];
  }

  async function callsOf(who: OpenPortal): Promise<ShownCall[]> {
    if (who.chosen === null) return [];
    const calls = await deps.calls.list([who.chosen.partyId]);
    await audit.write(
      {
        actorKind: 'tenant',
        actorId: who.identityId,
        action: 'portal.list_calls',
        subjectId: who.chosen.tenancyId,
        inputs: { count: calls.length },
      },
      { outcome: 'ok' },
    );
    return calls;
  }

  async function homePage(who: OpenPortal): Promise<string> {
    if (who.chosen === null) {
      return paint(who.language, () =>
        renderNoAccessPage({
          csrf: csrfTokenFor(who.token),
          phone: nationalDisplay(who.phone),
        }),
      );
    }
    const calls = await callsOf(who);
    const open = calls.filter((call) => call.state !== 'CLOSED');
    const zone = clock.zone;
    const chosen = who.chosen;
    return paint(who.language, () =>
      renderHomePage({
        csrf: csrfTokenFor(who.token),
        choices: choicesOf(who.rows),
        chosenId: chosen.tenancyId,
        greeting: greetingFor(chosen),
        openCount: open.length,
        calls: open
          .slice(0, 2)
          .map((call) => callCard(call, zone, deps.calls.status)),
        visit: nextVisit(calls, clock.now(), zone),
      }),
    );
  }

  async function callsPage(who: OpenPortal, closed: boolean): Promise<string> {
    if (who.chosen === null) {
      return paint(who.language, () =>
        renderNoAccessPage({
          csrf: csrfTokenFor(who.token),
          phone: nationalDisplay(who.phone),
        }),
      );
    }
    const calls = await callsOf(who);
    const zone = clock.zone;
    const open = calls.filter((call) => call.state !== 'CLOSED');
    const done = calls.filter((call) => call.state === 'CLOSED');
    const shown = closed ? done : open;
    const chosen = who.chosen;
    return paint(who.language, () =>
      renderPortalCallsPage({
        csrf: csrfTokenFor(who.token),
        choices: choicesOf(who.rows),
        chosenId: chosen.tenancyId,
        closed,
        openCount: open.length,
        closedCount: done.length,
        calls: shown.map((call) => callCard(call, zone, deps.calls.status)),
      }),
    );
  }

  async function flatOf(who: OpenPortal, tenancyId: string): Promise<string> {
    if (who.chosen === null) {
      return paint(who.language, () =>
        renderNoAccessPage({
          csrf: csrfTokenFor(who.token),
          phone: nationalDisplay(who.phone),
        }),
      );
    }
    const row = who.rows.find((item) => item.tenancyId === tenancyId);
    const chosen = who.chosen;
    if (row === undefined) {
      return paint(who.language, () =>
        renderMissingPage({ chosenId: chosen.tenancyId }),
      );
    }
    const day = today(clock);
    const listed = await listPortalDocuments(pool, row.tenancyId, clock, {
      actor: { actorKind: 'tenant', actorId: who.identityId },
    });
    return paint(who.language, () => {
      const parking =
        row.parking.length === 0
          ? portalText('flat.none')
          : row.parking.join(' · ');
      const storage =
        row.storage.length === 0
          ? portalText('flat.none')
          : row.storage.join(' · ');
      return renderFlatPage({
        csrf: csrfTokenFor(who.token),
        choices: choicesOf(who.rows),
        chosenId: row.tenancyId,
        address: `${row.addressLine}, ${portalText('flat.unit')} ${row.unitNumber}`,
        city: row.city,
        start: displayDate(row.startDate),
        end: displayDate(row.endDate),
        months: monthsRemaining(day, row.endDate),
        percent: leasePercent(row.startDate, row.endDate, day),
        parking,
        storage,
        documents: listed.map((doc) => ({
          href: `/flat/${row.tenancyId}/documents/${doc.documentId}`,
          name: doc.name,
          kind: portalText(`papers.kind.${doc.kind}`),
        })),
      });
    });
  }

  async function portalOf(request: {
    headers: IncomingHttpHeaders;
  }): Promise<null | { kind: 'notice'; language: string } | OpenPortal> {
    const token = readPortalCookie(
      request.headers.cookie,
      PORTAL_SESSION_COOKIE,
    );
    if (token === null) return null;
    const session = await resolvePortalSession(pool, clock, token);
    if (session === null) return null;
    return openPortal(request.headers.cookie, token, session);
  }

  app.get('/flat/:tenancyId', TENANT, async (request, reply) => {
    const who = await portalOf(request);
    if (who === null) return go(reply, '/', []);
    if (who.kind === 'notice') return go(reply, '/notice', []);
    const raw = (request.params as { tenancyId?: string }).tenancyId ?? '';
    let tenancyId = raw;
    try {
      tenancyId = validId(raw, 'tenancy');
    } catch (error) {
      if (!(error instanceof KernelError)) throw error;
      tenancyId = '';
    }
    const body = await flatOf(who, tenancyId);
    if (
      who.chosen !== null &&
      !who.rows.some((row) => row.tenancyId === tenancyId)
    ) {
      reply.code(404);
    }
    return html(reply, body);
  });

  app.get(
    '/flat/:tenancyId/documents/:documentId',
    TENANT,
    async (request, reply) => {
      const who = await portalOf(request);
      if (who === null) return go(reply, '/', []);
      if (who.kind === 'notice') return go(reply, '/notice', []);
      const params = request.params as {
        tenancyId?: string;
        documentId?: string;
      };
      const tenancyId = idOrEmpty(params.tenancyId, 'tenancy');
      const documentId = idOrEmpty(params.documentId, 'document');
      if (who.chosen === null) {
        return html(
          reply,
          paint(who.language, () =>
            renderNoAccessPage({
              csrf: csrfTokenFor(who.token),
              phone: nationalDisplay(who.phone),
            }),
          ),
        );
      }
      if (
        documentId === '' ||
        !who.rows.some((row) => row.tenancyId === tenancyId)
      ) {
        reply.code(404);
        return html(
          reply,
          paint(who.language, () =>
            renderMissingPage({ chosenId: who.chosen?.tenancyId ?? '' }),
          ),
        );
      }
      const doc = await resolvePortalDocument(
        pool,
        tenancyId,
        documentId,
        clock,
        { actor: { actorKind: 'tenant', actorId: who.identityId } },
      );
      if (doc === null) {
        reply.code(404);
        return html(
          reply,
          paint(who.language, () =>
            renderMissingPage({ chosenId: who.chosen?.tenancyId ?? '' }),
          ),
        );
      }
      let bytes: Buffer;
      try {
        bytes = await deps.readDocument(doc.storageUri);
      } catch (error) {
        if (!(error instanceof KernelError)) throw error;
        reply.code(404);
        return html(
          reply,
          paint(who.language, () =>
            renderMissingPage({ chosenId: who.chosen?.tenancyId ?? '' }),
          ),
        );
      }
      const entry = {
        actorKind: 'tenant' as const,
        actorId: who.identityId,
        subjectId: doc.documentId,
        inputs: {},
      };
      await audit.write(
        { ...entry, action: 'portal.open_document' },
        { outcome: 'ok' },
      );
      await audit.write(
        { ...entry, action: 'portal.download_document' },
        { outcome: 'ok' },
      );
      reply.header('content-type', fileType(doc.kind));
      reply.header(
        'content-disposition',
        contentDisposition(`${doc.name}.${doc.kind}`),
      );
      reply.header('cache-control', 'no-store');
      reply.header('x-content-type-options', 'nosniff');
      return reply.send(bytes);
    },
  );

  app.get('/calls', TENANT, async (request, reply) => {
    const who = await portalOf(request);
    if (who === null) return go(reply, '/', []);
    if (who.kind === 'notice') return go(reply, '/notice', []);
    const closed = (request.query as { closed?: string }).closed === '1';
    return html(reply, await callsPage(who, closed));
  });

  app.get('/calls/:callId', TENANT, async (request, reply) => {
    const who = await portalOf(request);
    if (who === null) return go(reply, '/', []);
    if (who.kind === 'notice') return go(reply, '/notice', []);
    if (who.chosen === null) {
      return html(
        reply,
        paint(who.language, () =>
          renderNoAccessPage({
            csrf: csrfTokenFor(who.token),
            phone: nationalDisplay(who.phone),
          }),
        ),
      );
    }
    const callId = idOrEmpty(
      (request.params as { callId?: string }).callId,
      'call',
    );
    const call =
      callId === '' ? null : await deps.calls.read(callId, reached(who));
    if (call === null) {
      reply.code(404);
      await audit.write(
        {
          actorKind: 'tenant',
          actorId: who.identityId,
          action: 'portal.read_call',
          subjectId: callId === '' ? who.chosen.tenancyId : callId,
          inputs: {},
        },
        { outcome: 'error', code: 'not_found' },
      );
      return html(
        reply,
        paint(who.language, () =>
          renderMissingPage({ chosenId: who.chosen?.tenancyId ?? '' }),
        ),
      );
    }
    await audit.write(
      {
        actorKind: 'tenant',
        actorId: who.identityId,
        action: 'portal.read_call',
        subjectId: call.id,
        inputs: {},
      },
      { outcome: 'ok' },
    );
    return html(reply, await threadHtml(who, call, null));
  });

  app.post(
    '/calls/:callId/follow-up',
    { config: { tenant: 'public', csrf: 'in-body' } },
    async (request, reply) => {
      const who = await portalOf(request);
      if (who === null) return go(reply, '/', []);
      if (who.kind === 'notice') return go(reply, '/notice', []);
      if (who.chosen === null) return noTenancy(reply, who);
      const callId = idOrEmpty(
        (request.params as { callId?: string }).callId,
        'call',
      );
      const call =
        callId === '' ? null : await deps.calls.read(callId, reached(who));
      if (call === null) {
        reply.code(404);
        await audit.write(
          {
            actorKind: 'tenant',
            actorId: who.identityId,
            action: 'portal.read_call',
            subjectId: callId === '' ? who.chosen.tenancyId : callId,
            inputs: { from: 'follow-up' },
          },
          { outcome: 'error', code: 'not_found' },
        );
        return html(
          reply,
          paint(who.language, () =>
            renderMissingPage({ chosenId: who.chosen?.tenancyId ?? '' }),
          ),
        );
      }
      await audit.write(
        {
          actorKind: 'tenant',
          actorId: who.identityId,
          action: 'portal.read_call',
          subjectId: call.id,
          inputs: { from: 'follow-up' },
        },
        { outcome: 'ok' },
      );
      const posted = await readBody(request);
      if (!csrfOk(who.token, { csrf: posted.fields.csrf ?? '' })) {
        return html(reply, await threadHtml(who, call, 'report.retry'));
      }
      if (call.state === 'CLOSED') {
        return html(reply, await threadHtml(who, call, 'calls.follow_closed'));
      }
      const text = (posted.fields.body ?? '').trim();
      if (text === '') {
        return html(reply, await threadHtml(who, call, 'calls.follow_empty'));
      }
      if (text.length > REPORT_TEXT_MAX) {
        return html(reply, await threadHtml(who, call, 'calls.follow_long'));
      }
      let key = '';
      try {
        key = validId(posted.fields.key ?? '', 'key');
      } catch (error) {
        if (!(error instanceof KernelError)) throw error;
      }
      if (key === '') {
        return html(reply, await threadHtml(who, call, 'report.retry'));
      }
      if (posted.oversized) {
        return html(reply, await threadHtml(who, call, 'report.file_size'));
      }
      if (posted.file && posted.file.bytes.length > 0) {
        const save = deps.saveReportFile;
        if (save === undefined) {
          return html(
            reply,
            await threadHtml(who, call, 'report.file_unavailable'),
          );
        }
        const saved = await save({
          ownerId: who.identityId,
          submissionId: key,
          fileName: posted.file.fileName,
          bytes: posted.file.bytes,
        });
        if (saved.status === 'refused') {
          return html(
            reply,
            await threadHtml(who, call, FILE_NOTICE[saved.reason]),
          );
        }
      }
      const submit = deps.submitFollowUp;
      if (submit === undefined) {
        throw new KernelError('unavailable', 'portal intake is not wired');
      }
      let result: { callId: string } | null = null;
      try {
        result = await submit({
          phone: who.phone,
          ownerId: who.identityId,
          key,
          body: text,
          callId: call.id,
        });
      } catch (error) {
        if (!(error instanceof KernelError) || error.code !== 'invalid') {
          throw error;
        }
      }
      if (result === null) {
        return html(reply, await threadHtml(who, call, 'report.retry'));
      }
      await audit.write(
        {
          actorKind: 'tenant',
          actorId: who.identityId,
          action: 'portal.follow_up',
          subjectId: result.callId,
          inputs: {},
        },
        { outcome: 'ok' },
      );
      return go(reply, `/calls/${result.callId}`, []);
    },
  );

  app.get('/more', TENANT, async (request, reply) => {
    const who = await portalOf(request);
    if (who === null) return go(reply, '/', []);
    if (who.kind === 'notice') return go(reply, '/notice', []);
    if (who.chosen === null) {
      return html(
        reply,
        paint(who.language, () =>
          renderNoAccessPage({
            csrf: csrfTokenFor(who.token),
            phone: nationalDisplay(who.phone),
          }),
        ),
      );
    }
    return html(
      reply,
      paint(who.language, () =>
        renderMorePage({ csrf: csrfTokenFor(who.token) }),
      ),
    );
  });

  app.get('/report/files/:holdId', TENANT, async (request, reply) => {
    const who = await portalOf(request);
    if (who === null || who.kind !== 'open' || !deps.readReportFile) {
      reply.code(404);
      return '';
    }
    let holdId = '';
    try {
      holdId = validId(
        (request.params as { holdId?: string }).holdId ?? '',
        'file',
      );
    } catch (error) {
      if (!(error instanceof KernelError)) throw error;
      reply.code(404);
      return '';
    }
    const file = await deps.readReportFile(who.identityId, holdId);
    if (file === null) {
      reply.code(404);
      return '';
    }
    reply.header('content-type', file.contentType);
    reply.header('cache-control', 'private, no-store');
    reply.header('x-content-type-options', 'nosniff');
    return reply.send(file.bytes);
  });

  app.get('/report', TENANT, async (request, reply) => {
    const who = await portalOf(request);
    if (who === null) return go(reply, '/', []);
    if (who.kind === 'notice') return go(reply, '/notice', []);
    if (who.chosen === null) return noTenancy(reply, who);
    const from = idOrEmpty((request.query as { from?: string }).from, 'call');
    if (from === '') return html(reply, await reportPage(who, freshReport()));
    const prior = await deps.calls.read(from, reached(who));
    if (prior === null || prior.state !== 'CLOSED') {
      await audit.write(
        {
          actorKind: 'tenant',
          actorId: who.identityId,
          action: 'portal.read_call',
          subjectId: from,
          inputs: { from: 'report' },
        },
        { outcome: 'error', code: 'not_found' },
      );
      reply.code(404);
      return html(
        reply,
        paint(who.language, () =>
          renderMissingPage({ chosenId: who.chosen?.tenancyId ?? '' }),
        ),
      );
    }
    await audit.write(
      {
        actorKind: 'tenant',
        actorId: who.identityId,
        action: 'portal.read_call',
        subjectId: prior.id,
        inputs: { from: 'report' },
      },
      { outcome: 'ok' },
    );
    return html(
      reply,
      await reportPage(who, { ...freshReport(), predecessorId: prior.id }),
    );
  });

  app.post(
    '/report',
    { config: { tenant: 'public', csrf: 'in-body' } },
    async (request, reply) => {
      const who = await portalOf(request);
      if (who === null) return go(reply, '/', []);
      if (who.kind === 'notice') return go(reply, '/notice', []);
      if (who.chosen === null) return noTenancy(reply, who);
      const posted = await readPostedReport(request);
      if (!csrfOk(who.token, { csrf: posted.csrf }) || posted.key === null) {
        return html(
          reply,
          await reportPage(who, {
            ...freshReport(),
            description: posted.description,
            notice: 'report.retry',
          }),
        );
      }
      const loaded = await deps.loadReport();
      const category =
        loaded.categories.find((row) => row.id === posted.categoryId) ?? null;
      const draft: ReportForm = {
        submission: posted.key,
        step: posted.step,
        categoryId: category?.id ?? '',
        description: posted.description,
        entry: posted.entry,
        notice: null,
        predecessorId: posted.predecessor,
      };
      if (posted.step === 2 && posted.oversized) {
        return html(
          reply,
          await reportPage(who, {
            ...draft,
            step: 2,
            notice: 'report.file_size',
          }),
        );
      }
      if (posted.step === 2 && posted.file && posted.file.bytes.length > 0) {
        const save = deps.saveReportFile;
        if (save !== undefined) {
          const saved = await save({
            ownerId: who.identityId,
            submissionId: posted.key,
            fileName: posted.file.fileName,
            bytes: posted.file.bytes,
          });
          if (saved.status === 'refused') {
            return html(
              reply,
              await reportPage(who, {
                ...draft,
                step: 2,
                notice: FILE_NOTICE[saved.reason],
              }),
            );
          }
        }
      }
      if (posted.remove !== null && posted.step === 2) {
        await deps.removeReportFile?.(
          who.identityId,
          posted.key,
          posted.remove,
        );
        return html(reply, await reportPage(who, { ...draft, step: 2 }));
      }
      if (posted.action === 'back') {
        return html(
          reply,
          await reportPage(who, {
            ...draft,
            step: posted.step === 3 ? 2 : 1,
          }),
        );
      }
      if (posted.action === 'send' && posted.step === 3) {
        return sendReport(reply, who, draft, category);
      }
      if (posted.step <= 1) {
        if (category === null) {
          return html(
            reply,
            await reportPage(who, {
              ...draft,
              step: 1,
              notice: 'report.category_missing',
            }),
          );
        }
        return html(reply, await reportPage(who, { ...draft, step: 2 }));
      }
      if (posted.description === '') {
        return html(
          reply,
          await reportPage(who, { ...draft, step: 2, notice: 'report.empty' }),
        );
      }
      if (posted.description.length > REPORT_TEXT_MAX) {
        return html(
          reply,
          await reportPage(who, { ...draft, step: 2, notice: 'report.long' }),
        );
      }
      return html(reply, await reportPage(who, { ...draft, step: 3 }));
    },
  );

  function noTenancy(reply: Parameters<typeof html>[0], who: OpenPortal) {
    return html(
      reply,
      paint(who.language, () =>
        renderNoAccessPage({
          csrf: csrfTokenFor(who.token),
          phone: nationalDisplay(who.phone),
        }),
      ),
    );
  }

  function freshReport(): ReportForm {
    return {
      submission: newId(clock),
      step: 1,
      categoryId: '',
      description: '',
      entry: '',
      notice: null,
      predecessorId: '',
    };
  }

  async function threadHtml(
    who: OpenPortal,
    call: ShownCall,
    noticeKey: string | null,
  ): Promise<string> {
    const messages = await deps.messagesOnCall(call.id);
    const zone = clock.zone;
    return paint(who.language, () => {
      const screen = threadScreen(
        call,
        messages.map((message) => ({
          at: message.at,
          body: message.body,
          echo: message.echo,
        })),
        zone,
        zoned(clock.now(), zone).key,
        deps.calls.status,
      );
      return renderPortalCallPage({
        ...screen,
        callId: call.id,
        note: screen.status === 'cancelled' ? call.cancelNote : null,
        notice: noticeKey,
        csrf: csrfTokenFor(who.token),
        followKey: call.state === 'CLOSED' ? null : newId(clock),
      });
    });
  }

  async function reportPage(
    who: OpenPortal,
    draft: ReportForm,
  ): Promise<string> {
    const chosen = who.chosen;
    if (chosen === null) {
      throw new KernelError('invalid', 'tenancy is not open');
    }
    const loaded = await deps.loadReport();
    const files = deps.listReportFiles
      ? await deps.listReportFiles(who.identityId, draft.submission)
      : [];
    return paint(who.language, () =>
      renderReportPage({
        csrf: csrfTokenFor(who.token),
        submission: draft.submission,
        files,
        step: draft.step,
        categories: loaded.categories.map((row) => ({
          id: row.id,
          code: row.code,
          label: row.labelHe,
        })),
        categoryId: draft.categoryId,
        description: draft.description,
        entry: draft.entry,
        dutyPhone: loaded.dutyPhone,
        dutyTel: dutyHref(loaded.dutyPhone),
        flat: `${portalText('flat.unit')} ${chosen.unitNumber} · ${chosen.addressLine}`,
        notice: draft.notice,
        predecessorId: draft.predecessorId,
      }),
    );
  }

  async function sendReport(
    reply: Parameters<typeof html>[0],
    who: OpenPortal,
    draft: ReportForm,
    category: { id: string; labelHe: string } | null,
  ) {
    const chosen = who.chosen;
    if (chosen === null) return noTenancy(reply, who);
    if (category === null) {
      return html(
        reply,
        await reportPage(who, {
          ...draft,
          step: 1,
          notice: 'report.category_missing',
        }),
      );
    }
    if (draft.description === '') {
      return html(
        reply,
        await reportPage(who, { ...draft, step: 2, notice: 'report.empty' }),
      );
    }
    if (draft.description.length > REPORT_TEXT_MAX) {
      return html(
        reply,
        await reportPage(who, { ...draft, step: 2, notice: 'report.long' }),
      );
    }
    if (draft.entry === '') {
      return html(
        reply,
        await reportPage(who, {
          ...draft,
          step: 3,
          notice: 'report.entry_missing',
        }),
      );
    }
    const submit = deps.submitReport;
    if (submit === undefined) {
      throw new KernelError('unavailable', 'portal intake is not wired');
    }
    let predecessorId: string | null = null;
    if (draft.predecessorId !== '') {
      const prior = await deps.calls.read(draft.predecessorId, reached(who));
      if (prior === null || prior.state !== 'CLOSED') {
        return html(
          reply,
          await reportPage(who, { ...draft, step: 3, notice: 'report.retry' }),
        );
      }
      predecessorId = prior.id;
    }
    let receipt: PortalReportReceipt | null = null;
    try {
      receipt = await submit({
        phone: who.phone,
        ownerId: who.identityId,
        key: draft.submission,
        body: draft.description,
        categoryId: category.id,
        entry: draft.entry,
        tenancyId: chosen.tenancyId,
        predecessorId,
      });
    } catch (error) {
      if (!(error instanceof KernelError) || error.code !== 'invalid') {
        throw error;
      }
    }
    if (receipt === null) {
      return html(
        reply,
        await reportPage(who, { ...draft, step: 3, notice: 'report.retry' }),
      );
    }
    return html(
      reply,
      paint(who.language, () =>
        renderReportReceived({
          callId: receipt.callId,
          callNumber: receipt.callNumber,
          category: category.labelHe,
          duty: receipt.duty,
        }),
      ),
    );
  }

  app.post('/tenancy', TENANT, async (request, reply) => {
    const who = await portalOf(request);
    if (who === null) return go(reply, '/', []);
    if (who.kind === 'notice') return go(reply, '/notice', []);
    const next = field(request.body, 'next');
    let tenancyId = '';
    try {
      tenancyId = validId(field(request.body, 'tenancy'), 'tenancy');
    } catch (error) {
      if (!(error instanceof KernelError)) throw error;
    }
    const allowed =
      csrfOk(who.token, request.body) &&
      who.rows.some((row) => row.tenancyId === tenancyId);
    const destination =
      next === '/calls'
        ? '/calls'
        : next === '/flat'
          ? `/flat/${tenancyId}`
          : '/';
    if (!allowed) return go(reply, '/', []);
    return go(reply, destination, [
      portalCookie(PORTAL_CHOICE_COOKIE, tenancyId, {
        secure: secureOf(request),
        maxAge: SESSION_ABSOLUTE_MS / 1000,
      }),
    ]);
  });

  app.post('/language', TENANT, async (request, reply) => {
    const cookie = request.headers.cookie;
    const language = field(request.body, 'language');
    const next = languageReturn(field(request.body, 'next'));
    const token =
      readPortalCookie(cookie, PORTAL_SESSION_COOKIE) ??
      readPortalCookie(cookie, PORTAL_FORM_COOKIE) ??
      readPortalCookie(cookie, PORTAL_CHALLENGE_COOKIE);
    if (!portalLanguages().includes(language) || !csrfOk(token, request.body)) {
      return go(reply, next, []);
    }
    return go(reply, next, [
      portalCookie(PORTAL_LANG_COOKIE, language, {
        secure: secureOf(request),
        maxAge: PORTAL_LANG_MAX_AGE,
      }),
    ]);
  });

  app.get('/ask', TENANT, async (request, reply) => {
    const session = await signedIn(request);
    if (session === null) return go(reply, '/', []);
    return html(
      reply,
      paint(session.language, () =>
        renderAskPage({
          csrf: csrfTokenFor(session.token),
          submission: newId(clock),
          question: '',
          notice: null,
        }),
      ),
    );
  });

  app.post('/ask', TENANT, async (request, reply) => {
    const session = await signedIn(request);
    if (session === null) return go(reply, '/', []);
    return runPortalLanguage(session.language, async () => {
      const submission = field(request.body, 'submission');
      const question = field(request.body, 'question').trim();
      if (!csrfOk(session.token, request.body)) {
        return html(
          reply,
          renderAskPage({
            csrf: csrfTokenFor(session.token),
            submission: newId(clock),
            question,
            notice: 'ask.retry',
          }),
        );
      }
      let key: string;
      try {
        key = validId(submission, 'submission');
      } catch (error) {
        if (!(error instanceof KernelError)) throw error;
        return html(
          reply,
          renderAskPage({
            csrf: csrfTokenFor(session.token),
            submission: newId(clock),
            question,
            notice: 'ask.retry',
          }),
        );
      }
      if (question === '') {
        return html(
          reply,
          renderAskPage({
            csrf: csrfTokenFor(session.token),
            submission: key,
            question: '',
            notice: 'ask.empty',
          }),
        );
      }
      const submit = deps.submitQuestion;
      if (submit === undefined) {
        throw new KernelError('unavailable', 'portal intake is not wired');
      }
      const receipt = await submit({
        phone: session.phone,
        key,
        body: question,
      });
      if (receipt === null) {
        return html(
          reply,
          renderAskPage({
            csrf: csrfTokenFor(session.token),
            submission: newId(clock),
            question,
            notice: 'ask.retry',
          }),
        );
      }
      return html(reply, renderAskReceived(receipt));
    });
  });

  async function signedIn(request: {
    headers: IncomingHttpHeaders;
  }): Promise<{ token: string; phone: string; language: string } | null> {
    const token = readPortalCookie(
      request.headers.cookie,
      PORTAL_SESSION_COOKIE,
    );
    if (token === null) return null;
    const session = await resolvePortalSession(pool, clock, token);
    if (session === null) return null;
    const preferred = await preferredLanguage(
      pool,
      clock,
      request.headers.cookie,
      session.phone,
      session.portalIdentityId,
    );
    return {
      token,
      phone: session.phone,
      language: languageNow(request.headers.cookie, preferred),
    };
  }

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
      paint(languageNow(request.headers.cookie, null), () =>
        renderCodePage({
          csrf: csrfTokenFor(challenge),
          phone: described.phone,
          channel: described.channel,
          alternate: otherChannel(sender, described.channel),
          waitSeconds: waitSeconds(described.retryAt, clock.now()),
          notice: described.notice,
        }),
      ),
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
        paint(languageNow(request.headers.cookie, null), () =>
          renderCodePage({
            csrf: csrfTokenFor(challenge),
            phone: result.phone,
            channel: result.channel,
            alternate: otherChannel(sender, result.channel),
            waitSeconds: waitSeconds(result.retryAt, clock.now()),
            notice: result.notice,
          }),
        ),
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
        paint(languageNow(request.headers.cookie, null), () =>
          renderCodePage({
            csrf: csrfTokenFor(challenge),
            phone: described.phone,
            channel: described.channel,
            alternate: otherChannel(sender, described.channel),
            waitSeconds: waitSeconds(described.retryAt, clock.now()),
            notice: issued.notice,
          }),
        ),
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
    return go(reply, '/', [
      clearedCookie(PORTAL_SESSION_COOKIE, secure),
      clearedCookie(PORTAL_CHOICE_COOKIE, secure),
    ]);
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
    return go(reply, '/', [
      clearedCookie(PORTAL_SESSION_COOKIE, secure),
      clearedCookie(PORTAL_CHOICE_COOKIE, secure),
    ]);
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
      paint(languageNow(request.headers.cookie, null), () =>
        renderPhonePage({
          csrf: screen.csrf,
          notice: screen.notice,
          caption: captionKey(sender),
          canSend: screen.canSend,
          options,
        }),
      ),
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
    language: string;
  } | null> {
    const token = readPortalCookie(cookie, PORTAL_SESSION_COOKIE);
    if (token === null) return null;
    const session = await resolvePortalSession(pool, clock, token);
    if (session === null) return null;
    const preferred = await preferredLanguage(
      pool,
      clock,
      cookie,
      session.phone,
      session.portalIdentityId,
    );
    return {
      token,
      portalIdentityId: session.portalIdentityId,
      phone: session.phone,
      language: languageNow(cookie, preferred),
    };
  }

  async function noticeDue(
    identityId: string,
    language: string,
  ): Promise<boolean> {
    const screen = await loadNotice(pool, identityId, clock.now(), language);
    return screen?.due === true;
  }

  function posted(body: unknown, name: string): string | null {
    const value = field(body, name);
    return value === '' ? null : value;
  }

  app.get('/passkey', TENANT, async (request, reply) => {
    const open = await openSession(request.headers.cookie);
    if (open === null) return go(reply, '/', []);
    const displayName = paint(open.language, () => portalText('brand'));
    const options = await beginRegistration(
      pool,
      clock,
      {
        portalIdentityId: open.portalIdentityId,
        accountName: nationalDisplay(open.phone),
        displayName,
      },
      ceremonyOf(request),
    );
    return html(
      reply,
      paint(open.language, () =>
        renderPasskeyOffer({ csrf: csrfTokenFor(open.token), options }),
      ),
    );
  });

  app.post('/passkey/later', TENANT, async (request, reply) => {
    const open = await openSession(request.headers.cookie);
    if (open === null || !csrfOk(open.token, request.body)) {
      return go(reply, '/', []);
    }
    return go(
      reply,
      (await noticeDue(open.portalIdentityId, open.language)) ? '/notice' : '/',
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
    language: string,
    notice: string | null,
  ): Promise<string> {
    const rows = await listPasskeys(pool, identityId);
    return html(
      reply,
      paint(language, () =>
        renderPasskeysPage({
          csrf: csrfTokenFor(token),
          notice,
          passkeys: rows.map((row) => ({
            id: row.passkeyId,
            added: dayIn(row.addedOn, clock.zone),
          })),
        }),
      ),
    );
  }

  app.get('/notice', TENANT, async (request, reply) => {
    const open = await openSession(request.headers.cookie);
    if (open === null) return go(reply, '/', []);
    const screen = await loadNotice(
      pool,
      open.portalIdentityId,
      clock.now(),
      open.language,
    );
    if (screen === null || !screen.due) return go(reply, '/', []);
    return html(
      reply,
      paint(open.language, () =>
        renderNoticePage({
          csrf: csrfTokenFor(open.token),
          privacy: screen.privacy,
          terms: screen.terms,
          optIns: screen.optIns,
        }),
      ),
    );
  });

  app.get('/notice/full', TENANT, async (request, reply) => {
    const open = await openSession(request.headers.cookie);
    if (open === null) return go(reply, '/', []);
    const screen = await loadNotice(
      pool,
      open.portalIdentityId,
      clock.now(),
      open.language,
    );
    if (screen === null) return go(reply, '/', []);
    return html(
      reply,
      paint(open.language, () =>
        renderNoticeFullPage({
          privacy: screen.privacy,
          terms: screen.terms,
        }),
      ),
    );
  });

  app.post('/notice', TENANT, async (request, reply) => {
    const open = await openSession(request.headers.cookie);
    if (open === null || !csrfOk(open.token, request.body)) {
      return go(reply, '/', []);
    }
    const screen = await loadNotice(
      pool,
      open.portalIdentityId,
      clock.now(),
      open.language,
    );
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
        open.language,
      ));
    if (!recorded) {
      return html(
        reply,
        paint(open.language, () =>
          renderNoticePage({
            csrf: csrfTokenFor(open.token),
            privacy: screen.privacy,
            terms: screen.terms,
            optIns: screen.optIns,
          }),
        ),
      );
    }
    return go(reply, '/', []);
  });

  app.get('/passkeys', TENANT, async (request, reply) => {
    const open = await openSession(request.headers.cookie);
    if (open === null) return go(reply, '/', []);
    if (await noticeDue(open.portalIdentityId, open.language))
      return go(reply, '/notice', []);
    return passkeyPage(
      reply,
      open.token,
      open.portalIdentityId,
      open.language,
      null,
    );
  });

  app.post('/passkeys/remove', TENANT, async (request, reply) => {
    const open = await openSession(request.headers.cookie);
    if (open === null) return go(reply, '/', []);
    if (await noticeDue(open.portalIdentityId, open.language))
      return go(reply, '/notice', []);
    if (!csrfOk(open.token, request.body)) {
      return passkeyPage(
        reply,
        open.token,
        open.portalIdentityId,
        open.language,
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
      open.language,
      removed ? null : 'passkeys.missing',
    );
  });
}
