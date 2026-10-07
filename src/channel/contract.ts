// The channel module's public surface. #186 is the intake door. #187 is the
// sorter on OpenAI, and translation. #188 is the Outlook adapter.

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
  startOutlookPolling,
} from './internal/outlook.ts';
export type { ChannelDeps } from './internal/routes.ts';
export { registerChannelRoutes } from './internal/routes.ts';
export { createSorter, SORTER_PROMPT_VERSION } from './internal/sorter.ts';
export { renderIntakeForm } from './internal/views.ts';
