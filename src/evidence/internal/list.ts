// What is filed, for a place. Slice 3.6.
//
// Two reads. `listLinkedDocuments` is the panel: the documents bound to one entity, distinct so a
// lease linked to the unit *and* the tenancy is one row. `searchDocuments` is the documents half of
// `/estate/search` — same LIMIT, same LIKE-escape, never a fork of that screen.
import { SEARCH_LIMIT as ESTATE_SEARCH_LIMIT } from '../../estate/contract.ts';
import { type ObjectStore, SIGN_READ_TTL_MS } from '../../kernel/objects.ts';
import type { FiledVerdict, LinkEntityType } from './documents.ts';
import { parseStorageUri } from './storage-path.ts';
import type { Queryable } from './types.ts';

/** Same cap estate's search carries. A second search that forgets it is the 2.6 defect. */
export const SEARCH_LIMIT = ESTATE_SEARCH_LIMIT;

export interface LinkedDocument {
  documentId: string;
  typeKey: string;
  labelHe: string;
  ingestedAt: string;
  validFrom: string | null;
  validTo: string | null;
  storageUri: string;
  verificationVerdict: FiledVerdict;
}

export interface DocumentHit extends LinkedDocument {
  entityType: 'UNIT' | 'BUILDING';
  entityId: string;
  unitId: string | null;
  unitNumber: string | null;
  buildingId: string | null;
  buildingName: string | null;
}

export interface DocumentSearchResults {
  documents: DocumentHit[];
  truncated: boolean;
}

const LISTED_COLUMNS = `
  d.document_id,
  dt.type_key,
  dt.label_he,
  (d.ingested_at AT TIME ZONE 'UTC')::date::text AS ingested_at,
  d.valid_from::text,
  d.valid_to::text,
  d.storage_uri,
  d.verification_verdict`;

const LIST_SQL = `
  SELECT ${LISTED_COLUMNS}
    FROM document d
    JOIN document_type dt ON dt.document_type_id = d.document_type_id
   WHERE d.document_id IN (
     SELECT document_id
       FROM document_link
      WHERE entity_type = $1 AND entity_id = $2
   )
   ORDER BY dt.label_he, d.ingested_at DESC`;

export async function listLinkedDocuments(
  db: Queryable,
  entityType: LinkEntityType,
  entityId: string,
): Promise<LinkedDocument[]> {
  const result = await db.query<{
    document_id: string;
    type_key: string;
    label_he: string;
    ingested_at: string;
    valid_from: string | null;
    valid_to: string | null;
    storage_uri: string;
    verification_verdict: FiledVerdict;
  }>(LIST_SQL, [entityType, entityId]);
  return result.rows.map(toLinked);
}

// `%` and `_` are wildcards, and a search term is user input: unescaped, a lone `%` matches every
// filed document. Validate at the edge (AGENTS.md) means here, because the edge of a LIKE is the
// pattern and not the parameter. Copied in shape from estate's search — a second copy that drifted
// would be the defect 2.6 wrote a test for, which this module's suite repeats.
function likeContains(term: string): string {
  return `%${term.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
}

export const SEARCH_DOCUMENTS_SQL = `
  SELECT * FROM (
    SELECT DISTINCT ON (d.document_id)
           ${LISTED_COLUMNS},
           l.entity_type,
           l.entity_id,
           u.unit_id,
           u.unit_number,
           COALESCE(unit_building.building_id, place_building.building_id) AS building_id,
           COALESCE(unit_building.name, place_building.name) AS building_name
      FROM document d
      JOIN document_type dt ON dt.document_type_id = d.document_type_id
      JOIN document_link l
        ON l.document_id = d.document_id
       AND l.entity_type IN ('UNIT', 'BUILDING')
      LEFT JOIN unit u
        ON l.entity_type = 'UNIT' AND u.unit_id = l.entity_id
      LEFT JOIN space s ON s.space_id = u.unit_id
      LEFT JOIN building unit_building ON unit_building.building_id = s.building_id
      LEFT JOIN building place_building
        ON l.entity_type = 'BUILDING' AND place_building.building_id = l.entity_id
     WHERE dt.label_he ILIKE $1 ESCAPE '\\'
        OR dt.label_en ILIKE $1 ESCAPE '\\'
        OR u.unit_number ILIKE $1 ESCAPE '\\'
        OR unit_building.name ILIKE $1 ESCAPE '\\'
        OR unit_building.address_line ILIKE $1 ESCAPE '\\'
        OR place_building.name ILIKE $1 ESCAPE '\\'
        OR place_building.address_line ILIKE $1 ESCAPE '\\'
     ORDER BY d.document_id,
              CASE l.entity_type WHEN 'UNIT' THEN 0 ELSE 1 END
  ) hits
  ORDER BY label_he, ingested_at DESC
  LIMIT $2`;

export async function searchDocuments(
  db: Queryable,
  term: string,
): Promise<DocumentSearchResults> {
  const result = await db.query<{
    document_id: string;
    type_key: string;
    label_he: string;
    ingested_at: string;
    valid_from: string | null;
    valid_to: string | null;
    storage_uri: string;
    verification_verdict: FiledVerdict;
    entity_type: 'UNIT' | 'BUILDING';
    entity_id: string;
    unit_id: string | null;
    unit_number: string | null;
    building_id: string | null;
    building_name: string | null;
  }>(SEARCH_DOCUMENTS_SQL, [likeContains(term), SEARCH_LIMIT + 1]);
  return {
    documents: result.rows.slice(0, SEARCH_LIMIT).map((row) => ({
      ...toLinked(row),
      entityType: row.entity_type,
      entityId: row.entity_id,
      unitId: row.unit_id,
      unitNumber: row.unit_number,
      buildingId: row.building_id,
      buildingName: row.building_name,
    })),
    truncated: result.rows.length > SEARCH_LIMIT,
  };
}

export const MEASURED_QUERIES = {
  'evidence · search, documents': SEARCH_DOCUMENTS_SQL,
  'evidence · list, linked documents': LIST_SQL,
};

function toLinked(row: {
  document_id: string;
  type_key: string;
  label_he: string;
  ingested_at: string;
  valid_from: string | null;
  valid_to: string | null;
  storage_uri: string;
  verification_verdict: FiledVerdict;
}): LinkedDocument {
  return {
    documentId: row.document_id,
    typeKey: row.type_key,
    labelHe: row.label_he,
    ingestedAt: row.ingested_at,
    validFrom: row.valid_from,
    validTo: row.valid_to,
    storageUri: row.storage_uri,
    verificationVerdict: row.verification_verdict,
  };
}

export interface LinkedDocumentRead extends LinkedDocument {
  readUrl: string;
}

/**
 * Slice 5.4. The panel's signed reads, minted here so estate never parses a `gs://` uri.
 * A uri that names another bucket is skipped rather than taking the whole page down.
 */
export async function signLinkedDocuments(
  docs: readonly LinkedDocument[],
  store: ObjectStore,
  bucket: string,
  now: Date,
): Promise<LinkedDocumentRead[]> {
  const expiresAt = new Date(now.getTime() + SIGN_READ_TTL_MS);
  return Promise.all(
    docs.map(async (doc) => {
      try {
        const { path } = parseStorageUri(doc.storageUri, bucket);
        return {
          ...doc,
          readUrl: await store.signRead(path, expiresAt, now),
        };
      } catch {
        return { ...doc, readUrl: '' };
      }
    }),
  );
}
