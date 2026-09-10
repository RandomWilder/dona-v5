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
import { renderIndexPage } from '../../src/index-page.ts';
import { CSRF_FIELD } from '../../src/kernel/ui/page.ts';
import {
  renderLoginPage,
  renderStaffHomePage,
} from '../../src/staff/contract.ts';
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

// A token shaped like the real one — 64 hex characters — so an assertion about the *shape* of what
// a form carries is testing the shape a session actually produces.
const CSRF = 'a1b2c3d4'.repeat(8);
const NAV = signedInChrome(CSRF, 'estate');
const NAV_SEARCH = signedInChrome(CSRF, 'search');
const NAV_EXPIRING = signedInChrome(CSRF, 'expiring');
const NAV_INCOMPLETE = signedInChrome(CSRF, 'incomplete');
const NAV_STAFF = signedInChrome(CSRF, 'staff');

const SCREENS: Array<[string, () => string]> = [
  ['root · index', () => renderIndexPage({ csrf: CSRF })],
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
  ['estate · one building', () => renderBuildingPage(detail, occupancy, NAV)],
  [
    'estate · one building, nothing let',
    () => renderBuildingPage(detail, new Map(), NAV),
  ],
  [
    'estate · one building, with a protocol',
    () => renderBuildingPage(detail, occupancy, NAV, [unverified]),
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
            missingTerms: ['המושכר', 'תקופת השכירות'],
          },
        },
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
        verification: { verdict: 'verified', missingTerms: [] },
        fileHash: 'c'.repeat(64),
        documentId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
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
        verification: { verdict: 'unverified', missingTerms: [] },
        fileHash: 'd'.repeat(64),
        documentId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      }),
  ],
  [
    'documents · read overlay',
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
        nav: NAV,
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
      if (name.startsWith('root ·')) {
        assert.equal(marked.length, 0, name);
      } else {
        assert.equal(marked.length, 1, name);
      }
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
      assert.doesNotMatch(html, /href="\/estate\/search"/, name);
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
    // The rule these screens keep, **and kept after 5.2 put them behind a session**: a screen may
    // say a unit is let and by how many, and may not say by whom. 5.2 was the slice entitled to
    // lift it and declined — a session says who is asking, not what a household's name is for
    // (SPEC.md). The views cannot break it by accident, because nothing ever hands them a name —
    // this asserts the property from the outside anyway, because that is what a rule is for.
    //
    // The operator's own email is on the staff board and always was: this rule is about tenants.
    for (const [name, render] of SCREENS) {
      const html = render();
      assert.doesNotMatch(html, /05\d[- ]?\d/, name);
      assert.doesNotMatch(html, /\+972/, name);
    }
  });

  it('shows a path and never a link to the bytes', () => {
    // A signed URL is a bearer token for one object. The session to hang one on exists from 5.2 and
    // **slice 5.4 is where the panel mints one**; until then it renders the gs:// uri as text. The filed-document screen already kept the
    // uri off the page entirely; the panel is allowed to name the path and still must not make it
    // clickable.
    const html = renderUnitPage(hit, 2, [filed], NAV);
    assert.match(html, /gs:\/\/dona-v5-staging-docs\//);
    assert.doesNotMatch(html, /href="gs:/);
    assert.doesNotMatch(html, /storage\.googleapis\.com/);
    const buildingHtml = renderBuildingPage(detail, occupancy, NAV, [
      unverified,
    ]);
    assert.match(buildingHtml, /gs:\/\/dona-v5-staging-docs\//);
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
});
