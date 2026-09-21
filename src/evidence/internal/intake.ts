// Filing one document. Slice 3.3, flow A1, and SPEC-evidence.md "Filing a document".
//
// This is the only path into `document` and `document_link` that a screen may take, and it exists so
// that the order slice 3.2 fixed is written once: **sniff → hash → verify → look the hash up → put
// the object only when no document holds it → ingest → link.**
//
// Two of those are counter-intuitive and are the reason the order is a rule rather than a preference:
//
//   - **Hashing comes before anything is written**, because the hash is the object path's leaf, so
//     the whole path is computable before the first byte leaves this process.
//   - **The lookup comes before the put**, because the same bytes filed against a second place must
//     add a link and not a second copy of one file. `document.file_hash` is UNIQUE and
//     `ingestDocument` excludes `storage_uri` from its update path, so the first path filed stays
//     authoritative whatever a later caller computes.
//
// **The guard runs before either.** A refused upload writes nothing at all — no row, no link, no
// object — which is what the acceptance bar means by *caught before it is filed*, and the reasoning
// against giving E12 a `state` column for it is in SPEC-evidence.md.
import type { AuditLog } from '../../kernel/audit.ts';

import type { Clock } from '../../kernel/clock.ts';
import type { Embedder } from '../../kernel/embeddings.ts';
import { KernelError } from '../../kernel/errors.ts';
import type { Extractor } from '../../kernel/extraction.ts';
import type { ObjectStore } from '../../kernel/objects.ts';
import type { OcrText } from '../../kernel/ocr.ts';
import type { PdfPage, PdfText } from '../../kernel/pdf.ts';
import type { WorkRunner } from '../../kernel/work.ts';
import { documentTypeByKey } from './catalogue.ts';
import {
  type DocumentSpec,
  getFiledDocument,
  ingestDocument,
  linkDocument,
  recordPageCoverage,
} from './documents.ts';
import {
  EXTRACT_WORK_KIND,
  extractFiledDocument,
  numberWords,
  parseMeasuredWords,
} from './extract.ts';
import { embedderConfigured, writeDocumentPassages } from './passages.ts';
import {
  type DocumentReading,
  ocrConfigured,
  readForVerdict,
  readRemainingSlices,
} from './read.ts';
import {
  documentContentTypes,
  documentFileHash,
  documentObjectPath,
  documentStorageUri,
  type Place,
  parseStorageUri,
  placeOfStorageUri,
  sniffExtension,
} from './storage-path.ts';
import type { Queryable } from './types.ts';
import type { Verification } from './verify.ts';

export interface IntakeDeps {
  db: Queryable;
  objects: ObjectStore;
  /** The reader. Injected, so a test files a document without pdfjs and without a fixture PDF. */
  pdf: PdfText;
  /**
   * The OCR reader. Absent or unconfigured leaves an `unverified` file as it
   * was — a miss must not become a 503 on the upload.
   */
  ocr?: OcrText;
  ocrVersion?: string;
  extractor?: Extractor;
  extractModel?: string;
  extractReasoningEffort?: string;
  /** The embedder passages are written through. Absent or unconfigured skips the store. */
  embedder?: Embedder;
  work?: WorkRunner;
  audit: AuditLog;
  clock: Clock;
  /** The bucket this process is configured for. `storage_uri` names it (slice 3.2). */
  bucket: string;
}

export interface IntakeRequest {
  bytes: Buffer;
  /** Declared by the administrator, never detected (SPEC-flows.md invariant 6). */
  typeKey: string;
  /** Where the document is filed: a place, and in this flow always the `UNIT`. */
  place: Place;
  /**
   * The letting this document belongs to, when the administrator named one.
   *
   * Optional, and not because a tenancy is optional to the model: a handover protocol precedes every
   * tenancy its flat will ever have. Creating a *draft* tenancy from this screen is week 4's, with
   * flow A2 and the human confirmation invariant 5 requires — SPEC-evidence.md says why.
   * Slice 4.6 is that path: a verified lease with no tenancy link redirects to confirm.
   */
  tenancyId: string | null;
  /** The validity window on the paper itself, when the type has one. Both null is the ordinary case. */
  validFrom?: string | null;
  validTo?: string | null;
  /**
   * **The reading this caller has already taken off these same bytes. Slice 6.4, widened at 6.8.**
   *
   * A12's intake route reads the document before this function is called — it has to, because the
   * address on the page is what tells it which flat to file against — and until 6.4 this function
   * then read the same bytes again: a second pdfjs parse always, and for a scan a second Document AI
   * call, one page image at a time, for a verdict the caller already had the words for.
   *
   * The fix 6.3 named is this and not a wider `fileDocument`: the request carries what was paid for.
   * **From 6.8 it carries the whole reading** — the pages, the verdict taken on them and what became
   * of the OCR call — because there is now one function that decides all three (`readForVerdict`)
   * and a caller that had already run it would otherwise hand over the pages and make this one take
   * the verdict again, on the same words, by the same rule. **Absent is the ordinary case**: the
   * unit-first screen, the seeding paths and the importer pass nothing and this function reads.
   */
  reading?: DocumentReading;
  /**
   * The operator filing this, from the session. Slice 5.2 put it on the audit line for the
   * per-caller cap; slice 5.4 also writes it to `document.uploaded_by`. Optional, because the
   * seeding and importer paths that call this function have no session and never will.
   */
  filedBy?: string;
}

/**
 * Why an upload was refused. Slice 6.8, and it is two rather than one because the screen has two
 * different sentences to say: *this is not that kind of document*, and *this is too long for us to
 * have read it*. A refusal an operator cannot act on is a refusal they will work around.
 */
export type IntakeRefusal = 'terms' | 'too_large' | 'anchored';

export type IntakeResult =
  | {
      filed: true;
      documentId: string;
      /** False when these bytes were already on file, filed again against the place they anchor to. */
      inserted: boolean;
      storageUri: string;
      verification: Verification;
    }
  | {
      filed: false;
      verification: Verification;
      refusal: IntakeRefusal;
      /**
       * The place these bytes are already anchored to. Present only on `anchored`, and it is the
       * whole point of that refusal: the screen names the flat rather than saying *somewhere else*
       * (SPEC-evidence.md, slice 6.10).
       */
      anchoredTo?: Place;
    };

/**
 * Files a document, or refuses it.
 *
 * **A refusal is a return value and not a thrown error**, because it is an expected outcome of a
 * correct request: the administrator picked the wrong file, the screen says which terms were missing,
 * and they try again. `KernelError` stays for what it has always meant here — a request that was
 * malformed at the edge, a type that does not exist, a store that is unreachable.
 *
 * Every call writes an audit line, including the refusals, which is where *what someone tried to
 * file and when* is kept now that E12 carries no `state`. **No filename and no document text reaches
 * that line**: the marker terms are the form's own printed words and the hash is a digest, and
 * neither is a person (SPEC.md — PII never in logs).
 */
export async function fileDocument(
  deps: IntakeDeps,
  request: IntakeRequest,
): Promise<IntakeResult> {
  const extension = sniffExtension(request.bytes);
  const fileHash = documentFileHash(request.bytes);

  const type = await documentTypeByKey(deps.db, request.typeKey);
  if (!type) {
    throw new KernelError('invalid', 'that is not a document type');
  }
  if (!type.isActive) {
    // Deactivated, never deleted (R16): the filed documents still point at it and a dispute reads
    // them. What retirement means is that nothing new is filed under it.
    throw new KernelError('invalid', 'that document type is retired');
  }

  // **One reading, before anything is written. Slice 6.8.** The verdict, the OCR decision and the
  // pages extraction will run over all come out of the same call, and the caller that already made
  // it hands the result over rather than paying for it twice.
  const reading =
    request.reading ??
    (await readForVerdict(deps, {
      bytes: request.bytes,
      extension,
      verificationTerms: type.verificationTerms,
    }));
  const verification = reading.verification;
  const pageCount =
    reading.native.length > 0 ? reading.native.length : reading.pages.length;
  const pagesRead =
    reading.pagesRead ?? (pageCount === 0 ? 0 : reading.pages.length);

  const line = {
    actorKind: 'staff' as const,
    // Named from slice 5.2. Before it there was no authenticated actor to name, and the per-caller
    // upload cap counts these rows by this column.
    actorId: request.filedBy,
    action: 'evidence.file_document',
    subjectId: request.place.id,
    inputs: {
      typeKey: type.typeKey,
      placeKind: request.place.kind,
      tenancyId: request.tenancyId,
      fileHash,
      extension,
      bytes: request.bytes.length,
      verdict: verification.verdict,
      missingTerms: verification.missingTerms,
      // What became of the OCR call, and how long the file was. Slice 6.8: a reader that broke, a
      // reader that found nothing and a file nobody tried to read were one absent row until now.
      ocr: reading.ocrOutcome,
      pages: reading.native.length,
      // Present only on a partial reading, and it is the number that keeps `verified` honest: the
      // verdict was taken on this many of the pages above, not on all of them.
      ...(reading.pagesRead === undefined
        ? {}
        : { pagesRead: reading.pagesRead }),
    },
  };

  if (reading.ocrOutcome === 'too_large') {
    // Refused rather than filed. Nothing was read off this file and nothing could be, so a row
    // would carry a verdict about a document nobody has seen a page of.
    await deps.audit.write(line, {
      outcome: 'error',
      code: 'invalid',
      message: 'the file is larger than the reader will take in one call',
    });
    return { filed: false, verification, refusal: 'too_large' };
  }

  if (verification.verdict === 'refused') {
    await deps.audit.write(line, {
      outcome: 'error',
      code: 'invalid',
      message: 'the file does not carry the declared type’s terms',
    });
    return { filed: false, verification, refusal: 'terms' };
  }

  const existing = await findDocumentByHash(deps.db, fileHash);

  // **One document, one anchor. Slice 6.10.**
  //
  // The lookup that keeps a second object from being written is also the one that knows where these
  // bytes already live, so the anchor check is that step and not a new one. A second *place* is
  // refused here — before the `put` and before `ingestDocument`, whose `DO UPDATE` would otherwise
  // rewrite the type and the verdict of a row this caller is being refused. A second *link* of any
  // other kind is untouched: R13 is about a lease being evidence of a letting and signed by two
  // parties, and none of those is a claim about which flat the paper is about.
  if (existing) {
    const anchor = placeOfStorageUri(existing.storageUri);
    if (anchor.kind !== request.place.kind || anchor.id !== request.place.id) {
      await deps.audit.write(line, {
        outcome: 'error',
        code: 'conflict',
        message: 'these bytes are already filed against another place',
      });
      return {
        filed: false,
        verification,
        refusal: 'anchored',
        anchoredTo: anchor,
      };
    }
  }

  let storageUri = existing?.storageUri ?? null;
  if (!storageUri) {
    const path = documentObjectPath({
      place: request.place,
      typeKey: type.typeKey,
      fileHash,
      extension,
    });
    storageUri = documentStorageUri(deps.bucket, path);
    // Before the rows and never after. An object with no row is invisible and costs storage; a row
    // pointing at an object that was never written is a document the system says it holds and does
    // not. The bucket is versioned and the application cannot delete (slice 3.2), so the cheap
    // failure is the one to choose deliberately.
    await deps.objects.put(
      path,
      request.bytes,
      documentContentTypes[extension],
    );
  }

  const spec: DocumentSpec = {
    documentTypeId: type.documentTypeId,
    storageUri,
    fileHash,
    driveFileId: null,
    validFrom: request.validFrom ?? null,
    validTo: request.validTo ?? null,
    verificationVerdict: verification.verdict,
    uploadedBy: request.filedBy ?? null,
    ...(pageCount > 0 ? { pageCount, pagesRead } : {}),
  };
  const filed = await ingestDocument(deps.db, spec, deps.clock.now());
  await linkDocument(deps.db, {
    documentId: filed.id,
    entityType: request.place.kind,
    entityId: request.place.id,
    linkRole: 'SUBJECT',
  });
  if (request.tenancyId) {
    // SPEC-flows.md invariant 1: the tenancy is the binding the upload asks for. It is a link and
    // never the path root, because a tenancy is temporal and rooting the filing cabinet at one would
    // scatter a flat's papers across its lettings.
    await linkDocument(deps.db, {
      documentId: filed.id,
      entityType: 'TENANCY',
      entityId: request.tenancyId,
      linkRole: 'EVIDENCE',
    });
  }

  await deps.audit.write(
    { ...line, inputs: { ...line.inputs, documentId: filed.id } },
    { outcome: 'ok' },
  );

  const remainder = pageCount > pagesRead;
  if (remainder && deps.work && ocrConfigured(deps.ocr) && deps.ocrVersion) {
    bindExtractWork(deps);
    await deps.work.schedule({
      kind: EXTRACT_WORK_KIND,
      runAt: deps.clock.now(),
      payload: {
        documentId: filed.id,
        remainder: true,
        pageCount,
        pages: reading.pages,
      },
      intentKey: `extract:${filed.id}`,
    });
  } else {
    const pages = remainder
      ? await finishFiledReading(
          deps,
          filed.id,
          request.bytes,
          extension,
          pageCount,
          reading.pages,
        )
      : reading.pages;
    await extractAfterFile(deps, filed.id, pages);
    if (embedderConfigured(deps.embedder)) {
      await writeDocumentPassages(deps.db, filed.id, pages, deps.embedder);
    }
  }

  return {
    filed: true,
    documentId: filed.id,
    inserted: filed.inserted,
    storageUri,
    verification,
  };
}

async function extractAfterFile(
  deps: IntakeDeps,
  documentId: string,
  pages: PdfPage[],
): Promise<void> {
  const words = numberWords(pages);
  if (!deps.extractor || words.length === 0) {
    return;
  }
  if (!deps.work) {
    await extractNow(deps, documentId, pages, words);
    return;
  }
  bindExtractWork(deps);
  await deps.work.schedule({
    kind: EXTRACT_WORK_KIND,
    runAt: deps.clock.now(),
    payload: { documentId, words },
    intentKey: `extract:${documentId}`,
  });
  await deps.work.tick();
}

export function bindExtractWork(deps: IntakeDeps): void {
  if (!deps.work) {
    return;
  }
  deps.work.register(EXTRACT_WORK_KIND, async (payload) => {
    await runExtractWork(deps, payload);
  });
}

export async function runExtractWork(
  deps: IntakeDeps,
  payload: Record<string, unknown>,
): Promise<void> {
  const documentId = String(payload.documentId ?? '');
  if (payload.remainder === true) {
    const filed = await getFiledDocument(deps.db, documentId);
    const { path } = parseStorageUri(filed.storageUri, deps.bucket);
    const object = await deps.objects.read(path);
    const extension = sniffExtension(object.bytes);
    const pageCount = Number(payload.pageCount);
    const already = parsePdfPages(payload.pages);
    const pages = await finishFiledReading(
      deps,
      documentId,
      object.bytes,
      extension,
      pageCount,
      already,
    );
    await extractNow(deps, documentId, pages);
    if (embedderConfigured(deps.embedder)) {
      await writeDocumentPassages(deps.db, documentId, pages, deps.embedder);
    }
    return;
  }
  await extractNow(deps, documentId, [], parseMeasuredWords(payload.words));
}

async function finishFiledReading(
  deps: IntakeDeps,
  documentId: string,
  bytes: Buffer,
  extension: keyof typeof documentContentTypes,
  pageCount: number,
  already: readonly PdfPage[],
): Promise<PdfPage[]> {
  if (
    !ocrConfigured(deps.ocr) ||
    !deps.ocrVersion ||
    already.length >= pageCount
  ) {
    return [...already];
  }
  const pages = await readRemainingSlices(
    { ocr: deps.ocr, ocrVersion: deps.ocrVersion },
    bytes,
    documentContentTypes[extension],
    pageCount,
    already,
  );
  await recordPageCoverage(deps.db, documentId, pageCount, pages.length);
  return pages;
}

async function extractNow(
  deps: IntakeDeps,
  documentId: string,
  pages: readonly PdfPage[],
  words = numberWords(pages),
): Promise<void> {
  if (!deps.extractor || words.length === 0) {
    return;
  }
  await extractFiledDocument(
    {
      db: deps.db,
      extractor: deps.extractor,
      audit: deps.audit,
      clock: deps.clock,
      model: deps.extractModel ?? 'unconfigured',
      reasoningEffort: deps.extractReasoningEffort,
    },
    { documentId, words },
  );
}

function parsePdfPages(value: unknown): PdfPage[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const pages: PdfPage[] = [];
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) {
      continue;
    }
    const row = entry as Record<string, unknown>;
    if (
      typeof row.number !== 'number' ||
      typeof row.width !== 'number' ||
      typeof row.height !== 'number' ||
      !Array.isArray(row.items)
    ) {
      continue;
    }
    pages.push({
      number: row.number,
      width: row.width,
      height: row.height,
      items: row.items.filter(
        (item): item is PdfPage['items'][number] =>
          typeof item === 'object' &&
          item !== null &&
          typeof (item as { text?: unknown }).text === 'string',
      ),
    });
  }
  return pages;
}

/**
 * The document already holding these bytes, if there is one.
 *
 * This is the *look the hash up* step, and it is a read and not a write on purpose: `ingestDocument`
 * would return the existing row anyway, but by then the object has been written a second time under
 * a second place's path — one file, two objects, and the second one unreferenced forever because
 * `ingestDocument` keeps the first `storage_uri`.
 */
export async function findDocumentByHash(
  db: Queryable,
  fileHash: string,
): Promise<{ documentId: string; storageUri: string } | null> {
  const result = await db.query<{ document_id: string; storage_uri: string }>(
    'SELECT document_id, storage_uri FROM document WHERE file_hash = $1',
    [fileHash],
  );
  const row = result.rows[0];
  return row
    ? { documentId: row.document_id, storageUri: row.storage_uri }
    : null;
}
