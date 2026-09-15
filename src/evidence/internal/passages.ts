import type { Embedder } from '../../kernel/embeddings.ts';
import { vectorLiteral } from '../../kernel/embeddings.ts';
import { KernelError } from '../../kernel/errors.ts';
import { newId } from '../../kernel/ids.ts';
import type { PdfPage } from '../../kernel/pdf.ts';
import type { Queryable } from './types.ts';
import { pageText } from './verify.ts';

export interface DocumentPassage {
  documentId: string;
  page: number;
  ordinal: number;
  body: string;
}

export function embedderConfigured(
  embedder: Embedder | undefined,
): embedder is Embedder {
  return embedder != null && embedder.describe() !== 'unconfigured';
}

export async function listDocumentPassages(
  db: Queryable,
  documentId: string,
): Promise<DocumentPassage[]> {
  const result = await db.query<{
    document_id: string;
    page: number;
    ordinal: number;
    body: string;
  }>(
    `SELECT document_id, page, ordinal, body
       FROM document_passage
      WHERE document_id = $1
      ORDER BY ordinal`,
    [documentId],
  );
  return result.rows.map((row) => ({
    documentId: row.document_id,
    page: row.page,
    ordinal: row.ordinal,
    body: row.body,
  }));
}

/**
 * Persist one passage per page of a reading that has already happened.
 *
 * Idempotent on a document that already has passages (a second filing of the
 * same bytes, or a caller that already wrote). Does not re-read bytes.
 */
export async function writeDocumentPassages(
  db: Queryable,
  documentId: string,
  pages: readonly PdfPage[],
  embedder: Embedder,
): Promise<void> {
  if (pages.length === 0) {
    return;
  }
  const existing = await listDocumentPassages(db, documentId);
  if (existing.length > 0) {
    return;
  }
  const bodies = pages.map((page) => pageText(page));
  const vectors = await embedder.embed(bodies);
  for (const [ordinal, page] of pages.entries()) {
    const body = bodies[ordinal] ?? '';
    const vector = vectors[ordinal];
    if (!vector) {
      throw new KernelError('unavailable', 'the embedder returned no vector');
    }
    await db.query(
      `INSERT INTO document_passage (
         document_passage_id, document_id, page, ordinal, body, embedding
       ) VALUES ($1, $2, $3, $4, $5, $6::vector)`,
      [newId(), documentId, page.number, ordinal, body, vectorLiteral(vector)],
    );
  }
}
