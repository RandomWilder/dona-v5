// The scope module's public surface. Other modules and tests/policy/ import this file and never
// internal/ (AGENTS.md).

export type {
  IsolationJoinRelation,
  Queryable,
  ScopedUnit,
} from './internal/isolation-join.ts';
export {
  ISOLATION_JOIN_RELATIONS,
  ISOLATION_JOIN_SQL,
  resolveUnitsByPhone,
} from './internal/isolation-join.ts';
