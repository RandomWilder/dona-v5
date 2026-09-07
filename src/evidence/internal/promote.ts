// Slice 4.3. Copy an extracted value onto a typed tenancy column, or refuse.
//
// Capture stays a row. Becoming business truth requires a FieldPromotion mapping, a TENANCY
// link, and a named promoter. The database refuses a stamp written without dona.promoting.
import type { Pool } from 'pg';
import type { AuditLog } from '../../kernel/audit.ts';
import type { Clock } from '../../kernel/clock.ts';
import { KernelError } from '../../kernel/errors.ts';
import { requireText, validId } from '../../kernel/validate.ts';
import {
  applyPromotedField,
  type PromotedTenancyField,
} from '../../tenancy/contract.ts';
import type { Queryable } from './types.ts';

export interface PromoteDeps {
  db: Queryable;
  audit: AuditLog;
  clock: Clock;
}

export interface PromoteSpec {
  extractedFieldId: string;
  promotedBy: string;
}

export interface PromoteResult {
  tenancyId: string;
  target: string;
  value: string;
}

const TARGET_FIELD: Record<string, PromotedTenancyField> = {
  'tenancy.start_date': 'start_date',
  'tenancy.end_date': 'end_date',
};

function asPool(db: Queryable): Pool | null {
  if ('connect' in db && !('release' in db)) {
    return db as Pool;
  }
  return null;
}

async function inTransaction<T>(
  db: Queryable,
  work: (db: Queryable) => Promise<T>,
): Promise<T> {
  const pool = asPool(db);
  if (!pool) {
    return work(db);
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function promoteExtractedField(
  deps: PromoteDeps,
  spec: PromoteSpec,
): Promise<PromoteResult> {
  const extractedFieldId = validId(spec.extractedFieldId, 'extracted field');
  const promotedBy = requireText(spec.promotedBy, 'promoted_by', 200);

  return inTransaction(deps.db, async (db) => {
    const captured = await db.query<{
      extracted_field_id: string;
      document_id: string;
      value: string;
      promoted_to: string | null;
      target: string | null;
    }>(
      `SELECT e.extracted_field_id, e.document_id, e.value, e.promoted_to, p.target
         FROM extracted_field e
         LEFT JOIN field_promotion p
           ON p.document_type_field_id = e.document_type_field_id
        WHERE e.extracted_field_id = $1`,
      [extractedFieldId],
    );
    const row = captured.rows[0];
    if (!row) {
      throw new KernelError('not_found', 'extracted field not found');
    }
    if (!row.target) {
      throw new KernelError(
        'invalid',
        'that field cannot become business truth',
      );
    }
    const field = TARGET_FIELD[row.target];
    if (!field) {
      throw new KernelError(
        'invalid',
        'that field cannot become business truth',
      );
    }

    const link = await db.query<{ entity_id: string }>(
      `SELECT entity_id FROM document_link
        WHERE document_id = $1 AND entity_type = 'TENANCY'
        ORDER BY entity_id
        LIMIT 1`,
      [row.document_id],
    );
    const tenancyId = link.rows[0]?.entity_id;
    if (!tenancyId) {
      throw new KernelError(
        'invalid',
        'that document is not bound to a tenancy',
      );
    }

    if (row.promoted_to === row.target) {
      return { tenancyId, target: row.target, value: row.value };
    }

    await db.query("SELECT set_config('dona.promoting', 'on', true)");
    await applyPromotedField(db, {
      tenancyId,
      field,
      value: row.value,
      actor: promotedBy,
      at: deps.clock.now(),
      sourceDocumentId: row.document_id,
      extractedFieldId,
    });
    await db.query(
      `UPDATE extracted_field
          SET promoted_to = $2, promoted_by = $3, promoted_at = $4
        WHERE extracted_field_id = $1`,
      [extractedFieldId, row.target, promotedBy, deps.clock.now()],
    );

    await deps.audit.write(
      {
        actorKind: 'staff',
        actorId: promotedBy,
        action: 'evidence.promote_field',
        subjectId: extractedFieldId,
        inputs: {
          documentId: row.document_id,
          tenancyId,
          target: row.target,
        },
      },
      { outcome: 'ok' },
    );

    return { tenancyId, target: row.target, value: row.value };
  });
}
