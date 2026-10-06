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
import { KernelError } from '../../kernel/errors.ts';
import type { Html } from '../../kernel/ui/html.ts';
import { validId } from '../../kernel/validate.ts';
import { findPartiesByName } from '../../parties/contract.ts';
import { can, csrfFrom, NOT_ALLOWED, type Role } from '../../staff/contract.ts';
import {
  CALL_STATES,
  type CallState,
  canExit,
  clearEmergency,
  exitCall,
  findCallsByDescription,
  flagEmergency,
  getCall,
  identifyCall,
  listCategories,
  listOpenCalls,
  type OpenCallSpec,
  openCall,
  setCallCategory,
} from './commands.ts';
import { renderCallPage, renderCallsPage } from './views.ts';

export interface CallsDeps {
  pool: Pool;
  clock: Clock;
  chrome: (
    csrf: string,
    dest: ChromeDest,
    mayFile: boolean,
    openCalls?: number,
  ) => Html;
}

const STAFF = { config: { staff: 'estate.read' } } as const;

const REFUSAL: Record<string, string> = {
  channel: 'יש לבחור טלפון או הגעה.',
  description: 'יש לכתוב תיאור.',
  sender: 'יש לציין את הפונה, או לסמן שלא ידוע.',
};

function html(reply: FastifyReply): void {
  reply.header('content-type', 'text/html; charset=utf-8');
  reply.header('cache-control', 'no-store');
  reply.header('x-content-type-options', 'nosniff');
}

function listFilter(query: unknown): {
  state?: CallState;
  categoryId?: string;
  emergency?: boolean;
} {
  const form = formOf(query);
  const state = textOf(form.state);
  const category = textOf(form.category);
  const filter: {
    state?: CallState;
    categoryId?: string;
    emergency?: boolean;
  } = {};
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
  return filter;
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

function formOf(body: unknown): Record<string, unknown> {
  return body !== null && typeof body === 'object'
    ? (body as Record<string, unknown>)
    : {};
}

function textOf(value: unknown): string {
  return typeof value === 'string' ? value : '';
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
): Promise<string> {
  const filter = listFilter(request.query);
  const [calls, categories] = await Promise.all([
    listOpenCalls(deps.pool, filter),
    listCategories(deps.pool),
  ]);
  const role = request.staff?.role ?? null;
  const csrf = csrfFrom(request);
  const mayFile = can(role, 'documents.write');
  return renderCallsPage({
    nav: deps.chrome(csrf, 'calls', mayFile, request.openCalls ?? calls.length),
    csrf,
    calls,
    categories,
    state: filter.state ?? null,
    categoryId: filter.categoryId ?? null,
    emergency: filter.emergency === true,
    now: deps.clock.now(),
    refusal,
  });
}

async function callPage(
  deps: CallsDeps,
  request: FastifyRequest,
  callId: string,
  refusal?: string,
): Promise<string> {
  const call = await getCall(deps.pool, callId);
  if (!call) throw new KernelError('not_found', 'call not found');
  const query = textOf(formOf(request.query).q).trim();
  const dup = textOf(formOf(request.query).dup).trim();
  const searching =
    call.state === 'NEW' && query.length > 0 && query.length <= 80;
  const dupSearching =
    canExit(call.state) && dup.length > 0 && dup.length <= 80;
  const [categories, matches, dupMatches] = await Promise.all([
    listCategories(deps.pool, { activeOnly: call.state !== 'NEW' }),
    searching ? findPartiesByName(deps.pool, query) : Promise.resolve([]),
    dupSearching
      ? findCallsByDescription(deps.pool, dup, callId)
      : Promise.resolve([]),
  ]);
  const role = request.staff?.role ?? null;
  const csrf = csrfFrom(request);
  return renderCallPage({
    nav: deps.chrome(
      csrf,
      'calls',
      can(role, 'documents.write'),
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
    now: deps.clock.now(),
    refusal:
      refusal ??
      (query.length > 80 || dup.length > 80 ? 'החיפוש ארוך מדי.' : undefined),
  });
}

export function registerCallsRoutes(
  app: FastifyInstance,
  deps: CallsDeps,
): void {
  app.get('/calls', STAFF, async (request, reply) => {
    html(reply);
    return callsPage(deps, request);
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
      return callsPage(deps, request, refusalHe(error));
    }
  });

  app.get('/calls/:id', STAFF, async (request, reply) => {
    html(reply);
    return callPage(deps, request, callIdOf(request.params));
  });

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
    await command(deps.pool, deps.clock, {
      callId,
      actorId: staff.staffAccountId,
      actorRole: staff.role,
    });
    return reply.code(303).header('location', `/calls/${callId}`).send();
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
      return reply.code(303).header('location', `/calls/${callId}`).send();
    } catch (error) {
      if (!(error instanceof KernelError) || error.code === 'not_allowed') {
        throw error;
      }
      if (error.code === 'not_found' && error.details?.field !== 'duplicate') {
        throw error;
      }
      html(reply);
      reply.code(error.code === 'not_found' ? 404 : 400);
      return callPage(deps, request, callId, refusalHe(error));
    }
  });
}
