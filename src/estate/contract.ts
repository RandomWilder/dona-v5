// The estate module's public surface. Other modules, the composition root and the tests import this
// file and never internal/ (AGENTS.md).

export type {
  ProposedAsset,
  ProtocolSeed,
  ProtocolSeedResult,
} from './internal/assets.ts';
export {
  addCalendarYears,
  applyProtocolSeed,
  WARRANTY_YEARS,
} from './internal/assets.ts';
export { importEstate, upsertUnitRow } from './internal/importer.ts';
export type {
  AssetClass,
  AssetPlan,
  AssetStatus,
  AssetType,
  BuildingPlan,
  BuildingStatus,
  ComplianceRegime,
  ConditionStatus,
  EstatePlan,
  ImportReport,
  ProjectPlan,
  ProjectStatus,
  ProviderKind,
  ProviderPlan,
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
  OverdueInspection,
  SearchResults,
  SpaceKindCount,
  UnitHit,
  UnitParkingAsset,
  UnitRow,
} from './internal/read-model.ts';
export {
  countUnitsByBuilding,
  EXPIRING_WINDOW_DAYS,
  getBuilding,
  getUnit,
  listBuildings,
  listExpiringLeases,
  listOverdueInspections,
  listUnitParkingAssets,
  MEASURED_QUERIES,
  SEARCH_LIMIT,
  searchEstate,
} from './internal/read-model.ts';
export type { EstateDeps } from './internal/routes.ts';
export { registerEstateRoutes } from './internal/routes.ts';
export type {
  DocumentSearchHit,
  FiledDocumentView,
  IncompleteTenancyRow,
  OccupancyByBuilding,
  OccupancyByUnit,
  PromotedFieldView,
  SearchPageResults,
} from './internal/views.ts';
export {
  renderBuildingPage,
  renderBuildingsPage,
  renderExpiringPage,
  renderIncompletePage,
  renderSearchPage,
  renderUnitPage,
} from './internal/views.ts';
