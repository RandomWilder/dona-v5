// The portal module's public surface. Tenant routes, the session cookie, and the screens.
// Other modules are reached through their contracts. This module holds no call, tenancy or
// document of its own.

export type { CodeNotice } from './internal/codes.ts';
export {
  PORTAL_LANG_COOKIE,
  PORTAL_LANG_MAX_AGE,
} from './internal/language.ts';
export type { PlaceholderText } from './internal/legal.ts';
export { currentPlaceholderTexts } from './internal/legal.ts';
export type { PortalDeps } from './internal/routes.ts';
export { registerPortalRoutes } from './internal/routes.ts';
export {
  PORTAL_CHALLENGE_COOKIE,
  PORTAL_CHOICE_COOKIE,
  PORTAL_FORM_COOKIE,
  PORTAL_SESSION_COOKIE,
  portalCookie,
  readPortalCookie,
  SESSION_ABSOLUTE_MS,
  SESSION_IDLE_MS,
} from './internal/sessions.ts';
export {
  renderAskPage,
  renderAskReceived,
  renderCodePage,
  renderFlatPage,
  renderHomePage,
  renderMissingPage,
  renderMorePage,
  renderNoAccessPage,
  renderNoticeFullPage,
  renderNoticePage,
  renderPasskeyOffer,
  renderPasskeysPage,
  renderPhonePage,
  renderPortalCallPage,
  renderPortalCallsPage,
  renderReportPage,
  renderReportReceived,
} from './internal/views.ts';
