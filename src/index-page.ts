// The root index. **Moved here from `src/estate/internal/views.ts` at slice 5.2.**
//
// 2.6 wrote it in estate and said, in the same paragraph, that it would move to the composition
// root the week a second *module* had a screen, because an index of screens is not estate's fact.
// 5.1 gave staff its screens and 5.2 is the slice that owns the move, so it happens here rather
// than being noticed again in a month.
//
// **It runs no query**, which is 2.6's decision and is unchanged: a portfolio headline belongs on
// the buildings list where those numbers are already being read for the cards, and an index that
// ran three portfolio queries to render four links would be a worse root than the 302 it replaced.
//
// **Slice 5.2b / 5.2c:** the chrome this page used to own is `src/chrome.ts`, the ops rail every
// screen. This file still lives beside `src/app.ts` rather than in a `src/ui/` of its own: a
// directory under `src/` reads as a module in this repository.

import { signedInChrome } from './chrome.ts';
import { type Html, h } from './kernel/ui/html.ts';
import { renderPage } from './kernel/ui/page.ts';

export interface IndexScreen {
  /** The token every form in this system carries from 5.2. The sign-out form is this screen's one. */
  csrf: string;
}

const styles = h`<style>
  .index-list { display: grid; gap: var(--space-2); }
  .card-title {
    display: flex;
    align-items: baseline;
    gap: var(--space-3);
    flex-wrap: wrap;
    margin: 0 0 var(--space-2);
    font-size: var(--text-lg);
    font-weight: 500;
  }
  a.card-link { color: inherit; text-decoration: none; display: block; }
  a.card-link:hover .card-title { text-decoration: underline; }
</style>`;

function marker(state: 'is-ok' | 'is-alert'): Html {
  return h`<span class="state-marker ${state}"></span>`;
}

export function renderIndexPage(screen: IndexScreen): string {
  const body = h`
    <div>
      <h1>דונה דום · ניהול נכסים</h1>
      <p class="lede">נתוני הדגמה. המסכים אינם מציגים שמות דיירים או מספרי טלפון.</p>
    </div>
    <div class="index-list">
      <article class="row-card">
        ${marker('is-ok')}
        <a class="card-link" href="/estate">
          <p class="card-title"><span>בניינים</span></p>
          <p class="lede">כל הבניינים, מספר היחידות בכל אחד וכמה מהן מאוכלסות היום.</p>
        </a>
      </article>
      <article class="row-card">
        ${marker('is-ok')}
        <a class="card-link" href="/estate/expiring">
          <p class="card-title"><span>חוזים מסתיימים</span></p>
          <p class="lede">כל החוזים בתיק המסתיימים ב־60 הימים הקרובים, לפי תאריך.</p>
        </a>
      </article>
      <article class="row-card">
        ${marker('is-alert')}
        <a class="card-link" href="/estate/incomplete">
          <p class="card-title"><span>חוזים לא שלמים</span></p>
          <p class="lede">טיוטות וחוזים פעילים שחסר בהם ערב, על המסמך שהיה אמור לשאת אותו.</p>
        </a>
      </article>
      <article class="row-card">
        ${marker('is-ok')}
        <a class="card-link" href="/estate/search">
          <p class="card-title"><span>חיפוש</span></p>
          <p class="lede">כתובת, שם בניין, מספר דירה או סוג מסמך, על פני כל התיק.</p>
        </a>
      </article>
      <article class="row-card">
        ${marker('is-ok')}
        <a class="card-link" href="/staff">
          <p class="card-title"><span>צוות</span></p>
          <p class="lede">מי מורשה להיכנס למערכת, ומה כל תפקיד רשאי לעשות.</p>
        </a>
      </article>
      <article class="row-card">
        ${marker('is-alert')}
        <a class="card-link" href="/calls">
          <p class="card-title"><span>קריאות</span></p>
          <p class="lede">שבוע 7 · סלייס 7.2</p>
        </a>
      </article>
      <article class="row-card">
        ${marker('is-alert')}
        <a class="card-link" href="/settings">
          <p class="card-title"><span>הגדרות</span></p>
          <p class="lede">שבוע 5 · סלייס 5.8</p>
        </a>
      </article>
    </div>`;
  return renderPage({
    title: 'דונה דום — ניהול נכסים',
    styles,
    nav: signedInChrome(screen.csrf, 'index'),
    body,
  });
}
