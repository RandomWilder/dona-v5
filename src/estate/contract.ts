// The estate module's public surface. Other modules, the composition root and the tests import this
// file and never internal/ (AGENTS.md).

export { importEstate, upsertUnitRow } from './internal/importer.ts';
export type {
  BuildingPlan,
  BuildingStatus,
  ConditionStatus,
  EstatePlan,
  ImportReport,
  ProjectPlan,
  ProjectStatus,
  Queryable,
  SpaceKind,
  SpacePlan,
  TableCount,
  UnitPlan,
  UnitRowResult,
  UnitRowSpec,
} from './internal/plan.ts';
export type {
  BuildingDetail,
  BuildingSummary,
  SpaceKindCount,
  UnitRow,
} from './internal/read-model.ts';
export { getBuilding, listBuildings } from './internal/read-model.ts';
export type { EstateDeps } from './internal/routes.ts';
export { registerEstateRoutes } from './internal/routes.ts';
export { renderBuildingPage, renderBuildingsPage } from './internal/views.ts';
