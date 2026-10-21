// The scope module's public surface. Other modules and tests/policy/ import this file and never
// internal/ (AGENTS.md).

export { normaliseEmail } from './internal/email.ts';
export type {
  IsolationJoinRelation,
  OccupantRow,
  OccupiedUnit,
  PortalTenancy,
  Queryable,
  ScopeActor,
  ScopedUnit,
} from './internal/isolation-join.ts';
export {
  EMAIL_ISOLATION_JOIN_SQL,
  ISOLATION_JOIN_RELATIONS,
  ISOLATION_JOIN_SQL,
  OCCUPANCY_VIEW,
  OCCUPANCY_VIEW_COLUMNS,
  partyHoldingContact,
  resolveActiveTenancy,
  resolveOccupiedUnits,
  resolvePartiesInUnit,
  resolvePortalTenancies,
  resolveUnitsByEmail,
  resolveUnitsByPhone,
} from './internal/isolation-join.ts';
export { E164_PATTERN, normalisePhone } from './internal/phone.ts';
