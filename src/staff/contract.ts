// The staff module's public surface. Other modules, the composition root and the tests import this
// file and never `internal/` (AGENTS.md; src/kernel/boundary.test.ts proves it from 2.4).
//
// **What is here is the guard, the vocabulary and the screens, and nothing about a household.**
// This module answers who is asking and what they may do. It never answers *which rows a person may
// see about a tenant* — that is `src/scope/`'s and nobody else's (foundation rule 1), and a staff
// role neither widens nor narrows the isolation join. Keeping the two apart is the reason there is
// no query in this file that returns a party, a unit or a document.
//
// `requireStaff` is exported for **slice 5.2**, which puts the seven long-unauthenticated routes
// behind exactly this function. One guard, one caller per route, never a second copy.

export type { StaffAccount } from './internal/accounts.ts';
export {
  accountByEmail,
  accountByLocalId,
  addOperator,
  assignRole,
  linkLocalId,
  NOT_ALLOWED,
  normaliseEmail,
} from './internal/accounts.ts';
export type {
  GoogleClaims,
  IdentityProvider,
} from './internal/identity.ts';
export {
  acceptClaims,
  configuredHostedDomain,
  createConfiguredIdentity,
  createGoogleOidc,
  createUnconfiguredIdentity,
  IdentityRefusal,
} from './internal/identity.ts';
export type { Permission, Role } from './internal/roles.ts';
export {
  can,
  isRole,
  PERMISSIONS,
  permissionsOf,
  ROLES,
} from './internal/roles.ts';
export type { StaffDeps } from './internal/routes.ts';
export { registerStaffRoutes, requireStaff } from './internal/routes.ts';
export type { ResolvedSession } from './internal/sessions.ts';
export {
  hashToken,
  mintSession,
  OAUTH_COOKIE,
  readSessionCookie,
  resolveSession,
  revokeSession,
  SESSION_ABSOLUTE_MS,
  SESSION_COOKIE,
  SESSION_IDLE_MS,
  sessionCookie,
} from './internal/sessions.ts';
export type { Queryable } from './internal/types.ts';
export type { LoginScreen, StaffHomeScreen } from './internal/views.ts';
export { renderLoginPage, renderStaffHomePage } from './internal/views.ts';
