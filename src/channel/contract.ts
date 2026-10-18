// The channel module's public surface. #186 is the intake door. #187 is the
// sorter on OpenAI, and translation. #188 is the Outlook adapter. #193 is
// WhatsApp on Meta's test number. #194 is the emergency reply on that number.
// #195 is the emergency reply on the shared mailbox. #196 is the Gmail
// standby: recorded payloads only, wired to no mailbox.

export { fileAttachment, readAttachment } from './internal/attachments.ts';
export type {
  IncomingAttachment,
  IncomingMessage,
  IntakeDeps,
  IntakeOutcome,
  NoiseMessage,
  SortCategory,
  Sorter,
  SortInput,
  SortVerdict,
  StoredMessage,
  TranslateInput,
  Translation,
} from './internal/door.ts';
export {
  emergencyMatch,
  listMessagesOnCall,
  listNoiseMessages,
  receiveIncoming,
  rescueNoise,
} from './internal/door.ts';
export { replyOnInboundEmail } from './internal/email-reply.ts';
export { GMAIL_SCOPE, normaliseGmailMessage } from './internal/gmail.ts';
export type {
  GraphFetch,
  OutlookReader,
  SecretWarning,
} from './internal/outlook.ts';
export {
  createGraphReader,
  graphMailboxFrom,
  mailboxWarning,
  normaliseOutlookMessage,
  OUTLOOK_POLL_MS,
  pollOutlook,
  secretWarning,
  sendOutlookReply,
  startOutlookPolling,
} from './internal/outlook.ts';
export type { SweepReport } from './internal/retention.ts';
export { sweepFilteredMessages } from './internal/retention.ts';
export type { ChannelDeps } from './internal/routes.ts';
export { registerChannelRoutes } from './internal/routes.ts';
export { createSorter, SORTER_PROMPT_VERSION } from './internal/sorter.ts';
export { renderIntakeForm } from './internal/views.ts';
export type { WhatsappConfig, WhatsappFetch } from './internal/whatsapp.ts';
export {
  noteWhatsappEcho,
  readWhatsappWebhook,
  sendWhatsappSession,
  watchWhatsapp,
  whatsappFrom,
  whatsappWarning,
} from './internal/whatsapp.ts';
export {
  replyOnInboundWhatsapp,
  type WhatsappSessionReply,
  whatsappWindowOpen,
} from './internal/whatsapp-reply.ts';
