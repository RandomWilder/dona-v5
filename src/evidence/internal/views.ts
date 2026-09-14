// The upload screen and its two answers. Slice 3.3, flow A1.
//
// The shell is the kernel's (`src/kernel/ui/page.ts`) and every colour, face and physical side comes
// from `/ui/tokens.css`. What is here is the layout of a form and of the sentence that follows it.
//
// **Nothing on these screens is a person, except A2's confirm page.** A unit number, a building, a
// type, a date range and a digest — that is the ordinary vocabulary. The tenancy options are dates
// and a status. Slice 4.6's confirm screen shows captured names so a human can confirm each role;
// it still does not query `party`. `tests/ui/tokens.test.ts` asserts the rest from the outside.
//
// **Slice 6.4 adds the second exception, and bounded it before it added it.** The read screen may
// print a captured ת.ז., and only to a viewer holding `party.national_id.read` — `mayReadIdentifiers`
// on `ReadScreen` is that stance, it is required rather than defaulted, and a viewer without it gets
// a count in place of the rows. The registry renders this screen at both stances, so the refusal is
// asserted where every other role difference in this console is.
//
// **No client JavaScript, here as everywhere.** The type list is a `<select>` the server filled from
// the catalogue, the file input is a file input, and the page works with scripting switched off.
import type { UnitHit } from '../../estate/contract.ts';
import { type OcrPageImage, onlineOcrByteLimit } from '../../kernel/ocr.ts';

/** A byte count in the unit the sentence is written in. One decimal, because 14.9 is a size. */
function megabytes(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(1);
}

import type { PdfPage } from '../../kernel/pdf.ts';
import { type Html, h } from '../../kernel/ui/html.ts';
import { csrfInput, renderPage } from '../../kernel/ui/page.ts';
import type { UnitLetting } from '../../tenancy/contract.ts';
import { isFlagged } from './approve.ts';
import {
  type DocumentTypeFieldRow,
  type DocumentTypeRow,
  FIELD_VALUE_TYPES,
} from './catalogue.ts';
import { type ExtractedRow, isIdentifierField } from './extract.ts';
import type { IntakeRefusal } from './intake.ts';
import type { ProposedPerson, TenancyCandidate } from './lease.ts';
import { CANDIDATE_LIMIT, type PlaceReading } from './place.ts';
import { documentExtensions } from './storage-path.ts';
import type { Verification } from './verify.ts';

const TENANCY_STATUS: Record<string, string> = {
  DRAFT: 'טיוטה',
  ACTIVE: 'פעיל',
  ENDED: 'הסתיים',
  TERMINATED_EARLY: 'הופסק',
};

const label = (table: Record<string, string>, value: string): string =>
  table[value] ?? value;

const ltr = (value: string | number): Html =>
  h`<span dir="ltr">${value}</span>`;

const styles = h`<style>
  /* minmax(0, 1fr) and not the default auto, from slice 7.1. Carried from the paint review: an
     implicit grid column floors at its widest item's min-content, so one .notice holding a table
     made the whole page — headings included — wider than the viewport and scrolled the body
     sideways at 478px. The paint fixed it inside itself and left the real screen alone because no
     wired .form-grid held a table. GET /documents is the first that does. */
  .form-grid { display: grid; grid-template-columns: minmax(0, 1fr); gap: var(--space-4); max-width: var(--size-shell-max); }
  .form-note { color: var(--color-text-muted); font-size: var(--text-sm); margin: var(--space-3) 0 0; }
  /* .grid-table and .table-wrap are in the token sheet beside .facts, not here: the key column
     names a *face*, and tests/ui/tokens.test.ts refuses a font-family typed into a screen. That
     guard is the reason the block moved rather than a preference — a shared shape that carries a
     face belongs to the sheet, which is what .facts has said since 3.3. Slice 7.1. */
  .form-row { display: grid; gap: var(--space-2); }
  .form-row .hint { color: var(--color-text-muted); font-size: var(--text-sm); margin: 0; }
  .form-actions { display: flex; gap: var(--space-3); flex-wrap: wrap; align-items: center; }
  /* Slice 7.2, lifted from the paint's own block. One control per row, and it is a form rather
     than a link because retiring a declaration is a write and a GET that writes is a GET a crawler
     can fire. */
  .row-actions { display: flex; gap: var(--space-2); flex-wrap: wrap; }
  .row-actions form { display: contents; }
  .mini {
    min-height: var(--size-control-ops);
    padding-inline: var(--space-3);
    font-size: var(--text-sm);
  }
  .notice {
    border: var(--size-hairline) solid var(--color-divider-soft);
    border-radius: var(--radius-3);
    padding: var(--space-4) var(--space-5);
    background: var(--color-surface-card);
  }
  .notice h2 { margin-block-end: var(--space-2); }
  /* One pair per line here, unlike a unit card's grid: there are three of them and one is a
     64-character digest, which in two columns wraps into a block nobody can read a line of. */
  .notice .facts { grid-template-columns: 1fr; }
  .terms { display: flex; flex-wrap: wrap; gap: var(--space-2); margin: var(--space-3) 0 0; padding: 0; list-style: none; }
  /* Slice 7.1. Every requirement is printed and the chip says which state it is in. The state is a
     word before it is a colour — נמצא / לא נמצא — because a refusal that separated its two
     halves by hue alone would be unreadable to anyone who cannot tell these two hues apart, and
     these two carry the whole meaning of the screen. The colours are the sheet's, as everything
     here is. */
  .terms .chip { gap: var(--space-2); background: var(--color-surface); }
  /* Slice 7.3. The read-quality cell borrows .grid-table .key for its face — a font-family typed
     into a screen is what tokens.test.ts refuses — and adds only the state. The state is a word
     before it is a colour everywhere else on this screen (the unmeasured row says so in Hebrew),
     so this is emphasis on a number and never the whole meaning of a cell. */
  .quality.is-low { color: var(--color-alert); font-weight: 600; }
  .second { color: var(--color-text-muted); font-size: var(--text-xs); }
  .term-found { color: var(--color-ok); }
  .term-missing { color: var(--color-alert); }
  .term-state { font-weight: 600; }
  /* Slice 6.3. A list of flats the reader could not choose between, each one a radio the operator
     chooses with. The min-height is the touch target; the input opts out of the field sizing the
     stylesheet gives every other input, because a radio is not a field. */
  .candidates { display: grid; gap: var(--space-2); margin: var(--space-3) 0 0; padding: 0; list-style: none; }
  .candidate { display: flex; gap: var(--space-2); align-items: baseline; min-height: var(--size-touch); }
  .candidate input { width: auto; min-height: 0; }
  /* Slice 6.9. One sentence per cause, stacked, so four different answers do not read as one
     paragraph an operator skims. */
  .read-facts { display: grid; gap: var(--space-1); margin: var(--space-3) 0 0; }
  .read-facts p { margin: 0; }
  .digest { word-break: break-all; }
  .page-read {
    position: relative;
    inline-size: min(100%, 40rem);
    background: var(--color-surface-card);
    border: var(--size-hairline) solid var(--color-divider-soft);
  }
  .page-read img { inline-size: 100%; block-size: auto; display: block; }
  .word-box {
    position: absolute;
    outline: var(--size-hairline) solid var(--color-accent);
    pointer-events: none;
  }
  .field-box {
    position: absolute;
    outline: var(--size-hairline) dashed var(--color-divider-soft);
    scroll-margin-block-start: var(--space-8);
    pointer-events: none;
  }
  .field-box:target {
    outline: var(--size-focus) solid var(--color-accent);
  }
</style>`;

function shell(title: string, body: Html, nav: Html): string {
  return renderPage({ title, styles, nav, body });
}

function unitLine(unit: UnitHit): Html {
  return h`<p class="lede">
    דירה ${ltr(unit.unit_number)} · ${unit.building_name} · ${unit.address_line}, ${unit.city}
  </p>`;
}

/**
 * What a refusal says.
 *
 * It names the terms that were not found, because a refusal an operator cannot act on is a refusal
 * they will work around — and those terms are the form's own printed words, never anything the
 * document they just tried to file says. Nothing from inside the file reaches this page.
 *
 * **One chip per requirement, spellings and all (6.8).** `המושכר|הדירה` is one thing that was not
 * found and either spelling would have met it, so it is one chip reading `המושכר או הדירה` — two
 * chips would tell an operator that two words are missing and send them looking for both.
 *
 * **Every requirement is printed, found and not found alike (7.1).** Until this slice the screen
 * printed `missingTerms` and stopped, so a lease that declares three requirements and failed one
 * produced a refusal naming two — and a reader with two chips in front of them cannot tell how many
 * things were checked, which is the difference between *this file is the wrong type* and *this
 * declaration is wrong*. Three chips, each carrying its own state, and the chip is what says which.
 * The found ones are as safe to render as the missing ones and for the same reason: both are the
 * form's language and neither is the document's.
 */
/**
 * The flat (or building) a document is already anchored to, said in words the operator can act on.
 * Slice 6.10 — the route resolves it, because naming a place is `src/estate/`'s data and this module
 * renders what it is handed.
 */
export interface AnchoredPlace {
  /** The place's own screen, so the refusal is a door and not a dead end. */
  href: string;
  /** Null for a building-level document — there is no flat to name. */
  unitNumber: string | null;
  buildingName: string;
  addressLine: string;
  city: string;
}

function anchoredLine(place: AnchoredPlace): Html {
  return place.unitNumber === null
    ? h`${place.buildingName} · ${place.addressLine}, ${place.city}`
    : h`דירה ${ltr(place.unitNumber)} · ${place.buildingName} · ${place.addressLine}, ${place.city}`;
}

function refusal(
  type: DocumentTypeRow,
  verification: Verification,
  reason: IntakeRefusal = 'terms',
  anchoredTo?: AnchoredPlace,
): Html {
  if (reason === 'anchored') {
    // **Slice 6.10.** Which flat, by name and as a link. *This file is already on file* is a
    // sentence an operator cannot act on; *it is already filed against דירה 12B* is one they can,
    // and it is usually the more useful fact than the upload they were attempting.
    return h`<section class="notice">
      <h2>הקובץ הזה כבר מתויק</h2>
      <p class="lede">
        אותם בתים בדיוק כבר שמורים במערכת, משויכים
        ${
          anchoredTo
            ? h`אל <a href="${anchoredTo.href}">${anchoredLine(anchoredTo)}</a>`
            : h`אל דירה אחרת`
        }.
        מסמך משויך למקום אחד בלבד — זה שהקובץ שלו נשמר תחתיו — ולכן <strong>לא נשמר דבר</strong>:
        לא קובץ, לא רישום ולא שיוך נוסף. אם זה המסמך הנכון, הוא כבר במערכת.
      </p>
    </section>`;
  }
  if (reason === 'too_large') {
    return h`<section class="notice">
      <h2>הקובץ גדול מכדי שנקרא אותו</h2>
      <p class="lede">
        הקורא מקבל עד ${megabytes(onlineOcrByteLimit)} מ״ב בפנייה אחת, ולכן לא נקרא דבר
        ו<strong>לא נשמר דבר</strong> — לא הקובץ ולא רישום. סרקו את המסמך ברזולוציה נמוכה יותר ונסו
        שוב.
      </p>
    </section>`;
  }
  const requirement = (term: string, found: boolean): Html =>
    h`<li class="chip ${found ? h`term-found` : h`term-missing`}">
      <span class="term-state">${found ? h`נמצא` : h`לא נמצא`}</span>
      <span>${term.split('|').join(' או ')}</span>
    </li>`;
  const checked =
    verification.matchedTerms.length + verification.missingTerms.length;
  return h`<section class="notice">
    <h2>הקובץ אינו נראה כמו ${type.labelHe}</h2>
    <p class="lede">
      טופס מסוג זה נבדק מול ${checked} ביטויים קבועים, ולא כולם נמצאו בקובץ — ולכן הוא לא נשמר.
      בדקו שנבחר הקובץ הנכון, או בחרו סוג מסמך אחר. להלן כל הביטויים שנבדקו:
    </p>
    <ul class="terms">
      ${verification.missingTerms.map((term) => requirement(term, false))}
      ${verification.matchedTerms.map((term) => requirement(term, true))}
    </ul>
  </section>`;
}

export interface UploadScreen {
  /** Slice 5.2b — injected by the composition root. */
  nav: Html;
  /** The CSRF token for this session (slice 5.2). Every form in this system carries it. */
  csrf: string;
  unit: UnitHit;
  types: DocumentTypeRow[];
  lettings: UnitLetting[];
  /** The declared type of a refused attempt, so the form comes back with it still chosen. */
  declaredTypeKey?: string;
  declaredTenancyId?: string;
  refused?: {
    type: DocumentTypeRow;
    verification: Verification;
    /** Why. Slice 6.8 — `too_many_pages` is a different sentence from a missing requirement. */
    reason?: IntakeRefusal;
    /** Slice 6.10. Where these bytes already live, on the `anchored` refusal and nowhere else. */
    anchoredTo?: AnchoredPlace;
  };
}

export function renderUploadPage(screen: UploadScreen): string {
  const { unit, types, lettings } = screen;
  const body = h`
    <div>
      <a class="back" href="/estate/buildings/${unit.building_id}">← ${unit.building_name}</a>
      <h1>הוספת מסמך</h1>
      ${unitLine(unit)}
    </div>
    ${
      screen.refused
        ? refusal(
            screen.refused.type,
            screen.refused.verification,
            screen.refused.reason,
            screen.refused.anchoredTo,
          )
        : h``
    }
    <form class="form-grid" method="post" action="/documents" enctype="multipart/form-data">
      ${csrfInput(screen.csrf)}
      <input type="hidden" name="unit" value="${unit.unit_id}" />
      <div class="form-row">
        <label for="type">סוג המסמך</label>
        <select id="type" name="type" required>
          ${types.map(
            (type) =>
              h`<option value="${type.typeKey}" ${
                type.typeKey === screen.declaredTypeKey ? h`selected` : h``
              }>${type.labelHe}</option>`,
          )}
        </select>
        <p class="hint">הסוג מוצהר ואינו מזוהה אוטומטית. המערכת בודקת שהקובץ אכן נראה כמו הסוג שנבחר.</p>
      </div>
      <div class="form-row">
        <label for="tenancy">שיוך לחוזה</label>
        <select id="tenancy" name="tenancy">
          <option value="">ללא שיוך לחוזה — מסמך של הדירה</option>
          ${lettings.map(
            (letting) =>
              h`<option value="${letting.tenancy_id}" ${
                letting.tenancy_id === screen.declaredTenancyId
                  ? h`selected`
                  : h``
              }>${ltr(letting.start_date)} — ${ltr(letting.end_date)} · ${label(
                TENANCY_STATUS,
                letting.status,
              )}</option>`,
          )}
        </select>
        <p class="hint">
          להקמת חוזה חדש מהמסמך השאירו ללא שיוך. שיוך לחוזה קיים הוא לקדם תאריך על חוזה שכבר נרשם.
        </p>
      </div>
      <div class="form-row">
        <label for="file">הקובץ</label>
        <input id="file" name="file" type="file" required
          accept="${documentExtensions.map((ext) => `.${ext}`).join(',')}" />
        <p class="hint">
          עד 20MB. סוג הקובץ נקבע מתוכנו ולא משמו, ושם הקובץ אינו נשמר.
        </p>
      </div>
      <div class="form-actions">
        <button class="btn btn-primary" type="submit">שמירת המסמך</button>
        <a href="/estate/buildings/${unit.building_id}">ביטול</a>
      </div>
    </form>`;
  return shell(
    `דונה דום — הוספת מסמך לדירה ${unit.unit_number}`,
    body,
    screen.nav,
  );
}

/**
 * The document-first screen. **Slice 6.3, flow A12.**
 *
 * The unit-first screen above is reached from a flat and therefore knows which flat it is filing
 * against; this one is reached from the index and knows nothing, because the answer is printed on
 * the paper. So it asks for two things — a type and a file — and the address on the page is what
 * chooses the flat.
 *
 * **The flat is the anchor and not the destination**, and the screen says so: a lease filed here
 * goes on to the tenancy it defines (A2), and the hint under the button is where an operator reads
 * that before they press it rather than after.
 *
 * The second state is a refusal, and everything about it is arranged around one sentence: *nothing
 * was written*. No row, no object, no held bytes — so the file input comes back armed and empty,
 * because there is nothing on the server to attach a choice to.
 */
export interface IntakeScreen {
  nav: Html;
  csrf: string;
  types: DocumentTypeRow[];
  /** The declared type of a refused attempt, so the form comes back with it still chosen. */
  declaredTypeKey?: string;
  /** Present on a refusal only: what the reader read off the page. Nulls inside it are ordinary. */
  reading?: PlaceReading;
  /** Whatever the operator might have meant. Empty is an answer too — the search box below. */
  candidates?: UnitHit[];
  /**
   * How many there really were. Larger than `candidates.length` means the list was cut at
   * `CANDIDATE_LIMIT`, and the screen says so rather than showing a fraction of the answer as if it
   * were the answer.
   */
  total?: number;
  /** A search the operator typed into the box, echoed back into it. */
  query?: string;
  /**
   * **The file was larger than the reader carries in one call, and this is how large. Slice 6.8.**
   *
   * A different refusal from the one above and it gets its own sentence: nothing was read off this
   * file at all, so there is no address, no candidate list and nothing for the operator to choose
   * between. Offering one here would be asking a question built on no reading.
   *
   * Not a page count: a *long* document is read in part (its first `onlineOcrPageLimit` pages) and
   * files normally. It is size that makes a file unreadable outright, because the bound is on the
   * request and the whole file rides in every one of them.
   */
  tooLargeBytes?: number;
  /**
   * **Whether this viewer may shape the estate — `estate.write`, which is ADMIN's. Slice 6.9.**
   *
   * The create offer is the only thing on this screen that differs by role, and it differs because
   * `documents.write` and `estate.write` are two different acts (A11): an operator files paper, an
   * admin decides a flat exists. A door an operator may see and may not walk through is 6.1's
   * refusal-after-typing, so an operator is shown the candidate list and the search box and no
   * create control at all — not a disabled one.
   */
  mayCreate?: boolean;
  /**
   * The building this reading's address matched, when it matched one. **Slice 6.9.**
   *
   * Present → the building is in the portfolio and the flat is not, so what is offered is the flat.
   * Absent → the address is in nobody's portfolio and what is offered is the building, then the flat.
   */
  building?: { building_id: string; name: string } | null;
  /**
   * The flat an admin has just created, coming back from A13. **Slice 6.9.**
   *
   * It is a pre-checked candidate and not a filing: nothing was held while the estate was being
   * shaped, so the file is attached again here and the post that follows is the ordinary
   * candidate-chosen one A12 has had since 6.3.
   */
  chosenUnitId?: string;
}

/**
 * The link out of a refusal and into A11 or A13, carrying what was read. **Slice 6.9.**
 *
 * Everything in it is a **default for an input**, never a write: the admin reads it against the
 * paper in their hand and edits what is wrong. `next=intake` is what brings them back here with the
 * new flat as the anchor, and it is the only piece of state that survives the two forms — the bytes
 * do not, which is what *nothing is held* means and is why the file input comes back armed.
 *
 * *(`next` and not `then`: Biome refuses an object literal with a `then` property, because a
 * thenable is what `await` mistakes for a promise. The rule is blunt here and the name is free.)*
 */
function createHref(
  screen: IntakeScreen,
  reading: PlaceReading,
): string | null {
  if (!reading.addressLine) {
    // Nothing was read, so there is nothing to prefill and nothing for the admin to check a
    // prefilled value against. A11's own screen is one click away on its own terms.
    return null;
  }
  const carried = new URLSearchParams({ next: 'intake' });
  if (screen.declaredTypeKey) {
    carried.set('type', screen.declaredTypeKey);
  }
  if (reading.apartmentNumber) {
    carried.set('unit_number', reading.apartmentNumber);
  }
  if (screen.building) {
    return `/estate/buildings/${screen.building.building_id}/units/new?${carried}`;
  }
  carried.set('address_line', reading.addressLine);
  if (reading.city) {
    carried.set('city', reading.city);
  }
  return `/estate/buildings/new?${carried}`;
}

/**
 * What the reader read, in the operator's words.
 *
 * **This is the one place a document's own text reaches a screen in this module**, and it is bounded
 * to three values a deterministic reader captured: a street, a town, a flat number. A refusal an
 * operator cannot act on is a refusal they will work around, and "we could not place it" without
 * saying what was read is exactly that refusal. No name, no date, no line of the lease.
 */
function placeRead(screen: IntakeScreen, reading: PlaceReading): Html {
  const address = reading.addressLine
    ? h`<p>
        נקראה הכתובת ${ltr(reading.addressLine)}${
          reading.city ? h`, ${reading.city}` : h``
        }.
        ${
          screen.building
            ? h`הבניין נמצא בתיק, והדירה לא.`
            : h`הכתובת הזו אינה בתיק — לא הבניין ולא הדירה.`
        }
      </p>`
    : reading.annexDeferral
      ? h`<p>
          המסמך מפנה את פרטי הנכס לנספח, ו<strong>הנספח אינו נקרא</strong> — זו החלטה ולא תקלה.
          לכן לא נקראה כתובת מגוף המסמך.
        </p>`
      : h`<p>לא נקראה כתובת מן הדף.</p>`;
  // **The apartment number gets its own sentence, and says where it may have come from. Slice 6.9,
  // raised by 6.11.** `APARTMENT` runs over the whole text, so a lease naming only a party's own
  // flat returns a number with no address — harmless to the filing, because with no address there
  // is nothing to resolve, and misleading on a screen that prints the number as though the document
  // had said it about the property.
  const apartment = reading.apartmentNumber
    ? reading.addressLine
      ? h`<p>נקרא מספר דירה ${ltr(reading.apartmentNumber)}.</p>`
      : h`<p>
          נקרא מספר דירה ${ltr(reading.apartmentNumber)}, אך ללא כתובת — ייתכן שנקרא משורה של אחד
          הצדדים ולא מתיאור הנכס.
        </p>`
    : h`<p>לא נקרא מספר דירה.</p>`;
  return h`<div class="read-facts">${address}${apartment}</div>
    <p class="lede">
      <strong>לא נשמר דבר</strong> — לא הקובץ ולא רישום.
      בחרו את הדירה שאליה הנייר שייך, או חפשו אותה, וצרפו את הקובץ שוב.
    </p>`;
}

/**
 * The create offer, and it is the only thing on this screen that depends on who is looking.
 *
 * **Slice 6.9, on the director's ruling of 14 Sep 2026.** A12 refused to create from 6.3 until here,
 * and the week-6 demo is what struck that: an operator standing at this refusal with the right paper
 * had nowhere to go. Creating is still A11's act and an admin's — it is offered from here.
 *
 * An operator gets nothing rather than a disabled control: a door they may see and may not walk
 * through is 6.1's refusal-after-typing, and the search box beside it is a question they *can*
 * answer.
 */
function createOffer(screen: IntakeScreen, reading: PlaceReading): Html {
  if (!screen.mayCreate) {
    return h``;
  }
  const href = createHref(screen, reading);
  if (!href) {
    return h``;
  }
  return h`<div class="form-actions">
      <a class="btn ${screen.building ? h`btn-secondary` : h`btn-primary`}" href="${href}">${
        screen.building
          ? h`הוספת הדירה לבניין ${screen.building.name}`
          : h`יצירת הבניין והדירה`
      }</a>
    </div>
    <p class="hint">
      מה שנקרא מהמסמך יופיע כברירת מחדל בטופס וניתן לתקן אותו. אחרי יצירת הדירה נחזור לכאן, הדירה
      תהיה מסומנת, ויהיה צורך לצרף את הקובץ שוב — שום דבר אינו נשמר בין הניסיונות.
    </p>`;
}

export function renderIntakePage(screen: IntakeScreen): string {
  const candidates = screen.candidates ?? [];
  const refused = screen.reading !== undefined;
  const tooLong =
    screen.tooLargeBytes === undefined
      ? h``
      : h`<section class="notice">
          <h2>הקובץ גדול מכדי שנקרא אותו</h2>
          <p class="lede">
            גודל הקובץ ${megabytes(screen.tooLargeBytes)} מ״ב, והקורא מקבל עד
            ${megabytes(onlineOcrByteLimit)} מ״ב בפנייה אחת. לכן לא נקרא דבר ו<strong>לא נשמר
            דבר</strong> — לא הקובץ ולא רישום. סרקו את המסמך ברזולוציה נמוכה יותר, או צרפו אותו מדף
            הדירה שאליה הוא שייך.
          </p>
        </section>`;
  const body = h`
    <div>
      <a class="back" href="/">← ראשי</a>
      <h1>הוספת מסמך</h1>
      <p class="lede">
        בחרו את סוג המסמך וצרפו את הקובץ. הדירה שאליה שייך הנייר תזוהה מתוך הכתובת שעליו —
        הדירה היא העוגן, לא סוף הדרך: חוזה שכירות ממשיך מכאן אל השכירות שהוא עצמו מגדיר.
      </p>
    </div>
    ${tooLong}
    ${
      refused
        ? h`<section class="notice">
            <h2>${
              candidates.length > 1
                ? h`נמצאה יותר מדירה אחת`
                : (screen.reading as PlaceReading).addressLine === null &&
                    (screen.reading as PlaceReading).annexDeferral
                  ? h`הנכס מתואר בנספח`
                  : h`לא זוהתה דירה אחת`
            }</h2>
            ${placeRead(screen, screen.reading as PlaceReading)}
            ${createOffer(screen, screen.reading as PlaceReading)}
          </section>`
        : h``
    }
    ${
      screen.chosenUnitId
        ? h`<section class="notice">
            <h2>הדירה נוצרה</h2>
            <p class="lede">
              הדירה מסומנת למטה. צרפו את הקובץ שוב — הוא לא נשמר בין הניסיונות — ותייקו.
            </p>
          </section>`
        : h``
    }
    <form class="form-grid" method="post" action="/documents/intake" enctype="multipart/form-data">
      ${csrfInput(screen.csrf)}
      <div class="form-row">
        <label for="type">סוג המסמך</label>
        <select id="type" name="type" required>
          ${screen.types.map(
            (type) =>
              h`<option value="${type.typeKey}" ${
                type.typeKey === screen.declaredTypeKey ? h`selected` : h``
              }>${type.labelHe}</option>`,
          )}
        </select>
        <p class="hint">הסוג מוצהר ואינו מזוהה אוטומטית. המערכת בודקת שהקובץ אכן נראה כמו הסוג שנבחר.</p>
      </div>
      ${
        candidates.length > 0
          ? h`<div class="form-row">
              <span>הדירה</span>
              <ul class="candidates">
                ${candidates.map(
                  (unit) =>
                    h`<li class="candidate">
                      <input type="radio" id="u-${unit.unit_id}" name="unit" value="${unit.unit_id}" required ${
                        // Slice 6.9: the flat an admin has just created, coming back from A13.
                        screen.chosenUnitId === unit.unit_id ? h`checked` : h``
                      } />
                      <label for="u-${unit.unit_id}">דירה ${ltr(
                        unit.unit_number,
                      )} · ${unit.building_name} · ${unit.address_line}, ${
                        unit.city
                      }</label>
                    </li>`,
                )}
              </ul>
              ${
                (screen.total ?? candidates.length) > candidates.length
                  ? h`<p class="hint">
                      בכתובת הזו ${ltr(screen.total ?? 0)} דירות. מוצגות ${ltr(
                        CANDIDATE_LIMIT,
                      )} הראשונות — אם הדירה אינה ביניהן, חפשו אותה למטה.
                    </p>`
                  : h``
              }
              <p class="hint">
                דירה שנבחרה כאן נלקחת כפי שהיא, והכתובת שעל הדף אינה נקראת שוב.
              </p>
            </div>`
          : h``
      }
      <div class="form-row">
        <label for="file">הקובץ</label>
        <input id="file" name="file" type="file" required
          accept="${documentExtensions.map((ext) => `.${ext}`).join(',')}" />
        <p class="hint">
          ${
            refused
              ? h`עד 20MB. הקובץ אינו נשמר בין הניסיונות, ולכן יש לצרף אותו שוב.`
              : h`עד 20MB. סוג הקובץ נקבע מתוכנו ולא משמו, ושם הקובץ אינו נשמר.`
          }
        </p>
      </div>
      <div class="form-actions">
        <button class="btn btn-primary" type="submit">${
          candidates.length > 0 ? h`תיוק לדירה שנבחרה` : h`קריאת הכתובת ותיוק`
        }</button>
        <a href="/">ביטול</a>
      </div>
      <p class="hint">
        מה קורה אחרי התיוק: חוזה שכירות ממשיך למסך אישור השכירות, שבו התקופה והצדדים נקראים מתוך
        המסמך ונקשרים אליו. מסמך שאינו חוזה נשאר מתויק לדירה בלבד.
      </p>
    </form>
    ${
      refused
        ? h`<form class="form-grid" method="get" action="/documents/new">
            <div class="form-row">
              <label for="q">חיפוש דירה אחרת</label>
              <input class="field" id="q" name="q" type="search" value="${
                screen.query ?? ''
              }" />
              <p class="hint">חיפוש לפי כתובת, שם בניין או מספר דירה — אותו חיפוש של מסך הנכסים.</p>
            </div>
            <div class="form-actions">
              <button class="btn btn-secondary" type="submit">חיפוש</button>
            </div>
          </form>`
        : h``
    }`;
  return shell('דונה דום — הוספת מסמך', body, screen.nav);
}

export interface FiledScreen {
  nav: Html;
  unit: UnitHit;
  type: DocumentTypeRow;
  /** False when these bytes were already on file: one document, a second binding. */
  inserted: boolean;
  boundToTenancy: boolean;
  verification: Verification;
  fileHash: string;
  documentId?: string;
  /**
   * **What the reader read, on the one path where nobody chose. Slice 6.9.**
   *
   * This screen was written for A1, where a human had already picked the flat and the only
   * interesting fact was the verdict. A12 places a document on its own, so the receipt is the only
   * place an operator can check that it placed it right — the director's ruling of 14 Sep: the
   * indication comes *after* the exact match files, because nothing is held before it.
   *
   * Absent on A1 and on A12's candidate branch, where the flat was chosen by hand and printing a
   * reading would print one that was never taken.
   */
  reading?: PlaceReading;
}

/**
 * What the screen says after a document is filed.
 *
 * It shows the **verdict**, including `unverified`, and that is deliberate: a scan with no text
 * layer is filed because refusing it would refuse most real leases, and a file that was accepted
 * without being checked has to look different from one that was checked. OCR closes the gap at
 * slice 4.1.
 *
 * The digest is shown and the `gs://` uri is not. The documents panel mints a signed URL (slice
 * 5.4); this confirmation screen does not.
 */
export function renderFiledPage(screen: FiledScreen): string {
  const { unit, type, verification } = screen;
  const body = h`
    <div>
      <a class="back" href="/estate/buildings/${unit.building_id}">← ${unit.building_name}</a>
      <h1>המסמך נשמר</h1>
      ${unitLine(unit)}
    </div>
    <section class="notice">
      <h2>${type.labelHe}</h2>
      ${
        screen.reading
          ? h`<div class="read-facts">
              <p>
                נקרא מן המסמך: ${
                  screen.reading.addressLine
                    ? h`${ltr(screen.reading.addressLine)}${
                        screen.reading.city ? h`, ${screen.reading.city}` : h``
                      }`
                    : h`ללא כתובת`
                }${
                  screen.reading.apartmentNumber
                    ? h` · דירה ${ltr(screen.reading.apartmentNumber)}`
                    : h``
                }.
              </p>
              <p>
                תויק לדירה ${ltr(unit.unit_number)} ב${unit.building_name}, ${unit.address_line},
                ${unit.city}.
              </p>
            </div>`
          : h``
      }
      <dl class="facts">
        <div><dt>שיוך</dt><dd>${
          screen.boundToTenancy ? h`הדירה והחוזה` : h`הדירה`
        }</dd></div>
        <div><dt>בדיקת התאמה</dt><dd>${
          verification.verdict === 'verified'
            ? h`נמצאו כל הביטויים הקבועים של הטופס`
            : verification.verdict === 'unverified'
              ? h`הקובץ אינו נושא שכבת טקסט — יאומת בשלב הקריאה האוטומטית`
              : h`לסוג זה אין ביטויים קבועים להשוואה`
        }</dd></div>
        <div><dt>טביעת הקובץ</dt><dd class="digest">${ltr(screen.fileHash)}</dd></div>
      </dl>
      ${
        screen.inserted
          ? h``
          : h`<p class="lede">קובץ זהה כבר היה במערכת. נוסף שיוך, ולא עותק שני.</p>`
      }
    </section>
    <div class="form-actions">
      ${
        screen.documentId
          ? h`<a class="btn btn-secondary" href="/documents/${screen.documentId}/read">מילים על הדף</a>`
          : h``
      }
      ${
        screen.documentId && type.typeKey === 'lease'
          ? h`<a class="btn btn-secondary" href="/documents/${screen.documentId}/tenancy">אישור חוזה</a>`
          : h``
      }
      ${
        screen.documentId &&
        type.typeKey === 'lease_amendment' &&
        screen.boundToTenancy
          ? h`<a class="btn btn-secondary" href="/documents/${screen.documentId}/tenancy">אישור נספח</a>`
          : h``
      }
      <a class="btn btn-secondary" href="/documents/new?unit=${unit.unit_id}">הוספת מסמך נוסף</a>
      <a href="/estate/buildings/${unit.building_id}">חזרה לבניין</a>
    </div>`;
  return shell('דונה דום — המסמך נשמר', body, screen.nav);
}

export interface SeedScreen {
  nav: Html;
  /** The CSRF token for this session (slice 5.2). Every form in this system carries it. */
  csrf: string;
  documentId: string;
  labelHe: string;
  buildingId: string;
  buildingName: string;
  unitId: string | null;
  unitNumber: string | null;
  handoverDate: string | null;
  apartmentNumber: string | null;
  warrantyEndDate: string | null;
  assets: ReadonlyArray<{ labelHe: string; assetType: string }>;
}

export function renderSeedPage(screen: SeedScreen): string {
  const back = `/estate/buildings/${screen.buildingId}`;
  const body = h`
    <div>
      <a class="back" href="${back}">← ${screen.buildingName}</a>
      <h1>אישור מסירה</h1>
      <p class="lede">${screen.labelHe}${
        screen.unitNumber ? h` · דירה ${ltr(screen.unitNumber)}` : h` · הבניין`
      }</p>
    </div>
    <section class="notice">
      <h2>מה שנקרא מהמסמך</h2>
      <dl class="facts">
        <div><dt>מועד המסירה</dt><dd>${
          screen.handoverDate
            ? ltr(screen.handoverDate)
            : h`לא נמצא תאריך במסמך`
        }</dd></div>
        ${
          screen.apartmentNumber
            ? h`<div><dt>דירה</dt><dd>${ltr(screen.apartmentNumber)}</dd></div>`
            : h``
        }
        ${
          screen.warrantyEndDate
            ? h`<div><dt>סיום תקופת הבדק</dt><dd>${ltr(screen.warrantyEndDate)}</dd></div>`
            : h``
        }
      </dl>
      ${
        screen.assets.length === 0
          ? h`<p class="lede">לא זוהו מערכות במסמך.</p>`
          : h`<ul class="terms">${screen.assets.map(
              (asset) => h`<li class="chip">${asset.labelHe}</li>`,
            )}</ul>`
      }
    </section>
    ${
      screen.handoverDate
        ? h`<form class="form-actions" method="post" action="/documents/${screen.documentId}/seed">
            ${csrfInput(screen.csrf)}
            <button class="btn btn-primary" type="submit">אישור וכתיבה</button>
            <a href="${back}">ביטול</a>
          </form>`
        : h`<div class="form-actions"><a href="${back}">חזרה לבניין</a></div>`
    }`;
  return shell('דונה דום — אישור מסירה', body, screen.nav);
}

export interface SeededScreen {
  nav: Html;
  buildingId: string;
  buildingName: string;
  unitId: string | null;
  handoverDate: string;
  warrantyEndDate: string;
  assetsWritten: number;
  alreadySeeded: boolean;
}

export function renderSeededPage(screen: SeededScreen): string {
  const back = `/estate/buildings/${screen.buildingId}`;
  const body = h`
    <div>
      <a class="back" href="${back}">← ${screen.buildingName}</a>
      <h1>המסירה נרשמה</h1>
    </div>
    <section class="notice">
      <dl class="facts">
        <div><dt>מועד המסירה</dt><dd>${ltr(screen.handoverDate)}</dd></div>
        <div><dt>סיום תקופת הבדק</dt><dd>${ltr(screen.warrantyEndDate)}</dd></div>
        <div><dt>מערכות שנרשמו</dt><dd>${ltr(String(screen.assetsWritten))}</dd></div>
      </dl>
      ${
        screen.alreadySeeded
          ? h`<p class="lede">מסמך זה כבר נזרע. התאריכים עודכנו, ולא נוסף עותק שני של המערכות.</p>`
          : h``
      }
    </section>
    <div class="form-actions">
      ${
        screen.unitId
          ? h`<a class="btn btn-secondary" href="/documents/new?unit=${screen.unitId}">הוספת מסמך נוסף</a>`
          : h``
      }
      <a href="${back}">חזרה לבניין</a>
    </div>`;
  return shell('דונה דום — המסירה נרשמה', body, screen.nav);
}

export interface ReadScreen {
  nav: Html;
  /** The CSRF token for this session (slice 5.2). Every form in this system carries it. */
  csrf: string;
  documentId: string;
  buildingId: string;
  buildingName: string;
  unitId: string | null;
  typeKey: string;
  labelHe: string;
  fileHash: string;
  source: 'pdfjs' | 'ocr' | 'none';
  page: PdfPage | null;
  image: OcrPageImage | null;
  /**
   * **Whether this viewer may see a captured identifier. Slice 6.4, and it is required on purpose.**
   *
   * Only `party.national_id.read` sets it true, and only ADMIN holds that. It is a field rather than
   * a default because a default is a thing a caller can fail to think about: a new screen that
   * rendered this view would inherit `false` silently and nobody would know which way it had failed.
   * Required, it costs one line and a decision at every call site, and there is exactly one.
   */
  mayReadIdentifiers: boolean;
  extracted?: ReadonlyArray<{
    extractedFieldId: string;
    fieldKey: string;
    labelHe: string;
    value: string;
    page: number;
    bbox: { x: number; y: number; width: number; height: number };
    confidence: number | null;
    promotionTarget: string | null;
    promotedTo: string | null;
    /** Slice 7.3. A state, said in one word; the ledger is where it is acted on. */
    approvedAt?: Date | null;
  }>;
}

function fieldAnchor(extractedFieldId: string): string {
  return `f-${extractedFieldId}`;
}

function pixelsHref(documentId: string, page: number, fieldId: string): string {
  return `/documents/${documentId}/read?page=${String(page)}#${fieldAnchor(fieldId)}`;
}

function confidenceLabel(confidence: number | null): Html {
  if (confidence === null) return h``;
  return h` · ${ltr(`${Math.round(confidence * 100)}%`)}`;
}

function boxPercents(
  box: { x: number; y: number; width: number; height: number },
  page: { width: number; height: number },
): string {
  const inlineStart = (box.x / page.width) * 100;
  const blockStart = (box.y / page.height) * 100;
  const inlineSize = (box.width / page.width) * 100;
  const blockSize = (box.height / page.height) * 100;
  return `inset-inline-start:${String(inlineStart)}%;inset-block-start:${String(blockStart)}%;inline-size:${String(inlineSize)}%;block-size:${String(blockSize)}%`;
}

/**
 * The captured rows this viewer may see. **Withheld is the default**: a viewer without
 * `party.national_id.read` never receives the value, not even to have it hidden by CSS, because a
 * page is a response and a response that carries it has disclosed it.
 */
function visibleRows(screen: ReadScreen) {
  const rows = screen.extracted ?? [];
  return screen.mayReadIdentifiers
    ? rows
    : rows.filter((row) => !isIdentifierField(row.fieldKey));
}

/** How many identifier rows were read and are not being shown. */
function withheldCount(screen: ReadScreen): number {
  if (screen.mayReadIdentifiers) {
    return 0;
  }
  return (screen.extracted ?? []).filter((row) =>
    isIdentifierField(row.fieldKey),
  ).length;
}

/**
 * **A state and a count, never the value.** The sentence this console has kept since 5.2, applied to
 * the first value it was ever written for. An operator has to be able to tell *the lease was read
 * and it named a ת.ז.* from *the lease was read and it named none* — the second is a reason to look
 * at the paper again and the first is not — and a count says which without saying what.
 */
function withheldLine(count: number): Html {
  if (count === 0) {
    return h``;
  }
  if (count === 1) {
    return h`<p class="lede">נקרא שדה מזהה אחד ואינו מוצג בהרשאה זו.</p>`;
  }
  if (count === 2) {
    return h`<p class="lede">נקראו שני שדות מזהה ואינם מוצגים בהרשאה זו.</p>`;
  }
  return h`<p class="lede">נקראו ${ltr(count)} שדות מזהה ואינם מוצגים בהרשאה זו.</p>`;
}

/**
 * What was read, on the page that shows where it was read from.
 *
 * **Slice 7.3 took the `קדם` buttons out of here**, and did not replace them with a second set. This
 * screen is the pixels: it answers *where did this come from*. Acting on a reading — signing it,
 * correcting it, promoting it — is one screen and one link away, and having the same write in two
 * places is how the two drift into disagreeing about which one is the flow.
 */
function extractedSection(screen: ReadScreen) {
  const rows = visibleRows(screen);
  const withheld = withheldLine(withheldCount(screen));
  if (rows.length === 0) {
    return h`<p class="lede">לא נקראו שדות מהמסמך. אין מה לאשר עד שהקריאה תשלים.</p>${withheld}`;
  }
  return h`
    <h2>מה שנקרא</h2>
    <dl class="facts">${rows.map(
      (row) =>
        h`<div><dt>${row.labelHe}</dt><dd><a href="${pixelsHref(screen.documentId, row.page, row.extractedFieldId)}">${row.value}</a>${confidenceLabel(row.confidence)}${
          row.approvedAt ? h` · אושר` : row.promotedTo ? h` · קודם` : h``
        }</dd></div>`,
    )}</dl>
    ${withheld}`;
}

export function renderReadPage(screen: ReadScreen): string {
  const back = `/estate/buildings/${screen.buildingId}`;
  const page = screen.page;
  const image = screen.image;
  // **The transcript is withheld below the permission. Slice 6.6**, ruling on what 6.5 found by
  // clicking: the captured row for a ת.ז. was correctly withheld and the word box beside it carried
  // the same digits in a `title` attribute at every stance, so an operator read it off the page the
  // gate was protecting. A `title` holding an OCR word is not the paper — it is this system's
  // transcription of the paper, as text, in its own response. The page image below these boxes *is*
  // the paper and is not withheld: the same viewer already holds a fifteen-minute signed read of the
  // bytes (5.4), so hiding a picture of the page would claim a control this system does not have.
  //
  // **Wholesale, not word by word, and on every type.** A run split across OCR tokens (`312`, `345`,
  // `678`) matches no pattern applied to one token; and the type's catalogue declaration is the
  // wrong gate, because a declaration governs what is *captured* and not what a page happens to
  // print. The geometry stays at both stances — a box with no word still answers *where did it read
  // something*, which is what `מילים על הדף` is for.
  const wordBoxes =
    page && page.width > 0 && page.height > 0
      ? page.items.map((item) =>
          screen.mayReadIdentifiers
            ? h`<span class="word-box" style="${boxPercents(item, page)}" title="${item.text}"></span>`
            : h`<span class="word-box" style="${boxPercents(item, page)}"></span>`,
        )
      : [];
  const fieldBoxes =
    page && page.width > 0 && page.height > 0
      ? visibleRows(screen)
          .filter((row) => row.page === page.number)
          .map(
            (row) =>
              h`<span id="${fieldAnchor(row.extractedFieldId)}" class="field-box" style="${boxPercents(row.bbox, page)}"></span>`,
          )
      : [];
  const boxes = [...wordBoxes, ...fieldBoxes];
  const body = h`
    <div>
      <a class="back" href="${back}">← ${screen.buildingName}</a>
      <h1>מילים על הדף</h1>
      <p class="lede">${screen.labelHe}${screen.unitId ? h`` : h` · הבניין`}</p>
    </div>
    <section class="notice">
      <dl class="facts">
        <div><dt>מקור</dt><dd>${
          screen.source === 'ocr'
            ? h`קריאה אוטומטית`
            : screen.source === 'pdfjs'
              ? h`שכבת הטקסט שבקובץ`
              : h`אין מילים לקריאה`
        }</dd></div>
        <div><dt>טביעת הקובץ</dt><dd class="digest">${ltr(screen.fileHash)}</dd></div>
      </dl>
      ${extractedSection(screen)}
    </section>
    ${
      page
        ? h`<div class="page-read" dir="ltr" style="aspect-ratio:${String(page.width)}/${String(page.height)}">${
            image
              ? h`<img alt="" src="data:${image.mimeType};base64,${image.bytes.toString('base64')}" />`
              : h``
          }${boxes}</div>`
        : h`<p class="lede">אין דף להצגה.</p>`
    }
    <div class="form-actions">
      ${
        // **Slice 7.3.** The ledger is where a reading is signed, corrected or promoted. It is the
        // primary control on this page for that reason: reading the pixels is what somebody does
        // *before* they act, and the act is next door.
        (screen.extracted ?? []).length > 0
          ? h`<a class="btn btn-primary" href="/documents/${screen.documentId}/fields">אישור הקריאה</a>`
          : h``
      }
      ${
        screen.typeKey === 'lease'
          ? h`<a class="btn btn-secondary" href="/documents/${screen.documentId}/tenancy">אישור חוזה</a>`
          : h``
      }
      ${
        screen.typeKey === 'lease_amendment'
          ? h`<a class="btn btn-secondary" href="/documents/${screen.documentId}/tenancy">אישור נספח</a>`
          : h``
      }
      ${
        screen.unitId
          ? h`<a class="btn btn-secondary" href="/documents/new?unit=${screen.unitId}">הוספת מסמך נוסף</a>`
          : h``
      }
      <a href="${back}">חזרה לבניין</a>
    </div>`;
  return shell('דונה דום — מילים על הדף', body, screen.nav);
}

const ROLE_LABEL: Record<string, string> = {
  PRIMARY_TENANT: 'שוכר ראשי',
  CO_TENANT: 'שוכר נוסף',
  GUARANTOR: 'ערב',
  OCCUPANT: 'דייר',
};

export interface TenancyScreen {
  nav: Html;
  /** The CSRF token for this session (slice 5.2). Every form in this system carries it. */
  csrf: string;
  documentId: string;
  typeKey: 'lease' | 'lease_amendment';
  unit: UnitHit;
  startDate: string | null;
  endDate: string | null;
  apartmentNumber: string | null;
  address: string | null;
  people: readonly ProposedPerson[];
  matchesUnit: boolean;
  alreadyEstablished: boolean;
  boundToTenancy: boolean;
  termsProfileNames: readonly string[];
  /**
   * **Slice 6.5. Which letting, offered rather than assumed.** Every letting on the flat, ranked by
   * identifier overlap and then by days shared. `identifierMatches` is a **count** — the value it
   * was counted from never reaches this file, which is 6.4's ruling kept structurally rather than
   * by care.
   */
  candidates: readonly TenancyCandidate[];
  /** Pre-selected. `null` is *a new letting*, and it is the default. */
  proposedTenancyId: string | null;
  /**
   * **What the cross-check actually found. Slice 6.9.** Four facts, four sentences: `matchesUnit`
   * still decides whether this screen may write, and this decides what it says about why it may not.
   */
  crossCheck: {
    addressRead: boolean;
    apartmentRead: boolean;
    addressFits: boolean;
    apartmentFits: boolean;
  };
  identifiersRead: number;
  identifiersPaired: number;
}

export function renderTenancyPage(screen: TenancyScreen): string {
  const back = `/estate/units/${screen.unit.unit_id}`;
  const isAmendment = screen.typeKey === 'lease_amendment';
  const people = screen.people.map(
    (person) => h`<div class="form-row">
      <label>${person.value}
        <select name="role-${person.extractedFieldId}">
          ${Object.entries(ROLE_LABEL).map(
            ([value, label]) =>
              h`<option value="${value}"${
                person.proposedRole === value ? h` selected` : h``
              }>${label}</option>`,
          )}
        </select>
      </label>
      ${
        // Slice 6.5. Whether a ת.ז. was paired to this person, and never the ת.ז. It says which of
        // upsertParty and createParty is about to run, which is the difference between one person
        // in two flats and two people — and it is a state, which is what this console shows.
        person.hasIdentifier
          ? h`<p class="hint">ת.ז. נקראה מהמסמך ותשויך לאדם הזה. הערך עצמו אינו מוצג כאן.</p>`
          : h`<p class="hint">לא שויכה ת.ז. לאדם הזה.</p>`
      }
    </div>`,
  );
  // **Slice 6.5 splits what used to be one condition.** Creating a letting needs dates, a tenant
  // and an annex; attaching to one that already exists needs none of the three, because it writes
  // none of them. A flat with no letting on it is the case this screen has always had, and it is
  // unchanged: no candidates, no radio group, the annex still required.
  const open = !isAmendment && screen.matchesUnit && !screen.alreadyEstablished;
  const canCreate =
    open &&
    screen.startDate !== null &&
    screen.endDate !== null &&
    screen.people.some((person) => person.fieldKey === 'tenant_name') &&
    screen.termsProfileNames.length > 0;
  const canAttach = open && screen.candidates.length > 0;
  const canWrite = isAmendment
    ? screen.boundToTenancy && !screen.alreadyEstablished
    : canCreate || canAttach;
  const profileOptions = screen.termsProfileNames.map(
    (name) => h`<option value="${name}">${name}</option>`,
  );
  const selected = screen.proposedTenancyId;
  const lettingChoice = h`<fieldset class="form-row">
      <legend>לאיזו השכרה שייך המסמך</legend>
      ${
        canCreate
          ? h`<label class="check">
              <input type="radio" name="attach_tenancy" value="new"${
                selected === null ? h` checked` : h``
              }>
              <span>השכרה חדשה</span>
            </label>`
          : h``
      }
      ${screen.candidates.map(
        (candidate) => h`<label class="check">
          <input type="radio" name="attach_tenancy" value="${candidate.tenancyId}"${
            selected === candidate.tenancyId ? h` checked` : h``
          }>
          <span>${ltr(candidate.startDate)} — ${ltr(candidate.endDate)} · ${label(
            TENANCY_STATUS,
            candidate.status,
          )}${
            candidate.identifierMatches > 0
              ? h` · התאמה לפי ת.ז.: ${String(candidate.identifierMatches)}`
              : h``
          }</span>
        </label>`,
      )}
      ${
        selected === null
          ? h`<p class="hint">אין השכרה שמתחילה בתאריך שבמסמך, ולכן ברירת המחדל היא השכרה חדשה.</p>`
          : h`<p class="hint">קיימת השכרה שמתחילה בדיוק בתאריך שבמסמך, והיא נבחרה מראש. צירוף למסמך קיים אינו משנה תאריכים.</p>`
      }
    </fieldset>`;
  const body = h`
    <div>
      <a class="back" href="${back}">← דירה ${ltr(screen.unit.unit_number)}</a>
      <h1>${isAmendment ? h`אישור נספח` : h`אישור חוזה`}</h1>
      ${unitLine(screen.unit)}
    </div>
    <section class="notice">
      <h2>מה שנקרא מהמסמך</h2>
      <dl class="facts">
        ${
          isAmendment
            ? h`<div><dt>מועד סיום מעודכן</dt><dd>${
                screen.endDate ? ltr(screen.endDate) : h`לא נמצא`
              }</dd></div>`
            : h`<div><dt>תחילת השכירות</dt><dd>${
                screen.startDate ? ltr(screen.startDate) : h`לא נמצא`
              }</dd></div>
        <div><dt>סיום השכירות</dt><dd>${
          screen.endDate ? ltr(screen.endDate) : h`לא נמצא`
        }</dd></div>
        <div><dt>דירה במסמך</dt><dd>${
          screen.apartmentNumber ? ltr(screen.apartmentNumber) : h`לא נמצא`
        }</dd></div>
        <div><dt>כתובת במסמך</dt><dd>${screen.address ?? h`לא נמצא`}</dd></div>`
        }
      </dl>
      ${
        !isAmendment && !screen.matchesUnit
          ? h`<div class="read-facts">
              ${
                // **One sentence per cause. Slice 6.9.** `views.ts` fired one sentence for four
                // facts until here, and *the address or the apartment number do not match* is true
                // of a scan that read neither — which sends an operator to compare two values the
                // page is printing as `לא נמצא`.
                screen.crossCheck.addressRead
                  ? screen.crossCheck.addressFits
                    ? h``
                    : h`<p>הכתובת שנקראה מהמסמך אינה הכתובת של הדירה שאליה הוגש.</p>`
                  : h`<p>לא נקראה כתובת מן המסמך.</p>`
              }
              ${
                screen.crossCheck.apartmentRead
                  ? screen.crossCheck.apartmentFits
                    ? h``
                    : h`<p>מספר הדירה שנקרא מהמסמך אינו מספר הדירה שאליה הוגש.</p>`
                  : h`<p>לא נקרא מספר דירה מן המסמך.</p>`
              }
              <p class="lede"><strong>לא נכתוב שוכרים.</strong></p>
            </div>`
          : h``
      }
    </section>
    ${
      canWrite
        ? h`<form class="form-grid" method="post" action="/documents/${screen.documentId}/tenancy">
            ${csrfInput(screen.csrf)}
            ${canAttach ? lettingChoice : h``}
            ${people}
            ${
              isAmendment || !canCreate
                ? h``
                : h`<div class="form-row">
              <label>נספח תחזוקה
                <select name="terms_profile"${canAttach ? h`` : h` required`}>
                  <option value="">בחרו נספח</option>
                  ${profileOptions}
                </select>
              </label>
              ${
                // The annex belongs to a *new* letting and to nothing else, so it stops being a
                // required field the moment an existing letting is on offer: the browser validates
                // `required` whatever the radio says, and forcing a choice nobody will use is how a
                // screen teaches people to pick anything.
                canAttach
                  ? h`<p class="hint">נדרש רק עבור השכרה חדשה.</p>`
                  : h``
              }
            </div>`
            }
            <div class="form-actions">
              <button class="btn btn-primary" type="submit">אישור וכתיבה</button>
              <a href="${back}">ביטול</a>
            </div>
          </form>`
        : h`${
            open && screen.termsProfileNames.length === 0
              ? h`<p class="lede">אין נספח תחזוקה במערכת. לא נכתוב השכרה עד שייובא הפנקס.</p>`
              : h``
          }
            <div class="form-actions"><a href="${back}">חזרה לדירה</a></div>`
    }`;
  return shell(
    isAmendment ? 'דונה דום — אישור נספח' : 'דונה דום — אישור חוזה',
    body,
    screen.nav,
  );
}

export interface TenancyWrittenScreen {
  nav: Html;
  unit: UnitHit;
  typeKey?: 'lease' | 'lease_amendment';
  startDate: string;
  endDate: string;
  partiesWritten: number;
  alreadyEstablished: boolean;
  /** Slice 6.5: whether the paper was bound to a letting that already existed. */
  attached?: boolean;
}

export function renderTenancyWrittenPage(screen: TenancyWrittenScreen): string {
  const back = `/estate/units/${screen.unit.unit_id}`;
  const isAmendment = screen.typeKey === 'lease_amendment';
  const body = h`
    <div>
      <a class="back" href="${back}">← דירה ${ltr(screen.unit.unit_number)}</a>
      <h1>${
        isAmendment
          ? h`הנספח נרשם`
          : screen.attached
            ? h`החוזה צורף להשכרה קיימת`
            : h`החוזה נרשם כטיוטה`
      }</h1>
    </div>
    <section class="notice">
      <dl class="facts">
        ${
          isAmendment
            ? h`<div><dt>מועד סיום מעודכן</dt><dd>${
                screen.endDate ? ltr(screen.endDate) : h`לא השתנה`
              }</dd></div>`
            : h`<div><dt>תחילת השכירות</dt><dd>${ltr(screen.startDate)}</dd></div>
        <div><dt>סיום השכירות</dt><dd>${ltr(screen.endDate)}</dd></div>`
        }
        <div><dt>${isAmendment ? h`ערבים שנרשמו` : h`שוכרים שנרשמו`}</dt><dd>${ltr(String(screen.partiesWritten))}</dd></div>
      </dl>
      ${
        screen.alreadyEstablished
          ? isAmendment
            ? h`<p class="lede">מסמך זה כבר נרשם. לא נוסף ערב שני.</p>`
            : h`<p class="lede">מסמך זה כבר הקים השכרה. לא נוסף בית שני.</p>`
          : h``
      }
      ${
        // Slice 6.5. Attaching writes the link and the people and nothing else — the dates on the
        // screen above are the letting's own, not the ones read off this paper. Saying so here is
        // what stops somebody reading the page as though the document had rewritten the term.
        screen.attached && !isAmendment
          ? h`<p class="lede">התאריכים שלמעלה הם של ההשכרה הקיימת ולא השתנו. העברת ערך מהמסמך לעמודה נעשית בנפרד, שדה אחר שדה, ממסך המסמך.</p>`
          : h``
      }
    </section>
    <div class="form-actions">
      <a class="btn btn-secondary" href="/documents/new?unit=${screen.unit.unit_id}">הוספת מסמך נוסף</a>
      <a href="${back}">חזרה לדירה</a>
    </div>`;
  return shell(
    screen.attached && !isAmendment
      ? 'דונה דום — החוזה צורף'
      : 'דונה דום — החוזה נרשם',
    body,
    screen.nav,
  );
}

/**
 * **The documents tab's landing. Slice 7.1, and the first screen of the new track.**
 *
 * It answers one question before anybody chooses a file: *what will this system look for on the
 * page?* The declaration has existed in the database since 3.1 and has been read at run time by the
 * extractor since 4.2, and until now there was nowhere to see it — so the week-6 demo could watch a
 * value arrive and could not check what had been asked for. Everything here is read out of
 * `document_type` and `document_type_field`; nothing is compiled in, which is A8 and the reason the
 * screen is worth having at all.
 *
 * **The version chip is the honest part.** `effective_from` on a declaration row *is* the version
 * (R18), so a reader who wants to know why a January value looks wrong against a March schema is
 * told, on the screen, which day's declaration they are looking at. Closed rows are not shown: the
 * route asks for the declarations governing today and the catalogue's date parameter does the rest.
 *
 * **Read-only, on purpose and only for now.** The `עריכה` control the paint drew is 7.2's and is not
 * here; the approval table is 7.3's. A control that did nothing would teach an operator that this
 * screen lies.
 */
export interface DocumentsScreen {
  nav: Html;
  csrf: string;
  types: DocumentTypeRow[];
  /** The type whose declaration is on the page. Null when the catalogue is empty. */
  chosen: DocumentTypeRow | null;
  /** The declarations governing `on`, already filtered by the catalogue's date parameter. */
  fields: DocumentTypeFieldRow[];
  /** The day the declaration was asked for — never `CURRENT_DATE`, for SPEC.md's reason. */
  on: string;
  /**
   * **Slice 7.2.** Whether this viewer holds `settings.write` — ADMIN only. The editor is rendered
   * only for a role that may post it, which is `/settings`'s shape and deliberately not 6.1's: the
   * landing itself is `documents.write`, so an OPERATOR reads the declaration and is never shown a
   * form that would refuse them after they typed into it.
   */
  mayWrite: boolean;
  /** A declaration was just written, so the screen says so. */
  saved?: 'declared' | 'retired';
}

export function renderDocumentsPage(screen: DocumentsScreen): string {
  const { chosen, fields } = screen;
  // One chip for the whole table when every row is the same version, which is the ordinary case;
  // a per-row date when they differ, because then the single chip would be a lie about some of
  // them. A schema corrected field by field is exactly how R18 says this table grows.
  const versions = [...new Set(fields.map((field) => field.effectiveFrom))];
  const oneVersion = versions.length === 1 ? versions[0] : null;
  const body = h`
    <div>
      <h1>מסמכים</h1>
      <p class="lede">
        מה המערכת מחפשת על הדף, לפי סוג המסמך. ההצהרה נקראת מן המסד בכל בקשה — היא נתון ולא קוד.
      </p>
    </div>
    ${
      screen.saved === undefined
        ? h``
        : h`<p class="lede">${
            screen.saved === 'declared'
              ? h`ההצהרה נשמרה, ותקפה מהיום.`
              : h`השדה הוצא משימוש. השורה נסגרה ולא נמחקה.`
          }</p>`
    }
    <form class="form-grid" method="get" action="/documents">
      <div class="form-row">
        <label for="type">סוג המסמך</label>
        <select id="type" name="type">
          ${screen.types.map(
            (type) =>
              h`<option value="${type.typeKey}" ${
                type.typeKey === chosen?.typeKey ? h`selected` : h``
              }>${type.labelHe}</option>`,
          )}
        </select>
        <p class="hint">הסוג מוצהר בעת התיוק ואינו מזוהה אוטומטית.</p>
      </div>
      <div class="form-actions">
        <button class="btn btn-secondary" type="submit">הצגה</button>
      </div>
    </form>
    ${
      chosen === null
        ? h`<section class="notice"><h2>אין סוגי מסמכים בקטלוג</h2>
            <p class="lede">הקטלוג נזרע מ־<code dir="ltr">npm run seed:doctypes</code>.</p>
          </section>`
        : h`<section class="notice">
      <h2>
        מה ייקרא מן הדף
        ${oneVersion ? h`<span class="chip">גרסה ${ltr(oneVersion)}</span>` : h``}
      </h2>
      <p class="lede">
        ${
          fields.length === 0
            ? h`לסוג זה אין עדיין שדות מוצהרים. הוא נשמר ונמצא בחיפוש, ולא נקרא ממנו ערך.`
            : h`${ltr(String(fields.length))} שדות מוצהרים ל${chosen.labelHe}. הקורא מחפש את אלה ואת אלה בלבד; מה שאינו כאן אינו נשמר.`
        }
      </p>
      ${
        fields.length === 0
          ? h``
          : h`<div class="table-wrap">
        <table class="grid-table">
          <thead>
            <tr>
              <th>שדה</th><th>מפתח</th><th>סוג ערך</th><th>חובה</th><th>רמז לקורא</th>
              ${oneVersion ? h`` : h`<th>גרסה</th>`}
              ${screen.mayWrite ? h`<th></th>` : h``}
            </tr>
          </thead>
          <tbody>
            ${fields.map(
              (field) => h`<tr>
              <td class="value">${field.labelHe}</td>
              <td class="key" dir="ltr">${field.fieldKey}</td>
              <td class="key" dir="ltr">${field.valueType}</td>
              <td ${field.isRequired ? h`` : h`class="muted"`}>${field.isRequired ? h`חובה` : h`רשות`}</td>
              <td class="muted">${field.extractionHint ?? h`—`}</td>
              ${oneVersion ? h`` : h`<td class="key" dir="ltr">${field.effectiveFrom}</td>`}
              ${
                screen.mayWrite
                  ? h`<td class="row-actions">
                <form method="post" action="/documents/types/${chosen.typeKey}/fields">
                  ${csrfInput(screen.csrf)}
                  <input type="hidden" name="action" value="retire" />
                  <input type="hidden" name="field_key" value="${field.fieldKey}" />
                  <button class="btn btn-secondary mini" type="submit">הוצאה משימוש</button>
                </form>
              </td>`
                  : h``
              }
            </tr>`,
            )}
          </tbody>
        </table>
      </div>`
      }
      <p class="form-note">
        ההצהרה המוצגת היא זו שתקפה ל־${ltr(screen.on)}. הצהרה שנסגרה אינה מוצגת כאן, והערכים שנקראו
        תחתיה נשארים מוסברים לפיה.
      </p>
      ${screen.mayWrite ? declarationForm(screen, chosen) : h``}
    </section>`
    }
    <div class="form-actions">
      <a class="btn btn-primary" href="/documents/new">תיוק מסמך</a>
    </div>`;
  return shell('דונה דום — מסמכים', body, screen.nav);
}

/**
 * The editor. **Slice 7.2, flow A14**, and the paint's «הוספת שדה» button wired.
 *
 * **Rendered only for `settings.write`.** An OPERATOR reads the declaration above and is shown no
 * form, which is why this screen needs no refusal state: the door an operator may not walk through
 * is not drawn on their page at all (A11's rule, 6.1's argument).
 *
 * **One form for add and for correct**, because they are one act: an existing key supersedes the
 * declaration governing today and a new one opens its first. The screen says so rather than making
 * the administrator pick a verb, and the R18 consequence — the old row stays and still says what it
 * said — is written under the button where somebody about to press it will read it.
 *
 * No value type is `MONEY` and the list is the `FieldValueType` union, so the `<select>` cannot
 * offer one. The refusal behind it is the vocabulary guard, which is a different rule: a money field
 * declared as `NUMBER` is the one the select cannot stop.
 */
function declarationForm(
  screen: DocumentsScreen,
  chosen: DocumentTypeRow,
): Html {
  return h`<form class="form-grid" method="post" action="/documents/types/${chosen.typeKey}/fields"
        style="margin-block-start: var(--space-5)">
    ${csrfInput(screen.csrf)}
    <input type="hidden" name="action" value="declare" />
    <h3>הצהרת שדה ל${chosen.labelHe}</h3>
    <p class="hint">
      מפתח שכבר מוצהר — הצהרה חדשה שמחליפה אותו מהיום. השורה הקודמת נסגרת אתמול ונשארת כפי שהיא,
      וערכים שנקראו תחתיה נשארים מוסברים לפיה. אין מחיקה.
    </p>
    <div class="form-row">
      <label for="field-key">מפתח</label>
      <input id="field-key" name="field_key" type="text" dir="ltr" required maxlength="64"
             pattern="[a-z][a-z0-9_]*" />
      <p class="hint">אותיות לטיניות קטנות, ספרות וקו תחתון. זהו המפתח שהערך נשמר תחתיו ואינו משתנה.</p>
    </div>
    <div class="form-row">
      <label for="field-label">שם בעברית</label>
      <input id="field-label" name="label_he" type="text" required maxlength="120" />
    </div>
    <div class="form-row">
      <label for="field-type">סוג ערך</label>
      <select id="field-type" name="value_type" required>
        ${FIELD_VALUE_TYPES.map(
          (type) => h`<option value="${type}">${type}</option>`,
        )}
      </select>
      <p class="hint">אין טיפוס כסף, ואין שדה כסף. סכום אינו אמת עסקית במערכת הזאת.</p>
    </div>
    <div class="form-row">
      <label for="field-hint">רמז לקורא</label>
      <textarea id="field-hint" name="extraction_hint" rows="2" maxlength="500"></textarea>
      <p class="hint">הניסוח כפי שהוא מודפס על הטופס, ומה הערך <em>אינו</em>. נשמר בגרסה הזאת בלבד.</p>
    </div>
    <label class="check">
      <input type="checkbox" name="is_required" value="true" />
      שדה חובה
    </label>
    <p class="hint">
      שדה חובה שלא נמצא על הדף הוא <strong>תוצאה</strong> ולא שגיאה — חוזה שאינו נוקב בערב הוא חוזה
      תקין. הסימון מצהיר מה מצופה, ואינו מסרב לכלום.
    </p>
    <div class="form-actions">
      <button class="btn btn-primary" type="submit">הצהרה</button>
      <span class="chip">אדמין בלבד</span>
    </div>
  </form>`;
}

/**
 * **The approval ledger. Slice 7.3, flow A15, and the last screen of the paint.**
 *
 * `/documents/:id/read` answers *where on the page did this come from* and has done since 4.1. This
 * answers the question nobody could act on: *is it right?* One row per captured value, the reading
 * as the extractor left it, the read quality, and the control that signs it.
 *
 * **`value` is never overwritten**, so the edit control is an input pre-filled with the reading and
 * a button that writes `approved_value` beside it. The difference between the two columns is the
 * per-field accuracy dataset, and a screen that wrote back into `value` would destroy the
 * measurement on the first correction — which is the whole reason the slice exists.
 *
 * **It takes no reading of the bytes.** The paint drew a page count and a reader line; both cost an
 * OCR call or a pdf parse per view, and the screen that already pays for those is one link away.
 * What is here comes out of `extracted_field`, `document_type_field` and `document`.
 */
export interface FieldsScreen {
  nav: Html;
  csrf: string;
  documentId: string;
  buildingId: string;
  buildingName: string;
  unitId: string | null;
  /** The document type's Hebrew label. */
  labelHe: string;
  /**
   * The day whose declaration these readings were taken against — the day the extraction ran, never
   * today. A field declared this morning is not something last month's lease failed to carry.
   */
  on: string;
  rows: readonly ExtractedRow[];
  /** Declarations the reader found nothing for. A result, not an error (SPEC-evidence.md). */
  unread: readonly DocumentTypeFieldRow[];
  /** 6.4's stance. Required, not defaulted: one call site, one decision, stated. */
  mayReadIdentifiers: boolean;
  /** `documents.write`. A viewer who may not sign is shown the ledger and no controls. */
  mayApprove: boolean;
  /** The one row a viewer asked for by name, this request only. Never sticky, never a query param. */
  revealed?: string;
  /** How many rows the last press signed. */
  saved?: number;
}

const MASK = '•••••••••';

/**
 * Whether the value on this row may be printed. **Withheld is the default** and a reveal is one
 * row, this request only: a viewer holding `party.national_id.read` still has to ask, because a
 * screen that printed every ת.ז. to every ADMIN who opened it would make the disclosure log a record
 * of who opened a page rather than of who read an identifier.
 */
function shows(screen: FieldsScreen, row: ExtractedRow): boolean {
  if (!isIdentifierField(row.fieldKey)) return true;
  return screen.mayReadIdentifiers && screen.revealed === row.extractedFieldId;
}

/** The reading's quality, in the words the number can actually support. */
function qualityCell(row: ExtractedRow): Html {
  if (row.confidence === null) {
    // Every word of a digitally-produced PDF arrives with no score at all (src/kernel/pdf.ts), so
    // this is the ordinary case on a native lease and not an anomaly. It is flagged, and it says
    // what it is instead of showing a number it does not have.
    return h`<td class="muted">נקרא מטקסט, לא נמדד</td>`;
  }
  const percent = `${String(Math.round(row.confidence * 100))}%`;
  return isFlagged(row.confidence)
    ? h`<td class="key quality is-low">${ltr(percent)}</td>`
    : h`<td class="key quality">${ltr(percent)}</td>`;
}

/**
 * Flagged first, and among the flagged the unmeasured first — the rows a person has to look at, at
 * the top of the page, which is the other half of `אישור כל מה שלא סומן` being safe to press.
 * Signed rows fall to the bottom: they are the work already done.
 */
function ledgerOrder(rows: readonly ExtractedRow[]): ExtractedRow[] {
  const rank = (row: ExtractedRow): number => {
    if (row.approvedAt !== null) return 3;
    if (row.confidence === null) return 0;
    if (isFlagged(row.confidence) || isIdentifierField(row.fieldKey)) return 1;
    return 2;
  };
  return [...rows].sort(
    (a, b) =>
      rank(a) - rank(b) ||
      (a.confidence ?? 0) - (b.confidence ?? 0) ||
      a.fieldKey.localeCompare(b.fieldKey),
  );
}

function approveControl(screen: FieldsScreen, row: ExtractedRow): Html {
  if (row.approvedAt !== null) {
    return h`<td class="muted">אושר</td>`;
  }
  if (!screen.mayApprove) {
    return h`<td class="muted">—</td>`;
  }
  if (isIdentifierField(row.fieldKey) && !shows(screen, row)) {
    // A signature on a masked value is a false record, so the only control here is the one that
    // ends the masking — and it is its own request, logged as a disclosure (6.4).
    return h`<td class="row-actions">
      <form method="post" action="/documents/${screen.documentId}/fields/reveal">
        ${csrfInput(screen.csrf)}
        <input type="hidden" name="extracted_field_id" value="${row.extractedFieldId}" />
        <button class="btn btn-secondary mini" type="submit">גילוי</button>
      </form>
    </td>`;
  }
  return h`<td class="row-actions">
    <form method="post" action="/documents/${screen.documentId}/fields/approve">
      ${csrfInput(screen.csrf)}
      <input type="hidden" name="extracted_field_id" value="${row.extractedFieldId}" />
      <input class="mini" name="approved_value" value="${row.value}" maxlength="2000"
             aria-label="הערך המאושר ל${row.labelHe}" />
      <button class="btn btn-primary mini" type="submit">אישור</button>
    </form>
  </td>`;
}

function valueCell(screen: FieldsScreen, row: ExtractedRow): Html {
  if (!shows(screen, row)) {
    return h`<td class="key">${ltr(MASK)}</td>`;
  }
  const read = h`<a href="${pixelsHref(screen.documentId, row.page, row.extractedFieldId)}">${row.value}</a>`;
  if (row.approvedValue === null || row.approvedValue === row.value) {
    return h`<td>${read}</td>`;
  }
  // **The delta, on the screen it was created on.** Both values, because the point of the second
  // column is that somebody can see what the reader got wrong.
  return h`<td><span class="value">${row.approvedValue}</span>
    <span class="second">· נקרא: ${read}</span></td>`;
}

export function renderFieldsPage(screen: FieldsScreen): string {
  const back = screen.unitId
    ? `/estate/units/${screen.unitId}`
    : `/estate/buildings/${screen.buildingId}`;
  const shown = screen.mayReadIdentifiers
    ? screen.rows
    : screen.rows.filter((row) => !isIdentifierField(row.fieldKey));
  const withheld = screen.mayReadIdentifiers
    ? 0
    : screen.rows.length - shown.length;
  const open = shown.filter((row) => row.approvedAt === null);
  const unflagged = open.filter(
    (row) => !isFlagged(row.confidence) && !isIdentifierField(row.fieldKey),
  );
  const promotable = shown.filter(
    (row) => row.promotionTarget && !row.promotedTo,
  );
  const body = h`
    <div>
      <a class="back" href="${back}">← ${screen.unitId ? h`הדירה` : screen.buildingName}</a>
      <h1>מה נקרא מן המסמך</h1>
      <p class="lede">${screen.labelHe} · ההצהרה שתקפה ל־${ltr(screen.on)}</p>
    </div>
    ${
      screen.saved === undefined
        ? h``
        : h`<p class="lede">${
            screen.saved === 1
              ? h`שורה אחת אושרה.`
              : h`${ltr(screen.saved)} שורות אושרו.`
          } הערך שנקרא נשמר כפי שהוא.</p>`
    }
    ${
      shown.length === 0 && screen.unread.length === 0
        ? h`<p class="lede">לא נקראו שדות מהמסמך ואין הצהרות לסוג הזה.</p>`
        : h`<div class="table-wrap">
      <table class="grid-table">
        <thead>
          <tr><th>שדה</th><th>ערך שנקרא</th><th>איכות הקריאה</th><th>פעולה</th></tr>
        </thead>
        <tbody>
          ${ledgerOrder(shown).map(
            (row) => h`<tr>
            <td class="value">${row.labelHe}</td>
            ${valueCell(screen, row)}
            ${qualityCell(row)}
            ${approveControl(screen, row)}
          </tr>`,
          )}
          ${screen.unread.map(
            (field) => h`<tr>
            <td class="value muted">${field.labelHe}</td>
            <td class="muted">לא נקרא${field.isRequired ? h`` : h` — שדה רשות`}</td>
            <td class="muted">—</td>
            <td class="muted">—</td>
          </tr>`,
          )}
        </tbody>
      </table>
    </div>`
    }
    ${withheldLine(withheld)}
    <div class="form-actions">
      ${
        screen.mayApprove && unflagged.length > 0
          ? h`<form method="post" action="/documents/${screen.documentId}/fields/approve">
            ${csrfInput(screen.csrf)}
            <input type="hidden" name="action" value="unflagged" />
            <button class="btn btn-primary" type="submit">אישור כל מה שלא סומן</button>
          </form>`
          : h``
      }
      <a class="btn btn-secondary" href="/documents/${screen.documentId}/read">מילים על הדף</a>
      ${
        open.length - unflagged.length > 0
          ? h`<span class="chip">${ltr(open.length - unflagged.length)} שורות לבדיקה אישית</span>`
          : h``
      }
    </div>
    <p class="form-note">
      «אישור» אינו «קידום». אישור אומר שהקריאה נכונה ונשמר על שורת המסמך; קידום מעתיק ערך לעמודה
      מוקלדת של ההשכרה, ויש לו יעד רק לשני התאריכים. ערך שנקרא לעולם אינו נמחק — תיקון נכתב לצדו.
    </p>
    ${
      promotable.length > 0
        ? h`<form class="form-actions" method="post" action="/documents/${screen.documentId}/promote">
          ${csrfInput(screen.csrf)}
          ${promotable.map(
            (row) =>
              h`<button class="btn btn-secondary" name="extracted_field_id" value="${row.extractedFieldId}">קדם · ${row.labelHe}</button>`,
          )}
        </form>`
        : h``
    }`;
  return shell('דונה דום — אישור קריאה', body, screen.nav);
}
