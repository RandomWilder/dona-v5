// Upload a Policy document and list the library. #250, versions #251.
//
// A later upload of the same title in the same section is a new version. It
// ends the open one by setting effective-to, and both rows stay.
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

export interface PolicyVersionView {
  policyDocumentId: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  inForce: boolean;
  passages: PolicyPassageView[];
}

export interface PolicyDocumentView {
  title: string;
  versions: PolicyVersionView[];
}

export interface PolicySectionView {
  sectionKey: string;
  labelHe: string;
  documents: PolicyDocumentView[];
}

export async function listPolicyLibrary(
  db: Queryable,
  asOf: string,
): Promise<PolicySectionView[]> {
  const day = requireDate(asOf, 'asOf');
  const result = await db.query<{
    section_key: string;
    label_he: string;
    policy_document_id: string | null;
    title: string | null;
    effective_from: string | null;
    effective_to: string | null;
    in_force: boolean | null;
    page: number | null;
    ordinal: number | null;
    body: string | null;
    passage_section_key: string | null;
  }>(
    `SELECT s.section_key, s.label_he,
            d.policy_document_id, d.title,
            to_char(d.effective_from, 'YYYY-MM-DD') AS effective_from,
            to_char(d.effective_to, 'YYYY-MM-DD') AS effective_to,
            policy_document_in_force(d.effective_from, d.effective_to, $1::date) AS in_force,
            p.page, p.ordinal, p.body,
            ps.section_key AS passage_section_key
       FROM policy_section s
       LEFT JOIN policy_document d
         ON d.policy_section_id = s.policy_section_id
       LEFT JOIN policy_passage p
         ON p.policy_document_id = d.policy_document_id
       LEFT JOIN policy_section ps
         ON ps.policy_section_id = p.policy_section_id
      ORDER BY s.sort_order, d.title, d.effective_from DESC, d.policy_document_id, p.ordinal`,
    [day],
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
    let document = section.documents.find((item) => item.title === row.title);
    if (!document) {
      document = { title: row.title, versions: [] };
      section.documents.push(document);
    }
    let version = document.versions.find(
      (item) => item.policyDocumentId === row.policy_document_id,
    );
    if (!version) {
      version = {
        policyDocumentId: row.policy_document_id,
        effectiveFrom: row.effective_from ?? '',
        effectiveTo: row.effective_to,
        inForce: row.in_force === true,
        passages: [],
      };
      document.versions.push(version);
    }
    if (
      row.page === null ||
      row.ordinal === null ||
      row.body === null ||
      row.passage_section_key === null
    ) {
      continue;
    }
    version.passages.push({
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
  const effectiveFrom = requireDate(spec.effectiveFrom, 'effective-from');
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
  const prior = await deps.db.query<{
    policy_document_id: string;
    effective_from: string;
  }>(
    `SELECT policy_document_id,
            to_char(effective_from, 'YYYY-MM-DD') AS effective_from
       FROM policy_document
      WHERE policy_section_id = $1
        AND title = $2
        AND effective_to IS NULL`,
    [sectionId, title],
  );
  const current = prior.rows[0];
  if (current && current.effective_from >= effectiveFrom) {
    throw new KernelError(
      'conflict',
      'a new version has to start after the current one',
    );
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
      if (current) {
        const closed = await deps.db.query(
          `UPDATE policy_document
              SET effective_to = $2::date
            WHERE policy_document_id = $1
              AND effective_to IS NULL`,
          [current.policy_document_id, effectiveFrom],
        );
        if (closed.rowCount !== 1) {
          throw new KernelError(
            'conflict',
            'two versions would be in force on the same date',
          );
        }
        await deps.audit.write(
          {
            actorKind: 'staff',
            actorId: uploadedBy,
            action: 'policy.supersede',
            subjectId: current.policy_document_id,
            inputs: {
              effectiveTo: effectiveFrom,
              successorId: policyDocumentId,
            },
          },
          { outcome: 'ok' },
        );
      }
      try {
        await insertPolicyDocument(deps, {
          policyDocumentId,
          sectionId,
          title,
          effectiveFrom,
          storageUri,
          hash,
          uploadedBy,
          pages,
          bodies,
          vectors,
        });
      } catch (error) {
        if ((error as { code?: string }).code === '23P01') {
          throw new KernelError(
            'conflict',
            'two versions would be in force on the same date',
          );
        }
        throw error;
      }
    },
  );
  return { policyDocumentId };
}

async function insertPolicyDocument(
  deps: LibraryDeps,
  spec: {
    policyDocumentId: string;
    sectionId: string;
    title: string;
    effectiveFrom: string;
    storageUri: string;
    hash: string;
    uploadedBy: string;
    pages: PdfPage[];
    bodies: string[];
    vectors: Awaited<ReturnType<Embedder['embed']>>;
  },
): Promise<void> {
  await deps.db.query(
    `INSERT INTO policy_document (
       policy_document_id, policy_section_id, title, effective_from,
       storage_uri, file_hash, uploaded_by, ingested_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      spec.policyDocumentId,
      spec.sectionId,
      spec.title,
      spec.effectiveFrom,
      spec.storageUri,
      spec.hash,
      spec.uploadedBy,
      deps.clock.now(),
    ],
  );
  for (const [ordinal, page] of spec.pages.entries()) {
    const vector = spec.vectors[ordinal];
    if (!vector) {
      throw new KernelError('unavailable', 'the embedder returned no vector');
    }
    await deps.db.query(
      `INSERT INTO policy_passage (
         policy_passage_id, policy_document_id, policy_section_id,
         page, ordinal, body, embedding
       ) VALUES ($1, $2, $3, $4, $5, $6, $7::vector)`,
      [
        newId(deps.clock),
        spec.policyDocumentId,
        spec.sectionId,
        page.number,
        ordinal,
        spec.bodies[ordinal] ?? '',
        vectorLiteral(vector),
      ],
    );
  }
}

function requireDate(value: unknown, field: string): string {
  if (typeof value !== 'string' || !DATE.test(value)) {
    throw new KernelError('invalid', `${field} must be a date`);
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
    throw new KernelError('invalid', `${field} must be a date`);
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
