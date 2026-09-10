// TenancyEvent read for one unit. Slice 5.5.
//
// Same standing as `listUnitTenancies`: a unit_id in, dates and an actor and a document out, no
// party and no phone. Who is in the unit today is still `src/scope/`. Register import writes no
// rows here; an empty list is a register-only letting, not a missing screen.
import type { Queryable } from './types.ts';

export interface TenancyEventRow {
  tenancy_event_id: string;
  tenancy_id: string;
  at: string;
  actor: string;
  kind: string;
  field: string;
  old_value: string | null;
  new_value: string;
  source_document_id: string;
}

function asIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

/**
 * Every amendment on every letting of this unit, oldest first.
 *
 * Order is `at`, then id — the verify bar is old → new, actor, document, in order. A second
 * letting on the same flat is still this unit's log.
 */
export async function listTenancyEvents(
  db: Queryable,
  unitId: string,
): Promise<TenancyEventRow[]> {
  const result = await db.query<{
    tenancy_event_id: string;
    tenancy_id: string;
    at: Date | string;
    actor: string;
    kind: string;
    field: string;
    old_value: string | null;
    new_value: string;
    source_document_id: string;
  }>(
    `SELECT e.tenancy_event_id,
            e.tenancy_id,
            e.at,
            e.actor,
            e.kind,
            e.field,
            e.old_value,
            e.new_value,
            e.source_document_id
       FROM tenancy_event e
       JOIN tenancy t ON t.tenancy_id = e.tenancy_id
      WHERE t.unit_id = $1
      ORDER BY e.at, e.tenancy_event_id`,
    [unitId],
  );
  return result.rows.map((row) => ({
    tenancy_event_id: row.tenancy_event_id,
    tenancy_id: row.tenancy_id,
    at: asIso(row.at),
    actor: row.actor,
    kind: row.kind,
    field: row.field,
    old_value: row.old_value,
    new_value: row.new_value,
    source_document_id: row.source_document_id,
  }));
}
