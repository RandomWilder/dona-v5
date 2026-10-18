// The קריאות routes. #182 is the list and the manual entry. #183 is one call.
// #184 closes it.
//
// All of them are `estate.read`, which every signed-in role holds. V1 has no
// calls permission of its own: every staff member may log a call, identify the
// requester and set the trade. The category catalogue is edited at /settings,
// under settings.write.
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Pool } from 'pg';
import type { ChromeDest } from '../../chrome.ts';
import type { Clock } from '../../kernel/clock.ts';
import type { Embedder } from '../../kernel/embeddings.ts';
import { KernelError } from '../../kernel/errors.ts';
import type { Extractor } from '../../kernel/extraction.ts';
import type { Html } from '../../kernel/ui/html.ts';
import { validId } from '../../kernel/validate.ts';
import { findPartiesByName } from '../../parties/contract.ts';
import { can, csrfFrom, NOT_ALLOWED, type Role } from '../../staff/contract.ts';
import {
  askCallFollowUp,
  type CallBriefRunner,
  loadCallBriefPanel,
  refreshCallBrief,
  startCallBrief,
} from './brief.ts';
import {
  CALL_STATES,
  type CallListFilter,
  type CallState,
  canExit,
  clearEmergency,
  EXIT_KINDS,
  type ExitKind,
  exitCall,
  findCallsByDescription,
  flagEmergency,
  getCall,
  identifyCall,
  listCategories,
  listClosedCalls,
  listOpenCalls,
  listReturnedCalls,
  newestCloseAtOrBefore,
  type OpenCallSpec,
  openCall,
  type ResponseGoal,
  readResponseGoal,
  responseGoalBand,
  restoreReturnedCall,
  returnToFiltered,
  type ServiceCall,
  saveSenderContact,
  setCallCategory,
} from './commands.ts';
import { writeCallDraft } from './draft.ts';
import {
  type ExitDraft,
  type FilteredOrigin,
  type LogDraft,
  previewExcerpt,
  renderCallPage,
  renderCallsPage,
  renderFilteredPage,
  type SecretNotice,
  shownCalls,
  type TimelineMessage,
} from './views.ts';

export interface NoiseMessage {
  id: string;
  title: string;
  body: string;
  sender: string;
  at: Date;
  channel: 'EMAIL' | 'WHATSAPP';
  bodyHe: string | null;
}

export interface CallsDeps {
  pool: Pool;
  clock: Clock;
  chrome: (
    csrf: string,
    dest: ChromeDest,
    mayFile: boolean,
    mayReadParties: boolean,
    openCalls?: number,
  ) => Html;
  /** `-dev` only. The fabricated-message form. */
  devIntake?: boolean;
  messagesOnCall?: (callId: string) => Promise<readonly TimelineMessage[]>;
  listNoise?: () => Promise<readonly NoiseMessage[]>;
  rescueNoise?: (spec: {
    messageId: string;
    actorId: string;
    actorRole?: string | null;
  }) => Promise<{ callId: string }>;
  /** True when the shared mailbox has not been read for an hour. */
  mailboxWarning?: () => Promise<boolean>;
  /** #198. The Outlook secret is near expiry, or its expiry is unknown. */
  secretWarning?: () => SecretNotice | null;
  /** #193. No echo from the office phone for seven days. */
  whatsappWarning?: () => Promise<boolean>;
  /** #190. The bytes of one attachment on a call. */
  openAttachment?: (spec: {
    callId: string;
    messageId: string;
    index: number;
  }) => Promise<{ bytes: Buffer; contentType: string; fileName: string }>;
  /** #190. File one attachment as an Unassigned document. */
  fileAttachment?: (spec: {
    callId: string;
    messageId: string;
    index: number;
    typeKey: string;
    actorId: string;
    actorRole?: string | null;
  }) => Promise<{ documentId: string }>;
  documentTypes?: () => Promise<
    readonly { typeKey: string; labelHe: string }[]
  >;
  /** Present when a model and an embedder are configured. #252. */
  brief?: {
    extractor: Extractor;
    embedder: Embedder;
    schedule?: CallBriefRunner['schedule'];
  };
}

const STAFF = { config: { staff: 'estate.read' } } as const;

const REFUSAL: Record<string, string> = {
  channel: 'יש לבחור טלפון או הגעה.',
  description: 'יש לכתוב תיאור.',
  sender: 'יש לציין את הפונה, או לסמן שלא ידוע.',
  place: 'אי אפשר לתייק עד שהפונה הוא דייר אחד.',
  type: 'הקובץ אינו מתאים לסוג שנבחר.',
  file: 'אין קובץ לתייק.',
  anchored: 'הקובץ כבר מתויק במקום אחר.',
};

function briefRunner(deps: CallsDeps): CallBriefRunner | null {
  if (!deps.brief) return null;
  return {
    db: deps.pool,
    clock: deps.clock,
    extractor: deps.brief.extractor,
    embedder: deps.brief.embedder,
    schedule: deps.brief.schedule,
  };
}

function html(reply: FastifyReply): void {
  reply.header('content-type', 'text/html; charset=utf-8');
  reply.header('cache-control', 'no-store');
  reply.header('x-content-type-options', 'nosniff');
}

function requestedCallId(query: unknown): string | null {
  const raw = textOf(formOf(query).call).trim();
  if (raw === '') return null;
  try {
    return validId(raw, 'call');
  } catch (error) {
    if (error instanceof KernelError) return null;
    throw error;
  }
}

const CLOSED_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

function exitFilterOf(query: unknown): ExitKind | null {
  const raw = textOf(formOf(query).exit);
  return (EXIT_KINDS as readonly string[]).includes(raw)
    ? (raw as ExitKind)
    : null;
}

/** The window a close falls in: page k holds a close at least k×30 days old and younger than (k+1)×30. */
function closedPageHolding(now: Date, closedAt: Date): number {
  return Math.floor((now.getTime() - closedAt.getTime()) / CLOSED_WINDOW_MS);
}

function closedPageOf(query: unknown): number {
  const raw = textOf(formOf(query).page);
  return /^[0-9]{1,4}$/.test(raw) ? Number(raw) : 0;
}

function listFilter(query: unknown): CallListFilter {
  const form = formOf(query);
  const state = textOf(form.state);
  const category = textOf(form.category);
  const band = textOf(form.goal);
  const filter: CallListFilter = {};
  if ((CALL_STATES as readonly string[]).includes(state)) {
    filter.state = state as CallState;
  }
  if (category !== '') {
    try {
      filter.categoryId = validId(category, 'category');
    } catch {
      // A filter that is not an id matches nothing by being ignored, so the
      // list still opens.
    }
  }
  if (textOf(form.emergency) === '1') filter.emergency = true;
  if (textOf(form.review) === '1') filter.toReview = true;
  if (band === 'amber' || band === 'red' || band === 'late') filter.band = band;
  return filter;
}

function matchesBand(
  call: ServiceCall,
  band: 'amber' | 'red' | 'late',
  now: Date,
  goal: ResponseGoal,
): boolean {
  const actual = responseGoalBand(call.state, call.openedAt, now, goal);
  if (band === 'late') return actual === 'amber' || actual === 'red';
  return actual === band;
}

function shownCall(
  call: ServiceCall,
  filter: CallListFilter,
  now: Date,
  goal: ResponseGoal,
): boolean {
  if (filter.state !== undefined && call.state !== filter.state) return false;
  if (
    filter.categoryId !== undefined &&
    call.category?.id !== filter.categoryId
  ) {
    return false;
  }
  if (filter.emergency === true && !call.emergency.flagged) return false;
  if (filter.toReview === true && !call.toReview) return false;
  if (filter.band !== undefined && !matchesBand(call, filter.band, now, goal)) {
    return false;
  }
  return true;
}

function refusalHe(error: KernelError): string {
  const field = error.details?.field;
  const reason = error.details?.reason;
  if (field === 'party' && reason === 'guarantor') {
    return 'ערב אינו יכול להיות הפונה לקריאה.';
  }
  if (field === 'party') return 'יש לבחור אדם מהרשימה.';
  if (field === 'state' && reason === 'category') {
    return 'יש לזהות את הפונה לפני בחירת קטגוריה.';
  }
  if (field === 'state' && reason === 'contact') {
    return 'שמירת איש קשר היא אחרי זיהוי בידי אדם.';
  }
  if (field === 'sender' && reason === 'taken') {
    return 'הכתובת כבר שייכת למישהו אחר.';
  }
  if (field === 'sender' && reason === 'contact') {
    return 'אין כתובת לשמור.';
  }
  if (field === 'category' && reason === 'inactive') {
    return 'אפשר לבחור רק קטגוריה פעילה.';
  }
  if (field === 'category') return 'יש לבחור קטגוריה.';
  if (field === 'note') return 'יש לכתוב סיבה.';
  if (field === 'department') return 'יש לציין את המחלקה.';
  if (field === 'duplicate' && reason === 'self') {
    return 'קריאה אינה יכולה לחזור על עצמה.';
  }
  if (field === 'duplicate') return 'יש לבחור קריאה קיימת.';
  if (field === 'state' && reason === 'closed') {
    return 'קריאה סגורה אינה משתנה.';
  }
  if (field === 'state' && reason === 'exit') {
    return 'לא ניתן לסגור קריאה שנקבעה.';
  }
  if (field === 'exit') return 'יש לבחור יציאה.';
  if (field === 'call' && reason === 'returned') {
    return 'הקריאה כבר במסוננות.';
  }
  if (field === 'call' && reason === 'open') {
    return 'הקריאה אינה במסוננות.';
  }
  if (field === 'message') return 'אפשר להציל רק הודעה מסוננת.';
  if (typeof field === 'string' && field in REFUSAL) {
    return REFUSAL[field] ?? 'לא ניתן לרשום את הקריאה.';
  }
  return 'לא ניתן לעדכן את הקריאה.';
}

function staffOf(request: FastifyRequest): {
  staffAccountId: string;
  role: Role | null;
} {
  const staff = request.staff;
  if (staff == null) throw new KernelError('not_allowed', NOT_ALLOWED);
  return staff;
}

function callIdOf(params: unknown): string {
  const id = (params as { id?: unknown }).id;
  if (typeof id !== 'string') {
    throw new KernelError('not_found', 'call not found');
  }
  try {
    return validId(id, 'call');
  } catch {
    throw new KernelError('not_found', 'call not found');
  }
}

function contentDisposition(inline: boolean, fileName: string): string {
  const ascii = fileName.replace(/[^A-Za-z0-9._ -]/g, '').trim() || 'file';
  const utf8 = encodeURIComponent(fileName);
  const kind = inline ? 'inline' : 'attachment';
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${utf8}`;
}

function messageIdOf(params: unknown): string {
  const id = (params as { messageId?: unknown }).messageId;
  if (typeof id !== 'string') {
    throw new KernelError('not_found', 'attachment not found');
  }
  try {
    return validId(id, 'message');
  } catch {
    throw new KernelError('not_found', 'attachment not found');
  }
}

function indexOf(params: unknown): number {
  const raw = (params as { index?: unknown }).index;
  if (typeof raw !== 'string' || !/^[0-9]+$/.test(raw)) {
    throw new KernelError('not_found', 'attachment not found');
  }
  return Number(raw);
}

function formOf(body: unknown): Record<string, unknown> {
  return body !== null && typeof body === 'object'
    ? (body as Record<string, unknown>)
    : {};
}

function textOf(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function logDraft(body: unknown): LogDraft {
  const form = formOf(body);
  return {
    channel: textOf(form.channel),
    description: textOf(form.description),
    sender: textOf(form.sender),
    senderName: textOf(form.sender_name),
  };
}

function exitDraftOf(body: unknown): ExitDraft {
  const form = formOf(body);
  return {
    kind: textOf(form.exit),
    note: textOf(form.note),
    department: textOf(form.department),
    duplicateOf: textOf(form.duplicate_of),
  };
}

function parseManual(
  body: unknown,
  staff: { staffAccountId: string; role: Role | null },
): OpenCallSpec {
  const form = formOf(body);
  const choice = form.sender;
  if (choice !== 'named' && choice !== 'unknown') {
    throw new KernelError('invalid', 'sender is required', { field: 'sender' });
  }
  return {
    sourceChannel: textOf(form.channel),
    description: textOf(form.description),
    sender:
      choice === 'unknown'
        ? { kind: 'unknown' }
        : { kind: 'named', name: textOf(form.sender_name) },
    openedBy: staff.staffAccountId,
    actorRole: staff.role,
  };
}

async function callsPage(
  deps: CallsDeps,
  request: FastifyRequest,
  refusal?: string,
  draft?: LogDraft,
): Promise<string> {
  const filter = listFilter(request.query);
  const now = deps.clock.now();
  const closed = filter.state === 'CLOSED';
  const exit = closed ? exitFilterOf(request.query) : null;
  const page = closed ? closedPageOf(request.query) : 0;
  const upTo = new Date(now.getTime() - page * CLOSED_WINDOW_MS);
  const after = new Date(upTo.getTime() - CLOSED_WINDOW_MS);
  const [
    everyOpen,
    closedRows,
    olderClose,
    categories,
    mailboxWarning,
    goal,
    echoWarning,
    noise,
    returned,
  ] = await Promise.all([
    listOpenCalls(deps.pool),
    closed
      ? listClosedCalls(deps.pool, {
          after,
          upTo,
          categoryId: filter.categoryId,
        })
      : Promise.resolve(null),
    closed
      ? newestCloseAtOrBefore(deps.pool, after, {
          categoryId: filter.categoryId ?? null,
          exit,
        })
      : Promise.resolve(null),
    listCategories(deps.pool),
    deps.mailboxWarning ? deps.mailboxWarning() : Promise.resolve(false),
    readResponseGoal(deps.pool),
    deps.whatsappWarning ? deps.whatsappWarning() : Promise.resolve(false),
    deps.listNoise ? deps.listNoise() : Promise.resolve([]),
    listReturnedCalls(deps.pool),
  ]);
  const calls =
    closedRows === null
      ? everyOpen.filter((call) => shownCall(call, filter, now, goal))
      : closedRows.filter((call) => exit === null || call.exit?.kind === exit);
  const exitCounts: Record<ExitKind | 'all', number> | null =
    closedRows === null
      ? null
      : {
          all: closedRows.length,
          ANSWERED: 0,
          FORWARDED: 0,
          DUPLICATE: 0,
          CANCELLED: 0,
        };
  for (const call of closedRows ?? []) {
    if (exitCounts !== null && call.exit !== null) {
      exitCounts[call.exit.kind] += 1;
    }
  }
  let emergency = 0;
  let near = 0;
  let past = 0;
  let toReview = 0;
  for (const call of everyOpen) {
    if (call.emergency.flagged) emergency += 1;
    if (call.toReview) toReview += 1;
    const band = responseGoalBand(call.state, call.openedAt, now, goal);
    if (band === 'amber') near += 1;
    else if (band === 'red') past += 1;
  }
  const role = request.staff?.role ?? null;
  const csrf = csrfFrom(request);
  const mayFile = can(role, 'documents.write');
  const listOnly = textOf(formOf(request.query).view) === 'list';
  const requested = requestedCallId(request.query);
  const shown = shownCalls({
    calls,
    state: filter.state ?? null,
    now,
    goal,
  });
  const chosen = listOnly
    ? null
    : (shown.find((call) => call.id === requested) ?? shown[0] ?? null);
  const excerpt =
    chosen === null
      ? null
      : previewExcerpt(
          deps.messagesOnCall && chosen.state !== 'CLOSED'
            ? await deps.messagesOnCall(chosen.id)
            : [],
          chosen,
        );
  return renderCallsPage({
    nav: deps.chrome(
      csrf,
      'calls',
      mayFile,
      can(role, 'party.read'),
      request.openCalls ?? calls.length,
    ),
    csrf,
    calls,
    categories,
    state: filter.state ?? null,
    categoryId: filter.categoryId ?? null,
    emergency: filter.emergency === true,
    toReview: filter.toReview === true,
    band: filter.band ?? null,
    goal,
    counts: {
      open: everyOpen.length,
      emergency,
      near,
      past,
      late: near + past,
      toReview,
    },
    filteredCount: noise.length + returned.length,
    devIntake: deps.devIntake === true,
    now,
    mailboxWarning,
    whatsappWarning: echoWarning,
    secretWarning: deps.secretWarning ? deps.secretWarning() : null,
    refusal,
    logging: textOf(formOf(request.query).log) === '1' || draft !== undefined,
    draft: draft ?? null,
    layout: listOnly ? 'list' : 'split',
    closedList:
      exitCounts === null
        ? null
        : {
            exit,
            page,
            olderPage:
              olderClose === null ? null : closedPageHolding(now, olderClose),
            counts: exitCounts,
          },
    preview:
      chosen === null || excerpt === null ? null : { id: chosen.id, excerpt },
  });
}

async function firstOpenCall(
  deps: CallsDeps,
  goal: ResponseGoal,
): Promise<{ id: string; description: string } | null> {
  const open = await listOpenCalls(deps.pool);
  const first = shownCalls({
    calls: open,
    state: null,
    now: deps.clock.now(),
    goal,
  })[0];
  if (!first) return null;
  return { id: first.id, description: first.description };
}

async function heldDuplicate(
  deps: CallsDeps,
  found: readonly { id: string; description: string }[],
  draft: ExitDraft | undefined,
): Promise<{ id: string; description: string }[]> {
  const held = draft?.kind === 'DUPLICATE' ? draft.duplicateOf.trim() : '';
  if (held === '' || found.some((row) => row.id === held)) return [...found];
  let otherId: string;
  try {
    otherId = validId(held, 'duplicate');
  } catch (error) {
    if (error instanceof KernelError) return [...found];
    throw error;
  }
  const other = await getCall(deps.pool, otherId);
  if (!other) return [...found];
  return [{ id: other.id, description: other.description }, ...found];
}

async function callPage(
  deps: CallsDeps,
  request: FastifyRequest,
  callId: string,
  refusal?: string,
  exitDraft?: ExitDraft,
  briefHold?: 'guarantor',
): Promise<string> {
  const call = await getCall(deps.pool, callId);
  if (!call) throw new KernelError('not_found', 'call not found');
  const query = textOf(formOf(request.query).q).trim();
  const dup = textOf(formOf(request.query).dup).trim();
  const searching =
    call.state === 'NEW' && query.length > 0 && query.length <= 80;
  const dupSearching =
    canExit(call.state) && dup.length > 0 && dup.length <= 80;
  const [categories, matches, foundDup, messages, documentTypes, goal] =
    await Promise.all([
      listCategories(deps.pool, { activeOnly: call.state !== 'NEW' }),
      searching ? findPartiesByName(deps.pool, query) : Promise.resolve([]),
      dupSearching
        ? findCallsByDescription(deps.pool, dup, callId)
        : Promise.resolve([]),
      deps.messagesOnCall ? deps.messagesOnCall(callId) : Promise.resolve([]),
      deps.documentTypes ? deps.documentTypes() : Promise.resolve([]),
      readResponseGoal(deps.pool),
    ]);
  const dupMatches = await heldDuplicate(deps, foundDup, exitDraft);
  const receipt =
    textOf(formOf(request.query).receipt) === '1' && call.state === 'CLOSED';
  const nextOpen = receipt ? await firstOpenCall(deps, goal) : null;
  const role = request.staff?.role ?? null;
  const csrf = csrfFrom(request);
  const brief =
    briefHold === 'guarantor'
      ? { kind: 'guarantor' as const, facts: null, turns: [], draft: null }
      : await loadCallBriefPanel(deps.pool, deps.clock, callId);
  return renderCallPage({
    nav: deps.chrome(
      csrf,
      'calls',
      can(role, 'documents.write'),
      can(role, 'party.read'),
      request.openCalls,
    ),
    csrf,
    call,
    categories,
    matches: matches.map((party) => ({
      id: party.party_id,
      name: party.full_name,
    })),
    query: searching ? query : query.length > 80 ? '' : query,
    dupQuery: canExit(call.state) && dup.length <= 80 ? dup : '',
    dupMatches,
    messages,
    goal,
    mayFile: can(role, 'documents.write'),
    mayReadParties: can(role, 'party.read'),
    documentTypes,
    now: deps.clock.now(),
    receipt,
    nextOpen,
    exitDraft,
    refusal:
      refusal ??
      (query.length > 80 || dup.length > 80 ? 'החיפוש ארוך מדי.' : undefined),
    brief,
  });
}

function senderOf(label: string | null, unknown: boolean): string {
  if (unknown || label === null || label.trim() === '') return 'לא ידוע';
  return label;
}

async function filteredPage(
  deps: CallsDeps,
  request: FastifyRequest,
  refusal?: string,
): Promise<string> {
  const noise = deps.listNoise ? await deps.listNoise() : [];
  const returned = await listReturnedCalls(deps.pool);
  const ranked = [
    ...noise.map((row) => ({
      at: row.at.getTime(),
      row: {
        kind: 'message' as const,
        id: row.id,
        title: row.title,
        body: row.body,
        bodyHe: row.bodyHe,
        sender: row.sender,
        sorterLabel: 'noise' as const,
        channel: row.channel,
        at: row.at,
      },
    })),
    ...returned.map((row) => ({
      at: row.at.getTime(),
      row: {
        kind: 'call' as const,
        id: row.id,
        title: row.title,
        body: row.title,
        bodyHe: null,
        sender: senderOf(row.senderLabel, row.senderUnknown),
        sorterLabel: row.sorterLabel,
        channel: row.sourceChannel,
        at: row.at,
      },
    })),
  ];
  ranked.sort((a, b) => b.at - a.at);
  const rows = ranked.map((item) => item.row);
  const origin = filteredOrigin(request.query);
  const shown = rows.filter((row) => shownFiltered(row.kind, origin));
  let sorter = 0;
  let office = 0;
  for (const row of rows) {
    if (row.kind === 'message') sorter += 1;
    else office += 1;
  }
  const role = request.staff?.role ?? null;
  const csrf = csrfFrom(request);
  return renderFilteredPage({
    nav: deps.chrome(
      csrf,
      'calls',
      can(role, 'documents.write'),
      can(role, 'party.read'),
      request.openCalls,
    ),
    csrf,
    rows: shown,
    origin,
    counts: { all: rows.length, sorter, office },
    refusal,
  });
}

function filteredOrigin(query: unknown): FilteredOrigin {
  const origin = textOf(formOf(query).origin);
  if (origin === 'sorter' || origin === 'office') return origin;
  return 'all';
}

function shownFiltered(
  kind: 'message' | 'call',
  origin: FilteredOrigin,
): boolean {
  if (origin === 'sorter') return kind === 'message';
  if (origin === 'office') return kind === 'call';
  return true;
}

export function registerCallsRoutes(
  app: FastifyInstance,
  deps: CallsDeps,
): void {
  app.get('/calls', STAFF, async (request, reply) => {
    html(reply);
    return callsPage(deps, request);
  });

  app.get('/calls/filtered', STAFF, async (request, reply) => {
    html(reply);
    return filteredPage(deps, request);
  });

  app.post('/calls/filtered', STAFF, async (request, reply) => {
    const staff = staffOf(request);
    const form = formOf(request.body);
    const messageId = textOf(form.message_id);
    const callId = textOf(form.call_id);
    try {
      if (messageId !== '') {
        if (!deps.rescueNoise) {
          throw new KernelError('invalid', 'message cannot be rescued', {
            field: 'message',
          });
        }
        const rescued = await deps.rescueNoise({
          messageId,
          actorId: staff.staffAccountId,
          actorRole: staff.role,
        });
        return reply
          .code(303)
          .header('location', `/calls/${rescued.callId}`)
          .send();
      }
      if (callId !== '') {
        await restoreReturnedCall(deps.pool, deps.clock, {
          callId,
          actorId: staff.staffAccountId,
          actorRole: staff.role,
        });
        return reply.code(303).header('location', `/calls/${callId}`).send();
      }
      throw new KernelError('invalid', 'nothing to rescue', {
        field: 'message',
      });
    } catch (error) {
      if (!(error instanceof KernelError) || error.code === 'not_allowed') {
        throw error;
      }
      html(reply);
      reply.code(error.code === 'not_found' ? 404 : 400);
      return filteredPage(deps, request, refusalHe(error));
    }
  });

  app.post('/calls', STAFF, async (request, reply) => {
    const staff = staffOf(request);
    try {
      await openCall(deps.pool, deps.clock, parseManual(request.body, staff));
      return reply.code(303).header('location', '/calls').send();
    } catch (error) {
      if (!(error instanceof KernelError) || error.code !== 'invalid') {
        throw error;
      }
      html(reply);
      reply.code(400);
      return callsPage(deps, request, refusalHe(error), logDraft(request.body));
    }
  });

  app.get('/calls/:id', STAFF, async (request, reply) => {
    html(reply);
    return callPage(deps, request, callIdOf(request.params));
  });

  app.get(
    '/calls/:id/messages/:messageId/files/:index',
    STAFF,
    async (request, reply) => {
      if (!deps.openAttachment) {
        throw new KernelError('not_found', 'attachment not found');
      }
      const file = await deps.openAttachment({
        callId: callIdOf(request.params),
        messageId: messageIdOf(request.params),
        index: indexOf(request.params),
      });
      const inline =
        file.contentType === 'application/pdf' ||
        file.contentType.startsWith('image/');
      reply.header('content-type', file.contentType);
      reply.header(
        'content-disposition',
        contentDisposition(inline, file.fileName),
      );
      reply.header('cache-control', 'no-store');
      reply.header('x-content-type-options', 'nosniff');
      return reply.send(file.bytes);
    },
  );

  app.post(
    '/calls/:id/messages/:messageId/files/:index',
    STAFF,
    async (request, reply) => {
      const staff = staffOf(request);
      const callId = callIdOf(request.params);
      if (!can(staff.role, 'documents.write') || !deps.fileAttachment) {
        throw new KernelError('not_allowed', NOT_ALLOWED);
      }
      try {
        await deps.fileAttachment({
          callId,
          messageId: messageIdOf(request.params),
          index: indexOf(request.params),
          typeKey: textOf(formOf(request.body).type_key),
          actorId: staff.staffAccountId,
          actorRole: staff.role,
        });
        return reply.code(303).header('location', `/calls/${callId}`).send();
      } catch (error) {
        if (!(error instanceof KernelError) || error.code === 'not_allowed') {
          throw error;
        }
        if (error.code === 'not_found') throw error;
        html(reply);
        reply.code(400);
        return callPage(deps, request, callId, refusalHe(error));
      }
    },
  );

  app.post('/calls/:id/identify', STAFF, async (request, reply) => {
    const staff = staffOf(request);
    const callId = callIdOf(request.params);
    const partyId = textOf(formOf(request.body).party_id);
    try {
      await identifyCall(deps.pool, deps.clock, {
        callId,
        partyId,
        actorId: staff.staffAccountId,
        actorRole: staff.role,
      });
      const runner = briefRunner(deps);
      if (runner) await startCallBrief(runner, callId);
      return reply.code(303).header('location', `/calls/${callId}`).send();
    } catch (error) {
      if (!(error instanceof KernelError) || error.code === 'not_allowed') {
        throw error;
      }
      if (error.code === 'not_found' && error.details?.field !== 'party') {
        throw error;
      }
      html(reply);
      reply.code(error.code === 'not_found' ? 404 : 400);
      const hold =
        error.details?.reason === 'guarantor' ? 'guarantor' : undefined;
      return callPage(deps, request, callId, refusalHe(error), undefined, hold);
    }
  });

  app.post('/calls/:id/brief', STAFF, async (request, reply) => {
    const callId = callIdOf(request.params);
    const runner = briefRunner(deps);
    if (runner) await refreshCallBrief(runner, callId);
    return reply.code(303).header('location', `/calls/${callId}`).send();
  });

  app.post('/calls/:id/draft', STAFF, async (request, reply) => {
    const callId = callIdOf(request.params);
    const runner = briefRunner(deps);
    if (runner) {
      const messages = deps.messagesOnCall
        ? await deps.messagesOnCall(callId)
        : [];
      const inbound = [...messages].reverse().find((message) => !message.echo);
      await writeCallDraft(runner, callId, inbound?.body);
    }
    return reply.code(303).header('location', `/calls/${callId}`).send();
  });

  app.post('/calls/:id/follow-up', STAFF, async (request, reply) => {
    const staff = staffOf(request);
    const callId = callIdOf(request.params);
    const runner = briefRunner(deps);
    if (runner) {
      await askCallFollowUp(runner, callId, {
        staffAccountId: staff.staffAccountId,
        question: textOf(formOf(request.body).question),
      });
    }
    return reply.code(303).header('location', `/calls/${callId}`).send();
  });

  app.post('/calls/:id/contact', STAFF, async (request, reply) => {
    const staff = staffOf(request);
    const callId = callIdOf(request.params);
    try {
      await saveSenderContact(deps.pool, deps.clock, {
        callId,
        actorId: staff.staffAccountId,
        actorRole: staff.role,
      });
      return reply.code(303).header('location', `/calls/${callId}`).send();
    } catch (error) {
      if (!(error instanceof KernelError) || error.code === 'not_allowed') {
        throw error;
      }
      if (error.code === 'not_found') throw error;
      html(reply);
      reply.code(400);
      return callPage(deps, request, callId, refusalHe(error));
    }
  });

  app.post('/calls/:id/category', STAFF, async (request, reply) => {
    const staff = staffOf(request);
    const callId = callIdOf(request.params);
    const categoryId = textOf(formOf(request.body).category_id);
    try {
      await setCallCategory(deps.pool, deps.clock, {
        callId,
        categoryId,
        actorId: staff.staffAccountId,
        actorRole: staff.role,
      });
      return reply.code(303).header('location', `/calls/${callId}`).send();
    } catch (error) {
      if (!(error instanceof KernelError) || error.code === 'not_allowed') {
        throw error;
      }
      if (error.code === 'not_found' && error.details?.field !== 'category') {
        throw error;
      }
      html(reply);
      reply.code(error.code === 'not_found' ? 404 : 400);
      return callPage(deps, request, callId, refusalHe(error));
    }
  });

  app.post('/calls/:id/emergency', STAFF, async (request, reply) => {
    const staff = staffOf(request);
    const callId = callIdOf(request.params);
    const action = textOf(formOf(request.body).action);
    if (action !== 'flag' && action !== 'clear') {
      html(reply);
      reply.code(400);
      return callPage(deps, request, callId, 'יש לבחור סימון חירום.');
    }
    const command = action === 'clear' ? clearEmergency : flagEmergency;
    try {
      await command(deps.pool, deps.clock, {
        callId,
        actorId: staff.staffAccountId,
        actorRole: staff.role,
      });
      return reply.code(303).header('location', `/calls/${callId}`).send();
    } catch (error) {
      if (!(error instanceof KernelError) || error.code === 'not_allowed') {
        throw error;
      }
      if (error.code === 'not_found') throw error;
      html(reply);
      reply.code(400);
      return callPage(deps, request, callId, refusalHe(error));
    }
  });

  app.post('/calls/:id/return', STAFF, async (request, reply) => {
    const staff = staffOf(request);
    const callId = callIdOf(request.params);
    try {
      await returnToFiltered(deps.pool, deps.clock, {
        callId,
        actorId: staff.staffAccountId,
        actorRole: staff.role,
      });
      return reply.code(303).header('location', '/calls/filtered').send();
    } catch (error) {
      if (!(error instanceof KernelError) || error.code === 'not_allowed') {
        throw error;
      }
      if (error.code === 'not_found') throw error;
      html(reply);
      reply.code(400);
      return callPage(deps, request, callId, refusalHe(error));
    }
  });

  app.post('/calls/:id/exit', STAFF, async (request, reply) => {
    const staff = staffOf(request);
    const callId = callIdOf(request.params);
    const form = formOf(request.body);
    try {
      await exitCall(deps.pool, deps.clock, {
        callId,
        kind: textOf(form.exit),
        note: textOf(form.note),
        department: textOf(form.department),
        duplicateOf: textOf(form.duplicate_of),
        actorId: staff.staffAccountId,
        actorRole: staff.role,
      });
      return reply
        .code(303)
        .header('location', `/calls/${callId}?receipt=1`)
        .send();
    } catch (error) {
      if (!(error instanceof KernelError) || error.code === 'not_allowed') {
        throw error;
      }
      if (error.code === 'not_found' && error.details?.field !== 'duplicate') {
        throw error;
      }
      html(reply);
      reply.code(error.code === 'not_found' ? 404 : 400);
      return callPage(
        deps,
        request,
        callId,
        refusalHe(error),
        exitDraftOf(request.body),
      );
    }
  });
}
