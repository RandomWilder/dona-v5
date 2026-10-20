// The portal module's public surface. Tenant routes, the session cookie, and the screens.
// Other modules are reached through their contracts. This module holds no call, tenancy or
// document of its own.

export type { CodeNotice } from './internal/codes.ts';
export type { PortalDeps } from './internal/routes.ts';
export { registerPortalRoutes } from './internal/routes.ts';
export {
  PORTAL_CHALLENGE_COOKIE,
  PORTAL_FORM_COOKIE,
  PORTAL_SESSION_COOKIE,
  portalCookie,
  readPortalCookie,
  SESSION_ABSOLUTE_MS,
  SESSION_IDLE_MS,
} from './internal/sessions.ts';
export {
  renderCodePage,
  renderHomePage,
  renderPhonePage,
} from './internal/views.ts';
