// #257. The office reply on a WHATSAPP call. The duty reply already posts a
// session message; this resolves who it goes to, and whether the window that
// inbound message opened is still open.

import type { Clock } from '../../kernel/clock.ts';
import { KernelError } from '../../kernel/errors.ts';
import { validId } from '../../kernel/validate.ts';
import { whatsappTo } from './door.ts';
import type { Queryable } from './types.ts';

/** Closed once 24 hours have passed. The same minute the next day is the boundary. */
const WINDOW_MS = 24 * 60 * 60 * 1000;

export interface WhatsappSessionReply {
  to: string;
  body: string;
}

export function whatsappWindowOpen(lastInboundAt: Date, now: Date): boolean {
  return now.getTime() < lastInboundAt.getTime() + WINDOW_MS;
}

/**
 * A session message to the number on this call's last inbound WhatsApp
 * message. An echo does not open the window. No number is read from the caller.
 */
export async function replyOnInboundWhatsapp(
  db: Queryable,
  clock: Clock,
  callId: string,
  body: string,
  send: (reply: WhatsappSessionReply) => Promise<{ externalMessageId: string }>,
): Promise<{ externalMessageId: string }> {
  const id = validId(callId, 'call');
  const { rows } = await db.query<{
    sender_address: string;
    received_at: Date;
  }>(
    `SELECT sender_address, received_at
       FROM message
      WHERE service_call_id = $1
        AND source_channel = 'WHATSAPP'
        AND NOT is_echo
      ORDER BY received_at DESC, message_id DESC
      LIMIT 1`,
    [id],
  );
  const inbound = rows[0];
  if (!inbound) {
    throw new KernelError(
      'invalid',
      'this call has no inbound WhatsApp message',
      {
        field: 'reply',
        reason: 'message',
      },
    );
  }
  const to = whatsappTo(inbound.sender_address);
  if (to === null) {
    throw new KernelError('invalid', 'this call has no WhatsApp number', {
      field: 'reply',
      reason: 'message',
    });
  }
  if (!whatsappWindowOpen(inbound.received_at, clock.now())) {
    throw new KernelError('invalid', 'the WhatsApp window has closed', {
      field: 'reply',
      reason: 'window',
    });
  }
  return send({ to, body });
}
