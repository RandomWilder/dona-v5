// Slice 4.1: read a filed document that the native text layer could not. OCR
// after the row exists, promote unverified → verified when the marker terms
// appear, and never turn a miss into a 503.
import type { AuditLog } from '../../kernel/audit.ts';
import type { Clock } from '../../kernel/clock.ts';
import { KernelError } from '../../kernel/errors.ts';
import type { ObjectStore } from '../../kernel/objects.ts';
import {
  type OcrPageImage,
  type OcrText,
  onlineOcrPageLimit,
} from '../../kernel/ocr.ts';
import type { PdfPage, PdfText } from '../../kernel/pdf.ts';
import {
  getFiledDocument,
  listUnverifiedDocuments,
  updateVerificationVerdict,
} from './documents.ts';
import {
  documentContentTypes,
  parseStorageUri,
  sniffExtension,
} from './storage-path.ts';
import type { Queryable } from './types.ts';
import {
  documentText,
  type Verification,
  verifyDeclaredType,
} from './verify.ts';

export interface ReadDeps {
  db: Queryable;
  objects: ObjectStore;
  pdf: PdfText;
  ocr: OcrText;
  ocrVersion: string;
  audit: AuditLog;
  clock: Clock;
  bucket: string;
}

export interface DocumentRead {
  documentId: string;
  typeKey: string;
  labelHe: string;
  fileHash: string;
  verification: Verification;
  pages: PdfPage[];
  images: OcrPageImage[];
  source: 'pdfjs' | 'ocr' | 'none';
}

function ocrConfigured(ocr: OcrText | undefined): ocr is OcrText {
  return ocr != null && ocr.describe() !== 'unconfigured';
}

export async function readFiledDocument(
  deps: ReadDeps,
  documentId: string,
): Promise<DocumentRead> {
  const filed = await getFiledDocument(deps.db, documentId);
  const { path } = parseStorageUri(filed.storageUri, deps.bucket);
  const object = await deps.objects.read(path);
  const read = await readBytes(deps, object.bytes);
  const verification = verifyDeclaredType(
    documentText(read.pages) || null,
    filed.verificationTerms,
  );
  if (
    filed.verificationVerdict === 'unverified' &&
    verification.verdict === 'verified'
  ) {
    await promoteVerified(deps, filed.documentId, filed.typeKey);
  }
  return {
    documentId: filed.documentId,
    typeKey: filed.typeKey,
    labelHe: filed.labelHe,
    fileHash: filed.fileHash,
    verification:
      verification.verdict === 'verified'
        ? verification
        : {
            verdict: filed.verificationVerdict,
            missingTerms: [],
          },
    pages: read.pages,
    images: read.images,
    source: read.source,
  };
}

export async function ocrAfterFile(
  deps: {
    ocr?: OcrText;
    ocrVersion?: string;
    db: Queryable;
    audit: AuditLog;
    clock: Clock;
  },
  input: {
    bytes: Buffer;
    extension: keyof typeof documentContentTypes;
    pdfPages: PdfPage[];
    documentId: string;
    typeKey: string;
    verificationTerms: string[] | null;
    subjectId: string;
  },
): Promise<Verification | null> {
  if (!ocrConfigured(deps.ocr) || !deps.ocrVersion) {
    return null;
  }
  if (input.pdfPages.length > onlineOcrPageLimit) {
    return null;
  }
  const nativeHasText = input.pdfPages.some((page) => page.items.length > 0);
  if (input.extension === 'pdf' && nativeHasText) {
    return null;
  }
  try {
    const result = await deps.ocr.pages(
      input.bytes,
      documentContentTypes[input.extension],
      deps.ocrVersion,
    );
    const next = verifyDeclaredType(
      documentText(result.pages),
      input.verificationTerms,
    );
    if (next.verdict !== 'verified') {
      return next.verdict === 'refused'
        ? { verdict: 'unverified', missingTerms: [] }
        : next;
    }
    await promoteVerified(
      deps,
      input.documentId,
      input.typeKey,
      input.subjectId,
    );
    return next;
  } catch (error) {
    if (error instanceof KernelError && error.code === 'unavailable') {
      return null;
    }
    return null;
  }
}

export interface SweepReport {
  examined: number;
  verified: number;
  unchanged: number;
  failed: number;
}

export async function sweepUnverified(
  deps: ReadDeps,
  only?: { documentIds?: readonly string[] },
): Promise<SweepReport> {
  const wanted = only?.documentIds ? new Set(only.documentIds) : null;
  const rows = (await listUnverifiedDocuments(deps.db)).filter((row) =>
    wanted ? wanted.has(row.documentId) : true,
  );
  const report: SweepReport = {
    examined: 0,
    verified: 0,
    unchanged: 0,
    failed: 0,
  };
  for (const row of rows) {
    report.examined += 1;
    try {
      const read = await readFiledDocument(deps, row.documentId);
      if (read.verification.verdict === 'verified') {
        report.verified += 1;
      } else {
        report.unchanged += 1;
      }
    } catch {
      report.failed += 1;
    }
  }
  return report;
}

async function readBytes(
  deps: Pick<ReadDeps, 'pdf' | 'ocr' | 'ocrVersion'>,
  bytes: Buffer,
): Promise<{
  pages: PdfPage[];
  images: OcrPageImage[];
  source: DocumentRead['source'];
}> {
  const extension = sniffExtension(bytes);
  if (extension === 'pdf') {
    const pages = await deps.pdf.pages(bytes);
    if (pages.some((page) => page.items.length > 0)) {
      return { pages, images: [], source: 'pdfjs' };
    }
  }
  if (!ocrConfigured(deps.ocr)) {
    return { pages: [], images: [], source: 'none' };
  }
  try {
    const result = await deps.ocr.pages(
      bytes,
      documentContentTypes[extension],
      deps.ocrVersion,
    );
    return { pages: result.pages, images: result.images, source: 'ocr' };
  } catch {
    return { pages: [], images: [], source: 'none' };
  }
}

async function promoteVerified(
  deps: Pick<ReadDeps, 'db' | 'audit'>,
  documentId: string,
  typeKey: string,
  subjectId: string = documentId,
): Promise<void> {
  const moved = await updateVerificationVerdict(
    deps.db,
    documentId,
    'verified',
  );
  if (!moved) {
    return;
  }
  await deps.audit.write(
    {
      actorKind: 'staff',
      action: 'evidence.read_document',
      subjectId,
      inputs: { documentId, typeKey, verdict: 'verified' },
    },
    { outcome: 'ok' },
  );
}
