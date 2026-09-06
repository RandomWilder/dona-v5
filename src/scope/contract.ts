// The scope module's public surface. Other modules and tests/policy/ import this file and never
// internal/ (AGENTS.md).

export type {
  IsolationJoinRelation,
  OccupantRow,
  OccupiedUnit,
  Queryable,
  ScopeActor,
  ScopedUnit,
} from './internal/isolation-join.ts';
export {
  ISOLATION_JOIN_RELATIONS,
  ISOLATION_JOIN_SQL,
  OCCUPANCY_VIEW,
  OCCUPANCY_VIEW_COLUMNS,
  resolveOccupiedUnits,
  resolvePartiesInUnit,
  resolveUnitsByPhone,
} from './internal/isolation-join.ts';
export { E164_PATTERN, normalisePhone } from './internal/phone.ts';
