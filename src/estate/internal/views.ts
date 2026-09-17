// The week-1 surface: two screens, rendered on the server. Slice 1.11.
//
// Server-rendered through the kernel's `h`, which escapes every interpolation, so there is **no
// client JavaScript on these pages at all** -- and therefore no JSON API that would have to be
// scoped before the screens could be shown to anyone. v3's screens were static shells that fetched;
// v5's first screen has one thing to say and says it in the response.
//
// Every colour, face, radius, space and measure comes from /ui/tokens.css (SPEC.md). The CSS below
// is layout for these two pages and nothing else: `tests/ui/tokens.test.ts` renders both and fails
// on a hex colour, a font-family, a fonts.googleapis URL, a physical left:/right: or a <script>.
// Physical sides are the RTL trap and the reason the rule exists -- inset-inline-start is the same
// edge in both directions, and `left` is not.
//
// **Four screens from 2.6, and one rule across the browsable ones: no name and no number.**
// Lists and chips still get a state and a count. #107 hands names to one letting's sheet.
import { type Html, h } from '../../kernel/ui/html.ts';
import { csrfInput, renderPage } from '../../kernel/ui/page.ts';
import type { BuildingStatus, ConditionStatus } from './plan.ts';
import type {
  BuildingDetail,
  BuildingSummary,
  ExpiringLease,
  ProjectOption,
  SearchResults,
  UnitHit,
  UnitRow,
} from './read-model.ts';
import { SEARCH_LIMIT } from './read-model.ts';

/**
 * Which units are let today, and by how many residents. `src/scope/` is the only thing that can
 * answer it (`resolveOccupiedUnits`), and a unit absent from the map is a vacancy.
 */
export type OccupancyByUnit = ReadonlyMap<string, number>;

/** How many units in each building are let today. Same answer, one level up. */
export type OccupancyByBuilding = ReadonlyMap<string, number>;

/**
 * What a documents panel is handed. Structural, and defined here so this file never imports
 * evidence: the composition root injects the rows, and the view renders them.
 */
export interface FiledDocumentView {
  documentId: string;
  typeKey: string;
  labelHe: string;
  ingestedAt: string;
  validFrom: string | null;
  validTo: string | null;
  storageUri: string;
  /** Slice 5.4. Present on the documents panel, absent on search. */
  readUrl?: string;
  verificationVerdict: 'verified' | 'unverified' | 'unguarded';
}

export interface PromotedFieldView {
  extractedFieldId: string;
  documentId: string;
  labelHe: string;
  value: string;
  page: number;
  confidence: number | null;
}

/** Slice 5.5. Injected from tenancy; this file never queries `tenancy_event`. */
export interface TenancyEventView {
  field: string;
  old_value: string | null;
  new_value: string;
  actor: string;
  source_document_id: string | null;
}

export interface DocumentSearchHit extends FiledDocumentView {
  entityType: 'UNIT' | 'BUILDING';
  entityId: string;
  unitId: string | null;
  unitNumber: string | null;
  buildingId: string | null;
  buildingName: string | null;
}

export interface SearchPageResults extends SearchResults {
  documents: readonly DocumentSearchHit[];
}

const BUILDING_STATUS: Record<string, string> = {
  ACTIVE: 'פעיל',
  IN_CONSTRUCTION: 'בבנייה',
  EXITED: 'הסתיים',
};

/**
 * The vocabulary the form offers, in the order it offers it (6.1). Typed as `BuildingStatus`, so
 * the select and the CHECK constraint cannot drift apart without a typecheck failure — the reason
 * `src/estate/internal/plan.ts` spells these as a union in the first place.
 */
const BUILDING_STATUSES: readonly BuildingStatus[] = [
  'ACTIVE',
  'IN_CONSTRUCTION',
  'EXITED',
];

const CONDITION: Record<string, string> = {
  READY: 'מוכנה',
  RENOVATION: 'בשיפוץ',
  WITHHELD: 'מוקפאת',
};

/**
 * The vocabulary the apartment form offers, in the order it offers it (6.2). Typed as
 * `ConditionStatus` for the reason `BUILDING_STATUSES` is typed as `BuildingStatus`: the select and
 * the CHECK constraint cannot drift apart without a typecheck failure.
 */
const CONDITION_STATUSES: readonly ConditionStatus[] = [
  'READY',
  'RENOVATION',
  'WITHHELD',
];

const SPACE_KIND: Record<string, string> = {
  UNIT: 'דירות',
  COMMON: 'שטחים משותפים',
  TECHNICAL: 'חללים טכניים',
  EXTERIOR: 'שטחי חוץ',
  PARKING: 'חניות',
  STORAGE: 'מחסנים',
};

const VERDICT: Record<FiledDocumentView['verificationVerdict'], string> = {
  verified: 'נמצאו כל הביטויים הקבועים של הטופס',
  unverified: 'הקובץ אינו נושא שכבת טקסט — יאומת בשלב הקריאה האוטומטית',
  unguarded: 'לסוג זה אין ביטויים קבועים להשוואה',
};

const VERDICT_CHIP: Record<FiledDocumentView['verificationVerdict'], string> = {
  verified: 'נבדק',
  unverified: 'ללא שכבת טקסט',
  unguarded: 'ללא בדיקה',
};

const EVENT_FIELD: Record<string, string> = {
  start_date: 'תחילת השכירות',
  end_date: 'סיום השכירות',
  status: 'סטטוס',
};

// Hebrew for a value the schema allows and this table does not translate. A vocabulary gains a
// member by migration, so the untranslated case is a deploy behind, not a data error.
const label = (table: Record<string, string>, value: string): string =>
  table[value] ?? value;

// Numbers, dates and Latin identifiers inside Hebrew text. tokens.css isolates [dir="ltr"], which
// is what stops '12A' rendering as 'A12' beside a Hebrew word.
const ltr = (value: string | number): Html =>
  h`<span dir="ltr">${value}</span>`;

// The shell — doctype, head, chrome bar, `.wrap` and the shared typography — moved to
// `src/kernel/ui/page.ts` at slice 3.3, when evidence gained a screen and the alternative was a
// second copy of it. What stays here is the layout of estate's own cards.
const styles = h`<style>
  .card-title {
    display: flex;
    align-items: baseline;
    gap: var(--space-3);
    flex-wrap: wrap;
    margin: 0 0 var(--space-2);
    font-size: var(--text-lg);
    font-weight: 500;
  }
  /* Two different measures on purpose. A building's facts are a date and a tender name and need a
     column wide enough not to break '2027-03-01' across two lines on a phone; a unit's are
     two-token pairs and would waste half the card at that width. Seen on staging at 375px. The
     wider one is .facts in the token sheet, shared with the filed-document screen since 3.3;
     only the narrow override is estate's. */
  .unit-card .facts {
    grid-template-columns: repeat(auto-fit, minmax(7rem, 1fr));
  }
  .chips { display: flex; flex-wrap: wrap; gap: var(--space-2); }
  .unit-actions { margin: var(--space-3) 0 0; }
  .unit-grid {
    display: grid;
    gap: var(--space-2);
    grid-template-columns: repeat(auto-fill, minmax(15rem, 1fr));
  }
  .unit-card { padding-inline-start: var(--space-6); }
  .unit-no { font-size: var(--text-lg); font-weight: 500; }
  a.card-link { color: inherit; text-decoration: none; display: block; }
  a.card-link:hover .card-title { text-decoration: underline; }
  a.unit-no { color: inherit; }
  .index-list { display: grid; gap: var(--space-2); }
  .lease-when { display: flex; gap: var(--space-3); align-items: baseline; flex-wrap: wrap; }
  .doc-uri { word-break: break-all; }
  .doc-group { display: grid; gap: var(--space-2); }
  .queue-card {
    display: grid;
    gap: var(--space-3);
    padding: var(--space-4) var(--space-5);
  }
  .queue-card form {
    display: flex;
    gap: var(--space-2);
    flex-wrap: wrap;
    align-items: center;
  }
  .queue-card input { min-height: var(--size-control-ops); flex: 1; min-width: 12rem; }
  .change-log {
    display: grid;
    gap: var(--space-2);
    padding: 0;
    margin: 0;
    list-style: none;
  }
  .change-log li {
    padding: var(--space-3) 0;
    border-block-end: var(--size-hairline) solid var(--color-divider);
  }
  /* Slice 6.1's form. Evidence's upload screen carries the same four class names in its own styles
     block, which is the arrangement src/kernel/ui/page.ts describes rather than a copy that
     drifted: the kernel owns the shell and the tokens, a module owns the layout of its own cards.
     A third module wanting them is the moment they move down. */
  .form-grid { display: grid; gap: var(--space-4); max-width: var(--size-shell-max); }
  .form-row { display: grid; gap: var(--space-2); }
  .form-row .hint, .form-note { color: var(--color-text-muted); font-size: var(--text-sm); margin: 0; }
  .form-actions { display: flex; gap: var(--space-3); flex-wrap: wrap; align-items: center; }
  .form-pair {
    display: grid;
    gap: var(--space-4);
    grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr));
  }
  /* Slice 6.2's one checkbox. The same two rules src/settings-page.ts carries, under the same
     name, which is the arrangement above rather than a copy that drifted: the third occurrence is
     what moves it to the token sheet. */
  /* One letting. Layout only; colour and type stay tokens. */
  .notice {
    border: var(--size-hairline) solid var(--color-divider-soft);
    border-radius: var(--radius-3);
    padding: var(--space-4) var(--space-5);
    background: var(--color-surface-card);
  }
  .notice h2 { font-size: var(--text-lg); margin: 0 0 var(--space-2); }
  .notice h2.second-heading { margin-block-start: var(--space-5); }
  /* Split pane, not a card: the Unit and the thread share the main column, and the
     checkbox collapses the thread the same way the ops rail opens — no script. */
  .ops:has(.unit-sheet) .ops-main {
    max-width: none;
    padding: 0;
    min-height: 100%;
    display: grid;
  }
  .unit-sheet {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    min-height: 100%;
    min-width: 0;
  }
  .unit-retrieval-toggle {
    position: absolute;
    width: var(--size-hairline);
    height: var(--size-hairline);
    overflow: hidden;
    clip-path: inset(50%);
  }
  .unit-sheet-main {
    grid-column: 1;
    grid-row: 1;
    min-width: 0;
    padding: var(--space-6);
    padding-inline: max(var(--space-6), env(safe-area-inset-inline-start, 0px), env(safe-area-inset-inline-end, 0px));
    padding-block-end: max(var(--space-6), env(safe-area-inset-bottom, 0px));
  }
  .unit-retrieval {
    grid-column: 1;
    grid-row: 2;
  }
  .unit-retrieval {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr) auto;
    min-width: 0;
    min-height: 0;
    max-height: 50dvh;
    background: var(--color-surface-card);
    border-block-start: var(--size-hairline) solid var(--color-divider);
  }
  .unit-retrieval-head {
    display: grid;
    gap: var(--space-2);
    padding: var(--space-3) var(--space-4);
    border-block-end: var(--size-hairline) solid var(--color-divider-soft);
  }
  .unit-retrieval-head h2 {
    margin: 0;
    min-width: 0;
    font-size: var(--text-base);
    font-weight: 500;
  }
  .unit-retrieval-tools {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    align-items: center;
  }
  .unit-retrieval-tools form { margin: 0; }
  .unit-retrieval-tools .btn {
    min-height: var(--size-control-ops);
    padding-inline: var(--space-3);
    font-size: var(--text-sm);
  }
  .unit-retrieval-hide {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: var(--size-control-ops);
    padding-inline: var(--space-3);
    border-radius: var(--radius-2);
    border: var(--size-hairline) solid var(--color-field-line);
    background: var(--color-surface-card);
    color: var(--color-text);
    font: inherit;
    font-size: var(--text-sm);
    font-weight: 500;
    cursor: pointer;
    touch-action: manipulation;
  }
  .unit-retrieval-hide .when-closed { display: none; }
  .unit-sheet:has(.unit-retrieval-toggle:not(:checked)) .unit-thread,
  .unit-sheet:has(.unit-retrieval-toggle:not(:checked)) .unit-retrieval-empty,
  .unit-sheet:has(.unit-retrieval-toggle:not(:checked)) .unit-retrieval-ask,
  .unit-sheet:has(.unit-retrieval-toggle:not(:checked)) .unit-retrieval-head h2,
  .unit-sheet:has(.unit-retrieval-toggle:not(:checked)) .unit-retrieval-tools form {
    display: none;
  }
  .unit-sheet:has(.unit-retrieval-toggle:not(:checked)) .unit-retrieval {
    max-height: none;
    grid-template-rows: auto;
  }
  .unit-sheet:has(.unit-retrieval-toggle:not(:checked)) .unit-retrieval-head {
    padding: var(--space-2) var(--space-4);
  }
  .unit-sheet:has(.unit-retrieval-toggle:not(:checked)) .unit-retrieval-hide .when-open {
    display: none;
  }
  .unit-sheet:has(.unit-retrieval-toggle:not(:checked)) .unit-retrieval-hide .when-closed {
    display: inline;
  }
  .unit-retrieval-toggle:focus-visible + .unit-sheet-main + .unit-retrieval .unit-retrieval-hide {
    outline: var(--size-focus) solid var(--color-accent-line);
    outline-offset: var(--size-focus);
  }
  .unit-thread {
    display: grid;
    align-content: start;
    gap: var(--space-3);
    margin: 0;
    padding: var(--space-4);
    list-style: none;
    overflow: auto;
    min-height: 0;
  }
  .unit-turn {
    display: grid;
    gap: var(--space-2);
    min-width: 0;
    padding: var(--space-3);
    border-radius: var(--radius-2);
    background: var(--color-bg);
  }
  .unit-turn .asked { margin: 0; font-weight: 500; font-size: var(--text-sm); color: var(--color-text-muted); }
  .unit-turn .answered { margin: 0; }
  .unit-turn.is-refused .answered { color: var(--color-text-muted); }
  .unit-citations { margin: 0; padding: 0; display: grid; gap: var(--space-1); list-style: none; }
  .unit-citations a { font-size: var(--text-sm); }
  .unit-retrieval-empty {
    margin: 0;
    padding: var(--space-4);
    color: var(--color-text-muted);
  }
  .unit-retrieval-ask {
    display: grid;
    gap: var(--space-3);
    padding: var(--space-4);
    padding-block-end: max(var(--space-4), env(safe-area-inset-bottom, 0px));
    border-block-start: var(--size-hairline) solid var(--color-divider-soft);
    background: var(--color-surface);
  }
  .unit-retrieval-ask .form-grid { max-width: none; gap: var(--space-3); }
  .unit-retrieval-ask textarea { min-height: calc(var(--space-10) + var(--space-6)); resize: none; }
  @media (min-width: 64rem) {
    .ops:has(.unit-sheet) {
      height: 100dvh;
      overflow: hidden;
    }
    .ops:has(.unit-sheet) .ops-main {
      min-height: 0;
      overflow: hidden;
    }
    .unit-sheet {
      grid-template-columns: minmax(0, 1fr) var(--size-retrieval);
      height: 100%;
      min-height: 0;
      overflow: hidden;
    }
    .unit-sheet:has(.unit-retrieval-toggle:not(:checked)) {
      grid-template-columns: minmax(0, 1fr) var(--size-touch);
    }
    .unit-sheet-main {
      overflow: auto;
    }
    .unit-retrieval {
      grid-column: 2;
      grid-row: 1;
    }
    .unit-retrieval {
      max-height: none;
      height: 100%;
      border-block-start: 0;
      border-inline-start: var(--size-hairline) solid var(--color-divider);
    }
    .unit-sheet:has(.unit-retrieval-toggle:not(:checked)) .unit-retrieval-head {
      height: 100%;
      padding: var(--space-4) 0;
      border-block-end: 0;
    }
    .unit-sheet:has(.unit-retrieval-toggle:not(:checked)) .unit-retrieval-hide {
      writing-mode: vertical-rl;
      min-height: 0;
      height: 100%;
      width: 100%;
      padding-block: var(--space-4);
      padding-inline: 0;
      border: 0;
      border-radius: 0;
      background: var(--color-surface);
    }
  }
  .tenancy-head { display: flex; flex-wrap: wrap; gap: var(--space-2) var(--space-3); align-items: baseline; }
  .status.is-active { background: color-mix(in srgb, var(--color-ok) 14%, var(--color-surface-card)); color: var(--color-ok); }
  .term-found { color: var(--color-ok); }
  .term-missing { color: var(--color-alert); }
  .term-state { font-weight: 600; }
  .second { color: var(--color-text-muted); font-size: var(--text-xs); }
  .gate { display: grid; gap: var(--space-2); margin: var(--space-3) 0 0; padding: 0; list-style: none; }
  .gate li { display: flex; gap: var(--space-3); align-items: baseline; flex-wrap: wrap; min-width: 0; }
  .gate .outcome { min-inline-size: 6rem; }
  .gate .why { color: var(--color-text-muted); font-size: var(--text-sm); }
  .activate {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-4);
    align-items: center;
    margin-block-start: var(--space-4);
    padding-block-start: var(--space-4);
    border-block-start: var(--size-hairline) solid var(--color-divider-soft);
  }
  .activate .reasons { color: var(--color-text-muted); font-size: var(--text-base); margin: 0; min-width: 0; flex: 1 1 18rem; }
  .arms { color: var(--color-text); font-weight: 500; }
  .missing { display: grid; gap: var(--space-1); margin: var(--space-3) 0 0; padding: 0; list-style: none; color: var(--color-alert); }
  .carried { display: grid; gap: var(--space-2); margin: var(--space-3) 0 0; padding: 0; }
  .carried > div { display: flex; gap: var(--space-3); flex-wrap: wrap; align-items: baseline; min-width: 0; }
  .carried dt { color: var(--color-text-muted); font-size: var(--text-sm); min-inline-size: 9rem; margin: 0; }
  .carried dd { margin: 0; min-width: 0; }
  .carried .role { color: var(--color-text-muted); font-size: var(--text-xs); }
</style>`;

function page(title: string, body: Html, nav: Html): string {
  return renderPage({ title, styles, nav, body });
}

function marker(status: string): Html {
  // The state marker's colour is a token and its meaning is the status. Anything but ACTIVE is not
  // an alert, it is simply not the ordinary case, so it gets the neutral marker. `ALERT` is the one
  // caller that means it: a lease inside its last fortnight is something somebody has to do
  // something about this week (2.6).
  const state =
    status === 'ACTIVE' ? 'is-ok' : status === 'ALERT' ? 'is-alert' : '';
  return h`<span class="state-marker ${state}"></span>`;
}

function buildingFacts(building: BuildingSummary, occupied?: number): Html {
  return h`<dl class="facts">
    <div><dt>יחידות דיור</dt><dd>${ltr(building.unit_count)}</dd></div>
    ${
      occupied === undefined
        ? h``
        : h`<div><dt>מאוכלסות</dt><dd>${ltr(occupied)}</dd></div>`
    }
    <div><dt>חללים</dt><dd>${ltr(building.space_count)}</dd></div>
    <div><dt>מסירה</dt><dd>${ltr(building.handover_date)}</dd></div>
    <div><dt>תום תקופת הבדק</dt><dd>${ltr(building.warranty_end_date)}</dd></div>
    ${
      building.project_code
        ? h`<div><dt>מכרז</dt><dd>${building.project_name} · ${ltr(building.project_code)}</dd></div>`
        : h``
    }
  </dl>`;
}

export function renderBuildingsPage(
  buildings: BuildingSummary[],
  occupancy: OccupancyByBuilding,
  nav: Html,
  /**
   * Whether this viewer holds `estate.write` (slice 6.1). The link is rendered for nobody else:
   * the refusal this system makes says `not_allowed` and nothing more, so an operator who followed
   * it would learn nothing from it except that they had wasted the trip.
   */
  mayWrite = false,
): string {
  const units = buildings.reduce(
    (total, building) => total + Number(building.unit_count),
    0,
  );
  let occupied = 0;
  for (const building of buildings) {
    occupied += occupancy.get(building.building_id) ?? 0;
  }
  const body = h`
    <div>
      <h1>בניינים</h1>
      <p class="lede">
        ${ltr(buildings.length)} בניינים · ${ltr(units)} יחידות דיור ·
        ${ltr(occupied)} מאוכלסות היום. שתי הספירות נגזרות בכל טעינה ואינן נשמרות.
      </p>
      ${
        mayWrite
          ? h`<p class="form-actions">
              <a class="btn btn-primary" href="/estate/buildings/new">בניין חדש</a>
            </p>`
          : h``
      }
    </div>
    ${
      buildings.length === 0
        ? h`<p class="empty-state">אין עדיין בניינים במערכת.</p>`
        : h`<div class="row-list">
            ${buildings.map(
              (building) => h`<article class="row-card">
                ${marker(building.status)}
                <a class="card-link" href="/estate/buildings/${building.building_id}">
                  <p class="card-title">
                    <span>${building.name}</span>
                    <span class="chip">${label(BUILDING_STATUS, building.status)}</span>
                  </p>
                  <p class="lede">${building.address_line}, ${building.city}</p>
                  ${buildingFacts(building, occupancy.get(building.building_id))}
                </a>
              </article>`,
            )}
          </div>`
    }`;
  return page('דונה דום — בניינים', body, nav);
}

/**
 * What the new-building form is handed. **Slice 6.1, flow A11.**
 *
 * `csrf` is required and has no default. 5.8 found the other arrangement the hard way: a default of
 * `''` type-checks at every call site and renders a form that posts and is always refused, which is
 * only discoverable by clicking the screen. A required parameter makes the route that forgets it
 * fail to compile.
 */
export interface NewBuildingScreen {
  nav: Html;
  csrf: string;
  projects: readonly ProjectOption[];
  /**
   * **What A12's refusal read off the paper. Slice 6.9.**
   *
   * Defaults in inputs and nothing more: the admin reads them against the document in their hand
   * and edits whatever is wrong, and the post is A11's own, through A11's own validation. A reading
   * that was wrong therefore costs a correction rather than a building.
   *
   * `carry` is what survives the two forms so A13 and then A12 can be reached without retyping an
   * address — a unit number, a document type and the marker that says *come back to intake*. It is
   * rendered as hidden inputs, which is the only state this walk has: **the bytes are not held.**
   */
  prefill?: {
    name?: string;
    addressLine?: string;
    city?: string;
  };
  carry?: { unitNumber?: string; typeKey?: string; next?: string };
}

/** The hidden inputs that carry A12's walk through a form that knows nothing about it. Slice 6.9. */
function carried(carry: NewBuildingScreen['carry']): Html {
  if (!carry?.next) {
    return h``;
  }
  return h`<input type="hidden" name="next" value="${carry.next}" />
    ${
      carry.unitNumber
        ? h`<input type="hidden" name="unit_number" value="${carry.unitNumber}" />`
        : h``
    }
    ${
      carry.typeKey
        ? h`<input type="hidden" name="type" value="${carry.typeKey}" />`
        : h``
    }`;
}

/**
 * The screen an admin shapes the estate from.
 *
 * **No client-side idempotence and no "does this address exist" check.** `building.address_key` is
 * UNIQUE and the importer upserts on it, so a double submit converges on one row whoever is
 * writing. A check here would be a check the next writer does not make.
 */
export function renderNewBuildingPage(screen: NewBuildingScreen): string {
  const body = h`
    <div>
      <a class="back" href="/estate">← בניינים</a>
      <h1>בניין חדש</h1>
      <p class="lede">
        מפעיל מתייק נייר; מנהל מעצב את הנכס. המסך הזה פתוח למנהל בלבד.
      </p>
    </div>
    ${
      screen.carry?.next
        ? h`<p class="form-note">
            <strong>מתוך תיוק מסמך.</strong> הכתובת שלמטה נקראה מן המסמך. בדקו אותה מול הנייר
            ותקנו אם צריך — אחרי יצירת הבניין נמשיך לדירה, ומשם חזרה לתיוק.
          </p>`
        : h``
    }
    <form class="form-grid" method="post" action="/estate/buildings">
      ${csrfInput(screen.csrf)}
      ${carried(screen.carry)}
      <div class="form-row">
        <label for="name">שם הבניין</label>
        <input id="name" name="name" type="text" maxlength="200" required
          value="${screen.prefill?.name ?? ''}" />
        <p class="hint">איך הצוות קורא לבניין. אינו חייב להיות זהה לכתובת.</p>
      </div>
      <div class="form-pair">
        <div class="form-row">
          <label for="address_line">רחוב ומספר</label>
          <input id="address_line" name="address_line" type="text" maxlength="200" required
            value="${screen.prefill?.addressLine ?? ''}" />
        </div>
        <div class="form-row">
          <label for="city">עיר</label>
          <input id="city" name="city" type="text" maxlength="120" required
            value="${screen.prefill?.city ?? ''}" />
        </div>
      </div>
      <p class="form-note">
        הכתובת היא מה שמזהה בניין. אותה כתובת פעמיים מעדכנת את הבניין הקיים ואינה יוצרת בניין שני.
      </p>
      <div class="form-row">
        <label for="project_code">פרויקט</label>
        <select id="project_code" name="project_code">
          <option value="">ללא פרויקט</option>
          ${screen.projects.map(
            (project) =>
              h`<option value="${project.project_code}">${project.name} · ${ltr(
                project.project_code,
              )}</option>`,
          )}
        </select>
        <p class="hint">
          בניין יכול לעמוד ללא פרויקט. הרשימה היא הפרויקטים הקיימים; קוד מכרז חדש אינו נפתח כאן.
        </p>
      </div>
      <div class="form-pair">
        <div class="form-row">
          <label for="handover_date">תאריך מסירה</label>
          <input id="handover_date" name="handover_date" type="date" required />
          <p class="hint">פותח את תקופת הבדק.</p>
        </div>
        <div class="form-row">
          <label for="warranty_end_date">תום תקופת הבדק</label>
          <input id="warranty_end_date" name="warranty_end_date" type="date" />
          <p class="hint">ריק — נגזר: תאריך המסירה ועוד שנתיים.</p>
        </div>
      </div>
      <div class="form-row">
        <label for="status">סטטוס</label>
        <select id="status" name="status">
          ${BUILDING_STATUSES.map(
            (status) =>
              h`<option value="${status}" ${
                status === 'ACTIVE' ? h`selected` : h``
              }>${label(BUILDING_STATUS, status)}</option>`,
          )}
        </select>
      </div>
      <div class="form-actions">
        <button class="btn btn-primary" type="submit">יצירת בניין</button>
        <a href="/estate">ביטול</a>
      </div>
    </form>
    <p class="form-note">
      הבניין נוצר ריק — בלי חללים ובלי דירות. הוספת דירה היא המסך הבא.
    </p>`;
  return page('דונה דום — בניין חדש', body, screen.nav);
}

/**
 * What the new-apartment form is handed. **Slice 6.2, flow A13.**
 *
 * The building is a row and not an id: the screen says which building it is writing into, and the
 * route has already read that row anyway — it is what the write is rebuilt from (SPEC-estate.md).
 * `csrf` is required and has no default, for the reason `NewBuildingScreen` states.
 */
export interface NewUnitScreen {
  nav: Html;
  csrf: string;
  building: BuildingSummary;
  /** The flat number A12's reader read, as a default. Slice 6.9 — `NewBuildingScreen` says why. */
  prefill?: { unitNumber?: string };
  carry?: { typeKey?: string; next?: string };
}

/**
 * The screen that fills a building A11 created empty.
 *
 * **It asks nothing about the building.** Everything the write needs about it is read from the row,
 * because `upsertUnitRow` upserts a building and a form's idea of one would unlink it from its
 * project on the way past (SPEC-flows.md A13).
 *
 * **And it checks nothing about the flat.** `space (building_id, space_kind, name)` is the natural
 * key and the upsert converges on it, so the same unit number posted twice is a correction and not
 * a duplicate — a check here would be a check `npm run import:register` does not make.
 */
export function renderNewUnitPage(screen: NewUnitScreen): string {
  const { building } = screen;
  const body = h`
    <div>
      <a class="back" href="/estate/buildings/${building.building_id}">← ${building.name}</a>
      <h1>דירה חדשה</h1>
      <p class="lede">${building.name} · ${building.address_line}, ${building.city}</p>
    </div>
    ${
      screen.carry?.next
        ? h`<p class="form-note">
            <strong>מתוך תיוק מסמך.</strong> מספר הדירה שלמטה נקרא מן המסמך. בדקו אותו מול הנייר
            ותקנו אם צריך — אחרי יצירת הדירה נחזור לתיוק, והדירה תהיה מסומנת.
          </p>`
        : h``
    }
    <form class="form-grid" method="post" action="/estate/buildings/${building.building_id}/units">
      ${csrfInput(screen.csrf)}
      ${
        screen.carry?.next
          ? h`<input type="hidden" name="next" value="${screen.carry.next}" />
            ${
              screen.carry.typeKey
                ? h`<input type="hidden" name="type" value="${screen.carry.typeKey}" />`
                : h``
            }`
          : h``
      }
      <div class="form-pair">
        <div class="form-row">
          <label for="unit_number">מספר דירה</label>
          <input id="unit_number" name="unit_number" type="text" maxlength="32" required
            value="${screen.prefill?.unitNumber ?? ''}" />
          <p class="hint">כפי שרשום על הדלת ובחוזה. ‏12A הוא מספר דירה תקין.</p>
        </div>
        <div class="form-row">
          <label for="floor">קומה</label>
          <input id="floor" name="floor" type="text" maxlength="32" />
          <p class="hint">טקסט ולא מספר: קרקע, מרתף וגג אינם מספרים.</p>
        </div>
      </div>
      <div class="form-pair">
        <div class="form-row">
          <label for="rooms">חדרים</label>
          <input id="rooms" name="rooms" type="number" step="0.5" min="0" max="20" required />
        </div>
        <div class="form-row">
          <label for="area_sqm">שטח במ״ר</label>
          <input id="area_sqm" name="area_sqm" type="number" step="0.1" min="0" />
          <p class="hint">ריק — טרם נמדד.</p>
        </div>
      </div>
      <div class="form-row">
        <label for="condition_status">מצב הדירה</label>
        <select id="condition_status" name="condition_status">
          ${CONDITION_STATUSES.map(
            (status) =>
              h`<option value="${status}" ${
                status === 'READY' ? h`selected` : h``
              }>${label(CONDITION, status)}</option>`,
          )}
        </select>
        <p class="hint">מצב הדירה אינו אכלוס: דירה מוכנה יכולה להיות מאוכלסת או פנויה.</p>
      </div>
      <label class="check" for="has_mamad">
        <input id="has_mamad" name="has_mamad" type="checkbox" value="true" />
        יש ממ״ד
      </label>
      <div class="form-row">
        <label for="warranty_end_date">תום תקופת הבדק לדירה</label>
        <input id="warranty_end_date" name="warranty_end_date" type="date" />
        <p class="hint">
          ריק — תקופת הבדק של הבניין (${ltr(building.warranty_end_date)}) חלה גם על הדירה. מלאו רק
          אם הדירה נמסרה בנפרד.
        </p>
      </div>
      <div class="form-actions">
        <button class="btn btn-primary" type="submit">הוספת דירה</button>
        <a href="/estate/buildings/${building.building_id}">ביטול</a>
      </div>
    </form>
    <p class="form-note">
      עם הדירה נכתבים גם חניה ומחסן על שמה, כמקומות ריקים — כדי שלפרוטוקול מסירה יהיה על מה לנחות.
      אותו מספר דירה פעמיים מעדכן את הדירה הקיימת ואינו יוצר דירה שנייה.
    </p>`;
  return page(`דונה דום — דירה חדשה`, body, screen.nav);
}

// **R6, on a card.** Occupancy is derived on every load and stored nowhere -- there is no column to
// read and no count to drift, which is the foundation rule made visible in the same way the unit
// total on the buildings list makes it visible. The number is residents and not parties: a guarantor
// is on the lease and not in the apartment, so `src/scope/` leaves them out of the count and the
// unit screen is where they are shown, marked.
function occupancyChip(residents: number | undefined): Html {
  if (residents === undefined) return h`<span class="chip">פנויה</span>`;
  return h`<span class="chip">${
    residents === 1
      ? h`מאוכלסת · דייר אחד`
      : h`מאוכלסת · ${ltr(residents)} דיירים`
  }</span>`;
}

function documentCard(doc: FiledDocumentView): Html {
  return h`<article class="row-card">
    <dl class="facts">
      ${
        doc.validFrom || doc.validTo
          ? h`<div><dt>תוקף</dt><dd>${ltr(
              [doc.validFrom, doc.validTo].filter(Boolean).join(' — '),
            )}</dd></div>`
          : h``
      }
      <div><dt>נקלט</dt><dd>${ltr(doc.ingestedAt)}</dd></div>
      <div><dt>בדיקת התאמה</dt><dd>${VERDICT[doc.verificationVerdict]}</dd></div>
      ${
        doc.readUrl
          ? h`<div><dt>קובץ</dt><dd><a href="${doc.readUrl}" rel="noreferrer">הורדה</a></dd></div>`
          : h``
      }
    </dl>
    <p class="unit-actions">
      <a href="/documents/${doc.documentId}/read">מילים על הדף</a>
      ${
        doc.typeKey === 'lease'
          ? h`<a href="/documents/${doc.documentId}/fields">אישור הקריאה</a>`
          : h``
      }
    </p>
  </article>`;
}

function documentsPanel(
  docs: readonly FiledDocumentView[],
  heading: string,
): Html {
  if (docs.length === 0) {
    return h`<section>
      <h2>${heading}</h2>
      <p class="empty-state">אין מסמכים בתיק זה עדיין.</p>
    </section>`;
  }
  const groups: Array<{ label: string; items: FiledDocumentView[] }> = [];
  for (const doc of docs) {
    const last = groups[groups.length - 1];
    if (last && last.label === doc.labelHe) {
      last.items.push(doc);
    } else {
      groups.push({ label: doc.labelHe, items: [doc] });
    }
  }
  return h`<section>
    <h2>${heading} · ${ltr(docs.length)}</h2>
    ${groups.map(
      (group) => h`<div class="doc-group">
        <h3>${group.label}</h3>
        ${group.items.map(documentCard)}
      </div>`,
    )}
  </section>`;
}

function unitCard(unit: UnitRow, occupancy: OccupancyByUnit): Html {
  const residents = occupancy.get(unit.unit_id);
  return h`<article class="row-card unit-card">
    ${marker(unit.condition_status === 'READY' ? 'ACTIVE' : unit.condition_status)}
    <p class="card-title">
      <a href="/estate/units/${unit.unit_id}" class="unit-no">דירה ${ltr(unit.unit_number)}</a>
      ${occupancyChip(residents)}
      <span class="chip">${label(CONDITION, unit.condition_status)}</span>
      ${unit.has_mamad ? h`<span class="chip">ממ״ד</span>` : h``}
    </p>
    <dl class="facts">
      ${unit.floor ? h`<div><dt>קומה</dt><dd>${ltr(unit.floor)}</dd></div>` : h``}
      <div><dt>חדרים</dt><dd>${ltr(unit.rooms)}</dd></div>
      <div>
        <dt>שטח</dt>
        <dd>${unit.area_sqm ? h`${ltr(unit.area_sqm)} מ״ר` : h`טרם נמדד`}</dd>
      </div>
      ${unit.parking_name ? h`<div><dt>חניה</dt><dd>${ltr(unit.parking_name)}</dd></div>` : h``}
      ${unit.storage_name ? h`<div><dt>מחסן</dt><dd>${ltr(unit.storage_name)}</dd></div>` : h``}
      ${
        unit.warranty_end_date
          ? h`<div><dt>בדק עד</dt><dd>${ltr(unit.warranty_end_date)}</dd></div>`
          : h``
      }
    </dl>
    <p class="unit-actions">
      <a href="/documents/new?unit=${unit.unit_id}">הוספת מסמך</a>
    </p>
  </article>`;
}

export function renderBuildingPage(
  detail: BuildingDetail,
  occupancy: OccupancyByUnit,
  nav: Html,
  documents: readonly FiledDocumentView[] = [],
  /**
   * Whether this viewer holds `estate.write` (slice 6.2). The buildings list's rule, one level
   * down: the door is rendered for nobody else, because the refusal behind it says `not_allowed`
   * and nothing more.
   */
  mayWrite = false,
  retrieval?: OfficeRetrievalView,
): string {
  const { building, kinds, units } = detail;
  const let_ = units.filter((unit) => occupancy.has(unit.unit_id)).length;
  const sheet = h`
    <div>
      <a class="back" href="/estate">← כל הבניינים</a>
      <h1>${building.name}</h1>
      <p class="lede">${building.address_line}, ${building.city}</p>
      ${buildingFacts(building)}
    </div>
    <section>
      <h2>חללים לפי סוג</h2>
      <div class="chips">
        ${kinds.map(
          (kind) =>
            h`<span class="chip">${label(SPACE_KIND, kind.space_kind)} · ${ltr(kind.n)}</span>`,
        )}
      </div>
    </section>
    ${documentsPanel(documents, 'מסמכי הבניין')}
    <section>
      <h2>יחידות דיור · ${ltr(units.length)}</h2>
      <p class="lede">${ltr(let_)} מאוכלסות היום, ${ltr(units.length - let_)} פנויות. נגזר בכל טעינה ואינו נשמר.</p>
      ${
        mayWrite
          ? h`<p class="form-actions">
              <a class="btn btn-primary" href="/estate/buildings/${building.building_id}/units/new">דירה חדשה</a>
            </p>`
          : h``
      }
      ${
        units.length === 0
          ? h`<p class="empty-state">אין יחידות דיור בבניין זה.</p>`
          : h`<div class="unit-grid">${units.map((unit) => unitCard(unit, occupancy))}</div>`
      }
    </section>`;
  const body =
    retrieval === undefined
      ? sheet
      : h`<div class="unit-sheet">${retrievalSplit(sheet, retrieval)}</div>`;
  return page(`דונה דום — ${building.name}`, body, nav);
}

function promotedPanel(fields: readonly PromotedFieldView[]): Html {
  if (fields.length === 0) {
    return h``;
  }
  return h`<section>
    <h2>מקור</h2>
    <dl class="facts">${fields.map((field) => {
      const href = `/documents/${field.documentId}/read?page=${String(field.page)}`;
      const score =
        field.confidence === null
          ? h``
          : h` · ${ltr(`${Math.round(field.confidence * 100)}%`)}`;
      return h`<div><dt>${field.labelHe}</dt><dd><a href="${href}">${ltr(field.value)}</a>${score}</dd></div>`;
    })}</dl>
  </section>`;
}

function changeLogPanel(events: readonly TenancyEventView[]): Html {
  if (events.length === 0) {
    return h``;
  }
  return h`<section>
    <h2>יומן שינויים</h2>
    <ol class="change-log">${events.map((event) => {
      const field = label(EVENT_FIELD, event.field);
      const oldValue = event.old_value ?? '—';
      const paper = event.source_document_id
        ? h` · <a href="/documents/${event.source_document_id}">מסמך</a>`
        : h``;
      return h`<li>
        ${field}
        <span dir="ltr">${oldValue} → ${event.new_value}</span>
        · <span dir="ltr">${event.actor}</span>${paper}
      </li>`;
    })}</ol>
  </section>`;
}

export function renderUnitPage(
  unit: UnitHit,
  residents: number | undefined,
  documents: readonly FiledDocumentView[],
  nav: Html,
  promoted: readonly PromotedFieldView[] = [],
  events: readonly TenancyEventView[] = [],
  retrieval?: OfficeRetrievalView,
): string {
  const sheet = h`
    <div>
      <a class="back" href="/estate/buildings/${unit.building_id}">← ${unit.building_name}</a>
      <h1>דירה ${ltr(unit.unit_number)}</h1>
      <p class="lede">${unit.building_name} · ${unit.address_line}, ${unit.city}</p>
      <div class="chips">${occupancyChip(residents)}</div>
      <p class="unit-actions">
        <a href="/documents/new?unit=${unit.unit_id}">הוספת מסמך</a>
      </p>
    </div>
    ${promotedPanel(promoted)}
    ${changeLogPanel(events)}
    ${documentsPanel(documents, 'מסמכים')}`;
  const body =
    retrieval === undefined
      ? sheet
      : h`<div class="unit-sheet">${retrievalSplit(sheet, retrieval)}</div>`;
  return page(`דונה דום — דירה ${unit.unit_number}`, body, nav);
}

export interface OfficeRetrievalView {
  csrf: string;
  bound: { kind: 'unit' | 'building'; id: string };
  thread: readonly {
    question: string;
    answer: string;
    refused: boolean;
    citations: readonly {
      documentId: string;
      page: number;
      documentType: string;
    }[];
  }[];
}

/** #114. Same shape as the Building panel; the bound is this Unit. */
export type UnitRetrievalView = OfficeRetrievalView;

function retrievalSplit(sheet: Html, retrieval: OfficeRetrievalView): Html {
  const prefix =
    retrieval.bound.kind === 'unit'
      ? `/estate/units/${retrieval.bound.id}`
      : `/estate/buildings/${retrieval.bound.id}`;
  const ask = `${prefix}/office-turn`;
  const clear = `${prefix}/office-thread`;
  const toggleId = `${retrieval.bound.kind}-retrieval-toggle`;
  return h`
    <input type="checkbox" id="${toggleId}" class="unit-retrieval-toggle" checked />
    <div class="unit-sheet-main">${sheet}</div>
    <aside class="unit-retrieval" data-office-retrieval="${retrieval.bound.kind}" aria-label="שאלות על המסמכים">
      <header class="unit-retrieval-head">
        <h2>שאלות על המסמכים</h2>
        <div class="unit-retrieval-tools">
          ${
            retrieval.thread.length === 0
              ? h``
              : h`<form method="post" action="${clear}">
                  ${csrfInput(retrieval.csrf)}
                  <button class="btn btn-secondary" type="submit">מחיקת השיחה</button>
                </form>`
          }
          <label class="unit-retrieval-hide" for="${toggleId}"><span class="when-open">הסתרה</span><span class="when-closed">שאלות</span></label>
        </div>
      </header>
      ${
        retrieval.thread.length === 0
          ? h`<p class="unit-retrieval-empty">עדיין לא נשאלה שאלה.</p>`
          : h`<ol class="unit-thread">
              ${retrieval.thread.map(
                (
                  turn,
                ) => h`<li class="unit-turn${turn.refused ? ' is-refused' : ''}">
                  <p class="asked">${turn.question}</p>
                  <p class="answered">${turn.answer}</p>
                  ${citationList(turn.citations)}
                </li>`,
              )}
            </ol>`
      }
      <form method="post" action="${ask}" class="unit-retrieval-ask">
        <div class="form-grid">
          ${csrfInput(retrieval.csrf)}
          <label class="form-row">שאלה
            <textarea name="question" required maxlength="2000" rows="2"></textarea>
          </label>
          <div class="form-actions">
            <button class="btn btn-primary" type="submit">שאלו</button>
          </div>
        </div>
      </form>
    </aside>
  `;
}

function citationList(
  citations: OfficeRetrievalView['thread'][number]['citations'],
): Html {
  if (citations.length === 0) return h``;
  return h`<ul class="unit-citations">
    ${citations.map((cite) => {
      const labelHe = DOC_LABEL[cite.documentType] ?? cite.documentType;
      return h`<li>
        <a href="/documents/${cite.documentId}/read?page=${cite.page}">${labelHe} · עמוד ${ltr(cite.page)}</a>
      </li>`;
    })}
  </ul>`;
}

// ------------------------------------------------------------------------------------------------
// Slice 2.6 — search and the leases ending soon. (The root index was here too, until 5.2.)
// ------------------------------------------------------------------------------------------------

/**
 * **The root index left this file at slice 5.2**, on the schedule 2.6 set for it: it moves to the
 * composition root the week a second *module* has a screen, because an index of screens is not
 * estate's fact. It is `src/index-page.ts` now, registered by `src/app.ts`, and its nav names both
 * modules' routes and carries the sign-out form — none of which estate could have written.
 *
 * What 2.6 decided about it still holds and is worth keeping where somebody looking for it will
 * find it: **it runs no query**. A portfolio headline belongs on the buildings list, where those
 * numbers are already being read for the cards.
 */

function unitHits(results: SearchResults): Html {
  return h`<div class="row-list">
    ${results.units.map(
      (unit) => h`<article class="row-card">
        <a class="card-link" href="/estate/units/${unit.unit_id}">
          <p class="card-title">
            <span class="unit-no">דירה ${ltr(unit.unit_number)}</span>
            <span>${unit.building_name}</span>
          </p>
          <p class="lede">${unit.address_line}, ${unit.city}</p>
        </a>
      </article>`,
    )}
  </div>`;
}

function documentHits(hits: readonly DocumentSearchHit[]): Html {
  return h`<div class="row-list">
    ${hits.map((hit) => {
      const href = `/documents/${hit.documentId}/read`;
      return h`<article class="row-card">
        <a class="card-link" href="${href}">
          <p class="card-title">
            <span>${hit.labelHe}</span>
            <span class="chip">${VERDICT_CHIP[hit.verificationVerdict]}</span>
          </p>
          <p class="lede">
            ${
              hit.unitNumber
                ? h`דירה ${ltr(hit.unitNumber)} · ${hit.buildingName}`
                : hit.buildingName
            }
          </p>
        </a>
      </article>`;
    })}
  </div>`;
}

/**
 * **Search across the portfolio — buildings, units and documents, and deliberately not people.**
 *
 * A search box that reached `party` would put a real person on a screen. An address is not personal
 * data and a name is; **5.2 put a login in front of this screen and did not open the name search**,
 * because a session says who is asking rather than what a household's name is for (SPEC.md). Slice 3.6 grew this screen by a documents half
 * rather than forking a second one.
 */
export function renderSearchPage(
  term: string,
  results: SearchPageResults,
  nav: Html,
): string {
  const found =
    results.buildings.length + results.units.length + results.documents.length;
  const body = h`
    <div>
      <h1>חיפוש</h1>
      ${
        term === ''
          ? h`<p class="lede">חפשו לפי כתובת, שם בניין, מספר דירה או סוג מסמך.</p>`
          : h`<p class="lede">${ltr(found)} תוצאות עבור «${term}».</p>`
      }
      ${
        results.truncated
          ? h`<p class="lede">מוצגות ${ltr(SEARCH_LIMIT)} התוצאות הראשונות בלבד. צמצמו את החיפוש.</p>`
          : h``
      }
    </div>
    ${
      term !== '' && found === 0
        ? h`<p class="empty-state">לא נמצאו בניינים, דירות או מסמכים התואמים את החיפוש.</p>`
        : h``
    }
    ${
      results.buildings.length === 0
        ? h``
        : h`<section>
            <h2>בניינים · ${ltr(results.buildings.length)}</h2>
            <div class="row-list">
              ${results.buildings.map(
                (building) => h`<article class="row-card">
                  ${marker(building.status)}
                  <a class="card-link" href="/estate/buildings/${building.building_id}">
                    <p class="card-title">
                      <span>${building.name}</span>
                      <span class="chip">${label(BUILDING_STATUS, building.status)}</span>
                    </p>
                    <p class="lede">${building.address_line}, ${building.city}</p>
                  </a>
                </article>`,
              )}
            </div>
          </section>`
    }
    ${
      results.units.length === 0
        ? h``
        : h`<section>
            <h2>דירות · ${ltr(results.units.length)}</h2>
            ${unitHits(results)}
          </section>`
    }
    ${
      results.documents.length === 0
        ? h``
        : h`<section>
            <h2>מסמכים · ${ltr(results.documents.length)}</h2>
            ${documentHits(results.documents)}
          </section>`
    }`;
  return page('דונה דום — חיפוש', body, nav);
}

/**
 * **Q5 — every lease in the portfolio ending inside the window, one indexed query.**
 *
 * It shows a unit, a building and a date, and no party at all: which lease ends when is an
 * operations fact, and who is on it is still not this screen's to say (SPEC.md, decided at 5.2).
 */
// Hebrew counts in three, not in two. “בעוד 1 ימים” is wrong in the way a room full of Hebrew
// speakers notices immediately and a template that only special-cases zero produces every day.
function daysLeft(days: number): Html {
  if (days === 0) return h`מסתיים היום`;
  if (days === 1) return h`מסתיים מחר`;
  if (days === 2) return h`בעוד יומיים`;
  return h`בעוד ${ltr(days)} ימים`;
}

export function renderExpiringPage(
  leases: ExpiringLease[],
  days: number,
  nav: Html,
): string {
  const body = h`
    <div>
      <h1>חוזים מסתיימים</h1>
      <p class="lede">
        ${ltr(leases.length)} חוזים פעילים מסתיימים ב־${ltr(days)} הימים הקרובים, על פני כל התיק.
      </p>
    </div>
    ${
      leases.length === 0
        ? h`<p class="empty-state">אין חוזים המסתיימים בטווח הזה.</p>`
        : h`<div class="row-list">
            ${leases.map(
              (lease) => h`<article class="row-card">
                ${marker(lease.days_left <= 14 ? 'ALERT' : 'ACTIVE')}
                <a class="card-link" href="/estate/buildings/${lease.building_id}">
                  <p class="card-title">
                    <span class="unit-no">דירה ${ltr(lease.unit_number)}</span>
                    <span>${lease.building_name}</span>
                    <span class="chip">${daysLeft(lease.days_left)}</span>
                  </p>
                  <p class="lede lease-when">
                    <span>${lease.city}</span>
                    <span>מסתיים ${ltr(lease.end_date)}</span>
                  </p>
                </a>
              </article>`,
            )}
          </div>`
    }`;
  return page('דונה דום — חוזים מסתיימים', body, nav);
}

const TENANCY_STATUS: Record<string, string> = {
  DRAFT: 'טיוטה',
  ACTIVE: 'פעיל',
  ENDED: 'הסתיים',
  TERMINATED_EARLY: 'הופסק',
};

const GATE_LABEL: Record<string, string> = {
  lease: 'חוזה שכירות מאושר',
  handover_protocol: 'פרוטוקול מסירה מאושר',
  start_reached: 'היום אינו לפני תחילת החוזה',
  within_term: 'היום אינו אחרי סיום החוזה',
};

const DOC_LABEL: Record<string, string> = {
  lease: 'חוזה שכירות',
  handover_protocol: 'פרוטוקול מסירה',
};

export interface IncompleteTenancyRow {
  tenancy_id: string;
  unit_id: string;
  unit_number: string;
  building_id: string;
  building_name: string;
  city: string;
  start_date: string;
  end_date: string;
  status: string;
  missing: string;
  expected_document_id: string;
  expected_document_label: string;
}

/**
 * A4 — document-backed drafts and live lettings that miss a named rule.
 *
 * A unit, dates, a missing-rule label and the document the rule was expected in. No party.
 * Gate-miss labels are the same wording as the tenancy page, so the two screens cannot disagree.
 */
export function renderIncompletePage(
  rows: readonly IncompleteTenancyRow[],
  /**
   * The CSRF token for this session (slice 5.2). The one form on this screen carries it.
   *
   * **Required, and it was briefly a default.** A default of `''` type-checks at every call site
   * and renders an empty hidden input, which is a form that posts and is always refused — found by
   * clicking the screen on `:3000` before merge, which is what that step is for. A required
   * parameter makes the route that forgets it fail to compile.
   */
  csrf: string,
  nav: Html,
): string {
  const body = h`
    <div>
      <h1>חוזים לא שלמים</h1>
      <p class="lede">
        ${ltr(rows.length)} חוזים בתיק שממתינים להשלמה. מסמך משלים, או רישום חריג לערב.
      </p>
    </div>
    ${
      rows.length === 0
        ? h`<p class="empty-state">אין חוזים ממתינים להשלמה.</p>`
        : h`<div class="row-list">
            ${rows.map((row) => {
              const missing =
                row.missing === 'guarantor'
                  ? 'חסר ערב'
                  : (GATE_LABEL[row.missing] ?? row.missing);
              return h`<article class="row-card queue-card">
                ${marker('ALERT')}
                <p class="card-title">
                  <a href="/estate/units/${row.unit_id}">
                    <span class="unit-no">דירה ${ltr(row.unit_number)}</span>
                    <span>${row.building_name}</span>
                  </a>
                  <span class="chip">${missing}</span>
                </p>
                <p class="lede lease-when">
                  <span>${row.city}</span>
                  <span>${ltr(row.start_date)} — ${ltr(row.end_date)}</span>
                  <span>${TENANCY_STATUS[row.status] ?? row.status}</span>
                </p>
                <p class="lede">
                  המסמך:
                  <a href="/documents/${row.expected_document_id}/read">${row.expected_document_label}</a>
                </p>
                ${
                  row.missing === 'guarantor'
                    ? h`<form
                  method="post"
                  action="/estate/incomplete/${row.tenancy_id}/exception"
                >
                  ${csrfInput(csrf)}
                  <input
                    id="reason-${row.tenancy_id}"
                    name="reason"
                    type="text"
                    maxlength="200"
                    required
                    aria-label="סיבת החריג"
                    placeholder="סיבת החריג"
                  />
                  <button class="btn btn-secondary" type="submit">רשום חריג</button>
                </form>`
                    : ''
                }
              </article>`;
            })}
          </div>`
    }`;
  return page('דונה דום — חוזים לא שלמים', body, nav);
}

const ROLE_LABEL: Record<string, string> = {
  PRIMARY_TENANT: 'שוכר ראשי',
  CO_TENANT: 'שוכר נוסף',
  GUARANTOR: 'ערב',
  OCCUPANT: 'דייר',
};

export interface TenancyPersonView {
  fullName: string;
  role: string;
  isServiceContact: boolean;
}

export interface TenancyGateCheckView {
  rule: string;
  passed: boolean;
}

export interface TenancySheet {
  tenancyId: string;
  status: string;
  startDate: string;
  endDate: string;
  unit: UnitHit;
  people: readonly TenancyPersonView[];
  documents: readonly FiledDocumentView[];
  checks: readonly TenancyGateCheckView[];
  canActivate: boolean;
  activatableOn: string | null;
  flags: readonly { typeKey: string }[];
  csrf: string;
  nav: Html;
}

function ofType(
  documents: readonly FiledDocumentView[],
  typeKey: string,
): FiledDocumentView | undefined {
  return documents.find((doc) => doc.typeKey === typeKey);
}

function checkWhy(check: TenancyGateCheckView, sheet: TenancySheet): Html {
  if (check.rule === 'lease' || check.rule === 'handover_protocol') {
    const held = ofType(sheet.documents, check.rule);
    if (check.passed && held) {
      return h`אושר ב־${ltr(held.ingestedAt)}`;
    }
    return h`לא הוגש ${DOC_LABEL[check.rule] ?? check.rule} להשכרה הזו`;
  }
  if (check.rule === 'start_reached') {
    return check.passed
      ? h`החוזה התחיל ב־${ltr(sheet.startDate)}`
      : h`החוזה מתחיל ב־${ltr(sheet.startDate)}`;
  }
  if (check.rule === 'within_term') {
    return check.passed
      ? h`החוזה מסתיים ב־${ltr(sheet.endDate)}`
      : h`החוזה הסתיים ב־${ltr(sheet.endDate)}`;
  }
  return h``;
}

function missingItems(sheet: TenancySheet): Html {
  const misses = sheet.checks.filter(
    (check) =>
      !check.passed &&
      (check.rule === 'lease' || check.rule === 'handover_protocol'),
  );
  if (misses.length === 0) {
    return sheet.activatableOn
      ? h`<p class="lede">דבר. כל המסמכים הנדרשים הוגשו ואושרו; מה שנותר הוא התאריך.</p>`
      : h`<p class="lede">דבר. כל הדרישות להפעלה התקיימו.</p>`;
  }
  return h`<ul class="missing">
    ${misses.map((check) => {
      const held = ofType(sheet.documents, check.rule);
      const name = DOC_LABEL[check.rule] ?? check.rule;
      return held
        ? h`<li>${name} — נקרא, לא אושר</li>`
        : h`<li>${name} — לא הוגש</li>`;
    })}
  </ul>`;
}

function activateReasons(sheet: TenancySheet): Html {
  if (sheet.canActivate) {
    return h`<p class="reasons">
      ההפעלה נרשמת כאירוע: מי הפעיל ומתי. השעון אינו מפעיל השכרה — הוא רק מסיים אותה בבוא
      מועדה.
    </p>`;
  }
  if (sheet.activatableOn) {
    return h`<p class="reasons">
      כל המסמכים הנדרשים אושרו. <span class="arms">הכפתור נדלק ב־${ltr(sheet.activatableOn)}</span>,
      יום תחילת החוזה. עד אז ההשכרה היא טיוטה, ואיש אינו רואה את הדיירים.
    </p>`;
  }
  const failed = sheet.checks.filter((check) => !check.passed);
  const names = failed
    .map((check) => GATE_LABEL[check.rule] ?? check.rule)
    .join(', ');
  return h`<p class="reasons">דרישות שטרם התקיימו: ${names}.</p>`;
}

function tenantsLine(people: readonly TenancyPersonView[]): Html {
  const tenants = people.filter(
    (person) => person.role === 'PRIMARY_TENANT' || person.role === 'CO_TENANT',
  );
  if (tenants.length === 0) return h`—`;
  return h`${tenants.map(
    (person, index) =>
      h`${index === 0 ? h`` : h` · `}${person.fullName} <span class="role">· ${label(ROLE_LABEL, person.role)}</span>`,
  )}`;
}

function guarantorsLine(people: readonly TenancyPersonView[]): Html {
  const guarantors = people.filter((person) => person.role === 'GUARANTOR');
  if (guarantors.length === 0) return h`—`;
  return h`${guarantors.map(
    (person, index) =>
      h`${index === 0 ? h`` : h` · `}${person.fullName} <span class="role">· ${
        person.isServiceContact ? 'איש קשר לשירות' : 'אינו איש קשר לשירות'
      }</span>`,
  )}`;
}

/**
 * A5 — one letting. #107. Prints the gate; does not re-run it.
 */
export function renderTenancyDetailPage(sheet: TenancySheet): string {
  const primary =
    sheet.people.find((person) => person.role === 'PRIMARY_TENANT') ??
    sheet.people[0];
  const title = primary
    ? `${primary.fullName} · ${sheet.unit.address_line}, ${sheet.unit.city} · דירה ${sheet.unit.unit_number}`
    : `${sheet.unit.address_line}, ${sheet.unit.city} · דירה ${sheet.unit.unit_number}`;
  const lease = ofType(sheet.documents, 'lease');
  const active = sheet.status === 'ACTIVE';
  const body = h`
    <div>
      <a class="back" href="/estate/units/${sheet.unit.unit_id}">← דירה ${ltr(sheet.unit.unit_number)}</a>
      <div class="tenancy-head">
        <h1>${primary ? h`${primary.fullName} · ${sheet.unit.address_line}, ${sheet.unit.city} · דירה ${ltr(sheet.unit.unit_number)}` : h`${sheet.unit.address_line}, ${sheet.unit.city} · דירה ${ltr(sheet.unit.unit_number)}`}</h1>
        <span class="${active ? 'chip status is-active' : 'chip status'}">${label(TENANCY_STATUS, sheet.status)}</span>
      </div>
      <p class="lede">${ltr(sheet.startDate)} — ${ltr(sheet.endDate)}</p>
    </div>

    <section class="notice">
      <h2>המסמכים שההשכרה מחזיקה</h2>
      ${
        sheet.documents.length === 0
          ? h`<p class="lede">אין מסמכים בתיק זה עדיין.</p>`
          : h`<div class="table-wrap">
        <table class="grid-table">
          <thead>
            <tr><th>מסמך</th><th>נקרא</th><th>מצב</th></tr>
          </thead>
          <tbody>
            ${sheet.documents.map(
              (doc) => h`<tr>
                <td class="value"><a href="/documents/${doc.documentId}/${doc.typeKey === 'lease' ? 'fields' : 'read'}">${doc.labelHe}</a></td>
                <td class="key">${ltr(doc.ingestedAt)}</td>
                <td><span class="term-state term-found">אושר</span></td>
              </tr>`,
            )}
          </tbody>
        </table>
      </div>`
      }

      <h2 class="second-heading">מה נשא החוזה אל ההשכרה</h2>
      <p class="second">
        ${
          lease
            ? h`אושר בפנקס האישור ב־${ltr(lease.ingestedAt)}.
        <a href="/documents/${lease.documentId}/fields">הערכים שאושרו</a> — לקריאה בלבד. תיקון נעשה שם, לא כאן.`
            : h`אין חוזה מקושר להשכרה הזו.`
        }
      </p>
      <dl class="carried">
        <div>
          <dt>תקופה</dt>
          <dd>${ltr(sheet.startDate)} — ${ltr(sheet.endDate)}</dd>
        </div>
        <div>
          <dt>דירה</dt>
          <dd>${sheet.unit.address_line}, ${sheet.unit.city} · דירה ${ltr(sheet.unit.unit_number)}</dd>
        </div>
        <div>
          <dt>שוכרים</dt>
          <dd>${tenantsLine(sheet.people)}</dd>
        </div>
        <div>
          <dt>ערב</dt>
          <dd>${guarantorsLine(sheet.people)}</dd>
        </div>
      </dl>

      <h2 class="second-heading">מה חסר</h2>
      ${missingItems(sheet)}
    </section>

    <section class="notice">
      <h2>מה נבדק</h2>
      ${
        sheet.flags.length === 0
          ? h``
          : h`<p class="lede">מסמך שפג תוקפו מרים דגל ואינו מזיז את המצב.</p>`
      }
      <ul class="gate">
        ${sheet.checks.map(
          (check) => h`<li>
            <span class="outcome term-state ${check.passed ? 'term-found' : 'term-missing'}">${check.passed ? 'עבר' : 'לא עבר'}</span>
            <span>${GATE_LABEL[check.rule] ?? check.rule}</span>
            <span class="why">${checkWhy(check, sheet)}</span>
          </li>`,
        )}
      </ul>

      ${
        active
          ? h``
          : h`<div class="activate">
        ${
          sheet.canActivate
            ? h`<form method="post" action="/estate/tenancies/${sheet.tenancyId}/activate">
                ${csrfInput(sheet.csrf)}
                <button class="btn btn-primary" type="submit">הפעלת ההשכרה</button>
              </form>`
            : h`<button class="btn btn-primary" type="button" disabled>הפעלת ההשכרה</button>`
        }
        ${activateReasons(sheet)}
      </div>`
      }
    </section>

    <div class="form-actions">
      <a class="btn btn-secondary" href="/documents/new?unit=${sheet.unit.unit_id}">הוספת מסמך</a>
      <a href="/estate/units/${sheet.unit.unit_id}">חזרה לדירה</a>
    </div>`;
  return page(`דונה דום — ${title}`, body, sheet.nav);
}
