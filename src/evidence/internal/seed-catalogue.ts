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
 * Closes the run-time declarations a seeded type now supersedes. #235.
 *
 * A declaration is the seed's own when the seed declares its key from its first day; anything else
 * open, under a matching key or label, is closed, including an A14 row under one of the seed's
 * own keys from a different day.
 *
 * The window closes the day before `on`, or on the declaration's own first day when it opened on
 * or after `on`: a window may not close before it opens, and a value already read under it still
 * points at a row that says what it said (R18). Nothing is deleted.
 */
async function closeSuperseded(
  db: Queryable,
  documentTypeId: string,
  seeded: ReadonlySet<string>,
  rule: NonNullable<SeedDocumentType['supersedes']>,
): Promise<void> {
  const open = await db.query<{
    document_type_field_id: string;
    field_key: string;
    label_he: string;
    effective_from: string;
  }>(
    `SELECT document_type_field_id, field_key, label_he,
            to_char(effective_from, 'YYYY-MM-DD') AS effective_from
       FROM document_type_field
      WHERE document_type_id = $1 AND effective_to IS NULL`,
    [documentTypeId],
  );
  for (const row of open.rows) {
    if (seeded.has(`${row.field_key}@${row.effective_from}`)) continue;
    if (!rule.key.test(row.field_key) && !rule.label.test(row.label_he)) {
      continue;
    }
    await db.query(
      `UPDATE document_type_field
          SET effective_to = GREATEST(effective_from, $2::date - 1)
        WHERE document_type_field_id = $1`,
      [row.document_type_field_id, rule.on],
    );
  }
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
    if (entry.supersedes) {
      await closeSuperseded(
        db,
        type.id,
        new Set(
          entry.fields.map(
            (declaration) =>
              `${declaration.fieldKey}@${declaration.effectiveFrom}`,
          ),
        ),
        entry.supersedes,
      );
    }
  }
  return report;
}
