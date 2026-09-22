// EstateEvent read for one unit. Issue #141.
//
// Register import and A13 write no rows here; an empty list is a typed original
// that no document has yet moved. Order is at, then id — old → new, actor,
// document, in order.
import type { Queryable } from './plan.ts';

export interface EstateEventRow {
  estate_event_id: string;
  entity_type: string;
  unit_id: string | null;
  building_id: string | null;
  at: string;
  actor: string;
  kind: string;
  field: string;
  old_value: string | null;
  new_value: string;
  source_document_id: string | null;
}

function asIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

export async function listEstateEvents(
  db: Queryable,
  unitId: string,
): Promise<EstateEventRow[]> {
  const result = await db.query<{
    estate_event_id: string;
    entity_type: string;
    unit_id: string | null;
    building_id: string | null;
    at: Date | string;
    actor: string;
    kind: string;
    field: string;
    old_value: string | null;
    new_value: string;
    source_document_id: string | null;
  }>(
    `SELECT estate_event_id, entity_type, unit_id, building_id, at, actor, kind,
            field, old_value, new_value, source_document_id
       FROM estate_event
      WHERE unit_id = $1
      ORDER BY at, estate_event_id`,
    [unitId],
  );
  return result.rows.map((row) => ({
    estate_event_id: row.estate_event_id,
    entity_type: row.entity_type,
    unit_id: row.unit_id,
    building_id: row.building_id,
    at: asIso(row.at),
    actor: row.actor,
    kind: row.kind,
    field: row.field,
    old_value: row.old_value,
    new_value: row.new_value,
    source_document_id: row.source_document_id,
  }));
}
