// The evidence module's public surface. Other modules, the composition root and the tests import
// this file and never internal/ (AGENTS.md, and src/kernel/boundary.test.ts proves it from 2.4).
//
// **No query here returns a person.** Documents bind to parties — `entity_type = 'PARTY'` is one of
// R13's eight — but who those parties are is `src/scope/`'s answer and nobody else's (foundation
// rule 1). A document panel shows what is filed, not who signed it — and still does after 5.2 put
// a session behind the screens and declined to lift the rule, and after 5.4 kept that rule again.
//
// The catalogue reads are here on purpose and are not an exception to the rule above: a document
// type is a row about paper, not about anybody. They exist because slice 3.3's guard and slice 4.2's
// extraction must read the catalogue **at run time** — A8.

// **Slice 7.3.** The approval stamp — the verb 4.3 did not have. `READ_QUALITY_THRESHOLD` and
// `isFlagged` are on the contract because `tests/policy/read-quality.test.ts` is their gate, and the
// policy suite reads contracts and never internals.
export type {
  ApproveDeps,
  ApproveResult,
  ApproveSpec,
  ApproveUnflaggedResult,
  ApproveUnflaggedSpec,
} from './internal/approve.ts';
export {
  approveExtractedField,
  approveUnflagged,
  isFlagged,
  READ_QUALITY_THRESHOLD,
} from './internal/approve.ts';
export type {
  DeclarationResult,
  DocumentTypeFieldRow,
  DocumentTypeFieldSpec,
  DocumentTypeRow,
  DocumentTypeSpec,
  FieldDeclaration,
  FieldValueType,
} from './internal/catalogue.ts';
export {
  declareDocumentTypeField,
  documentTypeByKey,
  documentTypeFieldCounts,
  documentTypeFields,
  FIELD_VALUE_TYPES,
  listDocumentTypes,
  retireDocumentTypeField,
  upsertDocumentType,
  upsertDocumentTypeField,
} from './internal/catalogue.ts';
export type {
  DocumentLinkSpec,
  DocumentSpec,
  FiledVerdict,
  LinkEntityType,
  LinkRole,
} from './internal/documents.ts';
export {
  getFiledDocument,
  ingestDocument,
  linkDocument,
  listUnverifiedDocuments,
  updateVerificationVerdict,
} from './internal/documents.ts';
export type {
  BBox,
  ExtractDeps,
  ExtractedRow,
  ExtractReport,
  MeasuredWord,
  PromotedField,
} from './internal/extract.ts';
// `asBareNumber` is on the contract because `tests/policy/amount-capture.test.ts` is its gate and
// the policy suite reads contracts, never internals. Which mark on a printed amount is the decimal
// point is a decision no model makes (ticket #101, ADR-0008).
export {
  asBareNumber,
  EXTRACT_INSTRUCTIONS,
  EXTRACT_WORK_KIND,
  extractFiledDocument,
  IDENTIFIER_FIELD_KEYS,
  isIdentifierField,
  listExtractedFields,
  listPromotedFieldsForUnit,
  numberWords,
  parseMeasuredWords,
  unionBox,
} from './internal/extract.ts';
export type {
  IntakeDeps,
  IntakeRefusal,
  IntakeRequest,
  IntakeResult,
} from './internal/intake.ts';
export { fileDocument, findDocumentByHash } from './internal/intake.ts';
export type {
  ConfirmLeaseResult,
  ConfirmLeaseSpec,
  LeaseDeps,
  LeaseProposal,
  ProposedPerson,
  ProposeLeaseSpec,
  TenancyCandidate,
} from './internal/lease.ts';
export {
  addressMatches,
  apartmentMatches,
  confirmLeaseTenancy,
  dayOverlap,
  proposeLeaseTenancy,
  rankCandidates,
} from './internal/lease.ts';
export type {
  DocumentHit,
  DocumentSearchResults,
  LinkedDocument,
  LinkedDocumentRead,
} from './internal/list.ts';
export {
  listLinkedDocuments,
  listTenancyDocumentFacts,
  MEASURED_QUERIES,
  SEARCH_LIMIT,
  searchDocuments,
  signLinkedDocuments,
} from './internal/list.ts';
export type { FilingContinuation } from './internal/orchestrate.ts';
export {
  destinationAfterFiling,
  unitDocumentAction,
} from './internal/orchestrate.ts';
export type { DocumentPassage } from './internal/passages.ts';
export { listDocumentPassages } from './internal/passages.ts';
export type {
  PromoteDeps,
  PromoteResult,
  PromoteSpec,
} from './internal/promote.ts';
export { promoteExtractedField } from './internal/promote.ts';
export type { HandoverProposal, ProposedAsset } from './internal/protocol.ts';
export { isProtocolType, readHandoverProposal } from './internal/protocol.ts';
export type {
  DocumentRead,
  DocumentReading,
  OcrOutcome,
  PassageSweepDeps,
  PassageSweepReport,
  ReadDeps,
  SweepReport,
} from './internal/read.ts';
export {
  readFiledDocument,
  readForVerdict,
  sweepMissingPassages,
  sweepUnverified,
} from './internal/read.ts';
export type { DocumentDeps } from './internal/routes.ts';
export { registerDocumentRoutes } from './internal/routes.ts';
export type { PassageHit, RetrievalStance } from './internal/search.ts';
export { SEARCH_PASSAGE_LIMIT, searchPassages } from './internal/search.ts';
export type { ProtocolProposal, SeedDeps } from './internal/seed.ts';
export {
  confirmProtocol,
  proposeProtocol,
} from './internal/seed.ts';
export type { CatalogueReport } from './internal/seed-catalogue.ts';
export { applyDocumentTypeCatalogue } from './internal/seed-catalogue.ts';
// The object path convention (slice 3.2). It is exported from the module that owns the paper
// because `src/kernel/objects.ts` stores the path it is handed and never invents one — and it is
// **not** a query, so it does not touch the rule above: a path names a place and a digest, and it
// cannot name a person, which SPEC-evidence.md states and `PlaceKind` enforces.
export type {
  DocumentExtension,
  ObjectPathSpec,
  Place,
  PlaceKind,
} from './internal/storage-path.ts';
export {
  documentContentTypes,
  documentExtensions,
  documentFileHash,
  documentObjectPath,
  documentStorageUri,
  parseObjectPath,
  parseStorageUri,
  sniffExtension,
} from './internal/storage-path.ts';
export type { Queryable } from './internal/types.ts';
// The verification guard (slice 3.3). Exported because `tests/policy/document-verification.test.ts`
// is its gate and the policy suite reads contracts, never internals.
export type { Verification, VerificationVerdict } from './internal/verify.ts';
export {
  documentText,
  verifyDeclaredType,
} from './internal/verify.ts';
export type {
  DocumentsScreen,
  FieldsScreen,
  FiledScreen,
  IntakeScreen,
  ReadScreen,
  SeededScreen,
  SeedScreen,
  TenancyScreen,
  TenancyWrittenScreen,
  UploadScreen,
} from './internal/views.ts';
export {
  renderDocumentsPage,
  renderFieldsPage,
  renderFiledPage,
  renderIntakePage,
  renderReadPage,
  renderSeededPage,
  renderSeedPage,
  renderTenancyPage,
  renderTenancyWrittenPage,
  renderUploadPage,
} from './internal/views.ts';
