// Evidence's HTTP surface — the upload screen and the post that files a document. Slice 3.3, flow
// A1, and **the first write route in this system**.
//
// Every route before this one was a read. SPEC-evidence.md, "The first write route in this system,
// and what bounds it", is where these bounds are set out
// and argued; they are applied here: one file, 20 MB, four kinds sniffed from the bytes, no filename
// kept, and nothing personal in the response.
//
// **There is no CSRF token, and that is not an omission.** A CSRF token defends a session's
// authority, and there is no session: an anonymous caller can already post directly. Week 5's login
// is the slice that owes one, in the same change that gives this route something worth riding.
import multipart from '@fastify/multipart';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Pool } from 'pg';
import type { ChromeDest } from '../../chrome.ts';
import {
  addCalendarYears,
  getBuilding,
  getUnit,
  searchEstate,
  type UnitHit,
  WARRANTY_YEARS,
} from '../../estate/contract.ts';
import { countActions, createAuditLog } from '../../kernel/audit.ts';
import type { Clock } from '../../kernel/clock.ts';
import {
  createSettings,
  readExtractionSettings,
  readOcrSettings,
} from '../../kernel/config.ts';
import { KernelError } from '../../kernel/errors.ts';
import type { Extractor } from '../../kernel/extraction.ts';
import type { ObjectStore } from '../../kernel/objects.ts';
import { createUnconfiguredOcr, type OcrText } from '../../kernel/ocr.ts';
import type { PdfPage, PdfText } from '../../kernel/pdf.ts';
import type { Html } from '../../kernel/ui/html.ts';
import { validId } from '../../kernel/validate.ts';
import {
  CSRF_FIELD,
  can,
  csrfFrom,
  readSessionCookie,
  verifyCsrf,
} from '../../staff/contract.ts';

const PAGE_NUMBER = /^[1-9]\d*$/;

/** 0-based index into the reader's pages. Missing → 0. Out of range clamps. Garbage is invalid. */
function pageIndex(asked: unknown, pageCount: number): number {
  if (asked === undefined || asked === '') {
    return 0;
  }
  if (typeof asked !== 'string' || !PAGE_NUMBER.test(asked)) {
    throw new KernelError('invalid', 'page is not a page number');
  }
  if (pageCount < 1) {
    return 0;
  }
  return Math.min(Number(asked), pageCount) - 1;
}

import type { WorkRunner } from '../../kernel/work.ts';
import { listUnitTenancies, type TenancyRole } from '../../tenancy/contract.ts';
import { documentTypeByKey, listDocumentTypes } from './catalogue.ts';
import {
  type ExtractedRow,
  isIdentifierField,
  listExtractedFields,
} from './extract.ts';
import { fileDocument } from './intake.ts';
import { confirmLeaseTenancy, proposeLeaseTenancy } from './lease.ts';
import { readPlace, resolvePlace } from './place.ts';
import { promoteExtractedField } from './promote.ts';
import { isProtocolType } from './protocol.ts';
import { ocrConfigured, readFiledDocument } from './read.ts';
import {
  confirmProtocol,
  type ProtocolProposal,
  proposeProtocol,
} from './seed.ts';
import {
  documentContentTypes,
  documentFileHash,
  sniffExtension,
} from './storage-path.ts';
import { documentText } from './verify.ts';
import type { SeedScreen } from './views.ts';
import {
  renderFiledPage,
  renderIntakePage,
  renderReadPage,
  renderSeededPage,
  renderSeedPage,
  renderTenancyPage,
  renderTenancyWrittenPage,
  renderUploadPage,
} from './views.ts';

export interface DocumentDeps {
  pool: Pool;
  objects: ObjectStore;
  pdf: PdfText;
  ocr?: OcrText;
  extractor?: Extractor;
  work?: WorkRunner;
  clock: Clock;
  /** The bucket `storage_uri` names. The memory store's stand-in locally (slice 3.2). */
  bucket: string;
  /** Slice 5.2b. Built at the composition root. */
  chrome: (csrf: string, dest: ChromeDest) => Html;
}

/**
 * One file, and it may not be a large one.
 *
 * A lease is a few hundred kilobytes and a scanned one a few megabytes; twenty is generous and is
 * chosen as a bound on a runaway rather than as a budget, which is `kernel/extraction.ts`'s
 * reasoning about its own timeout. `fields` and `fieldSize` are bounded for the same reason. From
 * 5.2 the caller is authenticated and bounded too, and these stay: they bound one request, and an
 * operator can post a runaway by accident as easily as a stranger could on purpose.
 */
const LIMITS = {
  files: 1,
  fileSize: 20 * 1024 * 1024,
  fields: 40,
  fieldSize: 200,
};

/**
 * **The bound on the caller. Slice 5.2.**
 *
 * `LIMITS` above bounds a request; this bounds an operator. Nothing bounded one until 5.2, because
 * until 5.2 there was no operator to bound — an anonymous poster could fill a versioned bucket this
 * application is deliberately unable to empty (slice 3.2), one legal 20 MB request at a time.
 *
 * **Fifty a day, per operator.** A person filing paper for 1,500 units files a handful in a day and
 * a bad afternoon is a dozen; fifty is chosen as the bound on a runaway rather than as a budget,
 * which is the same reasoning 3.3 wrote for its twenty megabytes. Bulk arrives through the register
 * importer and through 3.4's Drive ingestion, and neither goes anywhere near this route. If an
 * operator ever legitimately reaches it, the number is wrong and moving it is one line and one
 * evidence file — which is a better failure than discovering the bucket has been full for a week.
 *
 * **Counted over a rolling day, not a calendar one.** A calendar reset hands a caller the whole cap
 * again at midnight and twice the cap across two minutes either side of it.
 */
const UPLOADS_PER_DAY = 50;
const UPLOAD_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Refuses the fifty-first. `too_many` and 429, not `not_allowed` and 403: the operator may do this,
 * and may not do it this many times today, and a refusal that said the first thing would send
 * somebody to look at the role matrix for an answer that is not there.
 *
 * Both outcomes count. A refused upload consumed the work the bound exists to bound, and counting
 * only the ones that were filed would let a caller stay under the cap for ever by being wrong.
 */
async function boundTheCaller(
  deps: DocumentDeps,
  staffAccountId: string,
): Promise<void> {
  const since = new Date(deps.clock.now().getTime() - UPLOAD_WINDOW_MS);
  // **Two actions, one bound. Slice 6.3.** 5.2's argument is that the cap is on what reached intake
  // and not on what survived it, and A12 gave the route a second way to consume a read without
  // producing a row: an address the estate does not hold costs a pdf parse and possibly an OCR call,
  // and then writes nothing. Counting only `file_document` would leave that path free, for ever.
  const counts = await Promise.all(
    ['evidence.file_document', 'evidence.intake_unresolved'].map((action) =>
      countActions(deps.pool, { action, actorId: staffAccountId, since }),
    ),
  );
  const filed = counts.reduce((total, count) => total + count, 0);
  if (filed >= UPLOADS_PER_DAY) {
    throw new KernelError('too_many', 'too many documents filed today');
  }
}

/**
 * The raw session token, for the one route that verifies its own CSRF field. The guard has already
 * refused this request if there was no session, so the cookie is there; `??` is the type system's
 * question, not a real branch, and an empty string could never verify against anything.
 */
function sessionTokenOf(request: FastifyRequest): string {
  return readSessionCookie(request.headers.cookie) ?? '';
}

/**
 * Who is filing. The guard set this before the handler ran, so its absence is a wiring fault rather
 * than an unauthenticated request — and it fails closed instead of filing a document under nobody.
 */
function chromeOf(deps: DocumentDeps, request: FastifyRequest): Html {
  return deps.chrome(csrfFrom(request), 'estate');
}

function requireOperator(request: FastifyRequest): string {
  const id = request.staff?.staffAccountId;
  if (id === undefined) {
    throw new KernelError('not_allowed', 'not_allowed');
  }
  return id;
}

function requireOperatorEmail(request: FastifyRequest): string {
  const email = request.staff?.email;
  if (email === undefined || email === '') {
    throw new KernelError('not_allowed', 'not_allowed');
  }
  return email;
}

/**
 * **Whether this viewer may see a captured ת.ז. Slice 6.4.**
 *
 * The matrix is the answer and this is the only place that asks it: `party.national_id.read` has been
 * in `PERMISSIONS` unused since 5.1, held by ADMIN alone, waiting for the week the identifier started
 * existing. A role this system does not recognise, and a request the guard somehow let through
 * without one, both arrive here as `null` and both answer false — `can` fails closed on a null role
 * and that is the behaviour wanted here, not merely tolerated.
 */
function mayReadIdentifiers(request: FastifyRequest): boolean {
  return can(request.staff?.role ?? null, 'party.national_id.read');
}

/**
 * **The access log the security default has always promised. Slice 6.4.**
 *
 * `SPEC.md` says `national_id` is admin-only *and access-logged*, and until this slice there was
 * nothing to log because there was nothing to read. One line per disclosure, naming who asked, what
 * they hold and which document — and **never the value**, nor any part of it, because PII never
 * reaches a log and a line carrying a digit of it would defeat the thing it exists to record.
 *
 * **Withholding is not a read and writes nothing.** An operator opening this screen did not see an
 * identifier, so a line saying they did would make the count useless for the only question anyone
 * will ever ask it: who has seen this household's ת.ז.
 */
async function logIdentifierRead(
  deps: DocumentDeps,
  request: FastifyRequest,
  input: { documentId: string; typeKey: string; rows: readonly ExtractedRow[] },
): Promise<void> {
  const disclosed = input.rows.filter((row) => isIdentifierField(row.fieldKey));
  if (disclosed.length === 0) {
    return;
  }
  await createAuditLog(deps.pool, deps.clock).write(
    {
      actorKind: 'staff',
      actorId: request.staff?.staffAccountId,
      actorRole: request.staff?.role ?? undefined,
      action: 'evidence.read_identifier',
      subjectId: input.documentId,
      inputs: {
        documentId: input.documentId,
        typeKey: input.typeKey,
        fieldKeys: [...new Set(disclosed.map((row) => row.fieldKey))].sort(),
        count: disclosed.length,
      },
    },
    { outcome: 'ok' },
  );
}

function html(reply: { header: (k: string, v: string) => unknown }): void {
  reply.header('content-type', 'text/html; charset=utf-8');
  reply.header('cache-control', 'no-cache');
  reply.header('x-content-type-options', 'nosniff');
}

/**
 * The stances, from slice 5.2. Reading what is filed is `documents.read`; the upload screen and the
 * POST behind it are `documents.write`; promoting a captured value, seeding a protocol and
 * confirming a lease all write a tenancy or a unit through another module's command, so they ask
 * for `tenancy.write` — the permission that names what actually changes, rather than the one that
 * names the screen it changed from.
 */
const READ = { config: { staff: 'documents.read' } } as const;
const NEW = { config: { staff: 'documents.write' } } as const;
const FILE = {
  config: { staff: 'documents.write', csrf: 'in-body' },
} as const;
/**
 * **The second `csrf: 'in-body'` route, slice 6.3.** The exemption is not "uploads are special" —
 * it is *this body is a multipart stream the handler must parse itself*, which is as true here as
 * it is of `POST /documents`, and the token is checked by the same `verifyCsrf` against the same
 * session. `src/guard.test.ts` keeps the exempt set as an allow-list of named routes, so this route
 * turned it red the moment it was registered rather than widening it quietly.
 */
const INTAKE = {
  config: { staff: 'documents.write', csrf: 'in-body' },
} as const;
const CONFIRM = { config: { staff: 'tenancy.write' } } as const;

export function registerDocumentRoutes(
  app: FastifyInstance,
  deps: DocumentDeps,
): void {
  app.register(multipart, { limits: LIMITS });

  // The screen, and from 6.3 there are two of them behind one URL.
  //
  // **With a unit** it is A1's: reached from a flat on the building page, so the unit is in the
  // query string and is validated before it reaches a query — a malformed id is `invalid` and a
  // well-formed one that is not there is `not_found`, and neither says which.
  //
  // **With no unit** it is A12's: reached from the index by someone holding a piece of paper and no
  // idea which flat it belongs to. The address on the page is what answers that, so the screen asks
  // for a type and a file and nothing else. `q` is the refusal's search box coming back — the same
  // `searchEstate` the estate screens use, rendered as the candidate list.
  app.get('/documents/new', NEW, async (request, reply) => {
    const asked = (request.query as { unit?: string; q?: string }).unit ?? '';
    if (asked === '') {
      const query = (request.query as { q?: string }).q ?? '';
      const [types, found] = await Promise.all([
        listDocumentTypes(deps.pool),
        query ? searchEstate(deps.pool, query) : null,
      ]);
      html(reply);
      return renderIntakePage({
        nav: chromeOf(deps, request),
        csrf: csrfFrom(request),
        types,
        // A search is a refusal still being answered, so the screen stays in the state that offered
        // it: what was read is unknown here, and the reading it prints is the empty one.
        ...(found
          ? {
              reading: {
                addressLine: null,
                city: null,
                apartmentNumber: null,
              },
              candidates: found.units,
              total: found.units.length,
              query,
            }
          : {}),
      });
    }
    const unitId = validId(asked, 'unit');
    const [unit, types, lettings] = await Promise.all([
      getUnit(deps.pool, unitId),
      listDocumentTypes(deps.pool),
      listUnitTenancies(deps.pool, unitId),
    ]);
    html(reply);
    return renderUploadPage({
      nav: chromeOf(deps, request),
      csrf: csrfFrom(request),
      unit,
      types,
      lettings,
    });
  });

  app.post('/documents', FILE, async (request, reply) => {
    const { fields, bytes } = await readUpload(request);
    // **The token is checked here and not in the hook**, because the hook runs before the handler
    // and this body is a stream: reading the field there would consume the parts `readUpload` is
    // about to iterate. The comparison is `src/staff/`'s, not a second implementation of one.
    //
    // It is checked *after* the parts are read and *before* anything is written, which is the only
    // order available: the field arrives inside the thing being defended. The bytes are held in
    // memory and bounded at 20 MB by `LIMITS`, so a forged post costs a bounded read and no row.
    verifyCsrf(sessionTokenOf(request), fields[CSRF_FIELD]);
    // The caller, bounded, before the type lookup and before a single object is written.
    const operator = requireOperator(request);
    await boundTheCaller(deps, operator);
    const unitId = validId(fields.unit ?? '', 'unit');
    const typeKey = fields.type ?? '';
    const tenancyId = fields.tenancy
      ? validId(fields.tenancy, 'tenancy')
      : null;

    const type = await documentTypeByKey(deps.pool, typeKey);
    if (!type) {
      throw new KernelError('invalid', 'that is not a document type');
    }
    const unit = await getUnit(deps.pool, unitId);

    const result = await fileDocument(await filingDeps(deps), {
      bytes,
      typeKey: type.typeKey,
      place: placeFor(type.typeKey, unit),
      tenancyId,
      filedBy: operator,
    });

    html(reply);
    if (!result.filed) {
      // A refusal is the form again, with what was chosen still chosen and the missing terms above
      // it. **422 and not 400**: the request was well formed and the file was wrong, and an
      // operator who sees a 400 in a log goes looking for a bug in the form.
      reply.code(422);
      const lettings = await listUnitTenancies(deps.pool, unitId);
      return renderUploadPage({
        nav: chromeOf(deps, request),
        csrf: csrfFrom(request),
        unit,
        types: await listDocumentTypes(deps.pool),
        lettings,
        declaredTypeKey: type.typeKey,
        declaredTenancyId: tenancyId ?? undefined,
        refused: { type, verification: result.verification },
      });
    }
    if (
      isProtocolType(type.typeKey) &&
      result.verification.verdict === 'verified'
    ) {
      return reply.redirect(`/documents/${result.documentId}/seed`);
    }
    if (
      type.typeKey === 'lease' &&
      tenancyId === null &&
      result.verification.verdict === 'verified'
    ) {
      return reply.redirect(`/documents/${result.documentId}/tenancy`);
    }
    if (
      type.typeKey === 'lease_amendment' &&
      tenancyId !== null &&
      result.verification.verdict === 'verified'
    ) {
      return reply.redirect(`/documents/${result.documentId}/tenancy`);
    }
    return renderFiledPage({
      nav: chromeOf(deps, request),
      unit,
      type,
      inserted: result.inserted,
      boundToTenancy: tenancyId !== null,
      verification: result.verification,
      fileHash: fileHashOf(result.storageUri),
      documentId: result.documentId,
    });
  });

  /**
   * **A12. The document says where it belongs, and the system looks it up.** Slice 6.3.
   *
   * The order below is the whole of the slice, and each step is where it is for a reason:
   *
   * 1. the parts, then `verifyCsrf` — the token arrives *inside* the body being defended, so it
   *    cannot be checked earlier, and it is checked before anything is written, which is 3.3's
   *    argument unchanged;
   * 2. the operator and the cap, before a byte is parsed and before an OCR call is spent;
   * 3. the type and the sniff, so a file that is not one of the four kinds is refused here rather
   *    than after a read;
   * 4. **a unit posted from a refusal's list short-circuits the reader.** The operator has answered
   *    the question the address could not, and re-reading the page to second-guess them would make
   *    the candidate list decorative;
   * 5. otherwise the text, the reading, the resolution — and either exactly one flat, or a 422 that
   *    writes **no row and no object**. `fileDocument` is not reached in that branch at all, which
   *    is what makes "nothing was written" a property of the control flow rather than a promise.
   */
  app.post('/documents/intake', INTAKE, async (request, reply) => {
    const { fields, bytes } = await readUpload(request);
    verifyCsrf(sessionTokenOf(request), fields[CSRF_FIELD]);
    const operator = requireOperator(request);
    await boundTheCaller(deps, operator);

    const type = await documentTypeByKey(deps.pool, fields.type ?? '');
    if (!type) {
      throw new KernelError('invalid', 'that is not a document type');
    }
    const extension = sniffExtension(bytes);
    const chosen = fields.unit ? validId(fields.unit, 'unit') : null;

    let unit: UnitHit;
    // What the reader read off these bytes, kept so `fileDocument` need not read them again (6.4).
    // Undefined on the short-circuit below, where nothing was read because nothing needed to be.
    let readPages: { native: PdfPage[]; ocr?: PdfPage[] } | undefined;
    if (chosen) {
      unit = await getUnit(deps.pool, chosen);
    } else {
      const read = await intakeText(deps, bytes, extension);
      readPages = { native: read.native, ocr: read.ocr };
      const reading = readPlace(read.text);
      const resolved = await resolvePlace(deps.pool, reading);
      if (!resolved.unit) {
        // **The refusal, audited.** The log is this system's record of attempts (5.2), and an
        // intake that read a page and placed nothing is an attempt: it consumed the work the cap
        // bounds, and without a line there is nothing to count and nothing to read back when an
        // operator says a lease would not file. The inputs name the file and never its contents —
        // a digest, a kind, a size, a number of candidates. Not the address it read: that is on
        // the screen in front of the operator, and a log is not where a document's text goes.
        await createAuditLog(deps.pool, deps.clock).write(
          {
            actorKind: 'staff',
            actorId: operator,
            actorRole: request.staff?.role ?? undefined,
            action: 'evidence.intake_unresolved',
            inputs: {
              typeKey: type.typeKey,
              extension,
              bytes: bytes.length,
              fileHash: documentFileHash(bytes),
              candidates: resolved.candidates.length,
            },
          },
          { outcome: 'ok' },
        );
        html(reply);
        // 422 and not 400, for 3.3's reason: the request was well formed and the answer was not
        // there. A 400 in a log sends somebody looking for a bug in the form.
        reply.code(422);
        return renderIntakePage({
          nav: chromeOf(deps, request),
          csrf: csrfFrom(request),
          types: await listDocumentTypes(deps.pool),
          declaredTypeKey: type.typeKey,
          reading,
          candidates: resolved.candidates,
          total: resolved.total,
          query: reading.addressLine ?? '',
        });
      }
      unit = resolved.unit;
    }

    const result = await fileDocument(await filingDeps(deps), {
      bytes,
      typeKey: type.typeKey,
      place: placeFor(type.typeKey, unit),
      // A12 files against a place and never against a letting: which tenancy a lease *is* comes
      // from the lease, on the confirm screen this redirects to. Invariant 1 is kept by A2, where
      // it always was.
      tenancyId: null,
      filedBy: operator,
      readPages,
    });

    html(reply);
    if (!result.filed) {
      reply.code(422);
      return renderUploadPage({
        nav: chromeOf(deps, request),
        csrf: csrfFrom(request),
        unit,
        types: await listDocumentTypes(deps.pool),
        lettings: await listUnitTenancies(deps.pool, unit.unit_id),
        declaredTypeKey: type.typeKey,
        refused: { type, verification: result.verification },
      });
    }
    if (result.verification.verdict === 'verified') {
      if (isProtocolType(type.typeKey)) {
        return reply.redirect(`/documents/${result.documentId}/seed`);
      }
      if (type.typeKey === 'lease') {
        return reply.redirect(`/documents/${result.documentId}/tenancy`);
      }
    }
    return renderFiledPage({
      nav: chromeOf(deps, request),
      unit,
      type,
      inserted: result.inserted,
      boundToTenancy: false,
      verification: result.verification,
      fileHash: fileHashOf(result.storageUri),
      documentId: result.documentId,
    });
  });

  app.get<{ Params: { documentId: string } }>(
    '/documents/:documentId/read',
    READ,
    async (request, reply) => {
      const documentId = validId(request.params.documentId, 'document');
      const ocrVersion = (await readOcrSettings(createSettings(deps.pool)))
        .processorVersion;
      const read = await readFiledDocument(
        {
          db: deps.pool,
          objects: deps.objects,
          pdf: deps.pdf,
          ocr: deps.ocr ?? createUnconfiguredOcr(),
          ocrVersion,
          audit: createAuditLog(deps.pool, deps.clock),
          clock: deps.clock,
          bucket: deps.bucket,
        },
        documentId,
      );
      const subject = await deps.pool.query<{
        entity_type: string;
        entity_id: string;
      }>(
        `SELECT entity_type, entity_id FROM document_link
          WHERE document_id = $1 AND link_role = 'SUBJECT' LIMIT 1`,
        [documentId],
      );
      const extracted = await listExtractedFields(deps.pool, documentId);
      // The stance, once, before either branch renders — and the line written only when the viewer
      // holds the permission *and* the document actually carried an identifier.
      const identifiers = mayReadIdentifiers(request);
      if (identifiers) {
        await logIdentifierRead(deps, request, {
          documentId,
          typeKey: read.typeKey,
          rows: extracted,
        });
      }
      const link = subject.rows[0];
      const asked = (request.query as { page?: string }).page;
      const at = pageIndex(asked, read.pages.length);
      const page = read.pages[at] ?? null;
      const image =
        page === null
          ? null
          : (read.images.find((img) => img.pageNumber === page.number) ?? null);
      html(reply);
      if (link?.entity_type === 'UNIT') {
        const unit = await getUnit(deps.pool, link.entity_id);
        return renderReadPage({
          nav: chromeOf(deps, request),
          csrf: csrfFrom(request),
          documentId,
          buildingId: unit.building_id,
          buildingName: unit.building_name,
          unitId: unit.unit_id,
          typeKey: read.typeKey,
          labelHe: read.labelHe,
          fileHash: read.fileHash,
          source: read.source,
          page,
          image,
          extracted,
          mayReadIdentifiers: identifiers,
        });
      }
      if (link?.entity_type === 'BUILDING') {
        const detail = await getBuilding(deps.pool, link.entity_id);
        return renderReadPage({
          nav: chromeOf(deps, request),
          csrf: csrfFrom(request),
          documentId,
          buildingId: detail.building.building_id,
          buildingName: detail.building.name,
          unitId: null,
          typeKey: read.typeKey,
          labelHe: read.labelHe,
          fileHash: read.fileHash,
          source: read.source,
          page,
          image,
          extracted,
          mayReadIdentifiers: identifiers,
        });
      }
      throw new KernelError('not_found', 'document not found');
    },
  );

  app.post<{ Params: { documentId: string } }>(
    '/documents/:documentId/promote',
    CONFIRM,
    async (request, reply) => {
      const documentId = validId(request.params.documentId, 'document');
      const fields = await readFields(request);
      await promoteExtractedField(
        {
          db: deps.pool,
          audit: createAuditLog(deps.pool, deps.clock),
          clock: deps.clock,
        },
        {
          extractedFieldId: validId(
            fields.extracted_field_id ?? '',
            'extracted field',
          ),
          promotedBy: requireOperatorEmail(request),
        },
      );
      return reply.redirect(`/documents/${documentId}/read`);
    },
  );

  const seedDeps = () => ({
    db: deps.pool,
    objects: deps.objects,
    pdf: deps.pdf,
    bucket: deps.bucket,
  });

  app.get<{ Params: { documentId: string } }>(
    '/documents/:documentId/seed',
    READ,
    async (request, reply) => {
      const documentId = validId(request.params.documentId, 'document');
      const proposed = await proposeProtocol(seedDeps(), documentId);
      html(reply);
      return renderSeedPage(
        await seedScreen(
          deps,
          proposed,
          csrfFrom(request),
          chromeOf(deps, request),
        ),
      );
    },
  );

  app.post<{ Params: { documentId: string } }>(
    '/documents/:documentId/seed',
    CONFIRM,
    async (request, reply) => {
      const documentId = validId(request.params.documentId, 'document');
      const proposed = await proposeProtocol(seedDeps(), documentId);
      const confirmed = await confirmProtocol(seedDeps(), documentId);
      const screen = await seedScreen(
        deps,
        proposed,
        csrfFrom(request),
        chromeOf(deps, request),
      );
      html(reply);
      return renderSeededPage({
        nav: chromeOf(deps, request),
        buildingId: screen.buildingId,
        buildingName: screen.buildingName,
        unitId: screen.unitId,
        handoverDate: proposed.proposal.handoverDate ?? '',
        warrantyEndDate: confirmed.warrantyEndDate,
        assetsWritten: confirmed.assetsWritten,
        alreadySeeded: confirmed.alreadySeeded,
      });
    },
  );

  app.get<{ Params: { documentId: string } }>(
    '/documents/:documentId/tenancy',
    READ,
    async (request, reply) => {
      const documentId = validId(request.params.documentId, 'document');
      const proposed = await proposeLeaseTenancy(deps.pool, documentId);
      html(reply);
      return renderTenancyPage({
        ...proposed,
        nav: chromeOf(deps, request),
        csrf: csrfFrom(request),
      });
    },
  );

  app.post<{ Params: { documentId: string } }>(
    '/documents/:documentId/tenancy',
    CONFIRM,
    async (request, reply) => {
      const documentId = validId(request.params.documentId, 'document');
      const fields = await readFields(request);
      const roles: Record<string, TenancyRole> = {};
      for (const [name, value] of Object.entries(fields)) {
        if (name.startsWith('role-')) {
          roles[name.slice(5)] = value as TenancyRole;
        }
      }
      const confirmed = await confirmLeaseTenancy(
        {
          db: deps.pool,
          audit: createAuditLog(deps.pool, deps.clock),
          clock: deps.clock,
        },
        {
          documentId,
          termsProfileName: fields.terms_profile ?? '',
          confirmedBy: requireOperatorEmail(request),
          roles,
        },
      );
      const proposed = await proposeLeaseTenancy(deps.pool, documentId);
      html(reply);
      return renderTenancyWrittenPage({
        nav: chromeOf(deps, request),
        unit: proposed.unit,
        typeKey: proposed.typeKey,
        startDate: proposed.startDate ?? '',
        endDate: proposed.endDate ?? '',
        partiesWritten: confirmed.partiesWritten,
        alreadyEstablished: confirmed.alreadyEstablished,
      });
    },
  );
}

interface Upload {
  fields: Record<string, string>;
  bytes: Buffer;
}

/**
 * The multipart body, read once and bounded.
 *
 * `@fastify/multipart` is the one runtime dependency this slice added, and the reason is that an
 * HTML file input posts `multipart/form-data` and hand-writing a parser for a boundary-delimited
 * stream of untrusted input is precisely the work a maintained plugin exists to save. It is
 * Fastify's own, over busboy.
 *
 * Parts are iterated rather than taken from `request.file()`, because that helper's `fields` carry
 * only what arrived *before* the file and would silently depend on the order of inputs in the form.
 * A second file is drained and discarded rather than ignored: an unread part stalls the request.
 */
async function readFields(request: {
  parts: () => AsyncIterableIterator<
    | { type: 'field'; fieldname: string; value: unknown }
    | { type: 'file'; toBuffer: () => Promise<Buffer> }
  >;
}): Promise<Record<string, string>> {
  const fields: Record<string, string> = {};
  for await (const part of request.parts()) {
    if (part.type === 'file') {
      await part.toBuffer();
      continue;
    }
    fields[part.fieldname] = String(part.value);
  }
  return fields;
}

async function readUpload(request: {
  parts: () => AsyncIterableIterator<
    | { type: 'field'; fieldname: string; value: unknown }
    | {
        type: 'file';
        fieldname: string;
        file: { truncated: boolean };
        toBuffer: () => Promise<Buffer>;
      }
  >;
}): Promise<Upload> {
  const fields: Record<string, string> = {};
  let bytes: Buffer | null = null;
  for await (const part of request.parts()) {
    if (part.type === 'file') {
      const read = await part.toBuffer();
      if (part.file.truncated) {
        throw new KernelError('invalid', 'the file is larger than we accept', {
          maxBytes: LIMITS.fileSize,
        });
      }
      if (part.fieldname === 'file' && !bytes) {
        bytes = read;
      }
      continue;
    }
    fields[part.fieldname] = String(part.value);
  }
  if (!bytes || bytes.length === 0) {
    throw new KernelError('invalid', 'no file was attached');
  }
  return { fields, bytes };
}

/**
 * The dependencies `fileDocument` is called with. **Written once at 6.3**, when A12 became its
 * second caller and the alternative was the same fourteen lines in two handlers — including the two
 * settings reads, which were a round trip each on a path that had already paid for a pdf parse.
 */
async function filingDeps(deps: DocumentDeps) {
  const settings = createSettings(deps.pool);
  const [extraction, ocr] = await Promise.all([
    readExtractionSettings(settings),
    readOcrSettings(settings),
  ]);
  return {
    db: deps.pool,
    objects: deps.objects,
    pdf: deps.pdf,
    ocr: deps.ocr,
    ocrVersion: ocr.processorVersion,
    extractor: deps.extractor,
    extractModel: extraction.model,
    extractReasoningEffort: extraction.reasoningEffort,
    work: deps.work,
    audit: createAuditLog(deps.pool, deps.clock),
    clock: deps.clock,
    bucket: deps.bucket,
  };
}

/**
 * Where a document of this type is filed. One type files against the building and every other
 * against the flat, and both routes ask the same function rather than each carrying the conditional.
 */
function placeFor(
  typeKey: string,
  unit: UnitHit,
): { kind: 'BUILDING' | 'UNIT'; id: string } {
  return typeKey === 'building_handover_protocol'
    ? { kind: 'BUILDING', id: unit.building_id }
    : { kind: 'UNIT', id: unit.unit_id };
}

/**
 * The text A12's reader reads, **and the pages it was read from**.
 *
 * A pdf with a text layer is parsed and that is the end of it. A scan has none, so OCR is the only
 * way to a printed address.
 *
 * **6.3's known cost, paid off here.** Until 6.4 this function returned a bare string and threw the
 * pages away, so `fileDocument` read the same bytes again a moment later — a second pdfjs parse
 * always, and for a scan a second Document AI call, because its own verdict on a page with no text
 * layer comes back `unverified`. Returning what was read, and handing it over in `readPages`, is the
 * fix 6.3 named: the request carries what has been paid for, and `fileDocument` is widened by one
 * optional field rather than by a new responsibility.
 *
 * **An unconfigured OCR is not an error.** It is the ordinary local state, and it reads as a
 * document that names no place: the screen then asks, which is the same screen a genuinely
 * unplaceable lease gets.
 */
async function intakeText(
  deps: DocumentDeps,
  bytes: Buffer,
  extension: keyof typeof documentContentTypes,
): Promise<{ text: string; native: PdfPage[]; ocr?: PdfPage[] }> {
  const native = extension === 'pdf' ? await deps.pdf.pages(bytes) : [];
  if (native.some((page) => page.items.length > 0)) {
    return { text: documentText(native), native };
  }
  if (!ocrConfigured(deps.ocr)) {
    return { text: '', native };
  }
  const ocrVersion = (await readOcrSettings(createSettings(deps.pool)))
    .processorVersion;
  try {
    const result = await deps.ocr.pages(
      bytes,
      documentContentTypes[extension],
      ocrVersion,
    );
    return { text: documentText(result.pages), native, ocr: result.pages };
  } catch {
    // A reader that cannot read is a screen that asks. It is never a 503: the operator can still
    // choose the flat, and the document is still fileable.
    return { text: '', native };
  }
}

/**
 * The digest, read back off the uri the intake returned.
 *
 * It is the path's leaf by construction (slice 3.2), so the screen shows the same string the row
 * holds rather than a second hash of the same bytes taken for display.
 */
function fileHashOf(storageUri: string): string {
  const leaf = storageUri.slice(storageUri.lastIndexOf('/') + 1);
  return leaf.slice(0, leaf.lastIndexOf('.'));
}

async function seedScreen(
  deps: DocumentDeps,
  proposed: ProtocolProposal,
  csrf: string,
  nav: Html,
): Promise<SeedScreen> {
  if (proposed.placeKind === 'UNIT') {
    const unit = await getUnit(deps.pool, proposed.placeId);
    return {
      nav,
      csrf,
      documentId: proposed.documentId,
      labelHe: proposed.labelHe,
      buildingId: unit.building_id,
      buildingName: unit.building_name,
      unitId: unit.unit_id,
      unitNumber: unit.unit_number,
      handoverDate: proposed.proposal.handoverDate,
      apartmentNumber: proposed.proposal.apartmentNumber,
      warrantyEndDate: proposed.proposal.handoverDate
        ? addCalendarYears(proposed.proposal.handoverDate, WARRANTY_YEARS)
        : null,
      assets: proposed.proposal.assets,
    };
  }
  const detail = await getBuilding(deps.pool, proposed.placeId);
  return {
    nav,
    csrf,
    documentId: proposed.documentId,
    labelHe: proposed.labelHe,
    buildingId: detail.building.building_id,
    buildingName: detail.building.name,
    unitId: null,
    unitNumber: null,
    handoverDate: proposed.proposal.handoverDate,
    apartmentNumber: null,
    warrantyEndDate: proposed.proposal.handoverDate
      ? addCalendarYears(proposed.proposal.handoverDate, WARRANTY_YEARS)
      : null,
    assets: proposed.proposal.assets,
  };
}
