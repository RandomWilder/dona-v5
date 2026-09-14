// The token-discipline guard. Lifted from v3's `src/kernel/ui/tokens.test.ts` at slice 1.11, which
// is the first slice with a screen for it to guard — 1.4 left it behind on purpose, because it
// asserted against module HTML shells v5 did not have.
//
// **One change from v3, and it makes the guard stronger.** v3's screens were static files, so v3's
// guard read files. v5's screens are functions, so this one renders them and asserts on the bytes
// that actually reach the wire. A file the route does not serve is not the thing under test.
//
// The discipline erodes in the screens and not in the stylesheet, which is why the assertions are
// about the page: a hex colour typed into a view is how a design system stops being one.
//
// **Adding a screen means adding it to SCREENS.** One registry, so week 5's staff screens append
// here rather than copy this file — the second copy is how a guard dies.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
// The root index is the composition root's screen from 5.2, not estate's. It is in this registry
// under the same rule as every other screen: rendered here, asserted on the bytes.
import { signedInChrome } from '../../src/chrome.ts';
import type {
  BuildingDetail,
  BuildingSummary,
  ExpiringLease,
  FiledDocumentView,
  SearchPageResults,
  UnitHit,
} from '../../src/estate/contract.ts';
import {
  renderBuildingPage,
  renderBuildingsPage,
  renderExpiringPage,
  renderIncompletePage,
  renderNewBuildingPage,
  renderNewUnitPage,
  renderSearchPage,
  renderUnitPage,
} from '../../src/estate/contract.ts';
import type {
  DocumentTypeFieldRow,
  DocumentTypeRow,
  ExtractedRow,
} from '../../src/evidence/contract.ts';
import {
  renderDocumentsPage,
  renderFieldsPage,
  renderFiledPage,
  renderIntakePage,
  renderReadPage,
  renderSeededPage,
  renderSeedPage,
  renderTenancyPage,
  renderTenancyWrittenPage,
  renderUploadPage,
} from '../../src/evidence/contract.ts';
import { renderIndexPage } from '../../src/index-page.ts';
import { hasIdentifierRun } from '../../src/kernel/identifier.ts';
import { CSRF_FIELD } from '../../src/kernel/ui/page.ts';
import { renderSettingsPage } from '../../src/settings-page.ts';
import {
  renderLoginPage,
  renderStaffHomePage,
} from '../../src/staff/contract.ts';
import { CALLS_STUB, renderStubPage } from '../../src/stub-page.ts';
import type { UnitLetting } from '../../src/tenancy/contract.ts';

const building: BuildingSummary = {
  building_id: '11111111-1111-4111-8111-111111111111',
  name: 'בניין רקפת 12',
  address_line: 'רקפת 12',
  city: 'שוהם',
  status: 'ACTIVE',
  handover_date: '2025-03-01',
  warranty_end_date: '2027-03-01',
  project_name: 'שוהם — רקפת',
  project_code: 'SHM-01',
  unit_count: '72',
  space_count: '184',
};

const detail: BuildingDetail = {
  building,
  kinds: [
    { space_kind: 'UNIT', n: '72' },
    { space_kind: 'PARKING', n: '60' },
  ],
  units: [
    {
      unit_id: '22222222-2222-4222-8222-222222222222',
      unit_number: '12A',
      floor: '2',
      rooms: '3.5',
      area_sqm: '78.5',
      has_mamad: true,
      condition_status: 'READY',
      warranty_end_date: null,
      parking_name: 'ח-1',
      storage_name: null,
    },
    {
      unit_id: '33333333-3333-4333-8333-333333333333',
      unit_number: '13',
      floor: null,
      rooms: '4',
      area_sqm: null,
      has_mamad: false,
      condition_status: 'WITHHELD',
      warranty_end_date: '2027-09-01',
      parking_name: null,
      storage_name: null,
    },
  ],
};

// Slice 2.6's screens. **The occupancy chip has to be asserted in both states**: a card that is let
// and a card that is not are different markup, and the guard reads bytes rather than functions.
const occupancy = new Map([['22222222-2222-4222-8222-222222222222', 2]]);

const hit: UnitHit = {
  unit_id: '44444444-4444-4444-8444-444444444444',
  unit_number: '7',
  building_id: building.building_id,
  building_name: building.name,
  address_line: building.address_line,
  city: building.city,
};

const results: SearchPageResults = {
  buildings: [building],
  units: [hit],
  documents: [],
  truncated: true,
};

const filed: FiledDocumentView = {
  documentId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  typeKey: 'lease',
  labelHe: 'חוזה שכירות',
  ingestedAt: '2026-09-07',
  validFrom: '2025-01-01',
  validTo: '2026-12-31',
  storageUri:
    'gs://dona-v5-staging-docs/unit/22222222-2222-4222-8222-222222222222/lease/' +
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.pdf',
  verificationVerdict: 'verified',
  readUrl:
    'https://storage.googleapis.com/dona-v5-staging-docs/unit/x.pdf' +
    '?X-Goog-Algorithm=GOOG4-RSA-SHA256&X-Goog-Expires=900&X-Goog-Signature=ab',
};

const unverified: FiledDocumentView = {
  ...filed,
  documentId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  typeKey: 'handover_protocol',
  labelHe: 'פרוטוקול מסירה',
  validFrom: null,
  validTo: null,
  storageUri:
    'gs://dona-v5-staging-docs/building/11111111-1111-4111-8111-111111111111/handover_protocol/' +
    'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.pdf',
  verificationVerdict: 'unverified',
  readUrl:
    'https://storage.googleapis.com/dona-v5-staging-docs/building/y.pdf' +
    '?X-Goog-Algorithm=GOOG4-RSA-SHA256&X-Goog-Expires=900&X-Goog-Signature=cd',
};

const expiring: ExpiringLease[] = [
  {
    tenancy_id: '55555555-5555-4555-8555-555555555555',
    unit_id: hit.unit_id,
    unit_number: '7',
    building_id: building.building_id,
    building_name: building.name,
    city: building.city,
    end_date: '2026-09-20',
    days_left: 14,
  },
  {
    tenancy_id: '66666666-6666-4666-8666-666666666666',
    unit_id: '77777777-7777-4777-8777-777777777777',
    unit_number: '12A',
    building_id: building.building_id,
    building_name: building.name,
    city: building.city,
    end_date: '2026-11-01',
    days_left: 56,
  },
];

// Slice 3.3's screens. The upload form is the first screen in this system that *writes*, and it is
// in this registry for the reason every other one is: the guard reads rendered bytes, so a screen
// that is not rendered here is a screen nothing checks. Both of its answers are registered —
// a refusal is a different page from the empty form, and the refusal is the one that renders text
// the catalogue supplied.
// **Slice 7.1.** One declaration per shape the landing has to print: a required field with a hint,
// an optional one, and a field whose declaration opens on a different day from the others — which
// is what makes the single version chip turn into a per-row column. R18's `effective_from` is the
// version, so a table mixing two of them is an ordinary table and not an error state.
const documentTypeFields: DocumentTypeFieldRow[] = [
  {
    documentTypeFieldId: 'aaaaaaaa-0000-4000-8000-000000000001',
    fieldKey: 'address',
    labelHe: 'כתובת המושכר',
    valueType: 'TEXT',
    isRequired: true,
    extractionHint: 'כתובת הנכס המושכר, לא כתובת של אחד הצדדים',
    effectiveFrom: '2026-09-07',
    effectiveTo: null,
  },
  {
    documentTypeFieldId: 'aaaaaaaa-0000-4000-8000-000000000002',
    fieldKey: 'guarantor_name',
    labelHe: 'שם הערב',
    valueType: 'TEXT',
    isRequired: false,
    extractionHint: null,
    effectiveFrom: '2026-09-07',
    effectiveTo: null,
  },
];

const documentTypes: DocumentTypeRow[] = [
  {
    documentTypeId: '88888888-8888-4888-8888-888888888888',
    typeKey: 'lease',
    labelHe: 'חוזה שכירות',
    labelEn: 'Lease',
    verificationTerms: ['חוזה שכירות', 'המושכר', 'תקופת השכירות'],
    isActive: true,
  },
  {
    documentTypeId: '99999999-9999-4999-8999-999999999999',
    typeKey: 'arnona',
    labelHe: 'ארנונה',
    labelEn: 'Municipal tax bill',
    verificationTerms: ['ארנונה', 'המחזיק', 'הרשות המקומית'],
    isActive: true,
  },
];

const lettings: UnitLetting[] = [
  {
    tenancy_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    start_date: '2025-01-01',
    end_date: '2027-12-31',
    status: 'ACTIVE',
  },
  {
    tenancy_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    start_date: '2022-01-01',
    end_date: '2024-12-31',
    status: 'ENDED',
  },
];

// A token shaped like the real one — 64 hex characters — so an assertion about the *shape* of what
// a form carries is testing the shape a session actually produces.
const CSRF = 'a1b2c3d4'.repeat(8);
// **Every one of these is a rail for a role that may file. Slice 6.9.** The rail's documents
// destination is the one gated item on it, so a nav built with `false` is a different screen and is
// registered as one — `root · index, צופה` and `root · settings, viewer` below are where the
// registry holds that variant.
const NAV = signedInChrome(CSRF, 'estate', true);
const NAV_SEARCH = signedInChrome(CSRF, 'search', true);
const NAV_EXPIRING = signedInChrome(CSRF, 'expiring', true);
const NAV_INCOMPLETE = signedInChrome(CSRF, 'incomplete', true);
const NAV_STAFF = signedInChrome(CSRF, 'staff', true);
const NAV_DOCUMENTS = signedInChrome(CSRF, 'documents', true);

/**
 * **The read overlay at a stance. Slice 6.4.**
 *
 * One screen, two roles, and the registry is where the difference is asserted — 6.1, 6.2 and 6.3
 * each did the same with their admin doors rather than writing a second guard. The captured rows are
 * an apartment number, which everybody may see, and a ת.ז., which only a holder of
 * `party.national_id.read` may. The identifier fixture is deliberately a value that matches no
 * assertion this file already makes: `312345678` carries no `05` run and no `+972`, so a failure
 * here is this rule failing and never another one firing on the same digits.
 */
const READ_IDENTIFIER = '312345678';

/**
 * **The two names the fixtures put on a lease. Slice 6.6.**
 *
 * Consts rather than five literals, because the rule they are about is asserted over the registry
 * and an assertion cannot search for a string somebody has retyped. SPEC.md's sixth reconsideration
 * of *a state and a count, never a tenant's name* is what these are here for: a screen **about one
 * document** may transcribe what that document says, the names on it included, because the operator
 * is holding the paper and the screen is how they check the machine read it. A screen reached by
 * browsing the estate may not. A transcription is not a disclosure; a register is.
 */
const TENANT_NAME = 'יעל כהן';
const GUARANTOR_NAME = 'רותם ערב';

function readOverlay(mayReadIdentifiers: boolean): string {
  return renderReadPage({
    nav: NAV,
    csrf: CSRF,
    documentId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    buildingId: building.building_id,
    buildingName: building.name,
    unitId: hit.unit_id,
    typeKey: 'lease',
    labelHe: 'חוזה שכירות',
    fileHash: 'e'.repeat(64),
    source: 'ocr',
    mayReadIdentifiers,
    page: {
      number: 1,
      width: 100,
      height: 200,
      items: [
        {
          text: 'דירה',
          x: 10,
          y: 40,
          width: 30,
          height: 20,
          rightToLeft: true,
          endsLine: false,
          confidence: 0.91,
        },
        // **Slice 6.6, and the word this whole slice is about.** The page printed the ת.ז., so the
        // reader measured it, so the overlay has a box for it — and until 6.6 that box carried the
        // word in a `title` attribute at every stance. A word box is the one thing on this page
        // whose text comes from the document rather than from a fixture, which is why 6.5 could not
        // catch this with a registry assertion and why the case below renders a page whose words
        // the test itself chose.
        {
          text: READ_IDENTIFIER,
          x: 10,
          y: 80,
          width: 40,
          height: 20,
          rightToLeft: false,
          endsLine: true,
          confidence: 0.88,
        },
      ],
    },
    image: {
      pageNumber: 1,
      mimeType: 'image/png',
      bytes: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
        'base64',
      ),
    },
    extracted: [
      {
        extractedFieldId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
        fieldKey: 'apartment_number',
        labelHe: 'מספר הדירה',
        value: '14',
        page: 1,
        bbox: { x: 10, y: 40, width: 30, height: 20 },
        confidence: 0.91,
        promotionTarget: null,
        promotedTo: null,
      },
      {
        extractedFieldId: 'ffffffff-ffff-4fff-8fff-fffffffffffe',
        fieldKey: 'tenant_id_number',
        labelHe: 'ת.ז. השוכר',
        value: READ_IDENTIFIER,
        page: 1,
        bbox: { x: 10, y: 80, width: 40, height: 20 },
        confidence: 0.88,
        promotionTarget: null,
        promotedTo: null,
      },
    ],
  });
}

/**
 * **Slice 7.3, the approval ledger.** The seventh document-shaped screen, registered at three
 * stances the way 6.4's overlay is at two: what an ADMIN sees before they ask for the ת.ז., what an
 * OPERATOR sees instead of it, and the one row a reveal discloses. The difference between the three
 * is a permission and a request, and this registry is where every role difference in this console is
 * asserted.
 */
const FIELDS_DOCUMENT = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

function reading(
  extractedFieldId: string,
  fieldKey: string,
  labelHe: string,
  value: string,
  confidence: number | null,
  over: Partial<ExtractedRow> = {},
): ExtractedRow {
  return {
    extractedFieldId,
    documentTypeFieldId: 'aaaaaaaa-0000-4000-8000-00000000000f',
    fieldKey,
    labelHe,
    value,
    page: 1,
    bbox: { x: 10, y: 40, width: 30, height: 20 },
    confidence,
    model: 'gpt-test',
    promotionTarget: null,
    promotedTo: null,
    promotedBy: null,
    promotedAt: null,
    approvedValue: null,
    approvedBy: null,
    approvedAt: null,
    ...over,
  };
}

function fieldsLedger(options: {
  mayReadIdentifiers: boolean;
  revealed?: string;
  saved?: number;
}): string {
  const identifier = 'dddddddd-0000-4000-8000-000000000004';
  return renderFieldsPage({
    nav: NAV,
    csrf: CSRF,
    documentId: FIELDS_DOCUMENT,
    buildingId: building.building_id,
    buildingName: building.name,
    unitId: hit.unit_id,
    labelHe: 'חוזה שכירות',
    on: '2026-09-14',
    rows: [
      reading(
        'dddddddd-0000-4000-8000-000000000001',
        'start_date',
        'תחילת תקופת השכירות',
        '2026-02-01',
        0.96,
        { promotionTarget: 'tenancy.start_date' },
      ),
      reading(
        'dddddddd-0000-4000-8000-000000000002',
        'tenant_name',
        'שם השוכר',
        TENANT_NAME,
        0.71,
      ),
      // The ordinary case on a lease that was produced digitally rather than scanned: every word
      // arrives with no score at all, so the row is flagged and says why.
      reading(
        'dddddddd-0000-4000-8000-000000000003',
        'apartment_number',
        'מספר הדירה',
        '24',
        null,
      ),
      reading(
        identifier,
        'tenant_id_number',
        'ת.ז. השוכר',
        READ_IDENTIFIER,
        0.91,
      ),
      // Already signed, and corrected on the way: both values on the row, which is the whole reason
      // the slice adds a column instead of an UPDATE.
      reading(
        'dddddddd-0000-4000-8000-000000000005',
        'address',
        'כתובת המושכר',
        'הרב קוק 45',
        0.9,
        {
          approvedValue: 'הרב קוק 54',
          approvedBy: 'admin@example.test',
          approvedAt: new Date('2026-09-15T09:00:00.000Z'),
        },
      ),
    ],
    unread: [documentTypeFields[1] as DocumentTypeFieldRow],
    mayReadIdentifiers: options.mayReadIdentifiers,
    mayApprove: true,
    ...(options.revealed === undefined ? {} : { revealed: identifier }),
    ...(options.saved === undefined ? {} : { saved: options.saved }),
  });
}

const SCREENS: Array<[string, () => string]> = [
  // A role that may not file: no card, and from 6.9 no rail destination either.
  ['root · index, צופה', () => renderIndexPage({ csrf: CSRF, mayFile: false })],
  [
    // Slice 6.3: the same index for a role that may file a document. The door is the only
    // difference, and the registry is where it is asserted rather than in a second guard.
    'root · index, may file',
    () => renderIndexPage({ csrf: CSRF, mayFile: true }),
  ],
  [
    'estate · buildings',
    () =>
      renderBuildingsPage(
        [building],
        new Map([[building.building_id, 40]]),
        NAV,
      ),
  ],
  ['estate · buildings, empty', () => renderBuildingsPage([], new Map(), NAV)],
  [
    // Slice 6.1: the same screen for a role that may create a building. The link is the only
    // difference, and the registry is where it is asserted rather than in a second copy of a guard.
    'estate · buildings, admin',
    () =>
      renderBuildingsPage(
        [building],
        new Map([[building.building_id, 40]]),
        NAV,
        true,
      ),
  ],
  [
    'estate · new building',
    () =>
      renderNewBuildingPage({
        nav: NAV,
        csrf: CSRF,
        projects: [
          {
            project_id: '33333333-3333-4333-8333-333333333333',
            name: 'מכרז שוהם',
            project_code: 'DL-2024-SHOHAM',
            tender_ref: null,
            status: 'ACTIVE',
          },
        ],
      }),
  ],
  [
    'estate · new building, no projects',
    () => renderNewBuildingPage({ nav: NAV, csrf: CSRF, projects: [] }),
  ],
  [
    // Slice 6.9: A11 reached from A12's refusal, with what the place reader read already in the
    // fields. Prefill is a default in an input and never a write — the admin still posts this form,
    // through this form's own validation.
    'estate · new building, prefilled from a document',
    () =>
      renderNewBuildingPage({
        nav: NAV,
        csrf: CSRF,
        projects: [],
        prefill: { name: 'דקל 9', addressLine: 'דקל 9', city: 'כפר סבא' },
        carry: { unitNumber: '14', typeKey: 'lease', next: 'intake' },
      }),
  ],
  ['estate · one building', () => renderBuildingPage(detail, occupancy, NAV)],
  [
    // Slice 6.2: the same screen for a role that may add an apartment. The door is the only
    // difference, and the registry is where it is asserted rather than in a second guard.
    'estate · one building, admin',
    () => renderBuildingPage(detail, occupancy, NAV, [], true),
  ],
  [
    'estate · new apartment',
    () => renderNewUnitPage({ nav: NAV, csrf: CSRF, building }),
  ],
  [
    'estate · one building, nothing let',
    () => renderBuildingPage(detail, new Map(), NAV),
  ],
  [
    'estate · one building, with a protocol',
    () => renderBuildingPage(detail, occupancy, NAV, [unverified]),
  ],
  [
    // Slice 6.9: A13 reached from A12's refusal — the commoner of the two, because the reader finds
    // the building far more often than it finds the flat.
    'estate · new unit, prefilled from a document',
    () =>
      renderNewUnitPage({
        nav: NAV,
        csrf: CSRF,
        building,
        prefill: { unitNumber: '14' },
        carry: { typeKey: 'lease', next: 'intake' },
      }),
  ],
  ['estate · one unit', () => renderUnitPage(hit, 2, [filed], NAV)],
  [
    'estate · one unit, with a promoted date',
    () =>
      renderUnitPage(hit, 2, [filed], NAV, [
        {
          extractedFieldId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          documentId: filed.documentId,
          labelHe: 'תחילת תקופת השכירות',
          value: '2026-03-01',
          page: 1,
          confidence: 0.91,
        },
      ]),
  ],
  [
    'estate · one unit, with a change log',
    () =>
      renderUnitPage(
        hit,
        2,
        [filed],
        NAV,
        [],
        [
          {
            field: 'end_date',
            old_value: '2028-01-17',
            new_value: '2029-01-17',
            actor: 'ops@example.test',
            source_document_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          },
        ],
      ),
  ],
  [
    'estate · one unit, vacant and empty',
    () => renderUnitPage(hit, undefined, [], NAV),
  ],
  ['estate · search', () => renderSearchPage('רקפת', results, NAV_SEARCH)],
  [
    'estate · search, nothing found',
    () =>
      renderSearchPage(
        'זזז',
        {
          buildings: [],
          units: [],
          documents: [],
          truncated: false,
        },
        NAV_SEARCH,
      ),
  ],
  [
    'estate · search, no term',
    () =>
      renderSearchPage(
        '',
        {
          buildings: [],
          units: [],
          documents: [],
          truncated: false,
        },
        NAV_SEARCH,
      ),
  ],
  [
    'estate · search, a named lease',
    () =>
      renderSearchPage(
        'שכירות',
        {
          buildings: [],
          units: [],
          documents: [
            {
              ...filed,
              entityType: 'UNIT',
              entityId: hit.unit_id,
              unitId: hit.unit_id,
              unitNumber: hit.unit_number,
              buildingId: hit.building_id,
              buildingName: hit.building_name,
            },
          ],
          truncated: false,
        },
        NAV_SEARCH,
      ),
  ],
  [
    'estate · leases ending',
    () => renderExpiringPage(expiring, 60, NAV_EXPIRING),
  ],
  [
    // Hebrew counts in three. A template that only special-cases zero renders “בעוד 1 ימים”
    // every single day, which is the kind of thing a room full of Hebrew speakers reads first.
    'estate · leases ending today, tomorrow and in two days',
    () =>
      renderExpiringPage(
        [0, 1, 2].map((days, at) => ({
          ...(expiring[0] as ExpiringLease),
          tenancy_id: `0000000${at}-0000-4000-8000-00000000000${at}`,
          days_left: days,
        })),
        60,
        NAV_EXPIRING,
      ),
  ],
  [
    'estate · leases ending, none',
    () => renderExpiringPage([], 60, NAV_EXPIRING),
  ],
  [
    'estate · incomplete tenancies',
    () =>
      renderIncompletePage(
        [
          {
            tenancy_id: '55555555-5555-4555-8555-555555555555',
            unit_id: hit.unit_id,
            unit_number: '12A',
            building_id: building.building_id,
            building_name: building.name,
            city: building.city,
            start_date: '2026-03-01',
            end_date: '2027-02-28',
            status: 'DRAFT',
            missing: 'guarantor',
            expected_document_id: filed.documentId,
            expected_document_label: 'חוזה שכירות',
          },
        ],
        CSRF,
        NAV_INCOMPLETE,
      ),
  ],
  [
    'estate · incomplete tenancies, none',
    () => renderIncompletePage([], CSRF, NAV_INCOMPLETE),
  ],
  [
    // **Slice 7.1, the tab's landing.** The fifth document-shaped screen, registered here under
    // 6.6's rule: rendered, and asserted on the bytes that reach the wire.
    'documents · the declaration',
    () =>
      renderDocumentsPage({
        nav: NAV,
        csrf: CSRF,
        types: documentTypes,
        chosen: documentTypes[0] as DocumentTypeRow,
        fields: documentTypeFields,
        on: '2026-09-14',
        mayWrite: false,
      }),
  ],
  [
    // **Slice 7.2, the same screen with the editor armed.** The sixth document-shaped screen, and
    // it is registered separately rather than replacing the entry above because the difference
    // between the two is a role: an OPERATOR reads the declaration and an ADMIN writes it, and the
    // guards below assert *both* renderings — which is how every other role difference in this
    // console is asserted (6.4's read overlay at two stances, 6.6's ruling).
    'documents · the declaration, admin may edit',
    () =>
      renderDocumentsPage({
        nav: NAV,
        csrf: CSRF,
        types: documentTypes,
        chosen: documentTypes[0] as DocumentTypeRow,
        fields: documentTypeFields,
        on: '2026-09-14',
        mayWrite: true,
        saved: 'declared',
      }),
  ],
  [
    // A type the catalogue carries and nobody has declared a field for. It files and it is
    // searchable and nothing is read off it — the open half working, and a state the screen has to
    // say out loud rather than render as an empty table.
    'documents · the declaration, a type with no fields',
    () =>
      renderDocumentsPage({
        nav: NAV,
        csrf: CSRF,
        types: documentTypes,
        chosen: documentTypes[1] as DocumentTypeRow,
        fields: [],
        on: '2026-09-14',
        mayWrite: false,
      }),
  ],
  [
    'documents · field approval',
    () => fieldsLedger({ mayReadIdentifiers: true }),
  ],
  [
    // The same ledger at the stance that may not read a captured identifier: the row is not in the
    // table at all and a count stands in its place — 6.4's rule, unchanged, on a screen that is also
    // asking the viewer to sign what they can see.
    'documents · field approval, identifiers withheld',
    () => fieldsLedger({ mayReadIdentifiers: false, saved: 2 }),
  ],
  [
    // One row, asked for by name. This is the only screen in the registry that discloses a ת.ז.
    // besides 6.4's overlay, and the exemption list below says so.
    'documents · field approval, one identifier revealed',
    () => fieldsLedger({ mayReadIdentifiers: true, revealed: 'yes' }),
  ],
  [
    'documents · upload',
    () =>
      renderUploadPage({
        nav: NAV,
        csrf: CSRF,
        unit: hit,
        types: documentTypes,
        lettings,
      }),
  ],
  [
    'documents · upload, a flat with no letting on it',
    () =>
      renderUploadPage({
        nav: NAV,
        csrf: CSRF,
        unit: hit,
        types: documentTypes,
        lettings: [],
      }),
  ],
  [
    'documents · upload, refused',
    () =>
      renderUploadPage({
        nav: NAV,
        csrf: CSRF,
        unit: hit,
        types: documentTypes,
        lettings,
        declaredTypeKey: 'lease',
        declaredTenancyId: lettings[0]?.tenancy_id,
        refused: {
          type: documentTypes[0] as DocumentTypeRow,
          verification: {
            verdict: 'refused',
            // A requirement with two declared spellings and one with a single spelling, because
            // both shapes are on the catalogue from 6.8 and the screen has to print each of them.
            missingTerms: ['המושכר|הדירה', 'תקופת השכירות'],
            // **Slice 7.1.** The mixed refusal: the title requirement was found and the two body
            // requirements were not, which is the case the director's comment was about — a screen
            // that printed only the failures said two where three had been checked.
            matchedTerms: ['חוזה שכירות|הסכם שכירות'],
          },
        },
      }),
  ],
  [
    // **Slice 6.10.** The third thing this screen refuses: bytes already on file, anchored to another
    // flat. It is the only refusal that names a *place*, and the only one that is a link.
    'documents · upload, refused — already filed against another flat',
    () =>
      renderUploadPage({
        nav: NAV,
        csrf: CSRF,
        unit: hit,
        types: documentTypes,
        lettings,
        declaredTypeKey: 'lease',
        refused: {
          type: documentTypes[0] as DocumentTypeRow,
          verification: {
            verdict: 'verified',
            missingTerms: [],
            matchedTerms: [],
          },
          reason: 'anchored',
          anchoredTo: {
            href: '/estate/units/01a09f1e-0000-7000-8000-00000000000b',
            unitNumber: '12B',
            buildingName: 'בניין רקפת 12',
            addressLine: 'רקפת 12',
            city: 'שוהם',
          },
        },
      }),
  ],
  [
    // Slice 6.3, flow A12. The screen that asks for no flat.
    'documents · intake',
    () => renderIntakePage({ nav: NAV, csrf: CSRF, types: documentTypes }),
  ],
  [
    // Slice 6.8. The other refusal this screen has: nothing was read at all, because the file is
    // larger than the reader carries in one call. No candidate list, because there is no reading to
    // build one from. A *long* document is read in part and files normally; it is size that makes
    // one unreadable outright.
    'documents · intake, too large to read',
    () =>
      renderIntakePage({
        nav: NAV,
        csrf: CSRF,
        types: documentTypes,
        declaredTypeKey: 'lease',
        tooLargeBytes: 17_825_792,
      }),
  ],
  [
    // Slice 6.8, on the unit-first screen: the same cause, the same sentence, a different door.
    'documents · upload, refused for size',
    () =>
      renderUploadPage({
        nav: NAV,
        csrf: CSRF,
        unit: hit,
        types: documentTypes,
        lettings,
        declaredTypeKey: 'lease',
        refused: {
          type: documentTypes[0] as DocumentTypeRow,
          verification: {
            verdict: 'unverified',
            missingTerms: [],
            matchedTerms: [],
          },
          reason: 'too_large',
        },
      }),
  ],
  [
    'documents · intake, several flats answer to the address',
    () =>
      renderIntakePage({
        nav: NAV,
        csrf: CSRF,
        types: documentTypes,
        declaredTypeKey: 'lease',
        reading: {
          addressLine: 'רקפת 12',
          city: 'שוהם',
          apartmentNumber: '12A',
          annexDeferral: false,
        },
        candidates: [hit],
        // Slice 6.3: the list was cut, and the screen says how many there were.
        total: 72,
        query: 'רקפת 12',
      }),
  ],
  [
    // **Slice 6.9, and the reason the role split is in the registry and not in a second guard.**
    // The same refusal to an ADMIN and to an OPERATOR: one is offered the building and the flat,
    // the other the search box and nothing else.
    'documents · intake, an address in nobody portfolio, admin',
    () =>
      renderIntakePage({
        nav: NAV_DOCUMENTS,
        csrf: CSRF,
        types: documentTypes,
        declaredTypeKey: 'lease',
        reading: {
          addressLine: 'דקל 9',
          city: 'כפר סבא',
          apartmentNumber: '14',
          annexDeferral: false,
        },
        candidates: [],
        total: 0,
        mayCreate: true,
        building: null,
      }),
  ],
  [
    'documents · intake, an address in nobody portfolio, operator',
    () =>
      renderIntakePage({
        nav: NAV_DOCUMENTS,
        csrf: CSRF,
        types: documentTypes,
        declaredTypeKey: 'lease',
        reading: {
          addressLine: 'דקל 9',
          city: 'כפר סבא',
          apartmentNumber: '14',
          annexDeferral: false,
        },
        candidates: [],
        total: 0,
        mayCreate: false,
        building: null,
      }),
  ],
  [
    // The building is held and the flat is not: the offer narrows to the flat.
    'documents · intake, the building is ours and the flat is not, admin',
    () =>
      renderIntakePage({
        nav: NAV_DOCUMENTS,
        csrf: CSRF,
        types: documentTypes,
        declaredTypeKey: 'lease',
        reading: {
          addressLine: 'רקפת 12',
          city: 'שוהם',
          apartmentNumber: '999',
          annexDeferral: false,
        },
        candidates: [hit],
        total: 1,
        mayCreate: true,
        building: { building_id: building.building_id, name: building.name },
      }),
  ],
  [
    // **The fourth cause, carried in from 6.11.** A correct answer that read as a failure until
    // 6.9: the body named its property in a נספח, which A12 rules it does not read.
    'documents · intake, the document defers to an annex',
    () =>
      renderIntakePage({
        nav: NAV_DOCUMENTS,
        csrf: CSRF,
        types: documentTypes,
        declaredTypeKey: 'lease',
        reading: {
          addressLine: null,
          city: null,
          apartmentNumber: '206-7',
          annexDeferral: true,
        },
        candidates: [],
        total: 0,
        mayCreate: true,
        building: null,
      }),
  ],
  [
    // Slice 6.9: back from A13 with the new flat pre-checked, and the file to attach again.
    'documents · intake, anchored on a flat just created',
    () =>
      renderIntakePage({
        nav: NAV_DOCUMENTS,
        csrf: CSRF,
        types: documentTypes,
        declaredTypeKey: 'lease',
        candidates: [hit],
        total: 1,
        chosenUnitId: hit.unit_id,
      }),
  ],
  [
    'documents · intake, the page names no place we hold',
    () =>
      renderIntakePage({
        nav: NAV,
        csrf: CSRF,
        types: documentTypes,
        declaredTypeKey: 'lease',
        reading: {
          addressLine: null,
          city: null,
          apartmentNumber: null,
          annexDeferral: false,
        },
        candidates: [],
      }),
  ],
  [
    'documents · filed',
    () =>
      renderFiledPage({
        nav: NAV,
        unit: hit,
        type: documentTypes[0] as DocumentTypeRow,
        inserted: true,
        boundToTenancy: true,
        verification: {
          verdict: 'verified',
          missingTerms: [],
          matchedTerms: [],
        },
        fileHash: 'c'.repeat(64),
        documentId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      }),
  ],
  [
    // Slice 6.9: A12's own receipt. Nobody chose this flat, so the page says what was read and
    // where it landed — the director's ruling of 14 Sep, the indication after the match files.
    'documents · filed, and it says what it read',
    () =>
      renderFiledPage({
        nav: NAV_DOCUMENTS,
        unit: hit,
        type: documentTypes[0] as DocumentTypeRow,
        inserted: true,
        boundToTenancy: false,
        verification: {
          verdict: 'verified',
          missingTerms: [],
          matchedTerms: [],
        },
        fileHash: 'e'.repeat(64),
        documentId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
        reading: {
          addressLine: 'רקפת 12',
          city: 'שוהם',
          apartmentNumber: '12A',
          annexDeferral: false,
        },
      }),
  ],
  [
    'documents · filed, already on file and unverified',
    () =>
      renderFiledPage({
        nav: NAV,
        unit: hit,
        type: documentTypes[1] as DocumentTypeRow,
        inserted: false,
        boundToTenancy: false,
        verification: {
          verdict: 'unverified',
          missingTerms: [],
          matchedTerms: [],
        },
        fileHash: 'd'.repeat(64),
        documentId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      }),
  ],
  ['documents · read overlay', () => readOverlay(false)],
  [
    // The same screen for a role that holds `party.national_id.read`. ADMIN only, and the only
    // stance at which a captured ת.ז. is on a page in this console.
    'documents · read overlay, may read identifiers',
    () => readOverlay(true),
  ],
  [
    'documents · read overlay, no fields',
    () =>
      renderReadPage({
        nav: NAV,
        csrf: CSRF,
        documentId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
        buildingId: building.building_id,
        buildingName: building.name,
        unitId: hit.unit_id,
        typeKey: 'lease',
        labelHe: 'חוזה שכירות',
        fileHash: 'e'.repeat(64),
        source: 'ocr',
        mayReadIdentifiers: false,
        page: null,
        image: null,
      }),
  ],
  [
    'documents · seed a protocol',
    () =>
      renderSeedPage({
        nav: NAV,
        csrf: CSRF,
        documentId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        labelHe: 'פרוטוקול מסירה',
        buildingId: building.building_id,
        buildingName: building.name,
        unitId: hit.unit_id,
        unitNumber: hit.unit_number,
        handoverDate: '2024-06-01',
        apartmentNumber: '12',
        warrantyEndDate: '2026-06-01',
        assets: [
          { labelHe: 'מזגן', assetType: 'AC' },
          { labelHe: 'דוד מים', assetType: 'WATER_HEATER' },
        ],
      }),
  ],
  [
    'documents · protocol seeded',
    () =>
      renderSeededPage({
        nav: NAV,
        buildingId: building.building_id,
        buildingName: building.name,
        unitId: hit.unit_id,
        handoverDate: '2024-06-01',
        warrantyEndDate: '2026-06-01',
        assetsWritten: 2,
        alreadySeeded: false,
      }),
  ],
  [
    'documents · confirm a lease',
    () =>
      renderTenancyPage({
        nav: NAV,
        csrf: CSRF,
        documentId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        typeKey: 'lease',
        unit: hit,
        startDate: '2026-03-01',
        endDate: '2027-02-28',
        apartmentNumber: '12A',
        address: 'רקפת 12',
        people: [
          {
            extractedFieldId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
            fieldKey: 'tenant_name',
            value: TENANT_NAME,
            proposedRole: 'PRIMARY_TENANT',
            hasIdentifier: false,
          },
        ],
        matchesUnit: true,
        alreadyEstablished: false,
        boundToTenancy: false,
        termsProfileNames: ['נספח תחזוקה — תקן'],
        candidates: [],
        crossCheck: {
          addressRead: true,
          apartmentRead: true,
          addressFits: true,
          apartmentFits: true,
        },
        proposedTenancyId: null,
        identifiersRead: 0,
        identifiersPaired: 0,
      }),
  ],
  [
    // **Slice 6.5, and the stance 6.6 must not find an identifier on.** A ת.ז. *was* read off this
    // lease and paired to this person, and what the screen says about it is a sentence and a count.
    // The value is not in `TenancyScreen` at all, so this entry cannot leak one however it is
    // rendered — which is 6.4's ruling kept structurally rather than by care. A flat with two
    // lettings, one of which already holds this person, is the ranking it is here to show.
    'documents · confirm a lease, an identifier read and two lettings offered',
    () =>
      renderTenancyPage({
        nav: NAV,
        csrf: CSRF,
        documentId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        typeKey: 'lease',
        unit: hit,
        startDate: '2026-03-01',
        endDate: '2027-02-28',
        apartmentNumber: '12A',
        address: 'רקפת 12',
        people: [
          {
            extractedFieldId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
            fieldKey: 'tenant_name',
            value: TENANT_NAME,
            proposedRole: 'PRIMARY_TENANT',
            hasIdentifier: true,
          },
          {
            extractedFieldId: 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1',
            fieldKey: 'guarantor_name',
            value: GUARANTOR_NAME,
            proposedRole: 'GUARANTOR',
            hasIdentifier: false,
          },
        ],
        matchesUnit: true,
        alreadyEstablished: false,
        boundToTenancy: false,
        termsProfileNames: ['נספח תחזוקה — תקן'],
        candidates: [
          {
            tenancyId: '55555555-5555-4555-8555-555555555555',
            startDate: '2024-03-01',
            endDate: '2026-02-28',
            status: 'ENDED',
            identifierMatches: 1,
            dayOverlap: 0,
          },
          {
            tenancyId: '66666666-6666-4666-8666-666666666666',
            startDate: '2022-03-01',
            endDate: '2024-02-29',
            status: 'ENDED',
            identifierMatches: 0,
            dayOverlap: 0,
          },
        ],
        crossCheck: {
          addressRead: true,
          apartmentRead: true,
          addressFits: true,
          apartmentFits: true,
        },
        proposedTenancyId: null,
        identifiersRead: 1,
        identifiersPaired: 1,
      }),
  ],
  [
    // The same screen with a letting pre-selected: this lease starts on the day one of them does,
    // which is the case that was a dead end before 6.5 — `(unit_id, start_date)` is
    // `upsertTenancy`'s key, so creating was a conflict and attaching did not exist.
    'documents · confirm a lease, an existing letting pre-selected',
    () =>
      renderTenancyPage({
        nav: NAV,
        csrf: CSRF,
        documentId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        typeKey: 'lease',
        unit: hit,
        startDate: '2026-03-01',
        endDate: '2027-02-28',
        apartmentNumber: '12A',
        address: 'רקפת 12',
        people: [
          {
            extractedFieldId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
            fieldKey: 'tenant_name',
            value: TENANT_NAME,
            proposedRole: 'PRIMARY_TENANT',
            hasIdentifier: true,
          },
        ],
        matchesUnit: true,
        alreadyEstablished: false,
        boundToTenancy: false,
        termsProfileNames: ['נספח תחזוקה — תקן'],
        candidates: [
          {
            tenancyId: '55555555-5555-4555-8555-555555555555',
            startDate: '2026-03-01',
            endDate: '2027-02-28',
            status: 'DRAFT',
            identifierMatches: 1,
            dayOverlap: 365,
          },
        ],
        crossCheck: {
          addressRead: true,
          apartmentRead: true,
          addressFits: true,
          apartmentFits: true,
        },
        proposedTenancyId: '55555555-5555-4555-8555-555555555555',
        identifiersRead: 1,
        identifiersPaired: 1,
      }),
  ],
  [
    // **Slice 6.9. The cross-check that read nothing.** `views.ts` fired one sentence for four
    // facts until here — *the address or the apartment number do not match* — which is true of this
    // screen and sends an operator to compare two values the page prints as `לא נמצא`.
    'documents · confirm a lease, neither field was read',
    () =>
      renderTenancyPage({
        nav: NAV_DOCUMENTS,
        csrf: CSRF,
        documentId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        typeKey: 'lease',
        unit: hit,
        startDate: '2026-03-01',
        endDate: '2027-02-28',
        apartmentNumber: null,
        address: null,
        people: [],
        matchesUnit: false,
        crossCheck: {
          addressRead: false,
          apartmentRead: false,
          addressFits: false,
          apartmentFits: false,
        },
        alreadyEstablished: false,
        boundToTenancy: false,
        termsProfileNames: ['נספח תחזוקה — תקן'],
        candidates: [],
        proposedTenancyId: null,
        identifiersRead: 0,
        identifiersPaired: 0,
      }),
  ],
  [
    // The other half of the same split: both fields were read and neither is this flat's. A
    // different problem, and a different sentence.
    'documents · confirm a lease, both fields read and neither matches',
    () =>
      renderTenancyPage({
        nav: NAV_DOCUMENTS,
        csrf: CSRF,
        documentId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        typeKey: 'lease',
        unit: hit,
        startDate: '2026-03-01',
        endDate: '2027-02-28',
        apartmentNumber: '77',
        address: 'דקל 9',
        people: [],
        matchesUnit: false,
        crossCheck: {
          addressRead: true,
          apartmentRead: true,
          addressFits: false,
          apartmentFits: false,
        },
        alreadyEstablished: false,
        boundToTenancy: false,
        termsProfileNames: ['נספח תחזוקה — תקן'],
        candidates: [],
        proposedTenancyId: null,
        identifiersRead: 0,
        identifiersPaired: 0,
      }),
  ],
  [
    'documents · lease written',
    () =>
      renderTenancyWrittenPage({
        nav: NAV,
        unit: hit,
        startDate: '2026-03-01',
        endDate: '2027-02-28',
        partiesWritten: 2,
        alreadyEstablished: false,
      }),
  ],
  [
    // Slice 6.5. The dates on this page are the letting's own, and the page says so: attaching
    // writes the link and the people and never a date.
    'documents · lease attached to an existing letting',
    () =>
      renderTenancyWrittenPage({
        nav: NAV,
        unit: hit,
        startDate: '2026-03-01',
        endDate: '2027-02-28',
        partiesWritten: 2,
        alreadyEstablished: false,
        attached: true,
      }),
  ],
  [
    'documents · confirm an addendum',
    () =>
      renderTenancyPage({
        nav: NAV,
        csrf: CSRF,
        documentId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        typeKey: 'lease_amendment',
        unit: hit,
        startDate: null,
        endDate: '2028-02-28',
        apartmentNumber: null,
        address: null,
        people: [
          {
            extractedFieldId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
            fieldKey: 'guarantor_name',
            value: GUARANTOR_NAME,
            proposedRole: 'GUARANTOR',
            hasIdentifier: false,
          },
        ],
        matchesUnit: true,
        alreadyEstablished: false,
        boundToTenancy: true,
        termsProfileNames: [],
        candidates: [],
        crossCheck: {
          addressRead: true,
          apartmentRead: true,
          addressFits: true,
          apartmentFits: true,
        },
        proposedTenancyId: null,
        identifiersRead: 0,
        identifiersPaired: 0,
      }),
  ],
  // Slice 5.1's screens, **four of them deleted at 5.1b with the flow they belonged to**. Appended
  // here rather than guarded by a copy of this file — the header has said since 1.11 that week 5's
  // staff screens append to this registry, and the second copy is how a guard dies. They are also
  // the screens with the most to lose by drifting: a `<script>` on a login page is a dependency
  // loaded before anybody is authenticated, and that rule is what kept 5.1's second factor off SMS
  // and 5.1b's sign-in a plain redirect (SPEC-staff.md).
  ['staff · login', () => renderLoginPage()],
  [
    'staff · login, refused',
    () => renderLoginPage({ refused: 'לא ניתן להיכנס.' }),
  ],
  [
    'staff · login, no provider configured',
    () => renderLoginPage({ unconfigured: true }),
  ],
  [
    'staff · home, an admin',
    () =>
      renderStaffHomePage({
        nav: NAV_STAFF,
        csrf: CSRF,
        email: 'yael@example.test',
        role: 'ADMIN',
        permissions: [
          'estate.read',
          'documents.read',
          'documents.write',
          'tenancy.write',
          'settings.write',
          'staff.invite',
          'party.national_id.read',
        ],
        mayInvite: true,
      }),
  ],
  [
    'staff · home, an admin who just added an operator',
    () =>
      renderStaffHomePage({
        nav: NAV_STAFF,
        csrf: CSRF,
        email: 'yael@example.test',
        role: 'ADMIN',
        permissions: ['estate.read', 'staff.invite'],
        mayInvite: true,
        addedOperator: {
          email: 'amit@example.test',
          role: 'OPERATOR',
          created: true,
        },
      }),
  ],
  [
    'staff · home, an admin who moved an existing role',
    () =>
      renderStaffHomePage({
        nav: NAV_STAFF,
        csrf: CSRF,
        email: 'yael@example.test',
        role: 'ADMIN',
        permissions: ['estate.read', 'staff.invite'],
        mayInvite: true,
        addedOperator: {
          email: 'amit@example.test',
          role: 'VIEWER',
          created: false,
        },
      }),
  ],
  [
    'staff · home, a viewer who may not invite',
    () =>
      renderStaffHomePage({
        nav: NAV_STAFF,
        csrf: CSRF,
        email: 'dana@example.test',
        role: 'VIEWER',
        permissions: ['estate.read', 'documents.read'],
        mayInvite: false,
      }),
  ],
  [
    'root · calls stub',
    () => renderStubPage({ csrf: CSRF, mayFile: true }, CALLS_STUB, 'wired'),
  ],
  [
    'root · settings, admin',
    () =>
      renderSettingsPage({
        csrf: CSRF,
        mayWrite: true,
        mayFile: true,
        state: 'wired',
        obligations: [
          {
            obligationTypeId: '11111111-1111-4111-8111-111111111111',
            code: 'ARNONA',
            labelHe: 'ארנונה',
            labelEn: null,
            defaultResponsibleParty: 'TENANT',
            requiresEvidence: true,
            isActive: true,
          },
        ],
        documents: [
          {
            documentTypeId: '22222222-2222-4222-8222-222222222222',
            typeKey: 'lease',
            labelHe: 'חוזה שכירות',
            labelEn: null,
            verificationTerms: ['שכירות'],
            isActive: true,
          },
        ],
      }),
  ],
  [
    'root · settings, viewer',
    () =>
      renderSettingsPage({
        csrf: CSRF,
        mayWrite: false,
        mayFile: false,
        state: 'wired',
        obligations: [],
        documents: [],
      }),
  ],
];

/**
 * **Slice 6.5, found by clicking and then made impossible to repeat.**
 *
 * Two forms in this console posted `multipart/form-data` and carried nothing but text — the lease
 * confirm from 4.6 and the promote button from 4.3. Harmless until **5.2** put the CSRF check in a
 * `preHandler` that reads `request.body`, which a multipart body leaves undefined: both buttons
 * answered **403** in a browser from the day the token landed, and nothing noticed, because the
 * suite called those handlers rather than posting to them.
 *
 * The rule is the registry's, not a second copy of a route guard, and it is the whole class rather
 * than the two instances: a form declares that enctype **only** when it carries a file. The one
 * exemption the composition root grants — `csrf: 'in-body'` — is held by the two routes whose
 * bodies really are streams, and those are exactly the two forms with a file input in them.
 */
describe('a form is multipart only when it carries a file', () => {
  it('holds across every screen in the registry', () => {
    let forms = 0;
    for (const [name, render] of SCREENS) {
      const html = render();
      for (const form of html.match(/<form\b[\s\S]*?<\/form>/g) ?? []) {
        forms += 1;
        if (!/enctype="multipart\/form-data"/.test(form)) continue;
        assert.match(
          form,
          /<input[^>]+type="file"/,
          `${name}: a multipart form with no file input posts a body the CSRF preHandler cannot read`,
        );
      }
    }
    // A rule that scanned nothing passes forever and reads like diligence (scripts/guards.ts).
    assert.ok(forms > 10, `only ${forms} forms scanned`);
  });
});

describe('shared UI tokens', () => {
  it('is the only place a colour, a face, or a physical side is named', () => {
    for (const [name, render] of SCREENS) {
      const html = render();
      assert.doesNotMatch(html, /fonts\.googleapis/, name);
      assert.doesNotMatch(html, /#[0-9a-fA-F]{3,8}\b/, name);
      // v3's pattern for this was `(?:^|[\s;{])(?:left|right)\s*:` and it was weaker than its own
      // comment: the character before `left` in `padding-left` is a hyphen, so the properties people
      // actually type went straight through. Found by tripping this guard rather than by reading it
      // (slice 1.11; docs/from-v3.md). Property names are hyphen-separated segments, so the segment
      // is what the pattern matches — which keeps `--color-bright` and `copyright` out of it.
      assert.doesNotMatch(
        html,
        /(?:^|[\s;{])(?:[a-z]+-)*(?:left|right)(?:-[a-z]+)*\s*:/m,
        name,
      );
      // And the physical *value*, which `text-align: left` reaches without a physical property.
      assert.doesNotMatch(html, /:\s*(?:left|right)\b/, name);
      assert.doesNotMatch(html, /font-family\s*:/, name);
    }
  });

  it('keeps every screen Hebrew, RTL, and linked to the token layer', () => {
    for (const [name, render] of SCREENS) {
      const html = render();
      assert.match(html, /^<!doctype html>/, name);
      assert.match(html, /<html lang="he" dir="rtl">/, name);
      assert.match(html, /href="\/ui\/tokens\.css"/, name);
      assert.match(html, /<meta name="robots" content="noindex" \/>/, name);
      // v3 forbade `<script src=`. These pages are rendered on the server and need no script at
      // all, so the stronger assertion is free — and an inline script is exactly how the next
      // screen would acquire a dependency nothing gates.
      assert.doesNotMatch(html, /<script/, name);
    }
  });

  it('carries a CSRF token on every form that writes', () => {
    // **Slice 5.2, and this is the assertion that catches the eighth form.** Seven screens in this
    // system post; each of them was given the hidden input by hand, and a hand is exactly what
    // forgets the next one. The rule is a property of the registry rather than of seven memories:
    // if a rendered screen contains `<form method="post"`, that screen's bytes contain the field.
    //
    // It reads the field's name off `src/kernel/ui/page.ts` rather than spelling it, so renaming
    // the input in one place cannot leave this guard asserting the old name and passing.
    for (const [name, render] of SCREENS) {
      const html = render();
      if (
        !html.includes('<form method="post"') &&
        !/<form\s[^>]*method="post"/.test(html)
      ) {
        continue;
      }
      assert.match(
        html,
        new RegExp(`<input type="hidden" name="${CSRF_FIELD}" value="[^"]+"`),
        `${name} posts a form and carries no ${CSRF_FIELD}`,
      );
    }
  });

  it('never renders a GET form carrying the token', () => {
    // The search box is a GET form, and a token on it would land in the query string of every
    // result URL somebody sends to somebody else — a session's anti-forgery value in a link, a
    // referrer header and a log. One screen has one; asserting it over the registry is what keeps
    // the next GET form from acquiring one by copy-paste.
    for (const [name, render] of SCREENS) {
      const html = render();
      for (const form of html.match(/<form[\s\S]*?<\/form>/g) ?? []) {
        if (/method="post"/.test(form)) continue;
        assert.doesNotMatch(form, new RegExp(`name="${CSRF_FIELD}"`), name);
      }
    }
  });

  /**
   * **The two screens in the registry whose rail is a viewer's. Slice 6.9.**
   *
   * `documents` is the one gated destination on the bar — `documents.write`, which a VIEWER does
   * not hold — so a rail built without it is a different screen and is registered as one. Named
   * explicitly rather than matched by a pattern, so a screen added next month is asserted to carry
   * the destination unless somebody says in this list that it does not.
   */
  const VIEWER_RAIL = new Set([
    'root · index, צופה',
    'root · settings, viewer',
  ]);

  it('puts the same chrome on every signed-in screen', () => {
    // Slice 5.2c: one ops rail, built once, injected. A screen that invents its own list is how
    // the bar drifts — staff without a way out, evidence without search, the index as the only
    // page that could sign you out.
    for (const [name, render] of SCREENS) {
      if (name.startsWith('staff · login')) continue;
      const html = render();
      assert.match(html, /class="ops"/, name);
      assert.match(html, /<aside class="ops-nav"/, name);
      assert.match(html, /id="nav-toggle"/, name);
      assert.match(html, /class="ops-menu"/, name);
      assert.match(html, />תפריט</, name);
      assert.match(html, /href="\/estate"/, name);
      assert.match(html, /href="\/estate\/expiring"/, name);
      assert.match(html, /href="\/estate\/incomplete"/, name);
      assert.match(html, /href="\/estate\/search"/, name);
      assert.match(html, /href="\/staff"/, name);
      assert.match(html, /href="\/calls"/, name);
      assert.match(html, /href="\/settings"/, name);
      assert.match(html, />קריאות</, name);
      assert.match(html, />הגדרות</, name);
      // **Slice 6.9.** A12 had one door, on the index, and the week-6 demo never walked past the
      // index again — six documents filed through the unit-first screen and none through A12.
      // Gated, and the gate is asserted in both directions.
      if (VIEWER_RAIL.has(name)) {
        assert.doesNotMatch(html, /data-dest="documents"/, name);
      } else {
        assert.match(html, /data-dest="documents"/, name);
        // **Slice 7.1 repointed it.** The rail item was the filing form; it is the tab now, and
        // the form is a control on the tab's landing. Asserted on the exact href because the old
        // one is still a route and a rail that drifted back to it would otherwise pass.
        assert.match(html, /href="\/documents"/, name);
        assert.match(html, />מסמכים</, name);
      }
      assert.match(html, /action="\/staff\/logout"/, name);
      assert.match(html, />יציאה</, name);
      assert.match(
        html,
        new RegExp(
          `<form class="sign-out"[\\s\\S]*name="${CSRF_FIELD}" value="${CSRF}"`,
        ),
        name,
      );
      const marked = html.match(/<a[^>]*aria-current="page"/g) ?? [];
      if (name.startsWith('root · index') || name.startsWith('root · ia')) {
        assert.equal(marked.length, 0, name);
      } else {
        assert.equal(marked.length, 1, name);
      }
    }
  });

  /**
   * **Slice 6.9. Four causes, four sentences, and never the wrong one.**
   *
   * The refusal screen and the lease confirm screen each answered four different facts with one
   * sentence, and the four ask an operator for four different things: attach a better scan, choose
   * a flat, create one, or accept that the document named its property in an annex. Asserted over
   * the registry in **both directions** — a sentence that is right on one screen and also printed
   * on the other three is the defect this replaces, in a new costume.
   */
  it('gives each refusal cause its own sentence, and only its own', () => {
    const NOT_READ = /לא נקראה כתובת/;
    const ANNEX = /מפנה את פרטי הנכס לנספח/;
    const NOT_OURS = /אינה בתיק/;
    const BUILDING_ONLY = /הבניין נמצא בתיק, והדירה לא/;
    const screen = (name: string) => {
      const found = SCREENS.find(([label]) => label === name);
      assert.ok(found, name);
      return found[1]();
    };

    const nothing = screen(
      'documents · intake, the page names no place we hold',
    );
    assert.match(nothing, NOT_READ);
    assert.doesNotMatch(nothing, ANNEX);
    assert.doesNotMatch(nothing, NOT_OURS);
    assert.doesNotMatch(nothing, BUILDING_ONLY);

    const annex = screen('documents · intake, the document defers to an annex');
    assert.match(annex, ANNEX);
    assert.doesNotMatch(annex, NOT_OURS);
    assert.doesNotMatch(annex, BUILDING_ONLY);
    // And it says the apartment number may have come from a party's line — 6.11's open half, which
    // is exactly the reading this screen is printing.
    assert.match(annex, /משורה של אחד\s+הצדדים/);

    const elsewhere = screen(
      'documents · intake, an address in nobody portfolio, admin',
    );
    assert.match(elsewhere, NOT_OURS);
    assert.doesNotMatch(elsewhere, NOT_READ);
    assert.doesNotMatch(elsewhere, ANNEX);
    assert.doesNotMatch(elsewhere, BUILDING_ONLY);

    const partial = screen(
      'documents · intake, the building is ours and the flat is not, admin',
    );
    assert.match(partial, BUILDING_ONLY);
    assert.doesNotMatch(partial, NOT_OURS);
    assert.doesNotMatch(partial, NOT_READ);
  });

  /**
   * **The create offer is an admin's, and an operator is shown nothing rather than a dead control.**
   * `estate.write` is ADMIN-only (A11); a door an operator may see and may not walk through is the
   * refusal-after-typing 6.1 refused to build.
   */
  it('offers to create only to a role that may shape the estate', () => {
    const admin = SCREENS.find(
      ([name]) =>
        name === 'documents · intake, an address in nobody portfolio, admin',
    )?.[1]();
    const operator = SCREENS.find(
      ([name]) =>
        name === 'documents · intake, an address in nobody portfolio, operator',
    )?.[1]();
    assert.ok(admin && operator);
    assert.match(admin, /\/estate\/buildings\/new\?/);
    assert.match(admin, /יצירת הבניין והדירה/);
    // The reading rides in the link as a default for the form, and the walk's marker with it.
    assert.match(admin, /address_line=/);
    assert.match(admin, /next=intake/);
    assert.doesNotMatch(operator, /\/estate\/buildings\/new\?/);
    assert.doesNotMatch(operator, /יצירת/);
    // Both are still offered the question they can answer.
    for (const html of [admin, operator]) {
      assert.match(html, /חיפוש דירה אחרת/);
      assert.match(html, /type="file"/);
    }
  });

  /**
   * The same split one screen later. `matchesUnit` still decides what may be *written*; these four
   * decide what is *said*, and **a field that was not read is not a mismatch**.
   */
  it('tells an unread field from a field that does not match, on the confirm screen', () => {
    const unread = SCREENS.find(
      ([name]) =>
        name === 'documents · confirm a lease, neither field was read',
    )?.[1]();
    const mismatched = SCREENS.find(
      ([name]) =>
        name ===
        'documents · confirm a lease, both fields read and neither matches',
    )?.[1]();
    assert.ok(unread && mismatched);
    assert.match(unread, /לא נקראה כתובת מן המסמך/);
    assert.match(unread, /לא נקרא מספר דירה מן המסמך/);
    assert.doesNotMatch(unread, /אינה הכתובת של הדירה/);
    assert.doesNotMatch(unread, /אינו מספר הדירה/);

    assert.match(mismatched, /אינה הכתובת של הדירה/);
    assert.match(mismatched, /אינו מספר הדירה/);
    assert.doesNotMatch(mismatched, /לא נקראה כתובת מן המסמך/);
    assert.doesNotMatch(mismatched, /לא נקרא מספר דירה מן המסמך/);

    // Neither writes, which is the half 6.9 did not touch.
    for (const html of [unread, mismatched]) {
      assert.match(html, /לא נכתוב שוכרים/);
      assert.doesNotMatch(html, /אישור וכתיבה/);
    }
  });

  it('names the owner on an unbuilt destination', () => {
    const calls = renderStubPage(
      { csrf: CSRF, mayFile: true },
      CALLS_STUB,
      'wired',
    );
    assert.match(calls, /data-state="wired"/);
    assert.match(calls, /שבוע 7 · סלייס 7.2/);
  });

  // Asserted over the **wired** settings screens in the registry. It was asserted against the
  // painted A9 variant until 6.1, which put the only copy of a live guard on a mockup — and a
  // mockup is deleted the day its slice closes (scripts/guards.ts, guard four). The rule it
  // carries is the settings screen's: the role matrix is code, and `asset_type` is guarded
  // (SPEC.md rule 8), so neither may ever grow a card here.
  it('keeps asset kinds and the role matrix off the settings screen', () => {
    const screens = SCREENS.filter(([name]) =>
      name.startsWith('root · settings'),
    );
    assert.ok(screens.length > 0, 'no settings screen in the registry');
    for (const [name, render] of screens) {
      const html = render();
      assert.doesNotMatch(html, /asset_type/, name);
      assert.doesNotMatch(html, /ADMIN/, name);
      assert.doesNotMatch(html, /VIEWER/, name);
      assert.doesNotMatch(html, /staff\.invite/, name);
    }
  });

  it('keeps the login screen without that chrome', () => {
    for (const [name, render] of SCREENS) {
      if (!name.startsWith('staff · login')) continue;
      const html = render();
      assert.doesNotMatch(html, /class="ops"/, name);
      assert.doesNotMatch(html, /<aside class="ops-nav"/, name);
      assert.doesNotMatch(html, /id="nav-toggle"/, name);
      assert.doesNotMatch(html, /class="ops-menu"/, name);
      assert.doesNotMatch(html, /href="\/estate"/, name);
      assert.doesNotMatch(html, /href="\/calls"/, name);
      assert.doesNotMatch(html, /href="\/settings"/, name);
      assert.doesNotMatch(html, /href="\/estate\/search"/, name);
      assert.doesNotMatch(html, /href="\/documents\/new"/, name);
      assert.doesNotMatch(html, /action="\/staff\/logout"/, name);
      assert.doesNotMatch(html, />יציאה</, name);
    }
  });

  it('escapes what the database hands it', () => {
    // The kernel's `h` escapes by default and has no raw escape hatch, so this is a property of the
    // template rather than of the view remembering. It is asserted here because the view is the
    // first caller `h` has ever had, and because a building name is operator-typed text.
    const hostile: BuildingSummary = {
      ...building,
      name: '<script>alert(1)</script>',
      city: 'שוהם & סביבה',
    };
    const html = renderBuildingsPage([hostile], new Map(), NAV);
    assert.doesNotMatch(html, /<script/);
    assert.match(html, /&lt;script&gt;/);
    assert.match(html, /שוהם &amp; סביבה/);
  });

  it('escapes the search term, which is the one value a visitor chooses', () => {
    // Every other value on these screens came out of the database. This one came off the query
    // string, so it is the first genuinely hostile input the views have ever been handed.
    const html = renderSearchPage(
      '<img src=x onerror=alert(1)>',
      {
        buildings: [],
        units: [],
        documents: [],
        truncated: false,
      },
      NAV,
    );
    assert.doesNotMatch(html, /<img/);
    assert.match(html, /&lt;img/);
  });

  it('counts days in Hebrew, which does not count in two', () => {
    // “בעוד 1 ימים” is what a template that special-cases only zero renders every day, and it is
    // the first thing a Hebrew speaker reads on this screen. Found on staging before the demo.
    const html = renderExpiringPage(
      [0, 1, 2, 14].map((days, at) => ({
        ...(expiring[0] as ExpiringLease),
        tenancy_id: `0000000${at}-0000-4000-8000-00000000000${at}`,
        days_left: days,
      })),
      60,
      NAV,
    );
    assert.match(html, /מסתיים היום/);
    assert.match(html, /מסתיים מחר/);
    assert.match(html, /בעוד יומיים/);
    assert.match(html, /בעוד <span dir="ltr">14<\/span> ימים/);
    assert.doesNotMatch(html, /בעוד <span dir="ltr">1<\/span> ימים/);
  });

  it('shows a state and a count, and never a person', () => {
    // The rule these screens keep, **and kept after 5.2 and again after 5.4**: a screen may
    // say a unit is let and by how many, and may not say by whom. 5.4 unlocked who filed a
    // document and a signed read of its bytes; it did not put a household on a chip (SPEC.md).
    //
    // The operator's own email is on the staff board and always was: this rule is about tenants.
    for (const [name, render] of SCREENS) {
      const html = render();
      assert.doesNotMatch(html, /05\d[- ]?\d/, name);
      assert.doesNotMatch(html, /\+972/, name);
    }
  });

  // **Slice 6.6. The guard the whole week's identifier work rests on**, and the one the carried-in
  // row from week 5 — *`national_id` never in an agent tool's response shape* — has been waiting
  // for since 5.2. It is deliberately the crudest possible statement of the rule: a screen either
  // carries something shaped like a ת.ז. or it does not, and whether that run is a captured row, a
  // word off the paper, a value somebody hard-coded into a template or a field added in six months'
  // time is not a distinction this assertion has to make.
  //
  // **Over the registry, never over a live response.** Week 5 closed on exactly that mistake: a
  // duplicated `/05\d/` read a live page's CSRF token hex and failed 4 runs in 20. Every screen
  // here renders from constants in this file, so a hit is a fact about the screen and a pass is
  // permanent — and `src/kernel/identifier.ts` carries the pattern's own test, including the four
  // shapes this registry actually renders that an unanchored `\d{9}` would fire on.
  it('carries no identifier-shaped run, on any screen but the one entitled to', () => {
    // **One exception, and 6.5 corrected 6.4's prediction that there would be two.** The lease
    // confirm screen was expected to need one; it does not, because `LeaseProposal` has no field
    // for a value — that screen carries a sentence and a count. Adding a second entry here is a
    // decision about disclosure and belongs in SPEC.md before it belongs in this array.
    const MAY_READ_IDENTIFIERS = [
      'documents · read overlay, may read identifiers',
      // **Slice 7.3.** The reveal, and the one place in this console where a ת.ז. reaches a page
      // because somebody asked for that row rather than because they opened a screen. The ruling is
      // in SPEC-evidence.md, "Approving an identifier", written before this line was.
      'documents · field approval, one identifier revealed',
    ];
    let exercised = 0;
    for (const [name, render] of SCREENS) {
      const html = render();
      if (MAY_READ_IDENTIFIERS.includes(name)) {
        // The exception is asserted from both sides: a screen listed here and carrying nothing is
        // an exception nobody needs, and an unneeded exception is how the next one gets waved in.
        assert.ok(
          hasIdentifierRun(html),
          `${name} is exempt and carries nothing`,
        );
        exercised += 1;
        continue;
      }
      assert.equal(hasIdentifierRun(html), false, name);
    }
    assert.equal(exercised, MAY_READ_IDENTIFIERS.length);
  });

  // **Slice 6.6, and the sixth time this rule was reconsidered.** Week 6 is the week that tested it:
  // 6.4 put a ת.ז. on the capture path and 6.5 put a household's names on a confirm screen. The
  // ruling in SPEC.md is that **a confirm screen showing what the document in the operator's hand
  // says is not the same act as putting a household on a list** — so the rule is kept, and the line
  // it turns on is drawn here rather than left to the next screen's author.
  it('transcribes a name only on a screen about one document', () => {
    // Reached from one document, about that document, not queryable and not a list. Every other
    // screen in the registry is reached by browsing the estate, and a name on one of those is a
    // disclosure. Adding an entry here is a decision about disclosure and belongs in SPEC.md first.
    const ABOUT_ONE_DOCUMENT = [
      // **Slice 7.3.** The ledger is the screen a person checks the machine's reading on, with the
      // paper in their hand — the case SPEC.md's sixth reconsideration describes exactly. It is
      // reached from one document, it is about that document, and it is neither queryable nor a
      // list.
      'documents · field approval',
      'documents · field approval, identifiers withheld',
      'documents · field approval, one identifier revealed',
      'documents · confirm a lease',
      'documents · confirm a lease, an identifier read and two lettings offered',
      'documents · confirm a lease, an existing letting pre-selected',
      'documents · confirm an addendum',
    ];
    // **The two write receipts were on that list until this case was first run, and came off it.**
    // `renderTenancyWrittenPage` says `partiesWritten` and not who: once the confirm is done the
    // operator is no longer checking the paper, so the screen is already back to a state and a
    // count. They fall through to the loop below like every other browsable screen, which is the
    // assertion — the list is what this case had to be told, and everything else is proved.
    let exercised = 0;
    for (const [name, render] of SCREENS) {
      const html = render();
      const names = [TENANT_NAME, GUARANTOR_NAME].filter((person) =>
        html.includes(person),
      );
      if (ABOUT_ONE_DOCUMENT.includes(name)) {
        // Asserted from both sides, for the reason the exemption above is: a screen listed here
        // and transcribing nothing is an entry nobody needs, and an unneeded entry is how the next
        // one gets waved in.
        assert.ok(names.length > 0, `${name} transcribes no name`);
        exercised += 1;
        continue;
      }
      assert.deepEqual(names, [], name);
    }
    assert.equal(exercised, ABOUT_ONE_DOCUMENT.length);
  });

  it('withholds a captured identifier, and says how many it withheld', () => {
    // **Slice 6.4, and the refusal this slice was required to write red first.** The same screen,
    // the same captured rows, two stances. A viewer without `party.national_id.read` does not
    // receive the value — not hidden by CSS, not in a title attribute, not anywhere in the bytes —
    // and is told a count instead, because *the lease named a ת.ז.* and *the lease named none* are
    // different facts and an operator has to be able to tell them apart.
    const withheld = readOverlay(false);
    assert.doesNotMatch(withheld, new RegExp(READ_IDENTIFIER));
    assert.doesNotMatch(withheld, /ת\.ז\. השוכר/);
    assert.match(withheld, /נקרא שדה מזהה אחד ואינו מוצג/);
    // The rest of the reading is untouched: withholding one row is not hiding the page.
    assert.match(withheld, /מספר הדירה/);

    const disclosed = readOverlay(true);
    assert.match(disclosed, new RegExp(READ_IDENTIFIER));
    assert.match(disclosed, /ת\.ז\. השוכר/);
    assert.doesNotMatch(disclosed, /שדה מזהה אחד ואינו מוצג/);
  });

  it('masks a captured identifier on the ledger until one row is asked for', () => {
    // **Slice 7.3.** Three claims, and the third is the one a screen gets wrong by being helpful:
    // an approval is an attestation, so a row whose value is masked carries no control that signs
    // it. The only control on it is the one that ends the masking.
    const masked = fieldsLedger({ mayReadIdentifiers: true });
    assert.doesNotMatch(masked, new RegExp(READ_IDENTIFIER));
    assert.match(masked, /ת\.ז\. השוכר/);
    assert.match(masked, /גילוי/);
    // The approve control is an input pre-filled with the reading. On the masked row there is none,
    // at 91% read quality — which is exactly the number that would have argued for one.
    assert.doesNotMatch(masked, /name="approved_value" value="•/);

    const revealed = fieldsLedger({
      mayReadIdentifiers: true,
      revealed: 'yes',
    });
    assert.match(revealed, new RegExp(READ_IDENTIFIER));
    assert.doesNotMatch(revealed, /גילוי/);

    // And the stance that may not read one: no row, a count, and the rest of the ledger untouched.
    const withheld = fieldsLedger({ mayReadIdentifiers: false });
    assert.doesNotMatch(withheld, new RegExp(READ_IDENTIFIER));
    assert.doesNotMatch(withheld, /ת\.ז\. השוכר/);
    assert.match(withheld, /נקרא שדה מזהה אחד ואינו מוצג/);
    assert.match(withheld, /מספר הדירה/);
  });

  it('says what the read-quality number is, and never shows one it does not have', () => {
    // `confidence` is the minimum OCR word confidence, so the column is `איכות הקריאה` and never
    // `ביטחון` — and a native-text lease has no score at all, which the row says in words rather
    // than rendering as a silent pass. The bulk control exists on this screen; it is `אישור כל מה
    // שלא סומן` and a search for the approve-all wording it is not is part of the assertion.
    const ledger = fieldsLedger({ mayReadIdentifiers: true });
    assert.match(ledger, /איכות הקריאה/);
    assert.doesNotMatch(ledger, /ביטחון/);
    assert.match(ledger, /נקרא מטקסט, לא נמדד/);
    assert.match(ledger, /אישור כל מה שלא סומן/);
    assert.doesNotMatch(ledger, /אישור הכל/);
    // The correction and the reading, both on the row. One column would have shown only the first.
    assert.match(ledger, /הרב קוק 54/);
    assert.match(ledger, /נקרא: <a[^>]*>הרב קוק 45/);
  });

  it('withholds the word off the paper too, and keeps the box it was in', () => {
    // **Slice 6.6, and the defect 6.5 found by clicking.** 6.4's gate above withholds the captured
    // *row*; this page also draws one span per measured word, and until now each carried the word's
    // own text in a `title` attribute at every stance — so an operator whose captured row was
    // correctly withheld could read the same ת.ז. off the box beside it.
    //
    // **This is the one case in this file that reads a value the document supplied rather than the
    // registry**, and it is allowed for the reason week 5's lesson allows: the word under test is a
    // word this test put on the page. A registry assertion cannot reach it, because the words come
    // from the reader and not from a fixture the screen was handed.
    //
    // The ruling is in SPEC.md: **captured is governed, printed is the document.** The transcript is
    // ours and is withheld; the page image is the paper and is not — the same viewer already holds a
    // fifteen-minute signed read of the bytes from 5.4, so withholding a picture of the page would
    // claim a control this system does not have.
    const withheld = readOverlay(false);
    assert.doesNotMatch(withheld, new RegExp(READ_IDENTIFIER));
    // Narrow to the box: the ops rail has carried a `title` on every nav item since 5.2c, and a
    // guard that reads the whole page for the attribute is a guard about the wrong element.
    assert.doesNotMatch(withheld, /word-box[^>]*title=/);
    // The geometry stays. A box with no word is still the answer to *where did it read something*,
    // which is what this screen is called.
    assert.match(withheld, /class="word-box"/);
    assert.match(withheld, /<img alt="" src="data:image\/png;base64,/);

    const disclosed = readOverlay(true);
    assert.match(disclosed, new RegExp(`title="${READ_IDENTIFIER}"`));
    assert.match(disclosed, /title="דירה"/);
  });

  it('serves a signed read on the panel, never a gs:// href', () => {
    // A signed URL is a bearer token for one object. Slice 5.4 mints one on the panel.
    // Search still does not. The filed-document screen keeps the uri off the page entirely.
    const html = renderUnitPage(hit, 2, [filed], NAV);
    assert.match(html, /storage\.googleapis\.com/);
    assert.match(html, /X-Goog-Expires=900/);
    assert.doesNotMatch(html, /href="gs:/);
    assert.doesNotMatch(html, /gs:\/\/dona-v5-staging-docs\//);
    const buildingHtml = renderBuildingPage(detail, occupancy, NAV, [
      unverified,
    ]);
    assert.match(buildingHtml, /storage\.googleapis\.com/);
    assert.doesNotMatch(buildingHtml, /href="gs:/);
  });

  it('opens a listed document on the read overlay, and a lease on confirm', () => {
    const html = renderUnitPage(hit, 2, [filed], NAV);
    assert.match(
      html,
      /href="\/documents\/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa\/read"/,
    );
    assert.match(
      html,
      /href="\/documents\/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa\/tenancy"/,
    );
    const search = renderSearchPage(
      'שכירות',
      {
        buildings: [],
        units: [],
        documents: [
          {
            ...filed,
            entityType: 'UNIT',
            entityId: hit.unit_id,
            unitId: hit.unit_id,
            unitNumber: hit.unit_number,
            buildingId: hit.building_id,
            buildingName: hit.building_name,
          },
        ],
        truncated: false,
      },
      NAV,
    );
    assert.match(
      search,
      /href="\/documents\/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa\/read"/,
    );
    assert.doesNotMatch(search, /storage\.googleapis\.com/);
    const emptyRead = renderReadPage({
      nav: NAV,
      csrf: '',
      documentId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      buildingId: building.building_id,
      buildingName: building.name,
      unitId: hit.unit_id,
      typeKey: 'lease',
      labelHe: 'חוזה שכירות',
      fileHash: 'e'.repeat(64),
      source: 'ocr',
      mayReadIdentifiers: false,
      page: null,
      image: null,
    });
    assert.match(emptyRead, /לא נקראו שדות מהמסמך/);
    assert.match(
      emptyRead,
      /href="\/documents\/eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee\/tenancy"/,
    );
  });

  it('links a promoted date to its pixels, not the object bytes', () => {
    const html = renderUnitPage(hit, 2, [filed], NAV, [
      {
        extractedFieldId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        documentId: filed.documentId,
        labelHe: 'תחילת תקופת השכירות',
        value: '2026-03-01',
        page: 1,
        confidence: 0.91,
      },
    ]);
    assert.match(
      html,
      /href="\/documents\/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa\/read\?page=1#f-bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"/,
    );
    assert.match(html, /91%/);
    assert.doesNotMatch(html, /href="gs:/);
    assert.doesNotMatch(html, /<script/);
    const three = renderUnitPage(hit, 2, [filed], NAV, [
      {
        extractedFieldId: '11111111-1111-4111-8111-111111111111',
        documentId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        labelHe: 'תחילה',
        value: '2026-01-01',
        page: 1,
        confidence: null,
      },
      {
        extractedFieldId: '22222222-2222-4222-8222-222222222222',
        documentId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        labelHe: 'סיום',
        value: '2027-01-01',
        page: 2,
        confidence: null,
      },
      {
        extractedFieldId: '33333333-3333-4333-8333-333333333333',
        documentId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        labelHe: 'סיום מתוקן',
        value: '2027-06-30',
        page: 1,
        confidence: 0.8,
      },
    ]);
    assert.match(
      three,
      /aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa\/read\?page=1#f-11111111/,
    );
    assert.match(
      three,
      /bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb\/read\?page=2#f-22222222/,
    );
    assert.match(
      three,
      /cccccccc-cccc-4ccc-8ccc-cccccccccccc\/read\?page=1#f-33333333/,
    );
  });

  it('shows a unit change log as old to new, actor, and document, never a tenant name', () => {
    const html = renderUnitPage(
      hit,
      2,
      [filed],
      NAV,
      [],
      [
        {
          field: 'end_date',
          old_value: '2028-01-17',
          new_value: '2029-01-17',
          actor: 'ops@example.test',
          source_document_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        },
      ],
    );
    assert.match(html, /יומן שינויים/);
    assert.match(html, /2028-01-17 → 2029-01-17/);
    assert.match(html, /ops@example.test/);
    assert.match(
      html,
      /href="\/documents\/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"/,
    );
    const closed = renderUnitPage(
      hit,
      2,
      [filed],
      NAV,
      [],
      [
        {
          field: 'status',
          old_value: 'ACTIVE',
          new_value: 'ENDED',
          actor: 'system',
          source_document_id: null,
        },
      ],
    );
    assert.match(closed, /יומן שינויים/);
    assert.match(closed, /ACTIVE → ENDED/);
    assert.match(closed, /system/);
    assert.doesNotMatch(closed, />מסמך</);
    const empty = renderUnitPage(hit, 2, [filed], NAV);
    assert.doesNotMatch(empty, /יומן שינויים/);
  });
});
