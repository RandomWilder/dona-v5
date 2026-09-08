// The tenancy module's public surface. Other modules, the composition root and the tests import
// this file and never internal/ (AGENTS.md, and src/kernel/boundary.test.ts proves it from 2.4).
//
// Write commands, and from slice 3.3 one read. Who is in a unit *today* is still `src/scope/`'s
// answer, computed from these dates on every load; `listUnitTenancies` answers *which lettings does
// this flat have*, takes a unit and never a phone, carries no day predicate and returns no party.
// SPEC-tenancy.md sets out the difference, because the line between the two is the module boundary.

export type {
  PromotedFieldSpec,
  PromotedTenancyField,
  TenancyPartySpec,
  TenancyRole,
  TenancySpec,
  TenancyStatus,
} from './internal/commands.ts';
export {
  applyPromotedField,
  findTermsProfileByName,
  upsertTenancy,
  upsertTenancyParty,
  upsertTermsProfile,
} from './internal/commands.ts';
export type { UnitLetting } from './internal/lettings.ts';
export { listUnitTenancies } from './internal/lettings.ts';
export type { Queryable } from './internal/types.ts';
