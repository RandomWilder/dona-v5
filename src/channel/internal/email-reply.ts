// #256. The office reply on an EMAIL call. This resolves which inbound message
// the one Graph reply answers. The duty reply already holds that id and calls
// the same post.

import { KernelError } from '../../kernel/errors.ts';
import { validId } from '../../kernel/validate.ts';
import type { EmailDutyReply } from './door.ts';
import type { Queryable } from './types.ts';

/**
 * A Graph reply on the inbound message this call was opened from. The body
 * is the only text. No address is read from the caller.
 */
export async function replyOnInboundEmail(
  db: Queryable,
  callId: string,
  body: string,
  send: (reply: EmailDutyReply) => Promise<{ externalMessageId: string }>,
): Promise<{ externalMessageId: string }> {
  const id = validId(callId, 'call');
  const { rows } = await db.query<{ external_message_id: string }>(
    `SELECT external_message_id
       FROM message
      WHERE service_call_id = $1
        AND source_channel = 'EMAIL'
        AND NOT is_echo
      ORDER BY received_at, message_id
      LIMIT 1`,
    [id],
  );
  const messageId = rows[0]?.external_message_id;
  if (!messageId) {
    throw new KernelError('invalid', 'this call has no inbound email', {
      field: 'reply',
      reason: 'message',
    });
  }
  return send({ messageId, body });
}
