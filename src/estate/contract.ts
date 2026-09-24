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
export type { EstateEventRow } from './internal/events.ts';
export { listEstateEvents } from './internal/events.ts';
export { importEstate, upsertUnitRow } from './internal/importer.ts';
export type { EstatePromotionColumn } from './internal/occupancy.ts';
export { occupantOfEstateColumn } from './internal/occupancy.ts';
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
  PromotedEstateField,
  PromotedEstateFieldSpec,
} from './internal/promote.ts';
export { applyPromotedField } from './internal/promote.ts';
export type {
  EstatePurgeApplySpec,
  EstatePurgeArgs,
  EstatePurgeKind,
  EstatePurgeListQuery,
  EstatePurgeReport,
  EstatePurgeTarget,
  EstatePurgeUnitLine,
} from './internal/purge.ts';
export {
  applyEstatePurge,
  listEstatePurge,
  parseEstatePurgeArgs,
  refuseProdDatabase,
} from './internal/purge.ts';
export type {
  ApprovedCapture,
  BuildingDetail,
  BuildingSummary,
  ExpiringLease,
  InventorySpaceRow,
  OverdueInspection,
  ProjectOption,
  SearchResults,
  SpaceKindCount,
  UnitHit,
  UnitParkingAsset,
  UnitRow,
} from './internal/read-model.ts';
export {
  addressKeyOf,
  countUnitsByBuilding,
  EXPIRING_WINDOW_DAYS,
  findBuildingAtAddress,
  findUnitsAtAddress,
  getBuilding,
  getUnit,
  listApprovedCapturesForTenancy,
  listBuildings,
  listExpiringLeases,
  listOverdueInspections,
  listProjects,
  listUnitParkingAssets,
  MEASURED_QUERIES,
  SEARCH_LIMIT,
  searchEstate,
} from './internal/read-model.ts';
export type { EstateDeps } from './internal/routes.ts';
export { registerEstateRoutes } from './internal/routes.ts';
export type {
  ActivationQueueView,
  CitedCaptureView,
  DocumentSearchHit,
  FiledDocumentView,
  IncompleteTenancyRow,
  NewBuildingScreen,
  NewUnitScreen,
  OccupancyByBuilding,
  OccupancyByUnit,
  OfficeRetrievalView,
  PromotedFieldView,
  SearchPageResults,
  TenancyEventView,
  TenancyPersonView,
  TenancySheet,
  UnitRetrievalView,
} from './internal/views.ts';
export {
  renderBuildingPage,
  renderBuildingsPage,
  renderExpiringPage,
  renderIncompletePage,
  renderInventoryBuildingPage,
  renderInventoryPage,
  renderNewBuildingPage,
  renderNewInventoryPage,
  renderNewUnitPage,
  renderSearchPage,
  renderTenancyDetailPage,
  renderUnitPage,
} from './internal/views.ts';
