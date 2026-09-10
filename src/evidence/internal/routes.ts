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
import {
  addCalendarYears,
  getBuilding,
  getUnit,
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
import type { PdfText } from '../../kernel/pdf.ts';
import { requireText, validId } from '../../kernel/validate.ts';
import {
  CSRF_FIELD,
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
import { listExtractedFields } from './extract.ts';
import { fileDocument } from './intake.ts';
import { confirmLeaseTenancy, proposeLeaseTenancy } from './lease.ts';
import { promoteExtractedField } from './promote.ts';
import { isProtocolType } from './protocol.ts';
import { readFiledDocument } from './read.ts';
import {
  confirmProtocol,
  type ProtocolProposal,
  proposeProtocol,
} from './seed.ts';
import type { SeedScreen } from './views.ts';
import {
  renderFiledPage,
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
  const filed = await countActions(deps.pool, {
    action: 'evidence.file_document',
    actorId: staffAccountId,
    since,
  });
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
/**
 * The token this session's forms carry. Derived once by the composition root's guard; a screen
 * reads it and never computes it, which is what stops two screens deriving it two ways.
 */
function csrfOf(request: FastifyRequest): string {
  return request.csrf ?? '';
}

function requireOperator(request: FastifyRequest): string {
  const id = request.staff?.staffAccountId;
  if (id === undefined) {
    throw new KernelError('not_allowed', 'not_allowed');
  }
  return id;
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
const CONFIRM = { config: { staff: 'tenancy.write' } } as const;

export function registerDocumentRoutes(
  app: FastifyInstance,
  deps: DocumentDeps,
): void {
  app.register(multipart, { limits: LIMITS });

  // The screen. Reached from a unit on the building page, so the unit is in the query string and is
  // validated before it reaches a query — a malformed id is `invalid` and a well-formed one that is
  // not there is `not_found`, and neither says which.
  app.get('/documents/new', NEW, async (request, reply) => {
    const asked = (request.query as { unit?: string }).unit ?? '';
    const unitId = validId(asked, 'unit');
    const [unit, types, lettings] = await Promise.all([
      getUnit(deps.pool, unitId),
      listDocumentTypes(deps.pool),
      listUnitTenancies(deps.pool, unitId),
    ]);
    html(reply);
    return renderUploadPage({ csrf: csrfOf(request), unit, types, lettings });
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
    const extraction = await readExtractionSettings(createSettings(deps.pool));

    const result = await fileDocument(
      {
        db: deps.pool,
        objects: deps.objects,
        pdf: deps.pdf,
        ocr: deps.ocr,
        ocrVersion: (await readOcrSettings(createSettings(deps.pool)))
          .processorVersion,
        extractor: deps.extractor,
        extractModel: extraction.model,
        extractReasoningEffort: extraction.reasoningEffort,
        work: deps.work,
        audit: createAuditLog(deps.pool, deps.clock),
        clock: deps.clock,
        bucket: deps.bucket,
      },
      {
        bytes,
        typeKey: type.typeKey,
        place:
          type.typeKey === 'building_handover_protocol'
            ? { kind: 'BUILDING', id: unit.building_id }
            : { kind: 'UNIT', id: unitId },
        tenancyId,
        filedBy: operator,
      },
    );

    html(reply);
    if (!result.filed) {
      // A refusal is the form again, with what was chosen still chosen and the missing terms above
      // it. **422 and not 400**: the request was well formed and the file was wrong, and an
      // operator who sees a 400 in a log goes looking for a bug in the form.
      reply.code(422);
      const lettings = await listUnitTenancies(deps.pool, unitId);
      return renderUploadPage({
        csrf: csrfOf(request),
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
      unit,
      type,
      inserted: result.inserted,
      boundToTenancy: tenancyId !== null,
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
          csrf: csrfOf(request),
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
        });
      }
      if (link?.entity_type === 'BUILDING') {
        const detail = await getBuilding(deps.pool, link.entity_id);
        return renderReadPage({
          csrf: csrfOf(request),
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
          promotedBy: requireText(fields.promoted_by ?? '', 'promoted_by', 200),
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
      return renderSeedPage(await seedScreen(deps, proposed, csrfOf(request)));
    },
  );

  app.post<{ Params: { documentId: string } }>(
    '/documents/:documentId/seed',
    CONFIRM,
    async (request, reply) => {
      const documentId = validId(request.params.documentId, 'document');
      const proposed = await proposeProtocol(seedDeps(), documentId);
      const confirmed = await confirmProtocol(seedDeps(), documentId);
      const screen = await seedScreen(deps, proposed, csrfOf(request));
      html(reply);
      return renderSeededPage({
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
      return renderTenancyPage({ ...proposed, csrf: csrfOf(request) });
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
          confirmedBy: fields.confirmed_by ?? '',
          roles,
        },
      );
      const proposed = await proposeLeaseTenancy(deps.pool, documentId);
      html(reply);
      return renderTenancyWrittenPage({
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
): Promise<SeedScreen> {
  if (proposed.placeKind === 'UNIT') {
    const unit = await getUnit(deps.pool, proposed.placeId);
    return {
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
