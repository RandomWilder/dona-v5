// Applies a catalogue of document types and their field declarations. Slice 3.1.
//
// It lives in the module rather than in `src/seed-doctypes.ts` for `importEstate`'s reason: the
// composition root owns the connection and the transaction, and the module owns what the rows mean.
// It is also what the acceptance test drives — **adding a tenth type is this function over a
// one-element list**, which is why the test proves the same path the seed uses rather than a
// parallel one written to pass.
import type { UpsertResult } from '../../kernel/upsert.ts';
import type { SeedDocumentType } from '../fixtures/document-types.ts';
import { upsertDocumentType, upsertDocumentTypeField } from './catalogue.ts';
import type { Queryable } from './types.ts';

export interface CatalogueReport {
  types: { created: number; updated: number };
  fields: { created: number; updated: number };
}

function count(
  tally: { created: number; updated: number },
  result: UpsertResult,
): void {
  if (result.inserted) tally.created += 1;
  else tally.updated += 1;
}

/**
 * Upserts every type and every field declaration, in order.
 *
 * Counted from the upserts themselves and never from the tables, because a count that is not about
 * *this* run is not a fact about it — slice 1.11 paid for that lesson with two test files racing
 * over one database. On a second run every line reads `created 0`, which is the whole claim the seed
 * makes.
 */
export async function applyDocumentTypeCatalogue(
  db: Queryable,
  catalogue: SeedDocumentType[],
): Promise<CatalogueReport> {
  const report: CatalogueReport = {
    types: { created: 0, updated: 0 },
    fields: { created: 0, updated: 0 },
  };
  for (const entry of catalogue) {
    const type = await upsertDocumentType(db, entry.type);
    count(report.types, type);
    for (const declaration of entry.fields) {
      const field = await upsertDocumentTypeField(db, {
        ...declaration,
        documentTypeId: type.id,
      });
      count(report.fields, field);
    }
  }
  return report;
}
