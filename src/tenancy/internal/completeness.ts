// A4 — incomplete tenancies, derived. Slice 4.8. Gate misses join the same
// query at #108: the rule ids are the activation gate's, never a second copy.
import type { Clock } from '../../kernel/clock.ts';
import { KernelError } from '../../kernel/errors.ts';
import {
  type ActivationCheck,
  activationGate,
  type TenancyDocumentsReader,
} from './activation.ts';
import type { Queryable } from './types.ts';

export type CompletenessRule = 'guarantor' | ActivationCheck['rule'];

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

type QueuePlace = Omit<IncompleteTenancy, 'missing'>;

const PLACE_SQL = `
SELECT t.tenancy_id,
       t.unit_id,
       u.unit_number,
       b.building_id,
       b.name AS building_name,
       b.city,
       t.start_date::text AS start_date,
       t.end_date::text AS end_date,
       t.status,
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
 WHERE t.status IN ('DRAFT', 'ACTIVE')`;

const GUARANTOR_SQL = `${PLACE_SQL}
   AND NOT EXISTS (
     SELECT 1 FROM tenancy_party tp
      WHERE tp.tenancy_id = t.tenancy_id AND tp.role = 'GUARANTOR'
   )
   AND NOT EXISTS (
     SELECT 1 FROM tenancy_completeness_exception e
      WHERE e.tenancy_id = t.tenancy_id AND e.rule = 'guarantor'
   )`;

function byPlaceThenRule(a: IncompleteTenancy, b: IncompleteTenancy): number {
  return (
    a.city.localeCompare(b.city, 'he') ||
    a.building_name.localeCompare(b.building_name, 'he') ||
    a.unit_number.localeCompare(b.unit_number, 'he') ||
    a.missing.localeCompare(b.missing)
  );
}

export async function listIncompleteTenancies(
  db: Queryable,
  clock: Clock,
  documents: TenancyDocumentsReader,
): Promise<IncompleteTenancy[]> {
  const guarantor = await db.query<QueuePlace>(GUARANTOR_SQL);
  const places = await db.query<QueuePlace>(PLACE_SQL);
  const rows: IncompleteTenancy[] = [
    ...guarantor.rows.map((row) => ({ ...row, missing: 'guarantor' as const })),
  ];
  for (const place of places.rows) {
    const gate = await activationGate(db, clock, place.tenancy_id, documents);
    for (const check of gate.checks) {
      if (check.passed) continue;
      rows.push({ ...place, missing: check.rule });
    }
  }
  return rows.sort(byPlaceThenRule);
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
