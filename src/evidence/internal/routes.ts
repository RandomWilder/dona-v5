// Evidence's HTTP surface — the upload screen and the post that files a document. Slice 3.3, flow
// A1, and **the first write route in this system**.
//
// Every route before this one was a read. SPEC-evidence.md, "The first write route in this system,
// and it has no session", is where the bounds that stand in for a session until week 5 are set out
// and argued; they are applied here: one file, 20 MB, four kinds sniffed from the bytes, no filename
// kept, and nothing personal in the response.
//
// **There is no CSRF token, and that is not an omission.** A CSRF token defends a session's
// authority, and there is no session: an anonymous caller can already post directly. Week 5's login
// is the slice that owes one, in the same change that gives this route something worth riding.
import multipart from '@fastify/multipart';
import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import {
  addCalendarYears,
  getBuilding,
  getUnit,
  WARRANTY_YEARS,
} from '../../estate/contract.ts';
import { createAuditLog } from '../../kernel/audit.ts';
import type { Clock } from '../../kernel/clock.ts';
import { createSettings, readOcrSettings } from '../../kernel/config.ts';
import { KernelError } from '../../kernel/errors.ts';
import type { ObjectStore } from '../../kernel/objects.ts';
import { createUnconfiguredOcr, type OcrText } from '../../kernel/ocr.ts';
import type { PdfText } from '../../kernel/pdf.ts';
import { validId } from '../../kernel/validate.ts';
import { listUnitTenancies } from '../../tenancy/contract.ts';
import { documentTypeByKey, listDocumentTypes } from './catalogue.ts';
import { fileDocument } from './intake.ts';
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
  renderUploadPage,
} from './views.ts';

export interface DocumentDeps {
  pool: Pool;
  objects: ObjectStore;
  pdf: PdfText;
  ocr?: OcrText;
  clock: Clock;
  /** The bucket `storage_uri` names. The memory store's stand-in locally (slice 3.2). */
  bucket: string;
}

/**
 * One file, and it may not be a large one.
 *
 * A lease is a few hundred kilobytes and a scanned one a few megabytes; twenty is generous and is
 * chosen as a bound on a runaway rather than as a budget, which is `kernel/extraction.ts`'s
 * reasoning about its own timeout. `fields` and `fieldSize` are bounded for the same reason: this
 * route is reachable by anybody until week 5.
 */
const LIMITS = {
  files: 1,
  fileSize: 20 * 1024 * 1024,
  fields: 8,
  fieldSize: 200,
};

function html(reply: { header: (k: string, v: string) => unknown }): void {
  reply.header('content-type', 'text/html; charset=utf-8');
  reply.header('cache-control', 'no-cache');
  reply.header('x-content-type-options', 'nosniff');
}

export function registerDocumentRoutes(
  app: FastifyInstance,
  deps: DocumentDeps,
): void {
  app.register(multipart, { limits: LIMITS });

  // The screen. Reached from a unit on the building page, so the unit is in the query string and is
  // validated before it reaches a query — a malformed id is `invalid` and a well-formed one that is
  // not there is `not_found`, and neither says which.
  app.get('/documents/new', async (request, reply) => {
    const asked = (request.query as { unit?: string }).unit ?? '';
    const unitId = validId(asked, 'unit');
    const [unit, types, lettings] = await Promise.all([
      getUnit(deps.pool, unitId),
      listDocumentTypes(deps.pool),
      listUnitTenancies(deps.pool, unitId),
    ]);
    html(reply);
    return renderUploadPage({ unit, types, lettings });
  });

  app.post('/documents', async (request, reply) => {
    const { fields, bytes } = await readUpload(request);
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

    const result = await fileDocument(
      {
        db: deps.pool,
        objects: deps.objects,
        pdf: deps.pdf,
        ocr: deps.ocr,
        ocrVersion: (await readOcrSettings(createSettings(deps.pool)))
          .processorVersion,
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
      const link = subject.rows[0];
      html(reply);
      if (link?.entity_type === 'UNIT') {
        const unit = await getUnit(deps.pool, link.entity_id);
        return renderReadPage({
          buildingId: unit.building_id,
          buildingName: unit.building_name,
          unitId: unit.unit_id,
          labelHe: read.labelHe,
          fileHash: read.fileHash,
          source: read.source,
          page: read.pages[0] ?? null,
          image: read.images[0] ?? null,
        });
      }
      if (link?.entity_type === 'BUILDING') {
        const detail = await getBuilding(deps.pool, link.entity_id);
        return renderReadPage({
          buildingId: detail.building.building_id,
          buildingName: detail.building.name,
          unitId: null,
          labelHe: read.labelHe,
          fileHash: read.fileHash,
          source: read.source,
          page: read.pages[0] ?? null,
          image: read.images[0] ?? null,
        });
      }
      throw new KernelError('not_found', 'document not found');
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
    async (request, reply) => {
      const documentId = validId(request.params.documentId, 'document');
      const proposed = await proposeProtocol(seedDeps(), documentId);
      html(reply);
      return renderSeedPage(await seedScreen(deps, proposed));
    },
  );

  app.post<{ Params: { documentId: string } }>(
    '/documents/:documentId/seed',
    async (request, reply) => {
      const documentId = validId(request.params.documentId, 'document');
      const proposed = await proposeProtocol(seedDeps(), documentId);
      const confirmed = await confirmProtocol(seedDeps(), documentId);
      const screen = await seedScreen(deps, proposed);
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
): Promise<SeedScreen> {
  if (proposed.placeKind === 'UNIT') {
    const unit = await getUnit(deps.pool, proposed.placeId);
    return {
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
