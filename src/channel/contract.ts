// The channel module's public surface. #186 is the intake door and a fake
// sorter. Adapters, translation and the real sorter are later tickets.

export type {
  IncomingAttachment,
  IncomingMessage,
  IntakeDeps,
  IntakeOutcome,
  NoiseMessage,
  Sorter,
  SortInput,
  SortVerdict,
  StoredMessage,
} from './internal/door.ts';
export {
  emergencyMatch,
  listMessagesOnCall,
  listNoiseMessages,
  receiveIncoming,
  rescueNoise,
} from './internal/door.ts';

export type { ChannelDeps } from './internal/routes.ts';
export { registerChannelRoutes } from './internal/routes.ts';
