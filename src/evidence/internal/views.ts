// The upload screen and its two answers. Slice 3.3, flow A1.
//
// The shell is the kernel's (`src/kernel/ui/page.ts`) and every colour, face and physical side comes
// from `/ui/tokens.css`. What is here is the layout of a form and of the sentence that follows it.
//
// **Nothing on these screens is a person.** A unit number, a building, a type, a date range and a
// digest — that is the whole vocabulary. The tenancy options are dates and a status, which is the
// same rule the occupancy chip keeps: an unauthenticated screen may say a flat is let and may not
// say by whom, until week 5 puts a session in front of it. `tests/ui/tokens.test.ts` asserts it from
// the outside, on the rendered bytes, because that is what a rule is for.
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
          חוזי הדירה, לפי תאריכים. יצירת חוזה חדש מתוך מסמך שייכת לשלב הקריאה האוטומטית.
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
  buildingId: string;
  buildingName: string;
  unitId: string | null;
  labelHe: string;
  fileHash: string;
  source: 'pdfjs' | 'ocr' | 'none';
  page: PdfPage | null;
  image: OcrPageImage | null;
}

export function renderReadPage(screen: ReadScreen): string {
  const back = `/estate/buildings/${screen.buildingId}`;
  const page = screen.page;
  const image = screen.image;
  const boxes =
    page && page.width > 0 && page.height > 0
      ? page.items.map((item) => {
          const inlineStart = (item.x / page.width) * 100;
          const blockStart = (item.y / page.height) * 100;
          const inlineSize = (item.width / page.width) * 100;
          const blockSize = (item.height / page.height) * 100;
          return h`<span class="word-box" style="inset-inline-start:${String(inlineStart)}%;inset-block-start:${String(blockStart)}%;inline-size:${String(inlineSize)}%;block-size:${String(blockSize)}%" title="${item.text}"></span>`;
        })
      : [];
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
