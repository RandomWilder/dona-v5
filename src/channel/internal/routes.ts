// The dev-only door (#186) and the WhatsApp webhook (#193). The form is
// registered only on a `-dev` process. The webhook is always registered, and
// it refuses every request until WhatsApp is configured.

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Pool } from 'pg';
import { listCategories } from '../../calls/contract.ts';
import type { ChromeDest } from '../../chrome.ts';
import type { Clock } from '../../kernel/clock.ts';
import { KernelError } from '../../kernel/errors.ts';
import { newId } from '../../kernel/ids.ts';
import type { ObjectStore } from '../../kernel/objects.ts';
import type { Html } from '../../kernel/ui/html.ts';
import { can, csrfFrom } from '../../staff/contract.ts';
import {
  emergencyMatch,
  type IncomingMessage,
  receiveIncoming,
  type Sorter,
} from './door.ts';
import type { MalwareScanner } from './scanner.ts';
import { renderIntakeForm } from './views.ts';
import type { WhatsappFetch } from './whatsapp.ts';
import { registerWhatsappWebhook } from './whatsapp.ts';

export interface ChannelDeps {
  pool: Pool;
  clock: Clock;
  chrome: (
    csrf: string,
    dest: ChromeDest,
    mayFile: boolean,
    mayReadParties: boolean,
    openCalls?: number,
  ) => Html;
  devIntake: boolean;
  /** The real sorter. Absent, the form picks the verdict itself. */
  sorter?: Sorter;
  objects?: ObjectStore;
  scanner?: MalwareScanner;
  /** Media download. Absent, the webhook calls Meta. */
  whatsappFetch?: WhatsappFetch;
  /** After a new call is stored. The call brief. #252. */
  onCallIdentified?: (callId: string) => Promise<void>;
}

const STAFF = { config: { staff: 'estate.read' } } as const;

const REFUSAL: Record<string, string> = {
  channel: 'יש לבחור דוא״ל או וואטסאפ.',
  sender: 'יש לכתוב כתובת.',
  body: 'יש לכתוב את ההודעה.',
  subject: 'הנושא ארוך מדי.',
  externalMessageId: 'מזהה ההודעה ארוך מדי.',
  externalThreadId: 'מזהה השיחה ארוך מדי.',
  attachments: 'שם הקובץ אינו תקין.',
  fileName: 'שם הקובץ אינו תקין.',
};

function html(reply: FastifyReply): void {
  reply.header('content-type', 'text/html; charset=utf-8');
  reply.header('cache-control', 'no-store');
  reply.header('x-content-type-options', 'nosniff');
}

function formOf(body: unknown): Record<string, unknown> {
  return body !== null && typeof body === 'object'
    ? (body as Record<string, unknown>)
    : {};
}

function textOf(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function refusalHe(error: KernelError): string {
  const field = error.details?.field;
  if (typeof field === 'string' && field in REFUSAL) {
    return REFUSAL[field] ?? 'לא ניתן לקלוט את ההודעה.';
  }
  return 'לא ניתן לקלוט את ההודעה.';
}

function sorterFor(form: Record<string, unknown>): Sorter {
  const verdict = textOf(form.verdict);
  const categoryCode = textOf(form.category);
  const summary = textOf(form.summary);
  return {
    async sort() {
      if (verdict !== 'call' && verdict !== 'unsure' && verdict !== 'noise') {
        throw new Error('sorter failed');
      }
      return {
        label: verdict,
        categoryCode: categoryCode === '' ? null : categoryCode,
        summary: summary === '' ? null : summary,
      };
    },
    async translate() {
      return { bodyHe: null };
    },
  };
}

async function formPage(
  deps: ChannelDeps,
  request: FastifyRequest,
  refusal?: string,
): Promise<string> {
  const categories = await listCategories(deps.pool, { activeOnly: true });
  const role = request.staff?.role ?? null;
  const csrf = csrfFrom(request);
  const stored = textOf(formOf(request.query).stored) === '1';
  return renderIntakeForm({
    nav: deps.chrome(
      csrf,
      'calls',
      can(role, 'documents.write'),
      can(role, 'party.read'),
      request.openCalls,
    ),
    csrf,
    categories,
    stored,
    refusal,
    chooseVerdict: deps.sorter === undefined,
  });
}

export function registerChannelRoutes(
  app: FastifyInstance,
  deps: ChannelDeps,
): void {
  registerWhatsappWebhook(app, {
    pool: deps.pool,
    clock: deps.clock,
    objects: deps.objects,
    scanner: deps.scanner,
    sorter: deps.sorter,
    fetch: deps.whatsappFetch,
    onCallIdentified: deps.onCallIdentified,
  });
  if (!deps.devIntake) return;

  app.get('/dev/intake', STAFF, async (request, reply) => {
    html(reply);
    return formPage(deps, request);
  });

  app.post('/dev/intake', STAFF, async (request, reply) => {
    const form = formOf(request.body);
    const thread = textOf(form.thread).trim();
    const file = textOf(form.file).trim();
    const message: IncomingMessage = {
      sourceChannel: textOf(form.channel),
      externalMessageId: `dev-${newId(deps.clock)}`,
      externalThreadId: thread === '' ? `dev-${newId(deps.clock)}` : thread,
      senderAddress: textOf(form.sender),
      receivedAt: deps.clock.now(),
      subject: textOf(form.subject),
      body: textOf(form.body),
      echo: form.echo === '1',
      attachments: file === '' ? [] : [{ fileName: file }],
    };
    try {
      const outcome = await receiveIncoming(
        deps.pool,
        deps.clock,
        {
          sorter: deps.sorter ?? sorterFor(form),
          matchesEmergency: emergencyMatch(deps.pool),
          objects: deps.objects,
          scanner: deps.scanner,
          onCallIdentified: deps.onCallIdentified,
        },
        message,
      );
      const callId =
        outcome.kind === 'filtered' || outcome.callId === null
          ? null
          : outcome.callId;
      if (outcome.kind === 'filtered') {
        return reply.code(303).header('location', '/calls/filtered').send();
      }
      if (callId === null) {
        return reply
          .code(303)
          .header('location', '/dev/intake?stored=1')
          .send();
      }
      return reply.code(303).header('location', `/calls/${callId}`).send();
    } catch (error) {
      if (!(error instanceof KernelError) || error.code !== 'invalid') {
        throw error;
      }
      html(reply);
      reply.code(400);
      return formPage(deps, request, refusalHe(error));
    }
  });
}
