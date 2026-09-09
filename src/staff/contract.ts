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
  NOT_ALLOWED,
  normaliseEmail,
} from './internal/accounts.ts';
export type {
  IdentityProvider,
  MfaRequired,
  SignedIn,
  SignInResult,
  TotpEnrollment,
} from './internal/identity.ts';
export {
  createConfiguredIdentity,
  createIdentityPlatform,
  createUnconfiguredIdentity,
  IdentityRefusal,
  readIdTokenClaims,
  TOTP_FACTOR_NAME,
} from './internal/identity.ts';
export type { StaffInvite } from './internal/invites.ts';
export { createInvite, otpauthUri } from './internal/invites.ts';
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
  readSessionCookie,
  resolveSession,
  revokeSession,
  SESSION_ABSOLUTE_MS,
  SESSION_COOKIE,
  SESSION_IDLE_MS,
  sessionCookie,
} from './internal/sessions.ts';
export type { Queryable } from './internal/types.ts';
export type {
  EnrolScreen,
  InviteScreen,
  LoginScreen,
  SecondFactorScreen,
  StaffHomeScreen,
} from './internal/views.ts';
export {
  renderEnrolledPage,
  renderEnrolPage,
  renderInvitePage,
  renderLoginPage,
  renderSecondFactorPage,
  renderStaffHomePage,
} from './internal/views.ts';
