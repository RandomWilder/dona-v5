import type { Embedder } from '../../kernel/embeddings.ts';
import { vectorLiteral } from '../../kernel/embeddings.ts';
import { KernelError } from '../../kernel/errors.ts';
import { maskIdentifierRuns } from '../../kernel/identifier.ts';
import type { Queryable } from './types.ts';

/** Who is asking. Required; there is no default. */
export type RetrievalStance = 'administrator' | 'tenant';

export const SEARCH_PASSAGE_LIMIT = 8;

export interface PassageHit {
  documentId: string;
  page: number;
  text: string;
  documentType: string;
  unitId: string | null;
  distance: number;
}

/**
 * Nearest passages to a question, ordered by pgvector distance.
 *
 * Stance is required: the administrator read returns identifiers as printed;
 * the tenant read masks them. The stored row is never rewritten.
 */
export async function searchPassages(
  db: Queryable,
  embedder: Embedder,
  question: string,
  stance: RetrievalStance,
): Promise<PassageHit[]> {
  const [vector] = await embedder.embed([question]);
  if (!vector) {
    throw new KernelError('unavailable', 'the embedder returned no vector');
  }
  const found = await db.query<{
    document_id: string;
    page: number;
    body: string;
    type_key: string;
    unit_id: string | null;
    distance: number;
  }>(
    `SELECT p.document_id,
            p.page,
            p.body,
            dt.type_key,
            COALESCE(unit_link.entity_id, tenancy_unit.unit_id) AS unit_id,
            (p.embedding <=> $1::vector) AS distance
       FROM document_passage p
       JOIN document d ON d.document_id = p.document_id
       JOIN document_type dt ON dt.document_type_id = d.document_type_id
       LEFT JOIN LATERAL (
         SELECT entity_id
           FROM document_link
          WHERE document_id = p.document_id AND entity_type = 'UNIT'
          LIMIT 1
       ) unit_link ON true
       LEFT JOIN LATERAL (
         SELECT t.unit_id
           FROM document_link l
           JOIN tenancy t ON t.tenancy_id = l.entity_id
          WHERE l.document_id = p.document_id AND l.entity_type = 'TENANCY'
          LIMIT 1
       ) tenancy_unit ON true
      ORDER BY p.embedding <=> $1::vector
      LIMIT ${SEARCH_PASSAGE_LIMIT}`,
    [vectorLiteral(vector)],
  );
  return found.rows.map((row) => ({
    documentId: row.document_id,
    page: row.page,
    text: stance === 'tenant' ? maskIdentifierRuns(row.body) : row.body,
    documentType: row.type_key,
    unitId: row.unit_id,
    distance: Number(row.distance),
  }));
}
