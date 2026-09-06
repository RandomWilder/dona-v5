// What the two screens read. Slice 1.11.
//
// Queries live here rather than in the views for the ordinary reason -- a view that queries is a view
// nothing can test without a database -- and for one specific to this schema: **`unit_count` is
// counted here and stored nowhere** (R6, SPEC-estate.md "What is deliberately not a column"). The
// screen showing a total is the place that rule becomes visible, so the count is a `count(*)` over
// `space` and not a column anyone could drift.
//
// Dates are cast to text in SQL rather than converted in JavaScript. `pg` hands back a `date` as a
// JS Date at local midnight, and a handover date that moves a day when the server changes timezone
// is a bug that only appears in production. `numeric` already arrives as a string, and stays one:
// `3.5` and `4` are what the workbook means, and a float round-trip is how `4` becomes `4.0000001`.
import { KernelError } from '../../kernel/errors.ts';
import type { Queryable } from './plan.ts';

export interface BuildingSummary {
  building_id: string;
  name: string;
  address_line: string;
  city: string;
  status: string;
  handover_date: string;
  warranty_end_date: string;
  project_name: string | null;
  project_code: string | null;
  unit_count: string;
  space_count: string;
}

export interface SpaceKindCount {
  space_kind: string;
  n: string;
}

export interface UnitRow {
  unit_id: string;
  unit_number: string;
  floor: string | null;
  rooms: string;
  area_sqm: string | null;
  has_mamad: boolean;
  condition_status: string;
  warranty_end_date: string | null;
  parking_name: string | null;
  storage_name: string | null;
}

export interface BuildingDetail {
  building: BuildingSummary;
  kinds: SpaceKindCount[];
  units: UnitRow[];
}

const BUILDING_COLUMNS = `
  b.building_id,
  b.name,
  b.address_line,
  b.city,
  b.status,
  b.handover_date::text AS handover_date,
  b.warranty_end_date::text AS warranty_end_date,
  p.name AS project_name,
  p.project_code,
  (SELECT count(*) FROM space s JOIN unit u ON u.unit_id = s.space_id
    WHERE s.building_id = b.building_id) AS unit_count,
  (SELECT count(*) FROM space s WHERE s.building_id = b.building_id) AS space_count`;

export async function listBuildings(db: Queryable): Promise<BuildingSummary[]> {
  const result = await db.query<BuildingSummary>(
    `SELECT ${BUILDING_COLUMNS}
     FROM building b
     LEFT JOIN project p ON p.project_id = b.project_id
     ORDER BY b.city, b.address_line`,
  );
  return result.rows;
}

export async function getBuilding(
  db: Queryable,
  buildingId: string,
): Promise<BuildingDetail> {
  const found = await db.query<BuildingSummary>(
    `SELECT ${BUILDING_COLUMNS}
     FROM building b
     LEFT JOIN project p ON p.project_id = b.project_id
     WHERE b.building_id = $1`,
    [buildingId],
  );
  const building = found.rows[0];
  if (!building) {
    // The SPEC.md shape, and nothing more than the shape: an id that does not exist and an id that
    // exists elsewhere must be indistinguishable from outside.
    throw new KernelError('not_found', 'building not found');
  }

  const kinds = await db.query<SpaceKindCount>(
    `SELECT space_kind, count(*) AS n
     FROM space WHERE building_id = $1
     GROUP BY space_kind
     ORDER BY count(*) DESC, space_kind`,
    [buildingId],
  );

  // Ordered by the number as a number. '10' sorts before '2' as text, which is the one thing a list
  // of 72 apartments must not do; the trailing letter of a split unit ('12A') keeps the tie broken
  // by the text. NULLIF guards a unit number with no digits in it at all -- '' would fail the cast.
  const units = await db.query<UnitRow>(
    `SELECT u.unit_id,
            u.unit_number,
            s.floor,
            u.rooms::text AS rooms,
            u.area_sqm::text AS area_sqm,
            u.has_mamad,
            u.condition_status,
            u.warranty_end_date::text AS warranty_end_date,
            pk.name AS parking_name,
            st.name AS storage_name
     FROM unit u
     JOIN space s ON s.space_id = u.unit_id
     LEFT JOIN space pk ON pk.space_id = u.parking_space_id
     LEFT JOIN space st ON st.space_id = u.storage_space_id
     WHERE s.building_id = $1
     ORDER BY NULLIF(regexp_replace(u.unit_number, '\\D', '', 'g'), '')::int NULLS LAST,
              u.unit_number`,
    [buildingId],
  );

  return { building, kinds: kinds.rows, units: units.rows };
}
