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

// Named rather than inlined, from 2.6: `npm run measure:scale` explains and times **these strings**
// and not a second copy of them typed into a script. A measurement of a query the screen does not
// run is worth nothing, and the way that happens is a copy that drifts.
export const LIST_BUILDINGS_SQL = `
  SELECT ${BUILDING_COLUMNS}
  FROM building b
  LEFT JOIN project p ON p.project_id = b.project_id
  ORDER BY b.city, b.address_line`;

export async function listBuildings(db: Queryable): Promise<BuildingSummary[]> {
  const result = await db.query<BuildingSummary>(LIST_BUILDINGS_SQL);
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

// ------------------------------------------------------------------------------------------------
// Slice 2.6 — the portfolio-scale reads.
// ------------------------------------------------------------------------------------------------

export interface UnitHit {
  unit_id: string;
  unit_number: string;
  building_id: string;
  building_name: string;
  address_line: string;
  city: string;
}

export interface SearchResults {
  buildings: BuildingSummary[];
  units: UnitHit[];
  /** True when either list was cut off by the limit, so the screen can say so rather than lie. */
  truncated: boolean;
}

/** How many rows a search may return before the screen stops being a list and starts being a dump. */
export const SEARCH_LIMIT = 60;

// `%` and `_` are wildcards, and a search term is user input: unescaped, a lone `%` matches the whole
// portfolio and `%%%` scans it three times. Validate at the edge (AGENTS.md) means here, because the
// edge of a LIKE is the pattern and not the parameter — the value is bound safely and still means
// something the user did not type. `\` is the escape and is escaped first, or it would escape the
// escapes.
function likeContains(term: string): string {
  return `%${term.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
}

const SEARCH_BUILDINGS_SQL = `
  SELECT ${BUILDING_COLUMNS}
  FROM building b
  LEFT JOIN project p ON p.project_id = b.project_id
  WHERE b.name ILIKE $1 ESCAPE '\\'
     OR b.address_line ILIKE $1 ESCAPE '\\'
     OR b.city ILIKE $1 ESCAPE '\\'
  ORDER BY b.city, b.address_line
  LIMIT $2`;

const SEARCH_UNITS_SQL = `
  SELECT u.unit_id,
         u.unit_number,
         b.building_id,
         b.name AS building_name,
         b.address_line,
         b.city
  FROM unit u
  JOIN space s ON s.space_id = u.unit_id
  JOIN building b ON b.building_id = s.building_id
  WHERE u.unit_number ILIKE $1 ESCAPE '\\'
     OR b.name ILIKE $1 ESCAPE '\\'
     OR b.address_line ILIKE $1 ESCAPE '\\'
  ORDER BY b.city, b.address_line,
           NULLIF(regexp_replace(u.unit_number, '\\D', '', 'g'), '')::int NULLS LAST,
           u.unit_number
  LIMIT $2`;

/**
 * **Search across the portfolio — buildings and units, and deliberately not people.**
 *
 * `/estate` has no session until week 5 (SPEC-estate.md), so a search that reached `party` would put
 * a real person behind an unauthenticated route the week the register arrives. Addresses and unit
 * numbers are not personal data; a name and a number are, and they are week 5's to expose.
 *
 * **A city matches buildings and not units, deliberately.** A city holds hundreds of apartments and
 * sixty arbitrary ones is a worse answer than the buildings that contain them, which are the way in.
 * A building name or an address matches both, because those narrow to one building.
 */
export async function searchEstate(
  db: Queryable,
  term: string,
): Promise<SearchResults> {
  const pattern = likeContains(term);
  const buildings = await db.query<BuildingSummary>(SEARCH_BUILDINGS_SQL, [
    pattern,
    SEARCH_LIMIT + 1,
  ]);
  const units = await db.query<UnitHit>(SEARCH_UNITS_SQL, [
    pattern,
    SEARCH_LIMIT + 1,
  ]);
  // One row past the limit is how a list learns it was cut off without a second count(*) over the
  // same predicate — the count would be a whole-table read of the thing we just decided not to read.
  const truncated =
    buildings.rows.length > SEARCH_LIMIT || units.rows.length > SEARCH_LIMIT;
  return {
    buildings: buildings.rows.slice(0, SEARCH_LIMIT),
    units: units.rows.slice(0, SEARCH_LIMIT),
    truncated,
  };
}

export interface ExpiringLease {
  tenancy_id: string;
  unit_id: string;
  unit_number: string;
  building_id: string;
  building_name: string;
  city: string;
  end_date: string;
  days_left: number;
}

/** The window Q5 asks about. Sixty days is the workbook's; it is a parameter so a test can move it. */
export const EXPIRING_WINDOW_DAYS = 60;

const EXPIRING_LEASES_SQL = `
  SELECT t.tenancy_id,
         u.unit_id,
         u.unit_number,
         b.building_id,
         b.name AS building_name,
         b.city,
         t.end_date::text AS end_date,
         (t.end_date - $1::date) AS days_left
  FROM tenancy t
  JOIN unit u ON u.unit_id = t.unit_id
  JOIN space s ON s.space_id = u.unit_id
  JOIN building b ON b.building_id = s.building_id
  WHERE t.status = 'ACTIVE'
    AND t.end_date >= $1::date
    AND t.end_date <= $1::date + $2::int
  ORDER BY t.end_date, b.city, b.address_line, u.unit_number`;

/**
 * **Q5 — every lease in the portfolio ending inside the window.** One query, whole estate.
 *
 * This asks **when a lease ends**, which is not the same question as whether a tenancy counts today,
 * and that distinction is why the query lives here rather than in `src/scope/`. The isolation join's
 * tenancy-active predicate decides who may be told what; `end_date` inside a window decides what an
 * operations team does next week. Guard two protects the first and has nothing to say about the
 * second — and the moment this query needed "active on a given day" it would have to ask
 * `src/scope/` for it, which is the guard working rather than a line to walk up to.
 *
 * `today` is a parameter and never `CURRENT_DATE`: SPEC.md's clock rule, and a screen that changes
 * its answer at midnight is not a screen a test can pin.
 */
export async function listExpiringLeases(
  db: Queryable,
  today: Date,
  days: number = EXPIRING_WINDOW_DAYS,
): Promise<ExpiringLease[]> {
  const result = await db.query<ExpiringLease>(EXPIRING_LEASES_SQL, [
    today.toISOString().slice(0, 10),
    days,
  ]);
  return result.rows;
}

/**
 * How many of these units sit in each building.
 *
 * The other half of the occupancy total on the buildings list: `src/scope/` says **which** units are
 * let today, because that is a decision about when a tenancy counts, and this says **where** they
 * are, because that is estate's own structure. Neither module has to learn the other's rule, and the
 * screen costs two queries instead of one per building.
 */
export async function countUnitsByBuilding(
  db: Queryable,
  unitIds: readonly string[],
): Promise<Map<string, number>> {
  if (unitIds.length === 0) return new Map();
  const result = await db.query<{ building_id: string; n: string }>(
    `SELECT s.building_id, count(*)::text AS n
     FROM unit u
     JOIN space s ON s.space_id = u.unit_id
     WHERE u.unit_id = ANY($1)
     GROUP BY s.building_id`,
    [[...unitIds]],
  );
  return new Map(result.rows.map((row) => [row.building_id, Number(row.n)]));
}

/** The strings `npm run measure:scale` explains, so the instrument reads what the screen runs. */
export const MEASURED_QUERIES = {
  'estate · buildings list': LIST_BUILDINGS_SQL,
  'estate · search, buildings': SEARCH_BUILDINGS_SQL,
  'estate · search, units': SEARCH_UNITS_SQL,
  'estate · Q5, leases ending inside the window': EXPIRING_LEASES_SQL,
};
