// The evidence module's public surface. Other modules, the composition root and the tests import
// this file and never internal/ (AGENTS.md, and src/kernel/boundary.test.ts proves it from 2.4).
//
// **No query here returns a person.** Documents bind to parties — `entity_type = 'PARTY'` is one of
// R13's eight — but who those parties are is `src/scope/`'s answer and nobody else's (foundation
// rule 1). A document panel shows what is filed, not who signed it, until week 5 puts a session
// behind the screens. That is the same sentence `src/tenancy/contract.ts` and
// `src/parties/contract.ts` carry, and it does not bend for documents.
//
// The catalogue reads are here on purpose and are not an exception to the rule above: a document
// type is a row about paper, not about anybody. They exist because slice 3.3's guard and slice 4.2's
// extraction must read the catalogue **at run time** — A8.

export type {
  DocumentTypeFieldRow,
  DocumentTypeFieldSpec,
  DocumentTypeRow,
  DocumentTypeSpec,
  FieldValueType,
} from './internal/catalogue.ts';
export {
  documentTypeByKey,
  documentTypeFields,
  listDocumentTypes,
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
} from './internal/extract.ts';
export {
  EXTRACT_WORK_KIND,
  extractFiledDocument,
  listExtractedFields,
  numberWords,
  parseMeasuredWords,
  unionBox,
} from './internal/extract.ts';
export type {
  IntakeDeps,
  IntakeRequest,
  IntakeResult,
} from './internal/intake.ts';
export { fileDocument, findDocumentByHash } from './internal/intake.ts';
export type {
  DocumentHit,
  DocumentSearchResults,
  LinkedDocument,
} from './internal/list.ts';
export {
  listLinkedDocuments,
  MEASURED_QUERIES,
  SEARCH_LIMIT,
  searchDocuments,
} from './internal/list.ts';
export type {
  PromoteDeps,
  PromoteResult,
  PromoteSpec,
} from './internal/promote.ts';
export { promoteExtractedField } from './internal/promote.ts';
export type { HandoverProposal, ProposedAsset } from './internal/protocol.ts';
export { isProtocolType, readHandoverProposal } from './internal/protocol.ts';
export type { DocumentRead, ReadDeps, SweepReport } from './internal/read.ts';
export {
  ocrAfterFile,
  readFiledDocument,
  sweepUnverified,
} from './internal/read.ts';
export type { DocumentDeps } from './internal/routes.ts';
export { registerDocumentRoutes } from './internal/routes.ts';
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
export { documentText, verifyDeclaredType } from './internal/verify.ts';
export type {
  FiledScreen,
  ReadScreen,
  SeededScreen,
  SeedScreen,
  UploadScreen,
} from './internal/views.ts';
export {
  renderFiledPage,
  renderReadPage,
  renderSeededPage,
  renderSeedPage,
  renderUploadPage,
} from './internal/views.ts';
