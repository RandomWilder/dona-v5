// The tenancy module's public surface. Other modules, the composition root and the tests import
// this file and never internal/ (AGENTS.md, and src/kernel/boundary.test.ts proves it from 2.4).
//
// Write commands, two reads, and from 4.8 the completeness query. Who is in a unit *today* is
// still `src/scope/`'s answer; `listUnitTenancies` answers which lettings a flat has;
// `listIncompleteTenancies` answers which of those are missing an ערב. None takes a phone.
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
  listTermsProfiles,
  upsertTenancy,
  upsertTenancyParty,
  upsertTermsProfile,
} from './internal/commands.ts';
export type {
  CompletenessExceptionSpec,
  CompletenessRule,
  IncompleteTenancy,
} from './internal/completeness.ts';
export {
  listIncompleteTenancies,
  recordCompletenessException,
} from './internal/completeness.ts';
export type { UnitLetting } from './internal/lettings.ts';
export { listUnitTenancies } from './internal/lettings.ts';
export type { Queryable } from './internal/types.ts';
