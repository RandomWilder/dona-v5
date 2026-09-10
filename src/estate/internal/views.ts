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
// **Four screens from 2.6, and one rule across all of them: no name and no number reaches this
// layer.** These routes went behind the session at 5.2, **and the rule survived the slice that was
// entitled to lift it** (SPEC.md, and 1.11's carry restated at 2.1, 2.3 and 2.4): what a screen may
// show about a household is a *state* and a
// *count*. The occupancy chip says a unit is let and by how many residents; it does not say by whom,
// and search does not reach `party` at all. That is a decision the views enforce by never being
// handed the data, not a discipline they remember.
import { type Html, h } from '../../kernel/ui/html.ts';
import { csrfInput, renderPage } from '../../kernel/ui/page.ts';
import type {
  BuildingDetail,
  BuildingSummary,
  ExpiringLease,
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
  source_document_id: string;
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

const CONDITION: Record<string, string> = {
  READY: 'מוכנה',
  RENOVATION: 'בשיפוץ',
  WITHHELD: 'מוקפאת',
};

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
          ? h`<a href="/documents/${doc.documentId}/tenancy">אישור חוזה</a>`
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
): string {
  const { building, kinds, units } = detail;
  const let_ = units.filter((unit) => occupancy.has(unit.unit_id)).length;
  const body = h`
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
        units.length === 0
          ? h`<p class="empty-state">אין יחידות דיור בבניין זה.</p>`
          : h`<div class="unit-grid">${units.map((unit) => unitCard(unit, occupancy))}</div>`
      }
    </section>`;
  return page(`דונה דום — ${building.name}`, body, nav);
}

function promotedPanel(fields: readonly PromotedFieldView[]): Html {
  if (fields.length === 0) {
    return h``;
  }
  return h`<section>
    <h2>מקור</h2>
    <dl class="facts">${fields.map((field) => {
      const href = `/documents/${field.documentId}/read?page=${String(field.page)}#f-${field.extractedFieldId}`;
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
      return h`<li>
        ${field}
        <span dir="ltr">${oldValue} → ${event.new_value}</span>
        · <span dir="ltr">${event.actor}</span>
        · <a href="/documents/${event.source_document_id}">מסמך</a>
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
): string {
  const body = h`
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
  return page(`דונה דום — דירה ${unit.unit_number}`, body, nav);
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
 * A4 — document-backed drafts and live lettings missing an ערב.
 *
 * A unit, dates, a missing-rule label and the document the rule was expected in. No party.
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
        ${ltr(rows.length)} חוזים בתיק שחסר בהם ערב. נספח משלים, או רישום חריג.
      </p>
    </div>
    ${
      rows.length === 0
        ? h`<p class="empty-state">אין חוזים ממתינים להשלמה.</p>`
        : h`<div class="row-list">
            ${rows.map((row) => {
              const missing =
                row.missing === 'guarantor' ? 'חסר ערב' : row.missing;
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
                <form
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
                </form>
              </article>`;
            })}
          </div>`
    }`;
  return page('דונה דום — חוזים לא שלמים', body, nav);
}
