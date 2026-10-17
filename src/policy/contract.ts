// The policy module's public surface. Other modules, the composition root and
// the tests import this file and never internal/.
//
// The library holds laws and company policies. It holds no tenant's data, and
// it decides nothing — a Policy rule is a different thing and is not here yet.

export type { PolicySectionSeed } from './fixtures/sections.ts';
export { policySections } from './fixtures/sections.ts';
export type {
  PolicyDocumentView,
  PolicyPassageView,
  PolicySectionView,
  PolicyVersionView,
  UploadPolicyDocumentSpec,
} from './internal/library.ts';
export {
  listPolicyLibrary,
  uploadPolicyDocument,
} from './internal/library.ts';
export type { PolicyDeps } from './internal/routes.ts';
export { registerPolicyRoutes } from './internal/routes.ts';
export type { PolicyPassageHit } from './internal/search.ts';
export {
  POLICY_SECTION_CAP,
  searchPolicyPassages,
} from './internal/search.ts';
export type { SectionSeedReport } from './internal/sections.ts';
export { applyPolicySections } from './internal/sections.ts';
