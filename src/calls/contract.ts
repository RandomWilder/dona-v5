// The calls module's public surface. Other modules, the composition root and the
// tests import this file and never internal/.
//
// #182 is the first command: open a phone or walk-in call, and list what is open.
// The source channel is written by that command and no command changes it.

export type {
  CallSender,
  CallState,
  ManualChannel,
  OpenCallSpec,
  ServiceCall,
  SourceChannel,
} from './internal/commands.ts';
export {
  countOpenCalls,
  listOpenCalls,
  openCall,
} from './internal/commands.ts';

declare module 'fastify' {
  interface FastifyRequest {
    /** Open ServiceCalls, counted once per signed-in request for the rail. */
    openCalls?: number;
  }
}

export type { CallsDeps } from './internal/routes.ts';
export { registerCallsRoutes } from './internal/routes.ts';
export type { CallsScreen } from './internal/views.ts';
export { renderCallsPage } from './internal/views.ts';
