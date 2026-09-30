// Why an approved lease value is not on the letting. #175.
//
// Computed on read from current state. Nothing is stored: adding the missing bay, approving the
// other rent half, or carrying the value changes the sentence on the next page without a rewrite.
// The order matches promotion — the other rent half, then a different value already held, then a
// bay or storage number that is not a Space in the Building — so the sentence and the refusal
// name the same fact.
import { KernelError } from '../../kernel/errors.ts';
import { type Html, h } from '../../kernel/ui/html.ts';
import { acceptedFirstNumber } from './inventory.ts';
import type { Queryable } from './plan.ts';

export type UncarriedReason =
  | { kind: 'rent-half' }
  | { kind: 'held'; held: string }
  | {
      kind: 'missing-space';
      number: string;
      buildingId: string;
      buildingName: string;
      space: 'PARKING' | 'STORAGE';
    };

export interface UncarriedField {
  extractedFieldId: string;
  documentId: string;
  fieldKey: string;
  labelHe: string;
  value: string;
  page: number;
  target: string;
  reason: UncarriedReason | null;
}

const SHOWN = [
  'tenancy.rent_amount',
  'tenancy.rent_currency',
  'tenancy.option_end_date',
  'tenancy.parking_space_id',
  'tenancy.storage_space_id',
  'unit.rooms',
  'space.floor',
] as const;

// The same pair promote.ts refuses as one price. Estate does not import that module.
const RENT_SIBLING: Record<string, { fieldKey: string; target: string }> = {
  'tenancy.rent_amount': {
    fieldKey: 'rent_currency',
    target: 'tenancy.rent_currency',
  },
  'tenancy.rent_currency': {
    fieldKey: 'rent_amount',
    target: 'tenancy.rent_amount',
  },
};

const ltr = (value: string): Html => h`<span dir="ltr">${value}</span>`;

function missingSpaceHref(reason: {
  number: string;
  buildingId: string;
  space: 'PARKING' | 'STORAGE';
}): Html {
  const section = h`/estate/inventory/${reason.buildingId}#more-spaces`;
  const first = acceptedFirstNumber(reason.number);
  if (first === null) return section;
  if (reason.space === 'PARKING') {
    return h`/estate/inventory/${reason.buildingId}?parking_count=1&parking_first=${first}#more-spaces`;
  }
  return h`/estate/inventory/${reason.buildingId}?storage_count=1&storage_first=${first}#more-spaces`;
}

/**
 * The one-sentence reason, for the letting page, the ledger and the reading step.
 * `mayAdd` is `estate.write`: only then is a missing bay or store a link to later-add.
 */
export function renderUncarriedReason(
  reason: UncarriedReason,
  mayAdd = false,
): Html {
  if (reason.kind === 'rent-half') {
    return h`החצי השני של דמי השכירות טרם אושר.`;
  }
  if (reason.kind === 'held') {
    return h`העמודה כבר נושאת ${ltr(reason.held)}.`;
  }
  const noun = reason.space === 'PARKING' ? 'חניה' : 'מחסן';
  const verb = reason.space === 'PARKING' ? 'אינה' : 'אינו';
  const sentence = h`${ltr(reason.number)} ${verb} ${noun} ב${reason.buildingName}.`;
  if (!mayAdd) return sentence;
  return h`<a href="${missingSpaceHref(reason)}">${sentence}</a>`;
}

interface RawRow {
  extractedFieldId: string;
  documentId: string;
  fieldKey: string;
  labelHe: string;
  value: string;
  page: number;
  target: string;
}

interface Place {
  rentAmount: string | null;
  rentCurrency: string | null;
  optionEndDate: string | null;
  parkingName: string | null;
  storageName: string | null;
  rooms: string | null;
  floor: string | null;
  buildingName: string;
  buildingId: string;
  spaces: { kind: string; name: string }[];
}

interface Sibling {
  value: string | null;
  approved: boolean;
  target: string | null;
}

const ROWS_SQL = `
  SELECT e.extracted_field_id AS "extractedFieldId",
         e.document_id AS "documentId",
         f.field_key AS "fieldKey",
         f.label_he AS "labelHe",
         e.approved_value AS value,
         e.page,
         p.target
    FROM extracted_field e
    JOIN document_type_field f
      ON f.document_type_field_id = e.document_type_field_id
    JOIN field_promotion p
      ON p.document_type_field_id = e.document_type_field_id
   WHERE e.approved_at IS NOT NULL
     AND e.approved_value IS NOT NULL
     AND e.promoted_to IS NULL
     AND p.target = ANY($2::text[])
     AND e.document_id = ANY($1::uuid[])
   ORDER BY f.field_key, e.extracted_field_id`;

async function documentIds(
  db: Queryable,
  scope: { tenancyId: string } | { documentId: string },
): Promise<string[]> {
  if ('documentId' in scope) return [scope.documentId];
  const linked = await db.query<{ document_id: string }>(
    `SELECT document_id FROM document_link
      WHERE entity_type = 'TENANCY' AND entity_id = $1`,
    [scope.tenancyId],
  );
  return linked.rows.map((row) => row.document_id);
}

async function placeForTenancy(
  db: Queryable,
  tenancyId: string,
): Promise<Place | null> {
  const found = await db.query<{
    rentAmount: string | null;
    rentCurrency: string | null;
    optionEndDate: string | null;
    parkingName: string | null;
    storageName: string | null;
    rooms: string | null;
    floor: string | null;
    buildingName: string;
    buildingId: string;
  }>(
    `SELECT t.rent_amount::text AS "rentAmount",
            t.rent_currency AS "rentCurrency",
            t.option_end_date::text AS "optionEndDate",
            park.name AS "parkingName",
            store.name AS "storageName",
            u.rooms::text AS rooms,
            unit_space.floor,
            b.name AS "buildingName",
            b.building_id AS "buildingId"
       FROM tenancy t
       JOIN space unit_space ON unit_space.space_id = t.unit_id
       JOIN unit u ON u.unit_id = t.unit_id
       JOIN building b ON b.building_id = unit_space.building_id
       LEFT JOIN space park ON park.space_id = t.parking_space_id
       LEFT JOIN space store ON store.space_id = t.storage_space_id
      WHERE t.tenancy_id = $1`,
    [tenancyId],
  );
  const row = found.rows[0];
  if (!row) return null;
  return { ...row, spaces: await spacesIn(db, row.buildingId) };
}

async function placeForUnit(
  db: Queryable,
  unitId: string,
): Promise<Place | null> {
  const found = await db.query<{
    rooms: string | null;
    floor: string | null;
    buildingName: string;
    buildingId: string;
  }>(
    `SELECT u.rooms::text AS rooms,
            s.floor,
            b.name AS "buildingName",
            b.building_id AS "buildingId"
       FROM unit u
       JOIN space s ON s.space_id = u.unit_id
       JOIN building b ON b.building_id = s.building_id
      WHERE u.unit_id = $1`,
    [unitId],
  );
  const row = found.rows[0];
  if (!row) return null;
  return {
    rentAmount: null,
    rentCurrency: null,
    optionEndDate: null,
    parkingName: null,
    storageName: null,
    rooms: row.rooms,
    floor: row.floor,
    buildingName: row.buildingName,
    buildingId: row.buildingId,
    spaces: await spacesIn(db, row.buildingId),
  };
}

async function spacesIn(
  db: Queryable,
  buildingId: string,
): Promise<{ kind: string; name: string }[]> {
  const found = await db.query<{ kind: string; name: string }>(
    `SELECT space_kind AS kind, name
       FROM space
      WHERE building_id = $1 AND space_kind IN ('PARKING', 'STORAGE')`,
    [buildingId],
  );
  return found.rows;
}

async function placeFor(
  db: Queryable,
  scope: { tenancyId: string } | { documentId: string },
): Promise<Place | null> {
  if ('tenancyId' in scope) return placeForTenancy(db, scope.tenancyId);
  const links = await db.query<{ entity_type: string; entity_id: string }>(
    `SELECT entity_type, entity_id FROM document_link
      WHERE document_id = $1 AND entity_type IN ('TENANCY', 'UNIT')`,
    [scope.documentId],
  );
  const tenancy = links.rows.find((row) => row.entity_type === 'TENANCY');
  if (tenancy) return placeForTenancy(db, tenancy.entity_id);
  const unit = links.rows.find((row) => row.entity_type === 'UNIT');
  if (!unit) return null;
  return placeForUnit(db, unit.entity_id);
}

async function siblings(
  db: Queryable,
  documentIds: readonly string[],
): Promise<Map<string, Sibling>> {
  const found = await db.query<{
    documentId: string;
    fieldKey: string;
    value: string | null;
    approvedAt: Date | null;
    target: string | null;
  }>(
    `SELECT e.document_id AS "documentId",
            f.field_key AS "fieldKey",
            e.approved_value AS value,
            e.approved_at AS "approvedAt",
            p.target
       FROM extracted_field e
       JOIN document_type_field f
         ON f.document_type_field_id = e.document_type_field_id
       LEFT JOIN field_promotion p
         ON p.document_type_field_id = e.document_type_field_id
      WHERE e.document_id = ANY($1::uuid[])
        AND f.field_key IN ('rent_amount', 'rent_currency')
      ORDER BY e.extracted_at DESC, e.extracted_field_id`,
    [documentIds],
  );
  const out = new Map<string, Sibling>();
  for (const row of found.rows) {
    const key = `${row.documentId}:${row.fieldKey}`;
    if (out.has(key)) continue;
    out.set(key, {
      value: row.value,
      approved: row.approvedAt !== null,
      target: row.target,
    });
  }
  return out;
}

function heldValue(target: string, place: Place): string | null {
  if (target === 'tenancy.rent_amount') return place.rentAmount;
  if (target === 'tenancy.rent_currency') return place.rentCurrency;
  if (target === 'tenancy.option_end_date') return place.optionEndDate;
  if (target === 'tenancy.parking_space_id') return place.parkingName;
  if (target === 'tenancy.storage_space_id') return place.storageName;
  if (target === 'unit.rooms') return place.rooms;
  if (target === 'space.floor') return place.floor;
  return null;
}

function sameValue(target: string, held: string, incoming: string): boolean {
  if (target === 'unit.rooms') return Number(held) === Number(incoming);
  return held === incoming;
}

function decide(
  row: RawRow,
  place: Place,
  sibling: Sibling | undefined,
): { show: boolean; reason: UncarriedReason | null } {
  const pair = RENT_SIBLING[row.target];
  if (pair) {
    if (
      !sibling?.approved ||
      sibling.value === null ||
      sibling.target !== pair.target
    ) {
      return { show: true, reason: { kind: 'rent-half' } };
    }
  }
  const held = heldValue(row.target, place);
  if (held !== null && sameValue(row.target, held, row.value)) {
    return { show: false, reason: null };
  }
  if (held !== null) {
    return { show: true, reason: { kind: 'held', held } };
  }
  if (
    row.target === 'tenancy.parking_space_id' ||
    row.target === 'tenancy.storage_space_id'
  ) {
    const space =
      row.target === 'tenancy.parking_space_id' ? 'PARKING' : 'STORAGE';
    const found = place.spaces.some(
      (candidate) => candidate.kind === space && candidate.name === row.value,
    );
    if (!found) {
      return {
        show: true,
        reason: {
          kind: 'missing-space',
          number: row.value,
          buildingId: place.buildingId,
          buildingName: place.buildingName,
          space,
        },
      };
    }
  }
  return { show: true, reason: null };
}

async function uncarried(
  db: Queryable,
  scope: { tenancyId: string } | { documentId: string },
): Promise<UncarriedField[]> {
  const ids = await documentIds(db, scope);
  if (ids.length === 0) return [];
  const place = await placeFor(db, scope);
  if (!place) {
    if ('tenancyId' in scope) {
      throw new KernelError('not_found', 'tenancy not found');
    }
    return [];
  }
  const listed = await db.query<RawRow>(ROWS_SQL, [ids, SHOWN]);
  const other = await siblings(db, ids);
  const out: UncarriedField[] = [];
  for (const row of listed.rows) {
    const pair = RENT_SIBLING[row.target];
    const sibling = pair
      ? other.get(`${row.documentId}:${pair.fieldKey}`)
      : undefined;
    const decision = decide(row, place, sibling);
    if (!decision.show) continue;
    out.push({ ...row, page: Number(row.page), reason: decision.reason });
  }
  return out;
}

/** Approved mapped rows on this letting that are not on their column or Unit. */
export function uncarriedOnTenancy(
  db: Queryable,
  tenancyId: string,
): Promise<UncarriedField[]> {
  return uncarried(db, { tenancyId });
}

/** The same rows for one document, including before a letting exists. */
export function uncarriedOnDocument(
  db: Queryable,
  documentId: string,
): Promise<UncarriedField[]> {
  return uncarried(db, { documentId });
}
