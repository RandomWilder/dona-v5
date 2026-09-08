// Slice 4.2. Map OCR/pdfjs words onto the live DocumentTypeField list.
//
// Two engines: the measuring one already ran (pdfjs or Document AI). The language model is
// handed numbered words without boxes and returns field_key + word_ids. Geometry is joined
// here. A bbox in the model reply is ignored.
import type { AuditLog } from '../../kernel/audit.ts';
import type { Clock } from '../../kernel/clock.ts';
import { KernelError } from '../../kernel/errors.ts';
import type { Extractor, JsonSchema } from '../../kernel/extraction.ts';
import { newId } from '../../kernel/ids.ts';
import type { PdfPage } from '../../kernel/pdf.ts';
import { documentTypeFields } from './catalogue.ts';
import { getFiledDocument } from './documents.ts';
import type { Queryable } from './types.ts';

export const EXTRACT_WORK_KIND = 'evidence.extract_document';

export interface MeasuredWord {
  id: number;
  page: number;
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  confidence: number | null;
}

export interface BBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ExtractedRow {
  extractedFieldId: string;
  documentTypeFieldId: string;
  fieldKey: string;
  labelHe: string;
  value: string;
  page: number;
  bbox: BBox;
  confidence: number | null;
  model: string;
  promotionTarget: string | null;
  promotedTo: string | null;
  promotedBy: string | null;
  promotedAt: Date | null;
}

export interface ExtractDeps {
  db: Queryable;
  extractor: Extractor;
  audit: AuditLog;
  clock: Clock;
  model: string;
  reasoningEffort?: string;
}

export interface ExtractReport {
  written: number;
}

export function numberWords(pages: readonly PdfPage[]): MeasuredWord[] {
  const words: MeasuredWord[] = [];
  let id = 0;
  for (const page of pages) {
    for (const item of page.items) {
      if (item.text.trim().length === 0) {
        continue;
      }
      words.push({
        id,
        page: page.number,
        text: item.text,
        x: item.x,
        y: item.y,
        width: item.width,
        height: item.height,
        confidence: item.confidence,
      });
      id += 1;
    }
  }
  return words;
}

export function unionBox(words: readonly MeasuredWord[]): BBox {
  const first = words[0];
  if (!first) {
    throw new KernelError('invalid', 'cannot union an empty word list');
  }
  let minX = first.x;
  let minY = first.y;
  let maxX = first.x + first.width;
  let maxY = first.y + first.height;
  for (const word of words.slice(1)) {
    minX = Math.min(minX, word.x);
    minY = Math.min(minY, word.y);
    maxX = Math.max(maxX, word.x + word.width);
    maxY = Math.max(maxY, word.y + word.height);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function onDate(clock: Clock): string {
  return clock.now().toISOString().slice(0, 10);
}

function findingsSchema(fieldKeys: readonly string[]): JsonSchema {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      findings: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            field_key: { type: 'string', enum: fieldKeys },
            value: { type: 'string' },
            word_ids: { type: 'array', items: { type: 'integer' } },
          },
          required: ['field_key', 'value', 'word_ids'],
        },
      },
    },
    required: ['findings'],
  };
}

function wordsForModel(words: readonly MeasuredWord[]): string {
  return JSON.stringify(
    words.map((word) => ({ id: word.id, page: word.page, text: word.text })),
  );
}

function asFindings(reply: unknown): Array<{
  field_key: string;
  value: string;
  word_ids: number[];
}> {
  if (typeof reply !== 'object' || reply === null) {
    return [];
  }
  const findings = (reply as { findings?: unknown }).findings;
  if (!Array.isArray(findings)) {
    return [];
  }
  const rows: Array<{ field_key: string; value: string; word_ids: number[] }> =
    [];
  for (const entry of findings) {
    if (typeof entry !== 'object' || entry === null) {
      continue;
    }
    const fieldKey = (entry as { field_key?: unknown }).field_key;
    const value = (entry as { value?: unknown }).value;
    const wordIds = (entry as { word_ids?: unknown }).word_ids;
    if (typeof fieldKey !== 'string' || typeof value !== 'string') {
      continue;
    }
    if (!Array.isArray(wordIds)) {
      continue;
    }
    const ids = wordIds.filter((id): id is number => Number.isInteger(id));
    rows.push({ field_key: fieldKey, value, word_ids: ids });
  }
  return rows;
}

export async function extractFiledDocument(
  deps: ExtractDeps,
  input: { documentId: string; words: readonly MeasuredWord[] },
): Promise<ExtractReport> {
  const filed = await getFiledDocument(deps.db, input.documentId);
  const fields = await documentTypeFields(
    deps.db,
    filed.typeKey,
    onDate(deps.clock),
  );
  if (
    fields.length === 0 ||
    input.words.length === 0 ||
    deps.extractor.describe() === 'unconfigured'
  ) {
    return { written: 0 };
  }

  const byId = new Map(input.words.map((word) => [word.id, word]));
  const byKey = new Map(fields.map((field) => [field.fieldKey, field]));
  let reply: unknown;
  try {
    reply = await deps.extractor.extract({
      model: deps.model,
      name: 'document_fields',
      instructions:
        'Fill the declared fields from the numbered words. Return word_ids that support each value. Never invent coordinates.',
      input: JSON.stringify({
        fields: fields.map((field) => ({
          field_key: field.fieldKey,
          label_he: field.labelHe,
          value_type: field.valueType,
          extraction_hint: field.extractionHint,
        })),
        words: JSON.parse(wordsForModel(input.words)) as unknown,
      }),
      schema: findingsSchema(fields.map((field) => field.fieldKey)),
      reasoningEffort: deps.reasoningEffort,
    });
  } catch (error) {
    if (error instanceof KernelError && error.code === 'unavailable') {
      await deps.audit.write(
        {
          actorKind: 'system',
          action: 'evidence.extract_document',
          subjectId: input.documentId,
          inputs: { documentId: input.documentId, typeKey: filed.typeKey },
        },
        { outcome: 'error', code: error.code, message: error.message },
      );
      return { written: 0 };
    }
    throw error;
  }

  await deps.db.query(
    'DELETE FROM extracted_field WHERE document_id = $1 AND promoted_at IS NULL',
    [input.documentId],
  );

  let written = 0;
  for (const finding of asFindings(reply)) {
    const field = byKey.get(finding.field_key);
    if (!field || finding.value.trim().length === 0) {
      continue;
    }
    const selected: MeasuredWord[] = [];
    for (const id of finding.word_ids) {
      const word = byId.get(id);
      if (word && (selected.length === 0 || word.page === selected[0]?.page)) {
        selected.push(word);
      }
    }
    if (selected.length === 0) {
      continue;
    }
    const bbox = unionBox(selected);
    const confidence = selected.some((word) => word.confidence === null)
      ? null
      : Math.min(...selected.map((word) => word.confidence as number));
    await deps.db.query(
      `INSERT INTO extracted_field (
         extracted_field_id, document_id, document_type_field_id, value,
         page, bbox, confidence, model, extracted_at
       ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9)`,
      [
        newId(deps.clock),
        input.documentId,
        field.documentTypeFieldId,
        finding.value,
        selected[0]?.page,
        JSON.stringify(bbox),
        confidence,
        deps.model,
        deps.clock.now(),
      ],
    );
    written += 1;
  }

  await deps.audit.write(
    {
      actorKind: 'system',
      action: 'evidence.extract_document',
      subjectId: input.documentId,
      inputs: {
        documentId: input.documentId,
        typeKey: filed.typeKey,
        written,
      },
    },
    { outcome: 'ok' },
  );
  return { written };
}

export async function listExtractedFields(
  db: Queryable,
  documentId: string,
): Promise<ExtractedRow[]> {
  const result = await db.query<{
    extracted_field_id: string;
    document_type_field_id: string;
    field_key: string;
    label_he: string;
    value: string;
    page: number;
    bbox: BBox;
    confidence: number | null;
    model: string;
    promotion_target: string | null;
    promoted_to: string | null;
    promoted_by: string | null;
    promoted_at: Date | null;
  }>(
    `SELECT e.extracted_field_id, e.document_type_field_id, f.field_key, f.label_he,
            e.value, e.page, e.bbox, e.confidence, e.model,
            p.target AS promotion_target, e.promoted_to, e.promoted_by, e.promoted_at
       FROM extracted_field e
       JOIN document_type_field f
         ON f.document_type_field_id = e.document_type_field_id
       LEFT JOIN field_promotion p
         ON p.document_type_field_id = e.document_type_field_id
      WHERE e.document_id = $1
      ORDER BY f.field_key, e.extracted_field_id`,
    [documentId],
  );
  return result.rows.map((row) => ({
    extractedFieldId: row.extracted_field_id,
    documentTypeFieldId: row.document_type_field_id,
    fieldKey: row.field_key,
    labelHe: row.label_he,
    value: row.value,
    page: row.page,
    bbox: row.bbox,
    confidence: row.confidence,
    model: row.model,
    promotionTarget: row.promotion_target,
    promotedTo: row.promoted_to,
    promotedBy: row.promoted_by,
    promotedAt: row.promoted_at,
  }));
}

export interface PromotedField {
  extractedFieldId: string;
  documentId: string;
  labelHe: string;
  value: string;
  page: number;
  confidence: number | null;
}

/** Stamped values on paper bound to this unit. Slice 4.4. */
export async function listPromotedFieldsForUnit(
  db: Queryable,
  unitId: string,
): Promise<PromotedField[]> {
  const result = await db.query<{
    extracted_field_id: string;
    document_id: string;
    label_he: string;
    value: string;
    page: number;
    confidence: number | null;
  }>(
    `SELECT e.extracted_field_id, e.document_id, f.label_he, e.value, e.page, e.confidence
       FROM extracted_field e
       JOIN document_type_field f
         ON f.document_type_field_id = e.document_type_field_id
      WHERE e.promoted_at IS NOT NULL
        AND e.document_id IN (
          SELECT document_id FROM document_link
           WHERE entity_type = 'UNIT' AND entity_id = $1
          UNION
          SELECT l.document_id FROM document_link l
            JOIN tenancy t ON t.tenancy_id = l.entity_id
           WHERE l.entity_type = 'TENANCY' AND t.unit_id = $1
        )
      ORDER BY f.field_key, e.extracted_field_id`,
    [unitId],
  );
  return result.rows.map((row) => ({
    extractedFieldId: row.extracted_field_id,
    documentId: row.document_id,
    labelHe: row.label_he,
    value: row.value,
    page: row.page,
    confidence: row.confidence,
  }));
}

export function parseMeasuredWords(value: unknown): MeasuredWord[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const words: MeasuredWord[] = [];
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) {
      continue;
    }
    const row = entry as Record<string, unknown>;
    if (
      typeof row.id !== 'number' ||
      typeof row.page !== 'number' ||
      typeof row.text !== 'string' ||
      typeof row.x !== 'number' ||
      typeof row.y !== 'number' ||
      typeof row.width !== 'number' ||
      typeof row.height !== 'number'
    ) {
      continue;
    }
    words.push({
      id: row.id,
      page: row.page,
      text: row.text,
      x: row.x,
      y: row.y,
      width: row.width,
      height: row.height,
      confidence: typeof row.confidence === 'number' ? row.confidence : null,
    });
  }
  return words;
}
