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
import { KernelError } from '../../kernel/errors.ts';
import type { Extractor } from '../../kernel/extraction.ts';
import type { ObjectStore } from '../../kernel/objects.ts';
import type { OcrText } from '../../kernel/ocr.ts';
import type { PdfPage, PdfText } from '../../kernel/pdf.ts';
import type { WorkRunner } from '../../kernel/work.ts';
import { documentTypeByKey } from './catalogue.ts';
import {
  type DocumentSpec,
  ingestDocument,
  linkDocument,
} from './documents.ts';
import {
  EXTRACT_WORK_KIND,
  extractFiledDocument,
  numberWords,
  parseMeasuredWords,
} from './extract.ts';
import { ocrAfterFile } from './read.ts';
import {
  documentContentTypes,
  documentFileHash,
  documentObjectPath,
  documentStorageUri,
  type Place,
  sniffExtension,
} from './storage-path.ts';
import type { Queryable } from './types.ts';
import {
  documentText,
  type Verification,
  verifyDeclaredType,
} from './verify.ts';

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
   * The operator filing this, from the session. Slice 5.2 put it on the audit line for the
   * per-caller cap; slice 5.4 also writes it to `document.uploaded_by`. Optional, because the
   * seeding and importer paths that call this function have no session and never will.
   */
  filedBy?: string;
}

export type IntakeResult =
  | {
      filed: true;
      documentId: string;
      /** False when these bytes were already on file: one document, a second link. */
      inserted: boolean;
      storageUri: string;
      verification: Verification;
    }
  | { filed: false; verification: Verification };

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

  const pdfPages: PdfPage[] =
    extension === 'pdf' ? await deps.pdf.pages(request.bytes) : [];
  let pagesForExtract = pdfPages;
  let verification = verifyDeclaredType(
    extension === 'pdf' ? documentText(pdfPages) : null,
    type.verificationTerms,
  );

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
    },
  };

  if (verification.verdict === 'refused') {
    await deps.audit.write(line, {
      outcome: 'error',
      code: 'invalid',
      message: 'the file does not carry the declared type’s terms',
    });
    return { filed: false, verification };
  }

  const existing = await findDocumentByHash(deps.db, fileHash);
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

  if (verification.verdict === 'unverified') {
    const after = await ocrAfterFile(deps, {
      bytes: request.bytes,
      extension,
      pdfPages,
      documentId: filed.id,
      typeKey: type.typeKey,
      verificationTerms: type.verificationTerms,
      subjectId: request.place.id,
    });
    if (after) {
      verification = after.verification;
      if (after.pages.some((page) => page.items.length > 0)) {
        pagesForExtract = after.pages;
      }
    }
  }

  await extractAfterFile(deps, filed.id, pagesForExtract);

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
  if (!deps.extractor) {
    return;
  }
  const words = numberWords(pages);
  if (words.length === 0) {
    return;
  }
  const extract: Parameters<typeof extractFiledDocument>[0] = {
    db: deps.db,
    extractor: deps.extractor,
    audit: deps.audit,
    clock: deps.clock,
    model: deps.extractModel ?? 'unconfigured',
    reasoningEffort: deps.extractReasoningEffort,
  };
  if (!deps.work) {
    await extractFiledDocument(extract, { documentId, words });
    return;
  }
  deps.work.register(EXTRACT_WORK_KIND, async (payload) => {
    await extractFiledDocument(extract, {
      documentId: String(payload.documentId ?? ''),
      words: parseMeasuredWords(payload.words),
    });
  });
  await deps.work.schedule({
    kind: EXTRACT_WORK_KIND,
    runAt: deps.clock.now(),
    payload: { documentId, words },
    intentKey: `extract:${documentId}`,
  });
  await deps.work.tick();
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
