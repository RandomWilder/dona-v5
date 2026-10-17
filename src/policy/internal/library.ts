// Upload one Policy document and list the library. #250.
//
// The bytes are read by evidence's reader and chunked by evidence's page
// chunker, then embedded here. The passages are this module's rows: evidence's
// passage table is tenant paper.

import {
  documentContentTypes,
  documentFileHash,
  documentStorageUri,
  documentText,
  pageText,
  readForVerdict,
  sniffExtension,
} from '../../evidence/contract.ts';
import type { AuditLog } from '../../kernel/audit.ts';
import type { Clock } from '../../kernel/clock.ts';
import type { Embedder } from '../../kernel/embeddings.ts';
import { vectorLiteral } from '../../kernel/embeddings.ts';
import { KernelError } from '../../kernel/errors.ts';
import { newId } from '../../kernel/ids.ts';
import type { ObjectStore } from '../../kernel/objects.ts';
import type { OcrText } from '../../kernel/ocr.ts';
import type { PdfPage, PdfText } from '../../kernel/pdf.ts';
import { requireText, validId } from '../../kernel/validate.ts';
import type { Queryable } from './types.ts';

const TITLE_MAX = 80;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export interface LibraryDeps {
  db: Queryable;
  objects: ObjectStore;
  pdf: PdfText;
  embedder: Embedder;
  audit: AuditLog;
  clock: Clock;
  bucket: string;
  ocr?: OcrText;
  ocrVersion?: string;
}

export interface UploadPolicyDocumentSpec {
  sectionKey: string;
  title: string;
  effectiveFrom: string;
  bytes: Buffer;
  uploadedBy: string;
}

export interface PolicyPassageView {
  page: number;
  ordinal: number;
  body: string;
  sectionKey: string;
}

export interface PolicyDocumentView {
  policyDocumentId: string;
  title: string;
  effectiveFrom: string;
  passages: PolicyPassageView[];
}

export interface PolicySectionView {
  sectionKey: string;
  labelHe: string;
  documents: PolicyDocumentView[];
}

export async function listPolicyLibrary(
  db: Queryable,
): Promise<PolicySectionView[]> {
  const result = await db.query<{
    section_key: string;
    label_he: string;
    policy_document_id: string | null;
    title: string | null;
    effective_from: string | null;
    page: number | null;
    ordinal: number | null;
    body: string | null;
    passage_section_key: string | null;
  }>(
    `SELECT s.section_key, s.label_he,
            d.policy_document_id, d.title,
            to_char(d.effective_from, 'YYYY-MM-DD') AS effective_from,
            p.page, p.ordinal, p.body,
            ps.section_key AS passage_section_key
       FROM policy_section s
       LEFT JOIN policy_document d
         ON d.policy_section_id = s.policy_section_id
       LEFT JOIN policy_passage p
         ON p.policy_document_id = d.policy_document_id
       LEFT JOIN policy_section ps
         ON ps.policy_section_id = p.policy_section_id
      ORDER BY s.sort_order, d.effective_from, d.title, d.policy_document_id, p.ordinal`,
  );
  const sections: PolicySectionView[] = [];
  for (const row of result.rows) {
    let section = sections.find((item) => item.sectionKey === row.section_key);
    if (!section) {
      section = {
        sectionKey: row.section_key,
        labelHe: row.label_he,
        documents: [],
      };
      sections.push(section);
    }
    if (row.policy_document_id === null || row.title === null) continue;
    let document = section.documents.find(
      (item) => item.policyDocumentId === row.policy_document_id,
    );
    if (!document) {
      document = {
        policyDocumentId: row.policy_document_id,
        title: row.title,
        effectiveFrom: row.effective_from ?? '',
        passages: [],
      };
      section.documents.push(document);
    }
    if (
      row.page === null ||
      row.ordinal === null ||
      row.body === null ||
      row.passage_section_key === null
    ) {
      continue;
    }
    document.passages.push({
      page: row.page,
      ordinal: row.ordinal,
      body: row.body,
      sectionKey: row.passage_section_key,
    });
  }
  return sections;
}

export async function uploadPolicyDocument(
  deps: LibraryDeps,
  spec: UploadPolicyDocumentSpec,
): Promise<{ policyDocumentId: string }> {
  const sectionKey = requireText(spec.sectionKey, 'section', 64);
  const title = requireText(spec.title, 'title', TITLE_MAX);
  const effectiveFrom = requireDate(spec.effectiveFrom);
  const uploadedBy = validId(spec.uploadedBy, 'uploadedBy');
  if (!Buffer.isBuffer(spec.bytes) || spec.bytes.length === 0) {
    throw new KernelError('invalid', 'no file was attached');
  }
  const extension = sniffExtension(spec.bytes);
  const pages = await readPages(deps, spec.bytes, extension);
  const bodies = pages.map((page) => pageText(page));
  if (bodies.every((body) => body.trim() === '')) {
    throw new KernelError('invalid', 'the file has no text');
  }
  const section = await deps.db.query<{ policy_section_id: string }>(
    `SELECT policy_section_id FROM policy_section WHERE section_key = $1`,
    [sectionKey],
  );
  const sectionId = section.rows[0]?.policy_section_id;
  if (!sectionId) {
    throw new KernelError('invalid', 'that section is not in the library');
  }
  const vectors = await deps.embedder.embed(bodies);
  const policyDocumentId = newId(deps.clock);
  const hash = documentFileHash(spec.bytes);
  const path = `policy/${sectionKey}/${hash}.${extension}`;
  const storageUri = documentStorageUri(deps.bucket, path);
  await deps.objects.put(path, spec.bytes, documentContentTypes[extension]);
  await deps.audit.around(
    {
      actorKind: 'staff',
      actorId: uploadedBy,
      action: 'policy.upload',
      subjectId: policyDocumentId,
      inputs: { sectionKey, title, effectiveFrom },
    },
    async () => {
      await deps.db.query(
        `INSERT INTO policy_document (
           policy_document_id, policy_section_id, title, effective_from,
           storage_uri, file_hash, uploaded_by, ingested_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          policyDocumentId,
          sectionId,
          title,
          effectiveFrom,
          storageUri,
          hash,
          uploadedBy,
          deps.clock.now(),
        ],
      );
      for (const [ordinal, page] of pages.entries()) {
        const vector = vectors[ordinal];
        if (!vector) {
          throw new KernelError(
            'unavailable',
            'the embedder returned no vector',
          );
        }
        await deps.db.query(
          `INSERT INTO policy_passage (
             policy_passage_id, policy_document_id, policy_section_id,
             page, ordinal, body, embedding
           ) VALUES ($1, $2, $3, $4, $5, $6, $7::vector)`,
          [
            newId(deps.clock),
            policyDocumentId,
            sectionId,
            page.number,
            ordinal,
            bodies[ordinal] ?? '',
            vectorLiteral(vector),
          ],
        );
      }
    },
  );
  return { policyDocumentId };
}

function requireDate(value: unknown): string {
  if (typeof value !== 'string' || !DATE.test(value)) {
    throw new KernelError('invalid', 'effective-from must be a date');
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
    throw new KernelError('invalid', 'effective-from must be a date');
  }
  return value;
}

async function readPages(
  deps: LibraryDeps,
  bytes: Buffer,
  extension: keyof typeof documentContentTypes,
): Promise<PdfPage[]> {
  const native = await readForVerdict(
    { pdf: deps.pdf, ocr: deps.ocr, ocrVersion: deps.ocrVersion },
    { bytes, extension, verificationTerms: null },
  );
  if (documentText(native.pages).trim() !== '') return native.pages;
  // A scan has no text layer. A term the page cannot already contain is what
  // sends evidence's reader on to OCR; null terms return immediately.
  const scanned = await readForVerdict(
    { pdf: deps.pdf, ocr: deps.ocr, ocrVersion: deps.ocrVersion },
    { bytes, extension, verificationTerms: ['\u0000'] },
  );
  return scanned.pages.length > 0 ? scanned.pages : native.pages;
}
