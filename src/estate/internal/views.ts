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
import { type Html, h } from '../../kernel/ui/html.ts';
import type { BuildingDetail, BuildingSummary, UnitRow } from './read-model.ts';

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
</style>`;

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
    <header class="top">
      <div class="top-inner">
        <span class="brand">דונה דום</span>
        <span class="top-note">נכסים · נתוני הדגמה</span>
      </div>
    </header>
    <main class="wrap">${body}</main>
  </body>
</html>`}`;
}

function marker(status: string): Html {
  // The state marker's colour is a token and its meaning is the status. Anything but ACTIVE is not
  // an alert, it is simply not the ordinary case, so it gets the neutral marker.
  return h`<span class="state-marker ${status === 'ACTIVE' ? 'is-ok' : ''}"></span>`;
}

function buildingFacts(building: BuildingSummary): Html {
  return h`<dl class="facts">
    <div><dt>יחידות דיור</dt><dd>${ltr(building.unit_count)}</dd></div>
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

export function renderBuildingsPage(buildings: BuildingSummary[]): string {
  const body = h`
    <div>
      <h1>בניינים</h1>
      <p class="lede">${ltr(buildings.length)} בניינים במערכת. מספר יחידות הדיור נספר מהחללים ואינו נשמר.</p>
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
                  ${buildingFacts(building)}
                </a>
              </article>`,
            )}
          </div>`
    }`;
  return page('דונה דום — בניינים', body);
}

function unitCard(unit: UnitRow): Html {
  return h`<article class="row-card unit-card">
    ${marker(unit.condition_status === 'READY' ? 'ACTIVE' : unit.condition_status)}
    <p class="card-title">
      <span class="unit-no">דירה ${ltr(unit.unit_number)}</span>
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

export function renderBuildingPage(detail: BuildingDetail): string {
  const { building, kinds, units } = detail;
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
      ${
        units.length === 0
          ? h`<p class="empty-state">אין יחידות דיור בבניין זה.</p>`
          : h`<div class="unit-grid">${units.map(unitCard)}</div>`
      }
    </section>`;
  return page(`דונה דום — ${building.name}`, body);
}
