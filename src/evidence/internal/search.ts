import type { Embedder } from '../../kernel/embeddings.ts';
import { vectorLiteral } from '../../kernel/embeddings.ts';
import { KernelError } from '../../kernel/errors.ts';
import { maskIdentifierRuns } from '../../kernel/identifier.ts';
import type { Queryable } from './types.ts';

/** Who is asking. Required; there is no default. */
export type RetrievalStance = 'administrator' | 'tenant';

/**
 * Which Documents' Passages a search may consider. Required; there is no
 * default and no whole-store search by omission.
 */
export type RetrievalBound =
  | { kind: 'unit'; id: string }
  | { kind: 'building'; id: string }
  | { kind: 'portfolio' };

export const SEARCH_PASSAGE_LIMIT = 8;

export interface PassageHit {
  passageId: string;
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
 *
 * Bound is required: a Unit bound returns only Passages of Documents linked
 * to that Unit; a Building bound is the same command with a wider filter; a
 * portfolio bound is the whole store, named. A Building or portfolio bound
 * asked with tenant stance is refused.
 */
export async function searchPassages(
  db: Queryable,
  embedder: Embedder,
  question: string,
  stance: RetrievalStance,
  bound: RetrievalBound,
): Promise<PassageHit[]> {
  if (bound == null || typeof bound !== 'object' || !('kind' in bound)) {
    throw new KernelError('invalid', 'a retrieval bound is required');
  }
  if (
    bound.kind !== 'unit' &&
    bound.kind !== 'building' &&
    bound.kind !== 'portfolio'
  ) {
    throw new KernelError('invalid', 'a retrieval bound is required');
  }
  if (
    (bound.kind === 'unit' || bound.kind === 'building') &&
    (typeof bound.id !== 'string' || bound.id.length === 0)
  ) {
    throw new KernelError('invalid', 'a retrieval bound is required');
  }
  if (stance === 'tenant' && bound.kind !== 'unit') {
    throw new KernelError(
      'not_allowed',
      'tenant stance cannot search a Building or portfolio bound',
    );
  }
  const [vector] = await embedder.embed([question]);
  if (!vector) {
    throw new KernelError('unavailable', 'the embedder returned no vector');
  }
  const boundId = bound.kind === 'portfolio' ? null : bound.id;
  const found = await db.query<{
    document_passage_id: string;
    document_id: string;
    page: number;
    body: string;
    type_key: string;
    unit_id: string | null;
    distance: number;
  }>(
    `SELECT p.document_passage_id,
            p.document_id,
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
      WHERE $2::text = 'portfolio'
         OR (
              $2::text = 'unit'
          AND (
                EXISTS (
                  SELECT 1
                    FROM document_link unit_bound
                   WHERE unit_bound.document_id = p.document_id
                     AND unit_bound.entity_type = 'UNIT'
                     AND unit_bound.entity_id = $3::uuid
                )
             OR EXISTS (
                  SELECT 1
                    FROM document_link tenancy_bound
                    JOIN tenancy bound_tenancy
                      ON bound_tenancy.tenancy_id = tenancy_bound.entity_id
                   WHERE tenancy_bound.document_id = p.document_id
                     AND tenancy_bound.entity_type = 'TENANCY'
                     AND bound_tenancy.unit_id = $3::uuid
                )
              )
            )
         OR (
              $2::text = 'building'
          AND (
                EXISTS (
                  SELECT 1
                    FROM document_link building_link
                   WHERE building_link.document_id = p.document_id
                     AND building_link.entity_type = 'BUILDING'
                     AND building_link.entity_id = $3::uuid
                )
             OR EXISTS (
                  SELECT 1
                    FROM document_link unit_in_building
                    JOIN space unit_space
                      ON unit_space.space_id = unit_in_building.entity_id
                   WHERE unit_in_building.document_id = p.document_id
                     AND unit_in_building.entity_type = 'UNIT'
                     AND unit_space.building_id = $3::uuid
                )
             OR EXISTS (
                  SELECT 1
                    FROM document_link tenancy_in_building
                    JOIN tenancy bound_tenancy
                      ON bound_tenancy.tenancy_id = tenancy_in_building.entity_id
                    JOIN space tenancy_space
                      ON tenancy_space.space_id = bound_tenancy.unit_id
                   WHERE tenancy_in_building.document_id = p.document_id
                     AND tenancy_in_building.entity_type = 'TENANCY'
                     AND tenancy_space.building_id = $3::uuid
                )
              )
            )
      ORDER BY p.embedding <=> $1::vector
      LIMIT ${SEARCH_PASSAGE_LIMIT}`,
    [vectorLiteral(vector), bound.kind, boundId],
  );
  return found.rows.map((row) => ({
    passageId: row.document_passage_id,
    documentId: row.document_id,
    page: row.page,
    text: stance === 'tenant' ? maskIdentifierRuns(row.body) : row.body,
    documentType: row.type_key,
    unitId: row.unit_id,
    distance: Number(row.distance),
  }));
}
