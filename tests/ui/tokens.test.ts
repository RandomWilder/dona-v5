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
  SearchResults,
  UnitHit,
} from '../../src/estate/contract.ts';
import {
  renderBuildingPage,
  renderBuildingsPage,
  renderExpiringPage,
  renderIndexPage,
  renderSearchPage,
} from '../../src/estate/contract.ts';

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

const results: SearchResults = {
  buildings: [building],
  units: [hit],
  truncated: true,
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
  ['estate · search', () => renderSearchPage('רקפת', results)],
  [
    'estate · search, nothing found',
    () =>
      renderSearchPage('זזז', { buildings: [], units: [], truncated: false }),
  ],
  [
    'estate · search, no term',
    () => renderSearchPage('', { buildings: [], units: [], truncated: false }),
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
});
