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
import type { OcrPageImage } from '../../kernel/ocr.ts';
import type { PdfPage } from '../../kernel/pdf.ts';
import { type Html, h } from '../../kernel/ui/html.ts';
import { csrfInput, renderPage } from '../../kernel/ui/page.ts';
import type { UnitLetting } from '../../tenancy/contract.ts';
import type { DocumentTypeRow } from './catalogue.ts';
import { isIdentifierField } from './extract.ts';
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
  .form-grid { display: grid; gap: var(--space-4); max-width: var(--size-shell-max); }
  .form-row { display: grid; gap: var(--space-2); }
  .form-row .hint { color: var(--color-text-muted); font-size: var(--text-sm); margin: 0; }
  .form-actions { display: flex; gap: var(--space-3); flex-wrap: wrap; align-items: center; }
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
  /* Slice 6.3. A list of flats the reader could not choose between, each one a radio the operator
     chooses with. The min-height is the touch target; the input opts out of the field sizing the
     stylesheet gives every other input, because a radio is not a field. */
  .candidates { display: grid; gap: var(--space-2); margin: var(--space-3) 0 0; padding: 0; list-style: none; }
  .candidate { display: flex; gap: var(--space-2); align-items: baseline; min-height: var(--size-touch); }
  .candidate input { width: auto; min-height: 0; }
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
 */
function refusal(type: DocumentTypeRow, verification: Verification): Html {
  return h`<section class="notice">
    <h2>הקובץ אינו נראה כמו ${type.labelHe}</h2>
    <p class="lede">
      לא נמצאו בקובץ הביטויים הקבועים של טופס מסוג זה, ולכן הוא לא נשמר. בדקו שנבחר הקובץ הנכון,
      או בחרו סוג מסמך אחר.
    </p>
    <ul class="terms">
      ${verification.missingTerms.map((term) => h`<li class="chip">${term}</li>`)}
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
  refused?: { type: DocumentTypeRow; verification: Verification };
}

export function renderUploadPage(screen: UploadScreen): string {
  const { unit, types, lettings } = screen;
  const body = h`
    <div>
      <a class="back" href="/estate/buildings/${unit.building_id}">← ${unit.building_name}</a>
      <h1>הוספת מסמך</h1>
      ${unitLine(unit)}
    </div>
    ${screen.refused ? refusal(screen.refused.type, screen.refused.verification) : h``}
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
}

/**
 * What the reader read, in the operator's words.
 *
 * **This is the one place a document's own text reaches a screen in this module**, and it is bounded
 * to three values a deterministic reader captured: a street, a town, a flat number. A refusal an
 * operator cannot act on is a refusal they will work around, and "we could not place it" without
 * saying what was read is exactly that refusal. No name, no date, no line of the lease.
 */
function placeRead(reading: PlaceReading): Html {
  if (!reading.addressLine) {
    return h`<p class="lede">
      לא נקראה כתובת מן הדף, ולכן <strong>לא נשמר דבר</strong> — לא הקובץ ולא רישום.
      בחרו את הדירה שאליה הנייר שייך, או חפשו אותה, וצרפו את הקובץ שוב.
    </p>`;
  }
  return h`<p class="lede">
    נקראה הכתובת ${ltr(reading.addressLine)}${
      reading.city ? h`, ${reading.city}` : h``
    }${
      reading.apartmentNumber ? h` · דירה ${ltr(reading.apartmentNumber)}` : h``
    }.
    לא נמצאה במערכת דירה אחת שמתאימה לה, ולכן <strong>לא נשמר דבר</strong> — לא הקובץ ולא רישום.
    בחרו את הדירה שאליה הנייר שייך, או חפשו אותה, וצרפו את הקובץ שוב.
  </p>`;
}

export function renderIntakePage(screen: IntakeScreen): string {
  const candidates = screen.candidates ?? [];
  const refused = screen.reading !== undefined;
  const body = h`
    <div>
      <a class="back" href="/">← ראשי</a>
      <h1>הוספת מסמך</h1>
      <p class="lede">
        בחרו את סוג המסמך וצרפו את הקובץ. הדירה שאליה שייך הנייר תזוהה מתוך הכתובת שעליו —
        הדירה היא העוגן, לא סוף הדרך: חוזה שכירות ממשיך מכאן אל השכירות שהוא עצמו מגדיר.
      </p>
    </div>
    ${
      refused
        ? h`<section class="notice">
            <h2>${
              candidates.length > 1
                ? h`נמצאה יותר מדירה אחת`
                : h`לא זוהתה דירה אחת`
            }</h2>
            ${placeRead(screen.reading as PlaceReading)}
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
                      <input type="radio" id="u-${unit.unit_id}" name="unit" value="${unit.unit_id}" required />
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

function extractedSection(screen: ReadScreen) {
  const rows = visibleRows(screen);
  const withheld = withheldLine(withheldCount(screen));
  if (rows.length === 0) {
    return h`<p class="lede">לא נקראו שדות מהמסמך. אין מה לקדם עד שהקריאה תשלים.</p>${withheld}`;
  }
  const promotable = rows.filter(
    (row) => row.promotionTarget && !row.promotedTo,
  );
  return h`
    <h2>מה שנקרא</h2>
    <dl class="facts">${rows.map(
      (row) =>
        h`<div><dt>${row.labelHe}</dt><dd><a href="${pixelsHref(screen.documentId, row.page, row.extractedFieldId)}">${row.value}</a>${confidenceLabel(row.confidence)}${
          row.promotedTo
            ? h` · קודם`
            : row.promotionTarget
              ? h``
              : h` · נקרא בלבד`
        }</dd></div>`,
    )}</dl>
    ${withheld}
    ${
      promotable.length > 0
        ? h`<form method="post" action="/documents/${screen.documentId}/promote">
            ${csrfInput(screen.csrf)}
            ${promotable.map(
              (row) =>
                h`<button class="btn" name="extracted_field_id" value="${row.extractedFieldId}">קדם · ${row.labelHe}</button>`,
            )}
          </form>`
        : h``
    }`;
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
          ? h`<p class="lede">הכתובת או מספר הדירה במסמך אינם תואמים את הדירה שאליה הוגש. לא נכתוב שוכרים.</p>`
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
