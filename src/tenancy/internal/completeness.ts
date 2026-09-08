// A4 — incomplete tenancies, derived. Slice 4.8.
//
// Not "who is in a unit today": that remains `src/scope/`. This answers S1 / A4 — which lettings
// are missing an ערב — takes no phone, returns no party, and carries neither isolation predicate.
import { KernelError } from '../../kernel/errors.ts';
import type { Queryable } from './types.ts';

export type CompletenessRule = 'guarantor';

export interface IncompleteTenancy {
  tenancy_id: string;
  unit_id: string;
  unit_number: string;
  building_id: string;
  building_name: string;
  city: string;
  start_date: string;
  end_date: string;
  status: string;
  missing: CompletenessRule;
  expected_document_id: string;
  expected_document_label: string;
}

export interface CompletenessExceptionSpec {
  tenancyId: string;
  rule: CompletenessRule;
  actor: string;
  reason: string;
  at: Date;
}

const INCOMPLETE_SQL = `
SELECT t.tenancy_id,
       t.unit_id,
       u.unit_number,
       b.building_id,
       b.name AS building_name,
       b.city,
       t.start_date::text AS start_date,
       t.end_date::text AS end_date,
       t.status,
       'guarantor'::text AS missing,
       d.document_id AS expected_document_id,
       d.label_he AS expected_document_label
  FROM tenancy t
  JOIN unit u ON u.unit_id = t.unit_id
  JOIN space s ON s.space_id = u.unit_id
  JOIN building b ON b.building_id = s.building_id
  JOIN LATERAL (
    SELECT doc.document_id, dt.label_he
      FROM document_link dl
      JOIN document doc ON doc.document_id = dl.document_id
      JOIN document_type dt ON dt.document_type_id = doc.document_type_id
     WHERE dl.entity_type = 'TENANCY'
       AND dl.entity_id = t.tenancy_id
     ORDER BY (dt.type_key = 'lease') DESC, doc.ingested_at ASC
     LIMIT 1
  ) d ON true
 WHERE t.status IN ('DRAFT', 'ACTIVE')
   AND NOT EXISTS (
     SELECT 1 FROM tenancy_party tp
      WHERE tp.tenancy_id = t.tenancy_id AND tp.role = 'GUARANTOR'
   )
   AND NOT EXISTS (
     SELECT 1 FROM tenancy_completeness_exception e
      WHERE e.tenancy_id = t.tenancy_id AND e.rule = 'guarantor'
   )
 ORDER BY b.city, b.address_line, u.unit_number`;

export async function listIncompleteTenancies(
  db: Queryable,
): Promise<IncompleteTenancy[]> {
  const result = await db.query<IncompleteTenancy>(INCOMPLETE_SQL);
  return result.rows;
}

const FOREIGN_KEY_VIOLATION = '23503';

export async function recordCompletenessException(
  db: Queryable,
  spec: CompletenessExceptionSpec,
): Promise<'recorded' | 'alreadyRecorded'> {
  try {
    const result = await db.query<{ tenancy_id: string }>(
      `INSERT INTO tenancy_completeness_exception
         (tenancy_id, rule, at, actor, reason)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (tenancy_id, rule) DO NOTHING
       RETURNING tenancy_id`,
      [spec.tenancyId, spec.rule, spec.at, spec.actor, spec.reason],
    );
    return result.rows[0] ? 'recorded' : 'alreadyRecorded';
  } catch (error) {
    if ((error as { code?: string }).code === FOREIGN_KEY_VIOLATION) {
      throw new KernelError('not_found', 'tenancy not found');
    }
    throw error;
  }
}
