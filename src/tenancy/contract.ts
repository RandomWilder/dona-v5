// The tenancy module's public surface. Other modules, the composition root and the tests import
// this file and never internal/ (AGENTS.md, and src/kernel/boundary.test.ts proves it from 2.4).
//
// Write commands (including `exerciseOption`), two reads, the completeness query, the change log, the clock close, and from
// 5.7 Obligation / ObligationType (`listObligationTypes` at 5.8 for the settings screen). Who a
// phone reaches *today* is still `src/scope/`'s answer; `listUnitTenancies` answers which lettings
// a flat has; `listIncompleteTenancies` answers which of those miss a named completeness rule (ערב,
// and from #108 each activation-gate miss); `listActivationQueue` (#158) answers which drafts
// the gate will activate today or within `ACTIVATION_QUEUE_DAYS`, still with no party;
// `listTenancyEvents` answers what changed on those
// lettings; `listActiveLettingsInBuilding` (#122) is the office inventory of Units let in a
// Building today. None takes a phone.
// SPEC-tenancy.md sets out the difference, because the line between the two is the module boundary.

export type {
  ActivateTenancySpec,
  ActivationCheck,
  ActivationFlag,
  ActivationGate,
  BlockingLetting,
  ProtocolWaiver,
  RequiredActivationDocument,
  TenancyDocumentFact,
  TenancyDocumentsReader,
} from './internal/activation.ts';
export {
  activateTenancy,
  activationGate,
  EARLY_HANDOVER_DAYS,
  REQUIRED_FOR_ACTIVATION,
} from './internal/activation.ts';
export type {
  EndTenancyEarlySpec,
  ExerciseOptionSpec,
  PromotedFieldSpec,
  PromotedTenancyField,
  ReassignParkingSpec,
  ReassignStorageSpec,
  TenancyPartySpec,
  TenancyRole,
  TenancySpec,
  TenancyStatus,
} from './internal/commands.ts';
export {
  applyPromotedField,
  endTenancyEarly,
  exerciseOption,
  expireDueTenancies,
  findTermsProfileByName,
  listTermsProfiles,
  occupantOfAssignedBay,
  occupantOfAssignedStorage,
  reassignParkingSpace,
  reassignStorageSpace,
  upsertTenancy,
  upsertTenancyParty,
  upsertTermsProfile,
} from './internal/commands.ts';
export type {
  ActivationQueue,
  ActivationQueueDraft,
  ArmingSoon,
  CompletenessExceptionSpec,
  CompletenessRule,
  IncompleteTenancy,
  ProtocolWaiverView,
  ReadyToActivate,
} from './internal/completeness.ts';
export {
  ACTIVATION_QUEUE_DAYS,
  listActivationQueue,
  listIncompleteTenancies,
  recordCompletenessException,
} from './internal/completeness.ts';
export type { TenancyEventRow } from './internal/events.ts';
export { listTenancyEvents } from './internal/events.ts';
export type {
  ActiveLettingInBuilding,
  LettingOnUnit,
  TenancyPartyRow,
  TenancyRow,
  UnitLetting,
} from './internal/lettings.ts';
export {
  countIdentifierOverlap,
  getTenancy,
  listActiveLettingsInBuilding,
  listLettingsForUnits,
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
