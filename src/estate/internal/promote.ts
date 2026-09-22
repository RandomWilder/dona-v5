// #141. Copy a promoted value onto an estate column and append estate_event.
//
// Evidence never issues estate SQL. This is the second write under the seam
// applyProtocolSeed already established. A11, A13 and the register importer
// do not call it, so they append nothing.
import { KernelError } from '../../kernel/errors.ts';
import { newId } from '../../kernel/ids.ts';
import { requireText, validId } from '../../kernel/validate.ts';
import type { Queryable } from './plan.ts';

export type PromotedEstateField = 'rooms' | 'floor';
export type EstateEventEntity = 'BUILDING' | 'UNIT';

export interface PromotedEstateFieldSpec {
  entityType: EstateEventEntity;
  unitId?: string;
  buildingId?: string;
  field: PromotedEstateField;
  value: string;
  actor: string;
  at: Date;
  sourceDocumentId: string;
  extractedFieldId: string;
}

const ROOMS = /^\d+(\.\d+)?$/;

function requireRooms(value: string): string {
  if (!ROOMS.test(value)) {
    throw new KernelError('invalid', 'that is not a room count');
  }
  return value;
}

function requireFloor(value: string): string {
  const floor = requireText(value, 'floor', 32);
  return floor;
}

export async function applyPromotedField(
  db: Queryable,
  spec: PromotedEstateFieldSpec,
): Promise<void> {
  if (spec.entityType !== 'UNIT' || spec.unitId === undefined) {
    throw new KernelError('invalid', 'that promotion has no unit to land on');
  }
  const unitId = validId(spec.unitId, 'unit');
  const actor = requireText(spec.actor, 'actor', 200);
  const sourceDocumentId = validId(spec.sourceDocumentId, 'source document');
  const extractedFieldId = validId(spec.extractedFieldId, 'extracted field');

  if (spec.field === 'rooms') {
    const value = requireRooms(spec.value);
    const current = await db.query<{ rooms: string }>(
      `SELECT rooms::text AS rooms FROM unit WHERE unit_id = $1`,
      [unitId],
    );
    const row = current.rows[0];
    if (!row) {
      throw new KernelError('not_found', 'unit not found');
    }
    const oldValue = row.rooms;
    if (oldValue !== value) {
      await db.query(`UPDATE unit SET rooms = $2 WHERE unit_id = $1`, [
        unitId,
        value,
      ]);
    }
    await insertEvent(db, {
      unitId,
      at: spec.at,
      actor,
      field: 'rooms',
      oldValue,
      newValue: value,
      sourceDocumentId,
      extractedFieldId,
    });
    return;
  }

  const value = requireFloor(spec.value);
  const current = await db.query<{ floor: string | null }>(
    `SELECT floor FROM space WHERE space_id = $1`,
    [unitId],
  );
  const row = current.rows[0];
  if (!row) {
    throw new KernelError('not_found', 'space not found');
  }
  const oldValue = row.floor;
  if (oldValue !== value) {
    await db.query(`UPDATE space SET floor = $2 WHERE space_id = $1`, [
      unitId,
      value,
    ]);
  }
  await insertEvent(db, {
    unitId,
    at: spec.at,
    actor,
    field: 'floor',
    oldValue,
    newValue: value,
    sourceDocumentId,
    extractedFieldId,
  });
}

async function insertEvent(
  db: Queryable,
  spec: {
    unitId: string;
    at: Date;
    actor: string;
    field: string;
    oldValue: string | null;
    newValue: string;
    sourceDocumentId: string;
    extractedFieldId: string;
  },
): Promise<void> {
  await db.query(
    `INSERT INTO estate_event (
       estate_event_id, entity_type, building_id, unit_id, at, actor, kind,
       field, old_value, new_value, source_document_id, extracted_field_id
     ) VALUES ($1, 'UNIT', NULL, $2, $3, $4, 'amended', $5, $6, $7, $8, $9)`,
    [
      newId(),
      spec.unitId,
      spec.at,
      spec.actor,
      spec.field,
      spec.oldValue,
      spec.newValue,
      spec.sourceDocumentId,
      spec.extractedFieldId,
    ],
  );
}
