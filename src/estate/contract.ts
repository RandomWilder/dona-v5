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
  ExpiringLease,
  SearchResults,
  SpaceKindCount,
  UnitHit,
  UnitRow,
} from './internal/read-model.ts';
export {
  countUnitsByBuilding,
  EXPIRING_WINDOW_DAYS,
  getBuilding,
  getUnit,
  listBuildings,
  listExpiringLeases,
  MEASURED_QUERIES,
  SEARCH_LIMIT,
  searchEstate,
} from './internal/read-model.ts';
export type { EstateDeps } from './internal/routes.ts';
export { registerEstateRoutes } from './internal/routes.ts';
export type {
  OccupancyByBuilding,
  OccupancyByUnit,
} from './internal/views.ts';
export {
  renderBuildingPage,
  renderBuildingsPage,
  renderExpiringPage,
  renderIndexPage,
  renderSearchPage,
} from './internal/views.ts';
