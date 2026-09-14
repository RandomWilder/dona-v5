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
import type { PdfText } from '../../kernel/pdf.ts';
import type { Html } from '../../kernel/ui/html.ts';
import { optionalText, requireText, validId } from '../../kernel/validate.ts';
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
import {
  declareDocumentTypeField,
  documentTypeByKey,
  documentTypeFieldCounts,
  documentTypeFields,
  FIELD_VALUE_TYPES,
  type FieldValueType,
  listDocumentTypes,
  retireDocumentTypeField,
} from './catalogue.ts';
import { anchorOf } from './documents.ts';
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
import {
  type DocumentReading,
  ocrConfigured,
  readFiledDocument,
  readForVerdict,
} from './read.ts';
import {
  confirmProtocol,
  type ProtocolProposal,
  proposeProtocol,
} from './seed.ts';
import {
  type documentContentTypes,
  documentFileHash,
  sniffExtension,
} from './storage-path.ts';
import type { AnchoredPlace, SeedScreen } from './views.ts';
import {
  renderDocumentsPage,
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
  /**
   * Slice 5.2b, and **`mayFile` from 6.9**: the rail's documents destination is gated on
   * `documents.write`, so the caller passes the stance rather than the rail guessing it.
   */
  chrome: (csrf: string, dest: ChromeDest, mayFile: boolean) => Html;
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
  // **`'documents'` from 6.9, and `'estate'` before it.** These are this module's screens, so the
  // rail marks its own destination on them rather than marking the one next door — which is what a
  // reader following the bar back from a filed document saw until 6.9: the estate tab lit up, on a
  // page that is not estate's.
  return deps.chrome(
    csrfFrom(request),
    'documents',
    can(request.staff?.role ?? null, 'documents.write'),
  );
}

/**
 * Whether this viewer may shape the estate — `estate.write`, ADMIN's. **Slice 6.9.**
 *
 * Read once per refusal and used only to decide whether the create offer is rendered. The routes it
 * leads to declare `estate.write` themselves, so this is what keeps an operator from being shown a
 * door they cannot walk through, and never what keeps them out of it.
 */
function mayShapeTheEstate(request: FastifyRequest): boolean {
  return can(request.staff?.role ?? null, 'estate.write');
}

/**
 * A document type carried back from A11 or A13, so the screen comes back with it still chosen.
 * Bounded at the edge like every other query value; a key naming no type simply selects nothing.
 */
function declaredType(request: FastifyRequest): string {
  return String((request.query as { type?: string }).type ?? '').slice(0, 64);
}

/**
 * The edge validators for the declaration editor. Slice 7.2.
 *
 * Every one of them refuses rather than coerces, which is SPEC.md's rule for an input at the edge.
 * They are here rather than in `src/settings-page.ts` beside their twins because that file is the
 * composition root's screen and this route belongs to this module — a shared parser would be the
 * module edge `src/kernel/boundary.test.ts` polices, for four lines.
 */
type Form = Record<string, string | undefined>;

/** `type_key` out of the path. A key is a key, never a sentence and never a wildcard. */
const TYPE_KEY = /^[a-z][a-z0-9_]*$/;
/**
 * **`field_key` is the name a value is stored under and is never renamed**, so it is constrained
 * harder than a label: lowercase ASCII, digits and underscores. That is also what makes the money
 * guard's token match on it exact — `fee` cannot fire on a Hebrew label that happens to transliterate.
 */
const FIELD_KEY = /^[a-z][a-z0-9_]{0,62}[a-z0-9]$|^[a-z]$/;

function declaredKey(raw: string): string {
  const key = String(raw ?? '').slice(0, 64);
  if (!TYPE_KEY.test(key)) {
    throw new KernelError('invalid', 'typeKey is not a type key');
  }
  return key;
}

function fieldKeyOf(body: unknown): string {
  const key = requireText(
    (body as Form | undefined)?.field_key,
    'field_key',
    64,
  );
  if (!FIELD_KEY.test(key)) {
    throw new KernelError(
      'invalid',
      'field_key is lowercase latin letters, digits and underscores, and starts with a letter',
    );
  }
  return key;
}

function valueTypeOf(body: unknown): FieldValueType {
  const raw = requireText(
    (body as Form | undefined)?.value_type,
    'value_type',
    16,
  );
  // Against the catalogue's own array and never a list typed here, so this and the `CHECK` in
  // `0011_evidence.sql` cannot disagree — and so there is no place to add MONEY by hand.
  if (!(FIELD_VALUE_TYPES as readonly string[]).includes(raw)) {
    throw new KernelError('invalid', 'value_type is not a declared value type');
  }
  return raw as FieldValueType;
}

function optionalTextOf(
  body: unknown,
  name: string,
  max: number,
): string | null {
  const raw = (body as Form | undefined)?.[name];
  if (raw === undefined || raw.trim() === '') return null;
  return optionalText(raw, name, max);
}

function checked(body: unknown, name: string): boolean {
  const raw = (body as Form | undefined)?.[name];
  return raw === 'true' || raw === 'on';
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
// **Slice 7.2.** `settings.write`, ADMIN only, and already the hand on the `DocumentType`
// catalogue since 5.8 — so `src/staff/internal/roles.ts` does not change. A permission with one
// reader adds vocabulary without adding a boundary, and the matrix stays code.
//
// **Proved red at `documents.write`**, which an OPERATOR holds: the refusal case in
// `routes.test.ts` answered 303 with the declaration written, and the output is in
// `tasks/evidence/7.2.md`. A stance is the only thing that refusal is about, so the only honest
// way to write it red is to register the wrong one.
const DECLARE = { config: { staff: 'settings.write' } } as const;

export function registerDocumentRoutes(
  app: FastifyInstance,
  deps: DocumentDeps,
): void {
  app.register(multipart, { limits: LIMITS });

  // **The tab's landing. Slice 7.1.**
  //
  // What the reader will look for on the page, before anybody chooses a file — the catalogue and,
  // for the chosen type, the declarations governing today. Both are read at run time, which is A8
  // and the only reason this screen can be honest about a schema that is data.
  //
  // **The day is a parameter and never `CURRENT_DATE`**, for the reason every date in this system
  // is one (`SPEC.md`): a query the tests cannot pin fails on a Tuesday. It comes off `deps.clock`
  // like every other date this module writes.
  //
  // **`NEW`, the same `documents.write` the rail item carries.** An ungated landing behind a gated
  // tab is the door that answers `not_allowed` after somebody walked through it — 6.1's
  // refusal-after-typing, which A11 declined to build for its own form.
  app.get('/documents', NEW, async (request, reply) => {
    const asked = (request.query as { type?: string }).type ?? '';
    const types = await listDocumentTypes(deps.pool);
    // An unknown key falls back rather than 404ing: the parameter is a picker's state and not an
    // address, and a retired type reaching this screen from a stale bookmark is a page that should
    // still show something true.
    const on = deps.clock.now().toISOString().slice(0, 10);
    // **The default is the most-declared type, and clicking the screen is what wrote this rule.**
    // The catalogue comes back ordered by `type_key`, so the first row is `arnona` — which declares
    // no fields, and made the tab's own landing the emptiest page in the console. "The first one
    // that declares anything" is no better: that is `building_handover_protocol` with one field,
    // which is alphabetical accident wearing a reason.
    //
    // So the rule is the type the system knows the most about, which today is the lease with eight.
    // **No type key is compiled in here and none may be** — which type leads is a fact about the
    // data and has to stay one (A8), so it is read out of the same declarations the screen prints.
    // Ties and an empty catalogue both fall back to the catalogue's own order.
    const counts = await documentTypeFieldCounts(deps.pool, on);
    const chosen =
      types.find((type) => type.typeKey === asked) ??
      [...types].sort(
        (a, b) => (counts.get(b.typeKey) ?? 0) - (counts.get(a.typeKey) ?? 0),
      )[0] ??
      null;
    const fields = chosen
      ? await documentTypeFields(deps.pool, chosen.typeKey, on)
      : [];
    const saved = (request.query as { saved?: string }).saved;
    html(reply);
    return renderDocumentsPage({
      nav: chromeOf(deps, request),
      csrf: csrfFrom(request),
      types,
      chosen,
      fields,
      on,
      // **Slice 7.2.** `settings.write`, which is ADMIN only and has been the hand on the
      // `DocumentType` catalogue since 5.8. The landing keeps `documents.write` above, so an
      // OPERATOR reads this page and is simply not shown the editor.
      mayWrite: can(request.staff?.role ?? null, 'settings.write'),
      ...(saved === 'declared' || saved === 'retired' ? { saved } : {}),
    });
  });

  // **The declaration an administrator writes. Slice 7.2, flow A14.**
  //
  // Foundation rule 8 says a document type is a row and a field is a row, and that new ones cost no
  // migration and no deploy. The type half has been true since 3.1. This is the field half, and
  // until now it cost a commit to `src/evidence/fixtures/document-types.ts` and a run of
  // `npm run seed:doctypes` — a deploy wearing a seed's clothes, paid three times.
  //
  // **`settings.write`, and `src/staff/internal/roles.ts` does not change.** A permission with one
  // reader adds vocabulary without adding a boundary, and the matrix stays code.
  //
  // **No `csrf: 'in-body'`.** That flag is an *exemption* from the composition root's CSRF
  // preHandler, held by `POST /documents` alone because a multipart stream cannot be read there
  // without consuming it (6.1's finding). This body is urlencoded and the preHandler reads it;
  // `src/guard.test.ts` asserts the exempt list is still exactly one route.
  app.post<{ Params: { typeKey: string } }>(
    '/documents/types/:typeKey/fields',
    DECLARE,
    async (request, reply) => {
      const typeKey = declaredKey(request.params.typeKey);
      // The day, off the injected clock and never `CURRENT_DATE` — the same line `GET /documents`
      // reads its declaration for, so the screen and the write agree about which day this is.
      const on = deps.clock.now().toISOString().slice(0, 10);
      const action = requireText(
        (request.body as Form | undefined)?.action,
        'action',
        16,
      );
      const fieldKey = fieldKeyOf(request.body);
      const audit = createAuditLog(deps.pool, deps.clock);
      const actor = {
        actorKind: 'staff' as const,
        actorId: request.staff?.staffAccountId,
        actorRole: request.staff?.role ?? undefined,
      };
      if (action === 'retire') {
        // **The audit line is written around the work** and carries the refusal too: a declaration
        // refused is the case somebody asks about afterwards, and `around` is what records both
        // outcomes without the handler choosing which to log.
        await audit.around(
          {
            ...actor,
            action: 'evidence.retire_field',
            inputs: { typeKey, fieldKey, on },
          },
          () => retireDocumentTypeField(deps.pool, { typeKey, fieldKey, on }),
        );
        return reply
          .code(303)
          .header(
            'location',
            `/documents?type=${encodeURIComponent(typeKey)}&saved=retired`,
          )
          .send();
      }
      if (action !== 'declare') {
        throw new KernelError('invalid', 'action is not declare or retire');
      }
      const declaration = {
        typeKey,
        fieldKey,
        labelHe: requireText(
          (request.body as Form | undefined)?.label_he,
          'label_he',
          120,
        ),
        valueType: valueTypeOf(request.body),
        isRequired: checked(request.body, 'is_required'),
        extractionHint: optionalTextOf(request.body, 'extraction_hint', 500),
        on,
      };
      await audit.around(
        {
          ...actor,
          action: 'evidence.declare_field',
          // The declaration, and never a document's text: a key, a value type, a flag and a day.
          // The Hebrew label is the administrator's own words about a form and not about a person.
          inputs: {
            typeKey,
            fieldKey,
            valueType: declaration.valueType,
            isRequired: declaration.isRequired,
            on,
          },
        },
        () => declareDocumentTypeField(deps.pool, declaration),
      );
      return reply
        .code(303)
        .header(
          'location',
          `/documents?type=${encodeURIComponent(typeKey)}&saved=declared`,
        )
        .send();
    },
  );

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
      // **The way back from A13. Slice 6.9.** An admin who has just created the flat this document
      // belongs to returns here with it as a pre-checked candidate — not to A1's unit-first screen,
      // which offers a tenancy binding at the door that 6.3's ruling forbids on this path. Nothing
      // was held while the estate was being shaped, so the file input comes back armed and empty.
      const anchor = (request.query as { anchor?: string }).anchor ?? '';
      const declared = declaredType(request);
      const [types, found, anchored] = await Promise.all([
        listDocumentTypes(deps.pool),
        query ? searchEstate(deps.pool, query) : null,
        anchor ? getUnit(deps.pool, validId(anchor, 'unit')) : null,
      ]);
      html(reply);
      return renderIntakePage({
        nav: chromeOf(deps, request),
        csrf: csrfFrom(request),
        types,
        ...(declared ? { declaredTypeKey: declared } : {}),
        ...(anchored
          ? {
              candidates: [anchored],
              total: 1,
              chosenUnitId: anchored.unit_id,
            }
          : {}),
        // A search is a refusal still being answered, so the screen stays in the state that offered
        // it: what was read is unknown here, and the reading it prints is the empty one.
        ...(found
          ? {
              reading: {
                addressLine: null,
                city: null,
                apartmentNumber: null,
                annexDeferral: false,
              },
              candidates: found.units,
              total: found.units.length,
              query,
              mayCreate: mayShapeTheEstate(request),
              building: null,
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
        refused: {
          type,
          verification: result.verification,
          reason: result.refusal,
          // Slice 6.10. Present only on `anchored`, where naming the flat is the whole refusal.
          ...(result.anchoredTo
            ? { anchoredTo: await anchorScreen(deps, result.anchoredTo) }
            : {}),
        },
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
    // What the reader read off these bytes, kept so `fileDocument` need not read them again (6.4,
    // widened at 6.8 to carry the verdict it was taken with). Undefined on the short-circuit below,
    // where nothing was read because nothing needed to be.
    let read: DocumentReading | undefined;
    if (chosen) {
      unit = await getUnit(deps.pool, chosen);
    } else {
      read = await intakeReading(
        deps,
        bytes,
        extension,
        type.verificationTerms,
      );
      if (read.ocrOutcome === 'too_large') {
        // **Refused at the door, and before the place reader runs. Slice 6.8.** This file is larger
        // than the online call carries, so nothing was read off it — and a candidate list built on
        // no reading is a question the operator cannot answer. The sentence names the cause
        // instead, which is 6.9's one-cause-one-sentence bar arriving early because it costs
        // nothing here.
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
              candidates: 0,
              ocr: read.ocrOutcome,
              pages: read.native.length,
            },
          },
          { outcome: 'ok' },
        );
        html(reply);
        reply.code(422);
        return renderIntakePage({
          nav: chromeOf(deps, request),
          csrf: csrfFrom(request),
          types: await listDocumentTypes(deps.pool),
          declaredTypeKey: type.typeKey,
          tooLargeBytes: bytes.length,
        });
      }
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
              // **What became of the reader. Slice 6.8, added after the first click.** 6.8 put the
              // OCR outcome on `evidence.file_document` and forgot this line — and this is the one
              // A12 writes when it cannot place a document, which is exactly the case where
              // somebody asks afterwards whether the reader ran at all. Without it, an OCR that
              // failed and an OCR that read a page naming an address nobody holds are one row.
              // Still no address, no city and no document text: that is on the operator's screen,
              // and a log is not where a document's words go.
              ocr: read.ocrOutcome,
              pages: read.native.length,
              ...(read.pagesRead === undefined
                ? {}
                : { pagesRead: read.pagesRead }),
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
          // **Slice 6.9.** `estate.write` and not `documents.write`: an operator files paper and an
          // admin decides a flat exists (A11). The route this offer leads to asks for the same
          // permission on its own stance, so this decides what is *shown* and never what is allowed.
          mayCreate: mayShapeTheEstate(request),
          // Which offer. A building the address matched is *add the flat*; none is *create the
          // building and the flat*.
          building: resolved.building
            ? {
                building_id: resolved.building.building_id,
                name: resolved.building.name,
              }
            : null,
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
      reading: read,
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
        refused: {
          type,
          verification: result.verification,
          reason: result.refusal,
          // Slice 6.10. The same cause, the same sentence, a different door — 6.8's precedent for
          // the two upload routes sharing one refusal screen.
          ...(result.anchoredTo
            ? { anchoredTo: await anchorScreen(deps, result.anchoredTo) }
            : {}),
        },
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
      // **Slice 6.9.** Nobody chose this flat on the reading branch, so the receipt says what was
      // read and where it landed. `undefined` on the short-circuit, where the operator picked a
      // candidate and no reading was ever taken.
      ...(read ? { reading: readPlace(read.text) } : {}),
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
      // **Slice 6.10.** This was the second unordered `LIMIT 1` over `document_link`'s `SUBJECT`
      // rows, and on a document carrying two of them it drew the page's back link and its building
      // name off whichever came back. One read for both call sites now, and it is the place the
      // bytes are filed under.
      const anchor = await anchorOf(deps.pool, documentId);
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
      const asked = (request.query as { page?: string }).page;
      const at = pageIndex(asked, read.pages.length);
      const page = read.pages[at] ?? null;
      const image =
        page === null
          ? null
          : (read.images.find((img) => img.pageNumber === page.number) ?? null);
      html(reply);
      if (anchor.kind === 'UNIT') {
        const unit = await getUnit(deps.pool, anchor.id);
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
      if (anchor.kind === 'BUILDING') {
        const detail = await getBuilding(deps.pool, anchor.id);
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
      const fields = formBody(request);
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

  // Slice 6.5: the proposal writes an audit line of its own now — `evidence.match_identifier`, when
  // the lease declared an identifier for the resolution to compare — so it takes the same deps the
  // confirm has always taken, rather than a bare pool.
  const leaseDeps = () => ({
    db: deps.pool,
    audit: createAuditLog(deps.pool, deps.clock),
    clock: deps.clock,
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
      const proposed = await proposeLeaseTenancy(leaseDeps(), {
        documentId,
        readBy: requireOperatorEmail(request),
      });
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
      const fields = formBody(request);
      const roles: Record<string, TenancyRole> = {};
      for (const [name, value] of Object.entries(fields)) {
        if (name.startsWith('role-')) {
          roles[name.slice(5)] = value as TenancyRole;
        }
      }
      // `attach_tenancy` is the radio group on the confirm screen. Empty, absent or the literal
      // `new` is *a new letting*, which is what this flow did and all it could do before 6.5.
      const attach = fields.attach_tenancy ?? '';
      const confirmedBy = requireOperatorEmail(request);
      const confirmed = await confirmLeaseTenancy(leaseDeps(), {
        documentId,
        termsProfileName: fields.terms_profile ?? '',
        confirmedBy,
        roles,
        attachTenancyId: attach === '' || attach === 'new' ? null : attach,
      });
      const proposed = await proposeLeaseTenancy(leaseDeps(), {
        documentId,
        readBy: confirmedBy,
      });
      // Slice 6.5: on an attach the dates belong to the letting, not to the paper. Showing the
      // document's own would read as though attaching had rewritten the term — which is the one
      // thing that branch is built not to do.
      const bound = proposed.candidates.find(
        (candidate) => candidate.tenancyId === confirmed.tenancyId,
      );
      html(reply);
      return renderTenancyWrittenPage({
        nav: chromeOf(deps, request),
        unit: proposed.unit,
        typeKey: proposed.typeKey,
        startDate:
          (confirmed.attached ? bound?.startDate : proposed.startDate) ?? '',
        endDate: (confirmed.attached ? bound?.endDate : proposed.endDate) ?? '',
        partiesWritten: confirmed.partiesWritten,
        alreadyEstablished: confirmed.alreadyEstablished,
        attached: confirmed.attached,
      });
    },
  );
}

interface Upload {
  fields: Record<string, string>;
  bytes: Buffer;
}

/**
 * **A form that carries no file is an ordinary form. Slice 6.5, found by clicking.**
 *
 * Two of this module's forms posted `multipart/form-data` and carried nothing but text — the lease
 * confirm from 4.6 and the promote button from 4.3. That was harmless until **5.2**, which put the
 * CSRF check in a `preHandler` reading `request.body`: a multipart body leaves that undefined, so
 * both buttons answered **403** in a browser from the day the token landed. Nothing caught it,
 * because the suite calls these handlers rather than posting to them, and `csrf: 'in-body'` — the
 * one exemption — is held by the two routes whose bodies really are streams.
 *
 * The fix is not a third exemption. It is that these bodies were never streams: the composition
 * root's `registerFormBodies` parser has handled urlencoded since 5.1, so dropping the `enctype`
 * from the two forms puts them back inside the check rather than around it.
 */
function formBody(request: FastifyRequest): Record<string, string> {
  const body = request.body;
  if (body === null || typeof body !== 'object') {
    throw new KernelError('invalid', 'that form carried no fields');
  }
  return Object.fromEntries(
    Object.entries(body as Record<string, unknown>).map(([name, value]) => [
      name,
      String(value),
    ]),
  );
}

/**
 * The multipart body, read once and bounded.
 *
 * `@fastify/multipart` is the one runtime dependency slice 3.3 added, and the reason is that an
 * HTML file input posts `multipart/form-data` and hand-writing a parser for a boundary-delimited
 * stream of untrusted input is precisely the work a maintained plugin exists to save. It is
 * Fastify's own, over busboy.
 *
 * Parts are iterated rather than taken from `request.file()`, because that helper's `fields` carry
 * only what arrived *before* the file and would silently depend on the order of inputs in the form.
 * A second file is drained and discarded rather than ignored: an unread part stalls the request.
 *
 * **`readFields`, its fieldless twin, went at 6.5**, with the two forms that had no business being
 * multipart. What is left is the two routes whose bodies really are streams, and they are exactly
 * the two the composition root exempts from the CSRF `preHandler`.
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
 * A place, in the words the refusal screen prints. Slice 6.10.
 *
 * `fileDocument` returns an anchor as a kind and an id — it deals in places, not in names — and this
 * is where those become a flat somebody recognises and a door they can walk through. A `PROJECT` or
 * a `SPACE` has no screen of its own, so it reads as *filed elsewhere*: the ruling is that the
 * upload is refused, and how completely the refusal can describe the other place is a display
 * question and not the rule.
 */
async function anchorScreen(
  deps: DocumentDeps,
  anchor: { kind: string; id: string },
): Promise<AnchoredPlace | undefined> {
  if (anchor.kind === 'UNIT') {
    const unit = await getUnit(deps.pool, anchor.id);
    return {
      href: `/estate/units/${unit.unit_id}`,
      unitNumber: unit.unit_number,
      buildingName: unit.building_name,
      addressLine: unit.address_line,
      city: unit.city,
    };
  }
  if (anchor.kind === 'BUILDING') {
    const detail = await getBuilding(deps.pool, anchor.id);
    return {
      href: `/estate/buildings/${detail.building.building_id}`,
      unitNumber: null,
      buildingName: detail.building.name,
      addressLine: detail.building.address_line,
      city: detail.building.city,
    };
  }
  return undefined;
}

/**
 * The reading A12's place reader reads, **and the verdict it was taken with**.
 *
 * **6.3's known cost, paid off at 6.4; 6.8's defect, paid off here.** Until 6.4 this function
 * returned a bare string and threw the pages away, so `fileDocument` read the same bytes again a
 * moment later. Until 6.8 it also carried its own copy of the wrong condition — OCR only when a PDF
 * had no text layer at all — which is why the week-6 demo's phone scan was never given to Document
 * AI even once: CamScanner had left a text layer, and a text layer was the end of the question.
 *
 * There is one function that decides this now (`readForVerdict`), and this one is a thin call to it
 * that supplies the processor version the settings row holds. The declared type's terms are the
 * condition, so a scan whose own layer does not look like the type it was declared as is worth the
 * call — which is the whole of defect (b).
 *
 * **An unconfigured OCR is not an error.** It is the ordinary local state, and it reads as a
 * document that names no place: the screen then asks, which is the same screen a genuinely
 * unplaceable lease gets.
 */
async function intakeReading(
  deps: DocumentDeps,
  bytes: Buffer,
  extension: keyof typeof documentContentTypes,
  verificationTerms: string[] | null,
): Promise<DocumentReading> {
  const ocrVersion = ocrConfigured(deps.ocr)
    ? (await readOcrSettings(createSettings(deps.pool))).processorVersion
    : undefined;
  return readForVerdict(
    { pdf: deps.pdf, ocr: deps.ocr, ocrVersion },
    { bytes, extension, verificationTerms },
  );
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
