// The tenancy module's public surface. Other modules, the composition root and the tests import
// this file and never internal/ (AGENTS.md, and src/kernel/boundary.test.ts proves it from 2.4).
//
// Write commands only. Who is in a unit *today* is `src/scope/`'s answer, computed from these dates
// on every load; a query here would be a second copy of the isolation join.

export type {
  TenancyPartySpec,
  TenancyRole,
  TenancySpec,
  TenancyStatus,
} from './internal/commands.ts';
export {
  upsertTenancy,
  upsertTenancyParty,
  upsertTermsProfile,
} from './internal/commands.ts';
export type { Queryable } from './internal/types.ts';
