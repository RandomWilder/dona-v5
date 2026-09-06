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
// layer.** These routes have no session until week 5 (SPEC-estate.md, and 1.11's carry restated at
// 2.1, 2.3 and 2.4), so what an unauthenticated screen may show about a household is a *state* and a
// *count*. The occupancy chip says a unit is let and by how many residents; it does not say by whom,
// and search does not reach `party` at all. That is a decision the views enforce by never being
// handed the data, not a discipline they remember.
import { type Html, h } from '../../kernel/ui/html.ts';
import type {
  BuildingDetail,
  BuildingSummary,
  ExpiringLease,
  SearchResults,
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

// Hebrew for a value the schema allows and this table does not translate. A vocabulary gains a
// member by migration, so the untranslated case is a deploy behind, not a data error.
const label = (table: Record<string, string>, value: string): string =>
  table[value] ?? value;

// Numbers, dates and Latin identifiers inside Hebrew text. tokens.css isolates [dir="ltr"], which
// is what stops '12A' rendering as 'A12' beside a Hebrew word.
const ltr = (value: string | number): Html =>
  h`<span dir="ltr">${value}</span>`;

const styles = h`<style>
  .wrap {
    max-width: var(--size-shell-max);
    margin-inline: auto;
    padding: var(--space-4);
    display: grid;
    gap: var(--space-5);
  }
  .top {
    background: var(--color-chrome);
    color: var(--color-on-chrome);
    padding: var(--space-4);
  }
  .top-inner {
    max-width: var(--size-shell-max);
    margin-inline: auto;
    display: flex;
    align-items: baseline;
    gap: var(--space-3);
    flex-wrap: wrap;
  }
  .brand { font-weight: 500; }
  .top-note {
    color: var(--color-on-chrome-muted);
    font-size: var(--text-sm);
  }
  h1 { font-size: var(--text-xl); margin: 0; }
  h2 { font-size: var(--text-lg); margin: 0 0 var(--space-3); }
  .lede { color: var(--color-text-muted); margin: var(--space-1) 0 0; }
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
     two-token pairs and would waste half the card at that width. Seen on staging at 375px. */
  .facts {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(13rem, 1fr));
    gap: var(--space-2) var(--space-4);
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--text-base);
  }
  .unit-card .facts {
    grid-template-columns: repeat(auto-fit, minmax(7rem, 1fr));
  }
  .facts div { display: flex; gap: var(--space-2); min-width: 0; }
  .facts dt { margin: 0; }
  .facts dd { margin: 0; color: var(--color-text); }
  .chips { display: flex; flex-wrap: wrap; gap: var(--space-2); }
  .unit-grid {
    display: grid;
    gap: var(--space-2);
    grid-template-columns: repeat(auto-fill, minmax(15rem, 1fr));
  }
  .unit-card { padding-inline-start: var(--space-6); }
  .unit-no { font-size: var(--text-lg); font-weight: 500; }
  .back { display: inline-block; }
  a.card-link { color: inherit; text-decoration: none; display: block; }
  a.card-link:hover .card-title { text-decoration: underline; }
  .top-nav {
    display: flex;
    gap: var(--space-4);
    align-items: center;
    flex-wrap: wrap;
    margin-inline-start: auto;
  }
  .top-nav a { color: var(--color-on-chrome); }
  /* The search box is a plain GET form, so the screens still carry no client JavaScript at all and
     a result page is a URL somebody can send to somebody else. */
  .search { display: flex; gap: var(--space-2); align-items: center; }
  .search input { min-width: 14rem; min-height: var(--size-control-ops); padding-block: var(--space-2); }
  .search .btn { min-height: var(--size-control-ops); }
  .index-list { display: grid; gap: var(--space-2); }
  .lease-when { display: flex; gap: var(--space-3); align-items: baseline; flex-wrap: wrap; }
</style>`;

function chrome(): Html {
  return h`<div class="top-inner">
    <span class="brand">דונה דום</span>
    <span class="top-note">נכסים · נתוני הדגמה</span>
    <nav class="top-nav">
      <a href="/estate">בניינים</a>
      <a href="/estate/expiring">חוזים מסתיימים</a>
      <form class="search" method="get" action="/estate/search" role="search">
        <input
          id="q"
          name="q"
          type="search"
          aria-label="חיפוש בניין, כתובת או מספר דירה"
          placeholder="כתובת, בניין או מספר דירה"
        />
        <button class="btn btn-secondary" type="submit">חיפוש</button>
      </form>
    </nav>
  </div>`;
}

function page(title: string, body: Html): string {
  return `<!doctype html>
${h`<html lang="he" dir="rtl">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex" />
    <title>${title}</title>
    <link rel="stylesheet" href="/ui/tokens.css" />
    ${styles}
  </head>
  <body>
    <header class="top">${chrome()}</header>
    <main class="wrap">${body}</main>
  </body>
</html>`}`;
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
  return page('דונה דום — בניינים', body);
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

function unitCard(unit: UnitRow, occupancy: OccupancyByUnit): Html {
  const residents = occupancy.get(unit.unit_id);
  return h`<article class="row-card unit-card">
    ${marker(unit.condition_status === 'READY' ? 'ACTIVE' : unit.condition_status)}
    <p class="card-title">
      <span class="unit-no">דירה ${ltr(unit.unit_number)}</span>
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
  </article>`;
}

export function renderBuildingPage(
  detail: BuildingDetail,
  occupancy: OccupancyByUnit,
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
    <section>
      <h2>יחידות דיור · ${ltr(units.length)}</h2>
      <p class="lede">${ltr(let_)} מאוכלסות היום, ${ltr(units.length - let_)} פנויות. נגזר בכל טעינה ואינו נשמר.</p>
      ${
        units.length === 0
          ? h`<p class="empty-state">אין יחידות דיור בבניין זה.</p>`
          : h`<div class="unit-grid">${units.map((unit) => unitCard(unit, occupancy))}</div>`
      }
    </section>`;
  return page(`דונה דום — ${building.name}`, body);
}

// ------------------------------------------------------------------------------------------------
// Slice 2.6 — the root index, search, and the leases ending soon.
// ------------------------------------------------------------------------------------------------

/**
 * **`GET /` stops being a redirect here** (1.11's carry).
 *
 * It was a 302 to `/estate` because `/estate` was the only screen in the system, and 1.11 said it
 * would stop the week a second one existed. Three do now.
 *
 * **It runs no query**, which is the decision worth stating. A portfolio headline belongs on the
 * buildings list, where the numbers are already being read for the cards; an index that ran three
 * portfolio queries to render three links would be a worse root than the redirect was. It moves to
 * the composition root the week a second *module* has a screen — week 5's staff console — because
 * an index of screens is not estate's fact. Today all three are estate's, so it lives here.
 */
export function renderIndexPage(): string {
  const body = h`
    <div>
      <h1>דונה דום · ניהול נכסים</h1>
      <p class="lede">נתוני הדגמה. אין עדיין הזדהות — המסכים אינם מציגים שמות או מספרי טלפון.</p>
    </div>
    <div class="index-list">
      <article class="row-card">
        ${marker('ACTIVE')}
        <a class="card-link" href="/estate">
          <p class="card-title"><span>בניינים</span></p>
          <p class="lede">כל הבניינים, מספר היחידות בכל אחד וכמה מהן מאוכלסות היום.</p>
        </a>
      </article>
      <article class="row-card">
        ${marker('ACTIVE')}
        <a class="card-link" href="/estate/expiring">
          <p class="card-title"><span>חוזים מסתיימים</span></p>
          <p class="lede">כל החוזים בתיק המסתיימים ב־60 הימים הקרובים, לפי תאריך.</p>
        </a>
      </article>
      <article class="row-card">
        ${marker('ACTIVE')}
        <a class="card-link" href="/estate/search">
          <p class="card-title"><span>חיפוש</span></p>
          <p class="lede">כתובת, שם בניין או מספר דירה, על פני כל התיק.</p>
        </a>
      </article>
    </div>`;
  return page('דונה דום — ניהול נכסים', body);
}

function unitHits(results: SearchResults): Html {
  return h`<div class="row-list">
    ${results.units.map(
      (unit) => h`<article class="row-card">
        <a class="card-link" href="/estate/buildings/${unit.building_id}">
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

/**
 * **Search across the portfolio — buildings and units, and deliberately not people.**
 *
 * A search box that reached `party` would put a real person behind a route with no session, the week
 * the register arrives. An address is not personal data and a name is; the name search is week 5's,
 * behind the login that makes it lawful to show.
 */
export function renderSearchPage(term: string, results: SearchResults): string {
  const found = results.buildings.length + results.units.length;
  const body = h`
    <div>
      <h1>חיפוש</h1>
      ${
        term === ''
          ? h`<p class="lede">חפשו לפי כתובת, שם בניין או מספר דירה.</p>`
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
        ? h`<p class="empty-state">לא נמצאו בניינים או דירות התואמים את החיפוש.</p>`
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
    }`;
  return page('דונה דום — חיפוש', body);
}

/**
 * **Q5 — every lease in the portfolio ending inside the window, one indexed query.**
 *
 * It shows a unit, a building and a date, and no party at all: which lease ends when is an
 * operations fact, and who is on it is not this screen's to say before week 5.
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
  return page('דונה דום — חוזים מסתיימים', body);
}
