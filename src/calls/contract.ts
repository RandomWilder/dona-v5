// The calls module's public surface. Other modules, the composition root and the
// tests import this file and never internal/.
//
// #182 opens a phone or walk-in call and lists what is open. The source channel
// is written by that command and no command changes it.
// #183 identifies the requester, sets the Category, and reads one call.
// #184 closes a call by one of the four Exits.
// #186 opens a call from the intake door and returns one to the filtered list.

export { businessDaysElapsed } from './internal/business-days.ts';
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
  ChangeNonWorkingDateSpec,
  EmergencyActorSpec,
  EmergencyMark,
  EmergencySettings,
  EntryPermission,
  ExitCallSpec,
  ExitKind,
  HandlingGoal,
  IdentifyByAddressSpec,
  IdentifyCallSpec,
  ManualChannel,
  OpenCallSpec,
  OpenIntakeCallSpec,
  RequesterCall,
  ResponseBand,
  ResponseGoal,
  ReturnCallSpec,
  ReturnedCall,
  SaveEmergencySettingsSpec,
  SaveHandlingGoalSpec,
  SaveResponseGoalSpec,
  SaveSenderContactSpec,
  ServiceCall,
  ServiceCallDetail,
  SetCategorySpec,
  SorterLabel,
  SourceChannel,
} from './internal/commands.ts';
export {
  ADDRESS_MAX,
  callIsAttachable,
  changeNonWorkingDate,
  clearEmergency,
  countOpenCalls,
  DESCRIPTION_MAX,
  exitCall,
  flagCallByTerms,
  flagEmergency,
  getCall,
  identifyByAddress,
  identifyCall,
  listCallsByRequester,
  listCategories,
  listOpenCalls,
  listReturnedCalls,
  openCall,
  openIntakeCall,
  readEmergencySettings,
  readHandlingGoal,
  readNonWorkingDates,
  readResponseGoal,
  restoreReturnedCall,
  returnToFiltered,
  saveEmergencySettings,
  saveHandlingGoal,
  saveResponseGoal,
  saveSenderContact,
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

export type {
  CallBriefFacts,
  CallBriefPanel,
  CallBriefRunner,
} from './internal/brief.ts';
export {
  askCallFollowUp,
  loadCallBriefPanel,
  refreshCallBrief,
  startCallBrief,
} from './internal/brief.ts';
export { replyLanguage, writeCallDraft } from './internal/draft.ts';
export type { PortalCall, PortalReply } from './internal/portal-read.ts';
export { listPortalCalls, readPortalCall } from './internal/portal-read.ts';
export type { CallsDeps } from './internal/routes.ts';
export { registerCallsRoutes } from './internal/routes.ts';
export type { SendCallReplySpec } from './internal/send.ts';
export { sendCallReply } from './internal/send.ts';
export type { TenantStatus } from './internal/tenant-status.ts';
export { tenantStatus } from './internal/tenant-status.ts';
export type {
  CallScreen,
  CallsScreen,
  FilteredRow,
  TimelineMessage,
} from './internal/views.ts';
export {
  CALL_STATE_HE,
  renderCallPage,
  renderCallsPage,
  renderFilteredPage,
} from './internal/views.ts';
