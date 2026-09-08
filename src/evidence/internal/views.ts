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
// **No client JavaScript, here as everywhere.** The type list is a `<select>` the server filled from
// the catalogue, the file input is a file input, and the page works with scripting switched off.
import type { UnitHit } from '../../estate/contract.ts';
import type { OcrPageImage } from '../../kernel/ocr.ts';
import type { PdfPage } from '../../kernel/pdf.ts';
import { type Html, h } from '../../kernel/ui/html.ts';
import { renderPage } from '../../kernel/ui/page.ts';
import type { UnitLetting } from '../../tenancy/contract.ts';
import type { DocumentTypeRow } from './catalogue.ts';
import type { ProposedPerson } from './lease.ts';
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

function nav(): Html {
  return h`<nav class="top-nav">
    <a href="/estate">בניינים</a>
    <a href="/estate/expiring">חוזים מסתיימים</a>
  </nav>`;
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
  return renderPage({
    title: `דונה דום — הוספת מסמך לדירה ${unit.unit_number}`,
    styles,
    nav: nav(),
    body,
  });
}

export interface FiledScreen {
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
 * The digest is shown and the `gs://` uri is not. Nothing in this system mints a signed URL — a
 * signed URL is a bearer token for one object, and issuing one is a decision that belongs behind a
 * session (slice 3.6 carries the same rule for the documents panel).
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
      <a class="btn btn-secondary" href="/documents/new?unit=${unit.unit_id}">הוספת מסמך נוסף</a>
      <a href="/estate/buildings/${unit.building_id}">חזרה לבניין</a>
    </div>`;
  return renderPage({
    title: `דונה דום — המסמך נשמר`,
    styles,
    nav: nav(),
    body,
  });
}

export interface SeedScreen {
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
            <button class="btn btn-primary" type="submit">אישור וכתיבה</button>
            <a href="${back}">ביטול</a>
          </form>`
        : h`<div class="form-actions"><a href="${back}">חזרה לבניין</a></div>`
    }`;
  return renderPage({
    title: 'דונה דום — אישור מסירה',
    styles,
    nav: nav(),
    body,
  });
}

export interface SeededScreen {
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
  return renderPage({
    title: 'דונה דום — המסירה נרשמה',
    styles,
    nav: nav(),
    body,
  });
}

export interface ReadScreen {
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
  extracted?: ReadonlyArray<{
    extractedFieldId: string;
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

function extractedSection(screen: ReadScreen) {
  const rows = screen.extracted ?? [];
  if (rows.length === 0) {
    return h`<p class="lede">לא נקראו שדות מהמסמך. אין מה לקדם עד שהקריאה תשלים.</p>`;
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
    ${
      promotable.length > 0
        ? h`<form method="post" action="/documents/${screen.documentId}/promote" enctype="multipart/form-data">
            <p><label>מי מאשר <input name="promoted_by" required maxlength="200"></label></p>
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
  const wordBoxes =
    page && page.width > 0 && page.height > 0
      ? page.items.map(
          (item) =>
            h`<span class="word-box" style="${boxPercents(item, page)}" title="${item.text}"></span>`,
        )
      : [];
  const fieldBoxes =
    page && page.width > 0 && page.height > 0
      ? (screen.extracted ?? [])
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
        screen.unitId
          ? h`<a class="btn btn-secondary" href="/documents/new?unit=${screen.unitId}">הוספת מסמך נוסף</a>`
          : h``
      }
      <a href="${back}">חזרה לבניין</a>
    </div>`;
  return renderPage({
    title: 'דונה דום — מילים על הדף',
    styles,
    nav: nav(),
    body,
  });
}

const ROLE_LABEL: Record<string, string> = {
  PRIMARY_TENANT: 'שוכר ראשי',
  CO_TENANT: 'שוכר נוסף',
  GUARANTOR: 'ערב',
  OCCUPANT: 'דייר',
};

export interface TenancyScreen {
  documentId: string;
  unit: UnitHit;
  startDate: string | null;
  endDate: string | null;
  apartmentNumber: string | null;
  address: string | null;
  people: readonly ProposedPerson[];
  matchesUnit: boolean;
  alreadyEstablished: boolean;
  termsProfileNames: readonly string[];
}

export function renderTenancyPage(screen: TenancyScreen): string {
  const back = `/estate/units/${screen.unit.unit_id}`;
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
    </div>`,
  );
  const canWrite =
    screen.matchesUnit &&
    !screen.alreadyEstablished &&
    screen.startDate !== null &&
    screen.endDate !== null &&
    screen.people.some((person) => person.fieldKey === 'tenant_name') &&
    screen.termsProfileNames.length > 0;
  const profileOptions = screen.termsProfileNames.map(
    (name) => h`<option value="${name}">${name}</option>`,
  );
  const body = h`
    <div>
      <a class="back" href="${back}">← דירה ${ltr(screen.unit.unit_number)}</a>
      <h1>אישור חוזה</h1>
      ${unitLine(screen.unit)}
    </div>
    <section class="notice">
      <h2>מה שנקרא מהמסמך</h2>
      <dl class="facts">
        <div><dt>תחילת השכירות</dt><dd>${
          screen.startDate ? ltr(screen.startDate) : h`לא נמצא`
        }</dd></div>
        <div><dt>סיום השכירות</dt><dd>${
          screen.endDate ? ltr(screen.endDate) : h`לא נמצא`
        }</dd></div>
        <div><dt>דירה במסמך</dt><dd>${
          screen.apartmentNumber ? ltr(screen.apartmentNumber) : h`לא נמצא`
        }</dd></div>
        <div><dt>כתובת במסמך</dt><dd>${screen.address ?? h`לא נמצא`}</dd></div>
      </dl>
      ${
        screen.matchesUnit
          ? h``
          : h`<p class="lede">הכתובת או מספר הדירה במסמך אינם תואמים את הדירה שאליה הוגש. לא נכתוב שוכרים.</p>`
      }
    </section>
    ${
      canWrite
        ? h`<form class="form-grid" method="post" action="/documents/${screen.documentId}/tenancy" enctype="multipart/form-data">
            ${people}
            <div class="form-row">
              <label>נספח תחזוקה
                <select name="terms_profile" required>
                  <option value="">בחרו נספח</option>
                  ${profileOptions}
                </select>
              </label>
            </div>
            <div class="form-row">
              <label>מי מאשר
                <input name="confirmed_by" required maxlength="200">
              </label>
            </div>
            <div class="form-actions">
              <button class="btn btn-primary" type="submit">אישור וכתיבה</button>
              <a href="${back}">ביטול</a>
            </div>
          </form>`
        : h`${
            screen.matchesUnit &&
            !screen.alreadyEstablished &&
            screen.termsProfileNames.length === 0
              ? h`<p class="lede">אין נספח תחזוקה במערכת. לא נכתוב השכרה עד שייובא הפנקס.</p>`
              : h``
          }
            <div class="form-actions"><a href="${back}">חזרה לדירה</a></div>`
    }`;
  return renderPage({
    title: 'דונה דום — אישור חוזה',
    styles,
    nav: nav(),
    body,
  });
}

export interface TenancyWrittenScreen {
  unit: UnitHit;
  startDate: string;
  endDate: string;
  partiesWritten: number;
  alreadyEstablished: boolean;
}

export function renderTenancyWrittenPage(screen: TenancyWrittenScreen): string {
  const back = `/estate/units/${screen.unit.unit_id}`;
  const body = h`
    <div>
      <a class="back" href="${back}">← דירה ${ltr(screen.unit.unit_number)}</a>
      <h1>החוזה נרשם כטיוטה</h1>
    </div>
    <section class="notice">
      <dl class="facts">
        <div><dt>תחילת השכירות</dt><dd>${ltr(screen.startDate)}</dd></div>
        <div><dt>סיום השכירות</dt><dd>${ltr(screen.endDate)}</dd></div>
        <div><dt>שוכרים שנרשמו</dt><dd>${ltr(String(screen.partiesWritten))}</dd></div>
      </dl>
      ${
        screen.alreadyEstablished
          ? h`<p class="lede">מסמך זה כבר הקים השכרה. לא נוסף בית שני.</p>`
          : h``
      }
    </section>
    <div class="form-actions">
      <a class="btn btn-secondary" href="/documents/new?unit=${screen.unit.unit_id}">הוספת מסמך נוסף</a>
      <a href="${back}">חזרה לדירה</a>
    </div>`;
  return renderPage({
    title: 'דונה דום — החוזה נרשם',
    styles,
    nav: nav(),
    body,
  });
}
