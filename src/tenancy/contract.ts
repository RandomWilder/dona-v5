// The tenancy module's public surface. Other modules, the composition root and the tests import
// this file and never internal/ (AGENTS.md, and src/kernel/boundary.test.ts proves it from 2.4).
//
// Write commands, two reads, the completeness query, the change log, the clock close, and from
// 5.7 Obligation / ObligationType (`listObligationTypes` at 5.8 for the settings screen). Who is in a unit *today* is still `src/scope/`'s answer;
// `listUnitTenancies` answers which lettings a flat has; `listIncompleteTenancies` answers which
// of those miss a named completeness rule (ערב, and from #108 each activation-gate miss);
// `listTenancyEvents` answers what changed on those lettings. None
// takes a phone.
// SPEC-tenancy.md sets out the difference, because the line between the two is the module boundary.

export type {
  ActivateTenancySpec,
  ActivationCheck,
  ActivationFlag,
  ActivationGate,
  RequiredActivationDocument,
  TenancyDocumentFact,
  TenancyDocumentsReader,
} from './internal/activation.ts';
export {
  activateTenancy,
  activationGate,
  REQUIRED_FOR_ACTIVATION,
} from './internal/activation.ts';
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
  expireDueTenancies,
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
export type { TenancyEventRow } from './internal/events.ts';
export { listTenancyEvents } from './internal/events.ts';
export type {
  TenancyPartyRow,
  TenancyRow,
  UnitLetting,
} from './internal/lettings.ts';
export {
  countIdentifierOverlap,
  getTenancy,
  listTenancyParties,
  listUnitTenancies,
} from './internal/lettings.ts';
export type {
  ObligationRow,
  ObligationSpec,
  ObligationTypeCatalogueReport,
  ObligationTypeRow,
  ObligationTypeSpec,
  ResponsibleParty,
} from './internal/obligations.ts';
export {
  applyObligationTypeCatalogue,
  createObligation,
  getObligation,
  listObligationsForTenancy,
  listObligationTypes,
  upsertObligationType,
} from './internal/obligations.ts';
export type { ObligationStatus } from './internal/status.ts';
export {
  OBLIGATION_EXPIRING_WINDOW_DAYS,
  obligationStatus,
} from './internal/status.ts';
export type { Queryable } from './internal/types.ts';
