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
  renderIndexPage,
  renderSearchPage,
  renderUnitPage,
} from '../../src/estate/contract.ts';
import type { DocumentTypeRow } from '../../src/evidence/contract.ts';
import {
  renderFiledPage,
  renderReadPage,
  renderSeededPage,
  renderSeedPage,
  renderTenancyPage,
  renderTenancyWrittenPage,
  renderUploadPage,
} from '../../src/evidence/contract.ts';
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

const SCREENS: Array<[string, () => string]> = [
  ['estate · index', () => renderIndexPage()],
  [
    'estate · buildings',
    () =>
      renderBuildingsPage([building], new Map([[building.building_id, 40]])),
  ],
  ['estate · buildings, empty', () => renderBuildingsPage([], new Map())],
  ['estate · one building', () => renderBuildingPage(detail, occupancy)],
  [
    'estate · one building, nothing let',
    () => renderBuildingPage(detail, new Map()),
  ],
  [
    'estate · one building, with a protocol',
    () => renderBuildingPage(detail, occupancy, [unverified]),
  ],
  ['estate · one unit', () => renderUnitPage(hit, 2, [filed])],
  [
    'estate · one unit, with a promoted date',
    () =>
      renderUnitPage(
        hit,
        2,
        [filed],
        [
          {
            extractedFieldId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
            documentId: filed.documentId,
            labelHe: 'תחילת תקופת השכירות',
            value: '2026-03-01',
            page: 1,
            confidence: 0.91,
          },
        ],
      ),
  ],
  [
    'estate · one unit, vacant and empty',
    () => renderUnitPage(hit, undefined, []),
  ],
  ['estate · search', () => renderSearchPage('רקפת', results)],
  [
    'estate · search, nothing found',
    () =>
      renderSearchPage('זזז', {
        buildings: [],
        units: [],
        documents: [],
        truncated: false,
      }),
  ],
  [
    'estate · search, no term',
    () =>
      renderSearchPage('', {
        buildings: [],
        units: [],
        documents: [],
        truncated: false,
      }),
  ],
  [
    'estate · search, a named lease',
    () =>
      renderSearchPage('שכירות', {
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
      }),
  ],
  ['estate · leases ending', () => renderExpiringPage(expiring, 60)],
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
      ),
  ],
  ['estate · leases ending, none', () => renderExpiringPage([], 60)],
  [
    'estate · incomplete tenancies',
    () =>
      renderIncompletePage([
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
      ]),
  ],
  ['estate · incomplete tenancies, none', () => renderIncompletePage([])],
  [
    'documents · upload',
    () => renderUploadPage({ unit: hit, types: documentTypes, lettings }),
  ],
  [
    'documents · upload, a flat with no letting on it',
    () => renderUploadPage({ unit: hit, types: documentTypes, lettings: [] }),
  ],
  [
    'documents · upload, refused',
    () =>
      renderUploadPage({
        unit: hit,
        types: documentTypes,
        lettings,
        declaredTypeKey: 'lease',
        declaredTenancyId: lettings[0]?.tenancy_id,
        refused: {
          type: documentTypes[0] as DocumentTypeRow,
          verification: {
            verdict: 'refused',
            missingTerms: ['המושכר', 'תקופת השכירות'],
          },
        },
      }),
  ],
  [
    'documents · filed',
    () =>
      renderFiledPage({
        unit: hit,
        type: documentTypes[0] as DocumentTypeRow,
        inserted: true,
        boundToTenancy: true,
        verification: { verdict: 'verified', missingTerms: [] },
        fileHash: 'c'.repeat(64),
        documentId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      }),
  ],
  [
    'documents · filed, already on file and unverified',
    () =>
      renderFiledPage({
        unit: hit,
        type: documentTypes[1] as DocumentTypeRow,
        inserted: false,
        boundToTenancy: false,
        verification: { verdict: 'unverified', missingTerms: [] },
        fileHash: 'd'.repeat(64),
        documentId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      }),
  ],
  [
    'documents · read overlay',
    () =>
      renderReadPage({
        documentId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
        buildingId: building.building_id,
        buildingName: building.name,
        unitId: hit.unit_id,
        typeKey: 'lease',
        labelHe: 'חוזה שכירות',
        fileHash: 'e'.repeat(64),
        source: 'ocr',
        page: {
          number: 1,
          width: 100,
          height: 200,
          items: [
            {
              text: 'שכירות',
              x: 10,
              y: 40,
              width: 30,
              height: 20,
              rightToLeft: true,
              endsLine: false,
              confidence: 0.91,
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
            labelHe: 'מספר הדירה',
            value: '14',
            page: 1,
            bbox: { x: 10, y: 40, width: 30, height: 20 },
            confidence: 0.91,
            promotionTarget: null,
            promotedTo: null,
          },
        ],
      }),
  ],
  [
    'documents · read overlay, no fields',
    () =>
      renderReadPage({
        documentId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
        buildingId: building.building_id,
        buildingName: building.name,
        unitId: hit.unit_id,
        typeKey: 'lease',
        labelHe: 'חוזה שכירות',
        fileHash: 'e'.repeat(64),
        source: 'ocr',
        page: null,
        image: null,
      }),
  ],
  [
    'documents · seed a protocol',
    () =>
      renderSeedPage({
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
            value: 'יעל כהן',
            proposedRole: 'PRIMARY_TENANT',
          },
        ],
        matchesUnit: true,
        alreadyEstablished: false,
        boundToTenancy: false,
        termsProfileNames: ['נספח תחזוקה — תקן'],
      }),
  ],
  [
    'documents · lease written',
    () =>
      renderTenancyWrittenPage({
        unit: hit,
        startDate: '2026-03-01',
        endDate: '2027-02-28',
        partiesWritten: 2,
        alreadyEstablished: false,
      }),
  ],
  [
    'documents · confirm an addendum',
    () =>
      renderTenancyPage({
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
            value: 'רותם ערב',
            proposedRole: 'GUARANTOR',
          },
        ],
        matchesUnit: true,
        alreadyEstablished: false,
        boundToTenancy: true,
        termsProfileNames: [],
      }),
  ],
];

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

  it('escapes what the database hands it', () => {
    // The kernel's `h` escapes by default and has no raw escape hatch, so this is a property of the
    // template rather than of the view remembering. It is asserted here because the view is the
    // first caller `h` has ever had, and because a building name is operator-typed text.
    const hostile: BuildingSummary = {
      ...building,
      name: '<script>alert(1)</script>',
      city: 'שוהם & סביבה',
    };
    const html = renderBuildingsPage([hostile], new Map());
    assert.doesNotMatch(html, /<script/);
    assert.match(html, /&lt;script&gt;/);
    assert.match(html, /שוהם &amp; סביבה/);
  });

  it('escapes the search term, which is the one value a visitor chooses', () => {
    // Every other value on these screens came out of the database. This one came off the query
    // string, so it is the first genuinely hostile input the views have ever been handed.
    const html = renderSearchPage('<img src=x onerror=alert(1)>', {
      buildings: [],
      units: [],
      documents: [],
      truncated: false,
    });
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
    );
    assert.match(html, /מסתיים היום/);
    assert.match(html, /מסתיים מחר/);
    assert.match(html, /בעוד יומיים/);
    assert.match(html, /בעוד <span dir="ltr">14<\/span> ימים/);
    assert.doesNotMatch(html, /בעוד <span dir="ltr">1<\/span> ימים/);
  });

  it('shows a state and a count, and never a person', () => {
    // The rule these screens are built to keep until week 5 gives them a session: an
    // unauthenticated route may say a unit is let and by how many, and may not say by whom. The
    // views cannot break it by accident, because nothing ever hands them a name — this asserts the
    // property from the outside anyway, because that is what a rule is for.
    for (const [name, render] of SCREENS) {
      const html = render();
      assert.doesNotMatch(html, /05\d[- ]?\d/, name);
      assert.doesNotMatch(html, /\+972/, name);
    }
  });

  it('shows a path and never a link to the bytes', () => {
    // A signed URL is a bearer token for one object. Until week 5 there is no session to hang one
    // on, so the panel renders the gs:// uri as text. The filed-document screen already kept the
    // uri off the page entirely; the panel is allowed to name the path and still must not make it
    // clickable.
    const html = renderUnitPage(hit, 2, [filed]);
    assert.match(html, /gs:\/\/dona-v5-staging-docs\//);
    assert.doesNotMatch(html, /href="gs:/);
    assert.doesNotMatch(html, /storage\.googleapis\.com/);
    const buildingHtml = renderBuildingPage(detail, occupancy, [unverified]);
    assert.match(buildingHtml, /gs:\/\/dona-v5-staging-docs\//);
    assert.doesNotMatch(buildingHtml, /href="gs:/);
  });

  it('opens a listed document on the read overlay, and a lease on confirm', () => {
    const html = renderUnitPage(hit, 2, [filed]);
    assert.match(
      html,
      /href="\/documents\/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa\/read"/,
    );
    assert.match(
      html,
      /href="\/documents\/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa\/tenancy"/,
    );
    const search = renderSearchPage('שכירות', {
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
    });
    assert.match(
      search,
      /href="\/documents\/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa\/read"/,
    );
    const emptyRead = renderReadPage({
      documentId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      buildingId: building.building_id,
      buildingName: building.name,
      unitId: hit.unit_id,
      typeKey: 'lease',
      labelHe: 'חוזה שכירות',
      fileHash: 'e'.repeat(64),
      source: 'ocr',
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
    const html = renderUnitPage(
      hit,
      2,
      [filed],
      [
        {
          extractedFieldId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          documentId: filed.documentId,
          labelHe: 'תחילת תקופת השכירות',
          value: '2026-03-01',
          page: 1,
          confidence: 0.91,
        },
      ],
    );
    assert.match(
      html,
      /href="\/documents\/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa\/read\?page=1#f-bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"/,
    );
    assert.match(html, /91%/);
    assert.doesNotMatch(html, /href="gs:/);
    assert.doesNotMatch(html, /<script/);
    const three = renderUnitPage(
      hit,
      2,
      [filed],
      [
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
      ],
    );
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
});
