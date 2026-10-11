// The אנשי קשר tab. #202.
//
// It lives beside `src/index-page.ts` and `src/settings-page.ts` because the profile is assembled
// here, at the composition root. Later tickets add a tenancy section, an estate section and a
// calls section on this page. Those reads stay on their own contracts. The parties module does
// not import them, and it does not learn that a page exists.
//
// The phone and the email are folded here, with the same normalisers the door uses, before the
// parties contract is asked. A second copy of either fold inside parties is the one that drifts.

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Pool } from 'pg';
import { signedInChrome } from './chrome.ts';
import { KernelError } from './kernel/errors.ts';
import { type Html, h } from './kernel/ui/html.ts';
import { renderPage } from './kernel/ui/page.ts';
import { validId } from './kernel/validate.ts';
import type {
  DirectoryParty,
  DirectoryQuery,
  PartyProfile,
  ProfileContact,
} from './parties/contract.ts';
import { readPartyProfile, searchParties } from './parties/contract.ts';
import { normaliseEmail, normalisePhone } from './scope/contract.ts';
import { can, csrfFrom } from './staff/contract.ts';

const QUERY_MAX = 200;

const LANGUAGE_HE: Record<PartyProfile['language'], string> = {
  he: 'עברית',
  ar: 'ערבית',
  ru: 'רוסית',
  fr: 'צרפתית',
  en: 'אנגלית',
};

const styles = h`<style>
  .party-directory { display: grid; gap: var(--space-4); }
  .party-search {
    display: flex;
    flex-wrap: wrap;
    align-items: end;
    gap: var(--space-3);
  }
  .party-search label { display: grid; gap: var(--space-1); flex: 1 1 16rem; }
  .party-search input {
    min-height: var(--size-control);
    padding-inline: var(--space-3);
    border: var(--size-hairline) solid var(--color-divider);
    border-radius: var(--radius-2);
    background: var(--color-surface-card);
    font: inherit;
  }
  .party-contacts { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--space-2); }
  .party-contacts li { display: flex; flex-wrap: wrap; gap: var(--space-2); align-items: baseline; }
</style>`;

export interface DirectoryScreen {
  csrf: string;
  mayFile: boolean;
  mayReadParties: boolean;
  openCalls?: number;
  query: string;
  rows: readonly DirectoryParty[];
}

export interface ProfileScreen {
  csrf: string;
  mayFile: boolean;
  mayReadParties: boolean;
  openCalls?: number;
  profile: PartyProfile;
}

function asked(query: unknown): string {
  if (query === null || typeof query !== 'object') return '';
  const value = (query as { q?: unknown }).q;
  return typeof value === 'string' ? value : '';
}

/** What the box asked, turned into the one read the contract accepts. */
export function directoryQuery(raw: string): DirectoryQuery {
  const query = raw.trim();
  if (query.length === 0) return { kind: 'all' };
  if (query.length > QUERY_MAX) return { kind: 'name', words: [] };
  try {
    return { kind: 'phone', value: normalisePhone(query) };
  } catch (error) {
    if (!(error instanceof KernelError)) throw error;
  }
  try {
    return { kind: 'email', value: normaliseEmail(query) };
  } catch (error) {
    if (!(error instanceof KernelError)) throw error;
  }
  return {
    kind: 'name',
    words: query.split(/\s+/).filter((word) => word.length > 0),
  };
}

function blank(value: string | null): Html {
  if (value === null || value === '') return h`—`;
  return h`<bdi dir="ltr">${value}</bdi>`;
}

function dates(contact: ProfileContact): string {
  if (contact.validTo === null) return contact.validFrom;
  return `${contact.validFrom} – ${contact.validTo}`;
}

function navOf(
  screen: Pick<
    DirectoryScreen,
    'csrf' | 'mayFile' | 'mayReadParties' | 'openCalls'
  >,
  dest: 'parties',
): Html {
  return signedInChrome(
    screen.csrf,
    dest,
    screen.mayFile,
    screen.mayReadParties,
    screen.openCalls,
  );
}

export function renderPartyDirectory(screen: DirectoryScreen): string {
  const rows =
    screen.rows.length === 0
      ? h`<p class="lede">${screen.query === '' ? 'אין אנשי קשר.' : 'אין התאמה.'}</p>`
      : h`<div class="table-wrap">
          <table class="grid-table">
            <thead>
              <tr><th>שם</th><th>טלפון</th><th>דוא״ל</th><th>שפה</th></tr>
            </thead>
            <tbody>
              ${screen.rows.map(
                (row) => h`<tr>
                  <td><a href="/parties/${row.partyId}">${row.fullName}</a></td>
                  <td>${blank(row.primaryPhone)}</td>
                  <td>${blank(row.primaryEmail)}</td>
                  <td>${LANGUAGE_HE[row.language]}</td>
                </tr>`,
              )}
            </tbody>
          </table>
        </div>`;
  const body = h`<div class="glass-stage party-directory">
    <header class="page-head">
      <h1>אנשי קשר</h1>
      <p class="lede">כל מי שהמערכת מכירה.</p>
    </header>
    <form class="glass party-search" method="get" action="/parties">
      <label>חיפוש
        <input id="party-q" type="search" name="q" value="${screen.query}" placeholder="שם, טלפון או דוא״ל" autocomplete="off" maxlength="${QUERY_MAX}" />
      </label>
      <button class="btn" type="submit">חיפוש</button>
    </form>
    <div class="glass">${rows}</div>
  </div>`;
  return renderPage({
    title: 'אנשי קשר — דונה דום',
    styles,
    nav: navOf(screen, 'parties'),
    body,
  });
}

function identity(profile: PartyProfile): Html {
  const language = h`<div><dt>שפה</dt><dd>${LANGUAGE_HE[profile.language]}</dd></div>`;
  if (profile.kind === 'COMPANY') {
    return h`<dl class="facts">
      <div><dt>שם משפטי</dt><dd>${profile.legalName ?? '—'}</dd></div>
      <div><dt>סוג</dt><dd>חברה</dd></div>
      ${language}
    </dl>`;
  }
  return h`<dl class="facts">
    <div><dt>שם פרטי</dt><dd>${profile.givenName ?? '—'}</dd></div>
    <div><dt>שם משפחה</dt><dd>${profile.familyName ?? '—'}</dd></div>
    <div><dt>סוג</dt><dd>אדם</dd></div>
    ${language}
  </dl>`;
}

function contacts(rows: readonly ProfileContact[]): Html {
  if (rows.length === 0) return h`<p class="lede">אין פרטי קשר.</p>`;
  return h`<ul class="party-contacts">
    ${rows.map(
      (contact) => h`<li>
        ${blank(contact.value)}
        <span>${contact.validTo === null ? 'פתוח' : 'סגור'}</span>
        ${contact.isPrimary ? h`<span>ראשי</span>` : h``}
        <span dir="ltr">${dates(contact)}</span>
      </li>`,
    )}
  </ul>`;
}

export function renderPartyProfile(screen: ProfileScreen): string {
  const { profile } = screen;
  const body = h`<div class="glass-stage party-directory">
    <header class="page-head">
      <p class="lede"><a class="back" href="/parties">אנשי קשר</a></p>
      <h1>${profile.fullName}</h1>
    </header>
    <section class="glass">
      <h2>זהות</h2>
      ${identity(profile)}
    </section>
    <section class="glass">
      <h2>פרטי קשר</h2>
      ${contacts(profile.contacts)}
    </section>
  </div>`;
  return renderPage({
    title: `${profile.fullName} — אנשי קשר — דונה דום`,
    styles,
    nav: navOf(screen, 'parties'),
    body,
  });
}

function html(reply: FastifyReply): void {
  reply.header('content-type', 'text/html; charset=utf-8');
  reply.header('cache-control', 'no-store');
  reply.header('x-content-type-options', 'nosniff');
}

function screenOf(request: FastifyRequest): {
  csrf: string;
  mayFile: boolean;
  mayReadParties: boolean;
  openCalls?: number;
} {
  const role = request.staff?.role ?? null;
  return {
    csrf: csrfFrom(request),
    mayFile: can(role, 'documents.write'),
    mayReadParties: can(role, 'party.read'),
    openCalls: request.openCalls,
  };
}

export function registerPartyDirectoryRoutes(
  app: FastifyInstance,
  deps: { pool: Pool },
): void {
  const READ = { config: { staff: 'party.read' } } as const;

  app.get('/parties', READ, async (request, reply) => {
    html(reply);
    const raw = asked(request.query);
    const rows = await searchParties(deps.pool, directoryQuery(raw));
    return renderPartyDirectory({
      ...screenOf(request),
      query: raw.trim().slice(0, QUERY_MAX),
      rows,
    });
  });

  app.get<{ Params: { partyId: string } }>(
    '/parties/:partyId',
    READ,
    async (request, reply) => {
      html(reply);
      const profile = await readPartyProfile(
        deps.pool,
        validId(request.params.partyId, 'party'),
      );
      if (!profile) throw new KernelError('not_found', 'route not found');
      return renderPartyProfile({ ...screenOf(request), profile });
    },
  );
}
