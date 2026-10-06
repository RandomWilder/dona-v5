// The קריאות routes. #182.
//
// Both are `estate.read`, which every signed-in role holds. V1 has no calls
// permission of its own: every staff member may log a call and read the list.
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Pool } from 'pg';
import type { ChromeDest } from '../../chrome.ts';
import type { Clock } from '../../kernel/clock.ts';
import { KernelError } from '../../kernel/errors.ts';
import type { Html } from '../../kernel/ui/html.ts';
import { can, csrfFrom, NOT_ALLOWED, type Role } from '../../staff/contract.ts';
import { listOpenCalls, type OpenCallSpec, openCall } from './commands.ts';
import { renderCallsPage } from './views.ts';

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

function refusalHe(error: KernelError): string {
  const field = error.details?.field;
  if (typeof field === 'string' && field in REFUSAL) {
    return REFUSAL[field] ?? 'לא ניתן לרשום את הקריאה.';
  }
  return 'לא ניתן לרשום את הקריאה.';
}

function parseManual(
  body: unknown,
  staff: { staffAccountId: string; role: Role | null },
): OpenCallSpec {
  const form =
    body !== null && typeof body === 'object'
      ? (body as Record<string, unknown>)
      : {};
  const choice = form.sender;
  if (choice !== 'named' && choice !== 'unknown') {
    throw new KernelError('invalid', 'sender is required', { field: 'sender' });
  }
  return {
    sourceChannel: typeof form.channel === 'string' ? form.channel : '',
    description: typeof form.description === 'string' ? form.description : '',
    sender:
      choice === 'unknown'
        ? { kind: 'unknown' }
        : {
            kind: 'named',
            name: typeof form.sender_name === 'string' ? form.sender_name : '',
          },
    openedBy: staff.staffAccountId,
    actorRole: staff.role,
  };
}

async function callsPage(
  deps: CallsDeps,
  request: FastifyRequest,
  refusal?: string,
): Promise<string> {
  const calls = await listOpenCalls(deps.pool);
  const role = request.staff?.role ?? null;
  const csrf = csrfFrom(request);
  const mayFile = can(role, 'documents.write');
  return renderCallsPage({
    nav: deps.chrome(csrf, 'calls', mayFile, calls.length),
    csrf,
    calls,
    now: deps.clock.now(),
    refusal,
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
    const staff = request.staff;
    if (staff == null) {
      throw new KernelError('not_allowed', NOT_ALLOWED);
    }
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
}
