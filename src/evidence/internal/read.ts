// Slice 4.1: read a filed document that the native text layer could not. OCR
// after the row exists, promote unverified → verified when the marker terms
// appear, and never turn a miss into a 503.
import type { AuditLog } from '../../kernel/audit.ts';
import type { Clock } from '../../kernel/clock.ts';
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

/**
 * Whether an OCR call would reach anything. **Exported at 6.3** so the intake route can ask before
 * it spends one: an unconfigured OCR is a stand-in that answers `unconfigured` rather than a null,
 * and a caller that did not ask would pay a round trip to be told so.
 */
export function ocrConfigured(ocr: OcrText | undefined): ocr is OcrText {
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

/**
 * What happened to the OCR call this reading did or did not make. Slice 6.8.
 *
 * `catch { return null }` made a reader that broke indistinguishable from a reader that found
 * nothing, and both indistinguishable from a file nobody tried to read — three different facts and
 * one absent row in the log. They are five values now, and every one of them reaches the audit line.
 */
export type OcrOutcome =
  /** The native reading already satisfied the declared type. No call was needed. */
  | 'not_needed'
  /** The call was made and answered. Whether it *found* the terms is the verdict's business. */
  | 'ok'
  /** No processor is configured. The ordinary local state, and never an error. */
  | 'unconfigured'
  /** The call was made and failed, timed out, or was refused. */
  | 'failed'
  /** Too long for the online processor, so the call was not made. A refusal, from 6.8. */
  | 'too_many_pages';

export interface DocumentReading {
  /** The reading that won, as text — what the verdict was taken on and what A12's reader reads. */
  text: string;
  /** What pdfjs returned. Empty for a file that is not a PDF, which is a reading and not a miss. */
  native: PdfPage[];
  /** What the processor returned, when a call was spent and answered. */
  ocr?: PdfPage[];
  /** The pages downstream extraction runs over: the OCR pages when there are any, else the native. */
  pages: PdfPage[];
  verification: Verification;
  ocrOutcome: OcrOutcome;
}

/**
 * Read a document once, and take the verdict on the best reading available. Slice 6.8.
 *
 * **This is the only place that decides whether OCR is spent**, and until 6.8 there were two, both
 * asking the wrong question. `ocrAfterFile` here and `intakeText` in the routes both ran OCR only
 * when a PDF had *no text layer at all*, so a phone scanner's own layer permanently outranked
 * Document AI: the week-6 demo's refusals came back in 0.43-1.31s, against 7.07-7.40s for the one
 * file that had no layer, which is the difference between a decision and a call. And `fileDocument`
 * returned on a `refused` verdict before OCR was considered at all, so the better reader was never
 * reached for the case it exists to serve.
 *
 * The condition is the **declared type's terms**. A native reading that satisfies them is the end of
 * it; anything else is worth the call. When the call is spent and answers, **its pages win** - OCR
 * is only ever reached because the native reading failed the type's own guard, so preferring the
 * layer that just failed would be preferring the reader that lost.
 *
 * **It runs before anything is written.** The old order put OCR after the row because a refused
 * upload must write nothing, but a reading taken before the write is still a reading taken before
 * anything is written, and the refusal is then made on it. The after-the-fact path stays for the
 * rows already on file: `readFiledDocument` and `sweepUnverified`, which is the week-3 backlog.
 */
export async function readForVerdict(
  deps: {
    pdf: PdfText;
    ocr?: OcrText;
    ocrVersion?: string;
  },
  input: {
    bytes: Buffer;
    extension: keyof typeof documentContentTypes;
    verificationTerms: string[] | null;
  },
): Promise<DocumentReading> {
  const native =
    input.extension === 'pdf' ? await deps.pdf.pages(input.bytes) : [];
  const nativeText = input.extension === 'pdf' ? documentText(native) : null;
  const verification = verifyDeclaredType(
    nativeText || null,
    input.verificationTerms,
  );
  const settled =
    verification.verdict === 'verified' || verification.verdict === 'unguarded';
  const reading: DocumentReading = {
    text: nativeText ?? '',
    native,
    pages: native,
    verification,
    ocrOutcome: settled ? 'not_needed' : 'unconfigured',
  };
  if (settled) {
    return reading;
  }
  if (!ocrConfigured(deps.ocr) || !deps.ocrVersion) {
    // Not an error and not a refusal. It is the ordinary local state, and it reads as a document
    // nobody could get text out of - which is what `unverified` has always meant.
    return reading;
  }
  if (native.length > onlineOcrPageLimit) {
    // The call is declined rather than attempted, and the caller refuses rather than filing a
    // document it has not read. Before 6.8 this returned quietly and the row went in `unverified`.
    return { ...reading, ocrOutcome: 'too_many_pages' };
  }
  let pages: PdfPage[];
  try {
    const result = await deps.ocr.pages(
      input.bytes,
      documentContentTypes[input.extension],
      deps.ocrVersion,
    );
    pages = result.pages;
  } catch {
    // A miss must never become a 503 on an upload - the bound is 20 seconds and the operator can
    // still file. What is new is that the log says which of the two this was.
    return { ...reading, ocrOutcome: 'failed' };
  }
  const text = documentText(pages);
  return {
    text,
    native,
    ocr: pages,
    pages: pages.length > 0 ? pages : native,
    verification: verifyDeclaredType(text || null, input.verificationTerms),
    ocrOutcome: 'ok',
  };
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
