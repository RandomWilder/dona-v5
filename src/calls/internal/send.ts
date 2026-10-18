// #256. Send the draft, edited or as written, as a reply on the call's own
// inbound email. The channel resolves the message. This command decides
// whether the send is allowed, then records it.

import { createAuditLog } from '../../kernel/audit.ts';
import type { Clock } from '../../kernel/clock.ts';
import { inTransaction } from '../../kernel/db.ts';
import { KernelError } from '../../kernel/errors.ts';
import { newId } from '../../kernel/ids.ts';
import { requireText, validId } from '../../kernel/validate.ts';
import {
  can,
  isRole,
  loadCallThread,
  NOT_ALLOWED,
} from '../../staff/contract.ts';
import { getCall } from './commands.ts';
import type { Queryable } from './types.ts';

/** Long enough for a draft the model wrote, short of an unbounded post. */
const REPLY_MAX = 20_000;

export interface SendCallReplySpec {
  callId: string;
  body: string;
  actorId: string;
  actorRole?: string | null;
  /** Posted by a client. Never the address that is used. */
  recipient?: string | null;
}

export async function sendCallReply(
  db: Queryable,
  clock: Clock,
  spec: SendCallReplySpec,
  send: (
    callId: string,
    body: string,
  ) => Promise<{ externalMessageId: string }>,
): Promise<void> {
  const callId = validId(spec.callId, 'call');
  const actorId = validId(spec.actorId, 'actor');
  const body = requireText(spec.body, 'body', REPLY_MAX);
  const role = isRole(spec.actorRole) ? spec.actorRole : null;
  if (!can(role, 'calls.reply')) {
    throw new KernelError('not_allowed', NOT_ALLOWED);
  }
  const call = await getCall(db, callId);
  if (!call) throw new KernelError('not_found', 'call not found');
  if (call.state === 'CLOSED') {
    throw new KernelError('invalid', 'a closed call cannot be replied to', {
      field: 'state',
      reason: 'closed',
    });
  }
  if (call.state === 'NEW') {
    throw new KernelError('invalid', 'identify the caller before replying', {
      field: 'state',
      reason: 'new',
    });
  }
  if (call.sourceChannel !== 'EMAIL') {
    throw new KernelError('invalid', 'only an email call can be replied to', {
      field: 'reply',
      reason: 'channel',
    });
  }

  try {
    await send(callId, body);
  } catch (error) {
    if (error instanceof KernelError) throw error;
    throw new KernelError('unavailable', 'the reply was not sent', {
      field: 'reply',
      reason: 'send',
    });
  }

  const thread = await loadCallThread(db, callId);
  const draft = thread?.turns.filter((turn) => turn.kind === 'draft').at(-1);
  const mark = draft?.answer.trim() === body ? 'as_written' : 'edited';
  const at = clock.now();
  await inTransaction(db, async (tx) => {
    await tx.query(
      `INSERT INTO service_call_transition
         (transition_id, service_call_id, kind, actor_id, at, note, reply_mark)
       VALUES ($1, $2, 'REPLIED', $3, $4, $5, $6)`,
      [newId(clock), callId, actorId, at, body, mark],
    );
    await createAuditLog(tx, clock).write(
      {
        actorKind: 'staff',
        actorId,
        actorRole: role ?? undefined,
        action: 'calls.reply',
        subjectId: callId,
        inputs: { mark, text: body },
      },
      { outcome: 'ok' },
    );
  });
}
