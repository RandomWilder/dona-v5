// The calls module's public surface. Other modules, the composition root and the
// tests import this file and never internal/.
//
// #182 opens a phone or walk-in call and lists what is open. The source channel
// is written by that command and no command changes it.
// #183 identifies the requester, sets the Category, and reads one call.
// #184 closes a call by one of the four Exits.
// #186 opens a call from the intake door and returns one to the filtered list.

export type {
  CallCategory,
  CallExit,
  CallLink,
  CallListFilter,
  CallParty,
  CallSender,
  CallState,
  CallTransition,
  CategoryRow,
  CategorySpec,
  EmergencyActorSpec,
  EmergencyMark,
  EmergencySettings,
  ExitCallSpec,
  ExitKind,
  IdentifyCallSpec,
  ManualChannel,
  OpenCallSpec,
  OpenIntakeCallSpec,
  ReturnCallSpec,
  ReturnedCall,
  SaveEmergencySettingsSpec,
  ServiceCall,
  ServiceCallDetail,
  SetCategorySpec,
  SorterLabel,
  SourceChannel,
} from './internal/commands.ts';
export {
  ADDRESS_MAX,
  callIsAttachable,
  clearEmergency,
  countOpenCalls,
  DESCRIPTION_MAX,
  exitCall,
  flagCallByTerms,
  flagEmergency,
  getCall,
  identifyCall,
  listCategories,
  listOpenCalls,
  listReturnedCalls,
  openCall,
  openIntakeCall,
  readEmergencySettings,
  restoreReturnedCall,
  returnToFiltered,
  saveEmergencySettings,
  setCallCategory,
  upsertCategory,
} from './internal/commands.ts';
export type { DutyContact } from './internal/emergency.ts';
export {
  composeDutyReply,
  emergencyTermMatches,
} from './internal/emergency.ts';

declare module 'fastify' {
  interface FastifyRequest {
    /** Open ServiceCalls, counted once per signed-in request for the rail. */
    openCalls?: number;
  }
}

export type { CallsDeps } from './internal/routes.ts';
export { registerCallsRoutes } from './internal/routes.ts';
export type {
  CallScreen,
  CallsScreen,
  FilteredRow,
  TimelineMessage,
} from './internal/views.ts';
export {
  renderCallPage,
  renderCallsPage,
  renderFilteredPage,
} from './internal/views.ts';
