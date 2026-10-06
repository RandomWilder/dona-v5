// The calls module's public surface. Other modules, the composition root and the
// tests import this file and never internal/.
//
// #182 opens a phone or walk-in call and lists what is open. The source channel
// is written by that command and no command changes it.
// #183 identifies the requester, sets the Category, and reads one call.
// #184 closes a call by one of the four Exits.

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
  ExitCallSpec,
  ExitKind,
  IdentifyCallSpec,
  ManualChannel,
  OpenCallSpec,
  ServiceCall,
  ServiceCallDetail,
  SetCategorySpec,
  SourceChannel,
} from './internal/commands.ts';
export {
  countOpenCalls,
  exitCall,
  getCall,
  identifyCall,
  listCategories,
  listOpenCalls,
  openCall,
  setCallCategory,
  upsertCategory,
} from './internal/commands.ts';

declare module 'fastify' {
  interface FastifyRequest {
    /** Open ServiceCalls, counted once per signed-in request for the rail. */
    openCalls?: number;
  }
}

export type { CallsDeps } from './internal/routes.ts';
export { registerCallsRoutes } from './internal/routes.ts';
export type { CallScreen, CallsScreen } from './internal/views.ts';
export { renderCallPage, renderCallsPage } from './internal/views.ts';
