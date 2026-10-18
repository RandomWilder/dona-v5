// As-of search of the Policy library. #254.
//
// The in-force predicate is policy_document_in_force. This file does not
// restate it. Each section is capped on its own, at the same number a lease
// search returns, and section order is the catalogue's — distance never puts
// one section ahead of the other.

import { SEARCH_PASSAGE_LIMIT } from '../../evidence/contract.ts';
import type { Embedder } from '../../kernel/embeddings.ts';
import { vectorLiteral } from '../../kernel/embeddings.ts';
import { KernelError } from '../../kernel/errors.ts';
import type { Queryable } from './types.ts';

/** Same cap passage search uses, once per section. */
export const POLICY_SECTION_CAP = SEARCH_PASSAGE_LIMIT;

export interface PolicyPassageHit {
  passageId: string;
  policyDocumentId: string;
  page: number;
  text: string;
  sectionKey: string;
  sectionLabel: string;
  title: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  distance: number;
}

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function requireDate(value: string): string {
  if (!DATE.test(value)) {
    throw new KernelError('invalid', 'as-of must be a date');
  }
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    throw new KernelError('invalid', 'as-of must be a date');
  }
  return value;
}

/**
 * Passages of versions in force on `asOf`. At most {@link POLICY_SECTION_CAP}
 * from each section. State law before company policy.
 */
export async function searchPolicyPassages(
  db: Queryable,
  embedder: Embedder,
  question: string,
  asOf: string,
): Promise<PolicyPassageHit[]> {
  const on = requireDate(asOf);
  const [vector] = await embedder.embed([question]);
  if (!vector) {
    throw new KernelError('unavailable', 'the embedder returned no vector');
  }
  const found = await db.query<{
    policy_passage_id: string;
    policy_document_id: string;
    page: number;
    body: string;
    section_key: string;
    label_he: string;
    title: string;
    effective_from: string;
    effective_to: string | null;
    distance: number;
  }>(
    `WITH ranked AS (
       SELECT p.policy_passage_id,
              p.policy_document_id,
              p.page,
              p.body,
              s.section_key,
              s.label_he,
              s.sort_order,
              d.title,
              to_char(d.effective_from, 'YYYY-MM-DD') AS effective_from,
              to_char(d.effective_to, 'YYYY-MM-DD') AS effective_to,
              (p.embedding <=> $1::vector) AS distance,
              row_number() OVER (
                PARTITION BY s.policy_section_id
                ORDER BY p.embedding <=> $1::vector, p.policy_passage_id
              ) AS section_rank
         FROM policy_passage p
         JOIN policy_document d ON d.policy_document_id = p.policy_document_id
         JOIN policy_section s ON s.policy_section_id = d.policy_section_id
        WHERE policy_document_in_force(d.effective_from, d.effective_to, $2::date)
     )
     SELECT policy_passage_id, policy_document_id, page, body, section_key,
            label_he, title, effective_from, effective_to, distance
       FROM ranked
      WHERE section_rank <= ${POLICY_SECTION_CAP}
      ORDER BY sort_order, section_rank`,
    [vectorLiteral(vector), on],
  );
  return found.rows.map((row) => ({
    passageId: row.policy_passage_id,
    policyDocumentId: row.policy_document_id,
    page: row.page,
    text: row.body,
    sectionKey: row.section_key,
    sectionLabel: row.label_he,
    title: row.title,
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to,
    distance: row.distance,
  }));
}

/** Passages a draft repeats from the brief. The version is the one that was cited. */
export async function policyPassagesByIds(
  db: Queryable,
  ids: readonly string[],
): Promise<PolicyPassageHit[]> {
  if (ids.length === 0) return [];
  const found = await db.query<{
    policy_passage_id: string;
    policy_document_id: string;
    page: number;
    body: string;
    section_key: string;
    label_he: string;
    title: string;
    effective_from: string;
    effective_to: string | null;
  }>(
    `SELECT p.policy_passage_id, p.policy_document_id, p.page, p.body,
            s.section_key, s.label_he, d.title,
            to_char(d.effective_from, 'YYYY-MM-DD') AS effective_from,
            to_char(d.effective_to, 'YYYY-MM-DD') AS effective_to
       FROM policy_passage p
       JOIN policy_document d ON d.policy_document_id = p.policy_document_id
       JOIN policy_section s ON s.policy_section_id = d.policy_section_id
      WHERE p.policy_passage_id = ANY($1::uuid[])`,
    [ids],
  );
  return found.rows.map((row) => ({
    passageId: row.policy_passage_id,
    policyDocumentId: row.policy_document_id,
    page: row.page,
    text: row.body,
    sectionKey: row.section_key,
    sectionLabel: row.label_he,
    title: row.title,
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to,
    distance: 0,
  }));
}
