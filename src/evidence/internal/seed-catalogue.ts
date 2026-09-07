// Applies a catalogue of document types and their field declarations. Slice 3.1.
//
// It lives in the module rather than in `src/seed-doctypes.ts` for `importEstate`'s reason: the
// composition root owns the connection and the transaction, and the module owns what the rows mean.
// It is also what the acceptance test drives — **adding a tenth type is this function over a
// one-element list**, which is why the test proves the same path the seed uses rather than a
// parallel one written to pass.
import { newId } from '../../kernel/ids.ts';
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

/** Reviewed mappings. A new target column still costs a migration that extends the CHECK. */
const PROMOTION_TARGETS: Readonly<
  Record<string, Readonly<Record<string, string>>>
> = {
  lease: {
    start_date: 'tenancy.start_date',
    end_date: 'tenancy.end_date',
  },
  lease_amendment: {
    new_end_date: 'tenancy.end_date',
  },
};

async function upsertFieldPromotion(
  db: Queryable,
  documentTypeFieldId: string,
  target: string,
): Promise<void> {
  await db.query(
    `INSERT INTO field_promotion (field_promotion_id, document_type_field_id, target)
     VALUES ($1, $2, $3)
     ON CONFLICT (document_type_field_id) DO UPDATE SET target = EXCLUDED.target`,
    [newId(), documentTypeFieldId, target],
  );
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
      const target =
        PROMOTION_TARGETS[entry.type.typeKey]?.[declaration.fieldKey];
      if (target) {
        await upsertFieldPromotion(db, field.id, target);
      }
    }
  }
  return report;
}
