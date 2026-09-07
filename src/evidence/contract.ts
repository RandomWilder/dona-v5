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
  documentTypeFields,
  listDocumentTypes,
  upsertDocumentType,
  upsertDocumentTypeField,
} from './internal/catalogue.ts';
export type {
  DocumentLinkSpec,
  DocumentSpec,
  LinkEntityType,
  LinkRole,
} from './internal/documents.ts';
export { ingestDocument, linkDocument } from './internal/documents.ts';
export type { CatalogueReport } from './internal/seed-catalogue.ts';
export { applyDocumentTypeCatalogue } from './internal/seed-catalogue.ts';
export type { Queryable } from './internal/types.ts';
