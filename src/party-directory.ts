// The אנשי קשר tab. #202. Labels are composed here. #203. Contacts are edited here. #206.
// A party is created by hand here. #207. A company is marked a service provider here. #208.
//
// It lives beside `src/index-page.ts` and `src/settings-page.ts` because the profile is assembled
// here, at the composition root. Later tickets add a tenancy section, an estate section and a
// calls section on this page. Those reads stay on their own contracts. The parties module does
// not import them, and it does not learn that a page exists.
//
// The phone and the email are folded here, with the same normalisers the door uses, before the
// parties contract is asked. A second copy of either fold inside parties is the one that drifts.
//
// A label is the same kind of composition. Tenancy returns each role with the letting's status,
// dates and unit, and this file decides what that is today. "Current" is the isolation join's
// reading: the letting is ACTIVE and the clock's day falls inside the term, both ends inclusive.
// The query that fetched the roles does not state that, and neither does a column.

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Pool } from 'pg';
import { signedInChrome } from './chrome.ts';
import type { ProviderKind } from './estate/contract.ts';
import { linkProvider, listProvidersForParties } from './estate/contract.ts';
import { auditsForSubject, createAuditLog } from './kernel/audit.ts';
import { type Clock, dayIn, today } from './kernel/clock.ts';
import { inTransaction, type Queryable } from './kernel/db.ts';
import { KernelError } from './kernel/errors.ts';
import { type Html, h } from './kernel/ui/html.ts';
import { csrfInput, renderPage } from './kernel/ui/page.ts';
import { validId } from './kernel/validate.ts';
import type {
  DirectoryParty,
  DirectoryQuery,
  PartyProfile,
  ProfileContact,
} from './parties/contract.ts';
import {
  addPartyContact,
  closePartyContact,
  createPartyByHand,
  readPartyNationalId,
  readPartyProfile,
  searchParties,
  setPartyNationalId,
  setPrimaryPartyContact,
  updatePartyIdentity,
} from './parties/contract.ts';
import { normaliseEmail, normalisePhone } from './scope/contract.ts';
import { accountsByIds, can, csrfFrom } from './staff/contract.ts';
import type { PartyTenancyRole } from './tenancy/contract.ts';
import { listRolesForParties } from './tenancy/contract.ts';

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
  .party-search input,
  .party-search select,
  .party-id input,
  .party-contact-add input,
  .party-contacts input,
  .party-create input,
  .party-create select,
  .party-provider select {
    min-height: var(--size-control);
    padding-inline: var(--space-3);
    border: var(--size-hairline) solid var(--color-divider);
    border-radius: var(--radius-2);
    background: var(--color-surface-card);
    font: inherit;
  }
  .party-id { display: flex; flex-wrap: wrap; gap: var(--space-3); align-items: end; }
  .party-id label { display: grid; gap: var(--space-1); }
  .party-refusal { margin: 0; color: var(--color-alert); }
  .party-labels { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: var(--space-2); }
  a.chip { text-decoration: none; }
  .party-contacts { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--space-3); }
  .party-contacts li { display: flex; flex-wrap: wrap; gap: var(--space-2); align-items: baseline; }
  .party-contact-add { display: grid; gap: var(--space-3); max-inline-size: var(--size-form-max); }
  .party-create { display: grid; gap: var(--space-3); max-inline-size: var(--size-form-max); }
  .party-contact-add label,
  .party-contacts label,
  .party-create label,
  .party-provider label { display: grid; gap: var(--space-1); }
  .party-provider { display: grid; gap: var(--space-3); max-inline-size: var(--size-form-max); }
  .party-create .btn { justify-self: start; }
  .party-actions { display: flex; flex-wrap: wrap; gap: var(--space-2); margin: var(--space-3) 0 0; }
  .party-choice { display: flex; flex-wrap: wrap; gap: var(--space-4); border: 0; margin: 0; padding: 0; }
  .party-choice label { display: inline-flex; gap: var(--space-2); align-items: center; }
</style>`;

type TermState = 'current' | 'past' | 'draft';
type LabelFilter = TermState | 'guarantor' | 'provider' | 'none';

interface ShownLabel {
  kind: TermState | 'guarantor' | 'provider';
  text: string;
  tenancyId: string | null;
}

interface PartyLabels {
  labels: ShownLabel[];
  /** A tenancy role, or a service provider. Either one is not אין קשר. A role that has not started is neither. */
  holdsRole: boolean;
  /** Set when the party is a service provider. Absent on a screen that has none. */
  providerKind?: ProviderKind | null;
}

const NO_LABELS: PartyLabels = { labels: [], holdsRole: false };

export interface DirectoryScreen {
  csrf: string;
  mayFile: boolean;
  mayReadParties: boolean;
  mayReadNationalId?: boolean;
  mayWriteParty?: boolean;
  openCalls?: number;
  query: string;
  /** An administrator searched by ת.ז. The typed value is not on the page. */
  nationalIdSearch?: boolean;
  label: LabelFilter | null;
  rows: readonly (DirectoryParty & PartyLabels)[];
}

interface NationalIdConflict {
  partyId: string;
  fullName: string;
}

export interface ProfileScreen {
  csrf: string;
  mayFile: boolean;
  mayReadParties: boolean;
  mayReadNationalId?: boolean;
  mayWriteParty?: boolean;
  openCalls?: number;
  profile: PartyProfile;
  labels: PartyLabels;
  /** The stored value, this request only. Absent on the ordinary profile. */
  revealedNationalId?: string | null;
  nationalIdConflict?: NationalIdConflict | null;
  /** Why the last correction was refused. The row was not changed. */
  refusal?: string | null;
  history?: readonly ProfileHistory[];
  /** The clock's day. A contact date left blank means this day. */
  day?: string;
  /** The other party who already holds the number. Empty id: this party holds it. */
  contactHeld?: { partyId: string; fullName: string; open?: boolean } | null;
  contactRefusal?: string | null;
  contactDraft?: {
    channel: string;
    value: string;
    label: string;
    validFrom: string;
  };
  /** Why marking a service provider was refused. The provider row was not changed. */
  providerRefusal?: string | null;
}

interface ProfileHistory {
  who: string;
  when: string;
  what: readonly string[];
}

interface CreateDraft {
  kind: 'PERSON' | 'COMPANY';
  givenName: string;
  familyName: string;
  legalName: string;
  language: PartyProfile['language'];
  contact: string;
  identifier: string;
}

const LABEL_FILTERS: readonly LabelFilter[] = [
  'current',
  'past',
  'draft',
  'guarantor',
  'provider',
  'none',
];

const FILTER_HE: Record<LabelFilter, string> = {
  current: 'שוכר נוכחי',
  past: 'שוכר לשעבר',
  draft: 'טיוטת חוזה',
  guarantor: 'ערב',
  provider: 'ספק שירות',
  none: 'אין קשר',
};

const PROVIDER_KIND_HE: Record<ProviderKind, string> = {
  IN_HOUSE_CREW: 'צוות פנימי',
  CONTRACTOR: 'קבלן',
  DEVELOPER_WARRANTY: 'אחריות יזם',
};

const ROLE_HE: Record<string, string> = {
  PRIMARY_TENANT: 'שוכר ראשי',
  CO_TENANT: 'שוכר נוסף',
  OCCUPANT: 'דייר',
};

function asked(query: unknown): string {
  if (query === null || typeof query !== 'object') return '';
  const value = (query as { q?: unknown }).q;
  return typeof value === 'string' ? value : '';
}

function askedLabel(query: unknown): LabelFilter | null {
  if (query === null || typeof query !== 'object') return null;
  const value = (query as { label?: unknown }).label;
  if (typeof value !== 'string') return null;
  for (const known of LABEL_FILTERS) {
    if (value === known) return known;
  }
  return null;
}

/**
 * Whether this letting counts today.
 *
 * The isolation join's reading, applied to facts tenancy already returned:
 * ACTIVE, and the day falls inside the term, both ends inclusive. Not stated
 * as a query. A letting that is ACTIVE and has not started does not count.
 */
function countsToday(
  status: string,
  startDate: string,
  endDate: string,
  day: string,
): boolean {
  return status === 'ACTIVE' && startDate <= day && endDate >= day;
}

function termState(
  status: string,
  startDate: string,
  endDate: string,
  day: string,
): TermState | null {
  if (status === 'DRAFT') return 'draft';
  if (status === 'ENDED' || status === 'TERMINATED_EARLY') return 'past';
  if (countsToday(status, startDate, endDate, day)) return 'current';
  if (status === 'ACTIVE' && endDate < day) return 'past';
  return null;
}

function place(unitNumber: string): string {
  return `דירה ${unitNumber}`;
}

function guarantorText(state: TermState | null, unitNumber: string): string {
  const where = place(unitNumber);
  if (state === 'current') return `ערב · פעיל · ${where}`;
  if (state === 'draft') return `ערב · טיוטה · ${where}`;
  if (state === 'past') return `ערב · עבר · ${where}`;
  return `ערב · ${where}`;
}

function tenantText(
  state: TermState,
  role: string,
  unitNumber: string,
): string {
  const kind = FILTER_HE[state];
  const who = ROLE_HE[role] ?? role;
  return `${kind} · ${who} · ${place(unitNumber)}`;
}

function labelsFor(
  roles: readonly PartyTenancyRole[],
  day: string,
  providerKind: ProviderKind | null,
): PartyLabels {
  const labels: ShownLabel[] = [];
  for (const role of roles) {
    const state = termState(role.status, role.start_date, role.end_date, day);
    if (role.role === 'GUARANTOR') {
      labels.push({
        kind: 'guarantor',
        text: guarantorText(state, role.unit_number),
        tenancyId: role.tenancy_id,
      });
      continue;
    }
    if (state === null || ROLE_HE[role.role] === undefined) continue;
    labels.push({
      kind: state,
      text: tenantText(state, role.role, role.unit_number),
      tenancyId: role.tenancy_id,
    });
  }
  if (providerKind !== null) {
    labels.push({
      kind: 'provider',
      text: `ספק שירות · ${PROVIDER_KIND_HE[providerKind]}`,
      tenancyId: null,
    });
  }
  return {
    labels,
    holdsRole: roles.length > 0 || providerKind !== null,
    providerKind,
  };
}

function carries(filter: LabelFilter | null, labelled: PartyLabels): boolean {
  if (filter === null) return true;
  if (filter === 'none') return !labelled.holdsRole;
  return labelled.labels.some((label) => label.kind === filter);
}

async function labelsByParty(
  pool: Pool,
  clock: Clock,
  partyIds: readonly string[],
): Promise<Map<string, PartyLabels>> {
  const day = today(clock);
  const [roles, providers] = await Promise.all([
    listRolesForParties(pool, partyIds),
    listProvidersForParties(pool, partyIds),
  ]);
  const rolesOf = new Map<string, PartyTenancyRole[]>();
  for (const role of roles) {
    const list = rolesOf.get(role.party_id);
    if (list) list.push(role);
    else rolesOf.set(role.party_id, [role]);
  }
  const kindOf = new Map(providers.map((row) => [row.partyId, row.kind]));
  const byParty = new Map<string, PartyLabels>();
  for (const partyId of partyIds) {
    byParty.set(
      partyId,
      labelsFor(rolesOf.get(partyId) ?? [], day, kindOf.get(partyId) ?? null),
    );
  }
  return byParty;
}

/**
 * A ת.ז. probe: one to nine digits once separators are gone, and not a phone the door accepts.
 * The match itself is the database's fold. This only chooses which read to ask for.
 */
function isNationalIdProbe(query: string): boolean {
  return /^[0-9]{1,9}$/.test(query.replace(/[\s\-./]/g, ''));
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
  if (isNationalIdProbe(query)) return { kind: 'nationalId', value: query };
  return {
    kind: 'name',
    words: query.split(/\s+/).filter((word) => word.length > 0),
  };
}

function blank(value: string | null): Html {
  if (value === null || value === '') return h`—`;
  return h`<bdi dir="ltr">${value}</bdi>`;
}

function phoneCell(row: DirectoryParty): Html {
  const phone = blank(row.primaryPhone);
  if (!row.formerNumber) return phone;
  const mark =
    row.primaryPhone === null || row.primaryPhone === ''
      ? 'מספר לשעבר'
      : 'החיפוש הוא מספר לשעבר';
  return h`${phone} <span>${mark}</span>`;
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

function labelMarks(labelled: PartyLabels, linked: boolean): Html {
  if (!labelled.holdsRole) return h`<span>${FILTER_HE.none}</span>`;
  if (labelled.labels.length === 0) return h`—`;
  return h`<ul class="party-labels">
    ${labelled.labels.map((label) =>
      linked && label.tenancyId !== null
        ? h`<li><a class="chip" href="/estate/tenancies/${label.tenancyId}">${label.text}</a></li>`
        : h`<li><span class="chip">${label.text}</span></li>`,
    )}
  </ul>`;
}

function labelSelect(current: LabelFilter | null): Html {
  const options: { value: string; name: string }[] = [
    { value: '', name: 'הכל' },
    ...LABEL_FILTERS.map((filter) => ({
      value: filter,
      name: FILTER_HE[filter],
    })),
  ];
  return h`<label>תווית
    <select id="party-label" name="label">
      ${options.map((option) => {
        const selected =
          (option.value === '' && current === null) || option.value === current;
        return h`<option value="${option.value}"${selected ? h` selected` : h``}>${option.name}</option>`;
      })}
    </select>
  </label>`;
}

export function renderPartyDirectory(screen: DirectoryScreen): string {
  const quiet =
    screen.query === '' && screen.label === null
      ? 'אין אנשי קשר.'
      : 'אין התאמה.';
  const rows =
    screen.rows.length === 0
      ? h`<p class="lede">${quiet}</p>`
      : h`<div class="table-wrap">
          <table class="grid-table">
            <thead>
              <tr><th>שם</th><th>תווית</th><th>טלפון</th><th>דוא״ל</th><th>שפה</th></tr>
            </thead>
            <tbody>
              ${screen.rows.map(
                (row) => h`<tr>
                  <td><a href="/parties/${row.partyId}">${row.fullName}</a></td>
                  <td>${labelMarks(row, false)}</td>
                  <td>${phoneCell(row)}</td>
                  <td>${blank(row.primaryEmail)}</td>
                  <td>${LANGUAGE_HE[row.language]}</td>
                </tr>`,
              )}
            </tbody>
          </table>
        </div>`;
  const placeholder = screen.mayReadNationalId
    ? 'שם, טלפון, דוא״ל או ת.ז.'
    : 'שם, טלפון או דוא״ל';
  const searchedById = screen.nationalIdSearch
    ? h`<p class="lede">חיפוש לפי ת.ז.</p>`
    : h``;
  const create =
    screen.mayWriteParty === true
      ? h`<p class="party-actions">
          <a class="btn btn-primary" href="/parties/new?kind=person">אדם חדש</a>
          <a class="btn btn-secondary" href="/parties/new?kind=company">חברה חדשה</a>
        </p>`
      : h``;
  const body = h`<div class="glass-stage party-directory">
    <header class="page-head">
      <h1>אנשי קשר</h1>
      <p class="lede">כל מי שהמערכת מכירה.</p>
      ${create}
    </header>
    <form class="glass party-search" method="get" action="/parties">
      <label>חיפוש
        <input id="party-q" type="search" name="q" value="${screen.query}" placeholder="${placeholder}" autocomplete="off" maxlength="${QUERY_MAX}" />
      </label>
      ${labelSelect(screen.label)}
      <button class="btn" type="submit">חיפוש</button>
    </form>
    ${searchedById}
    <div class="glass">${rows}</div>
  </div>`;
  return renderPage({
    title: 'אנשי קשר — דונה דום',
    styles,
    nav: navOf(screen, 'parties'),
    body,
  });
}

function maskedSuffix(suffix: string): string {
  return `${'•'.repeat(5)}${suffix}`;
}

function nationalIdValue(screen: ProfileScreen): Html {
  const revealed = screen.revealedNationalId;
  if (typeof revealed === 'string' && revealed !== '') {
    return h`<bdi dir="ltr">${revealed}</bdi>`;
  }
  const suffix = screen.profile.nationalIdSuffix;
  if (suffix === null || suffix === '') return h`—`;
  return h`<bdi dir="ltr">${maskedSuffix(suffix)}</bdi>`;
}

function nationalIdControls(screen: ProfileScreen): Html {
  if (screen.mayReadNationalId !== true) return h``;
  const partyId = screen.profile.partyId;
  const reveal =
    screen.profile.nationalIdSuffix === null ||
    (typeof screen.revealedNationalId === 'string' &&
      screen.revealedNationalId !== '')
      ? h``
      : h`<form method="post" action="/parties/${partyId}/national-id/reveal">
          ${csrfInput(screen.csrf)}
          <button class="btn btn-secondary" type="submit">גילוי</button>
        </form>`;
  const clash = screen.nationalIdConflict;
  const refusal =
    clash === undefined || clash === null
      ? h``
      : clash.partyId === ''
        ? h`<p class="party-refusal">הת.ז. כבר רשומה על איש קשר אחר.</p>`
        : h`<p class="party-refusal">הת.ז. כבר רשומה על <a href="/parties/${clash.partyId}">${clash.fullName}</a>.</p>`;
  return h`${refusal}
    ${reveal}
    <form class="party-id" method="post" action="/parties/${partyId}/national-id">
      ${csrfInput(screen.csrf)}
      <label>ת.ז.
        <input name="identifier" autocomplete="off" maxlength="64" />
      </label>
      <button class="btn" type="submit">שמירה</button>
    </form>`;
}

function languageOptions(current: PartyProfile['language']): Html {
  return h`${(Object.keys(LANGUAGE_HE) as PartyProfile['language'][]).map(
    (code) =>
      h`<option value="${code}"${code === current ? h` selected` : h``}>${LANGUAGE_HE[code]}</option>`,
  )}`;
}

function identityForm(screen: ProfileScreen): Html {
  if (screen.mayWriteParty !== true) return h``;
  const profile = screen.profile;
  const partyId = profile.partyId;
  const refusal =
    screen.refusal === undefined ||
    screen.refusal === null ||
    screen.refusal === ''
      ? h``
      : h`<p class="party-refusal">${screen.refusal}</p>`;
  const names =
    profile.kind === 'COMPANY'
      ? h`<label>שם משפטי
          <input name="legal_name" value="${profile.legalName ?? ''}" autocomplete="off" maxlength="200" required />
        </label>`
      : h`<label>שם פרטי
          <input name="given_name" value="${profile.givenName ?? ''}" autocomplete="off" maxlength="200" placeholder="אפשר להשאיר ריק" />
        </label>
        <label>שם משפחה
          <input name="family_name" value="${profile.familyName ?? ''}" autocomplete="off" maxlength="200" required />
        </label>`;
  return h`${refusal}
    <form class="party-id" method="post" action="/parties/${partyId}">
      ${csrfInput(screen.csrf)}
      ${names}
      <label>שפה
        <select name="language">${languageOptions(profile.language)}</select>
      </label>
      <button class="btn" type="submit">שמירה</button>
    </form>`;
}

function identity(screen: ProfileScreen): Html {
  const profile = screen.profile;
  const language = h`<div><dt>שפה</dt><dd>${LANGUAGE_HE[profile.language]}</dd></div>`;
  const identifier = h`<div><dt>ת.ז.</dt><dd>${nationalIdValue(screen)}</dd></div>`;
  const form = identityForm(screen);
  if (profile.kind === 'COMPANY') {
    return h`<dl class="facts">
      <div><dt>שם משפטי</dt><dd>${profile.legalName ?? '—'}</dd></div>
      <div><dt>סוג</dt><dd>חברה</dd></div>
      ${language}
      ${identifier}
    </dl>
    ${form}
    ${nationalIdControls(screen)}`;
  }
  return h`<dl class="facts">
    <div><dt>שם פרטי</dt><dd>${profile.givenName ?? '—'}</dd></div>
    <div><dt>שם משפחה</dt><dd>${profile.familyName ?? '—'}</dd></div>
    <div><dt>סוג</dt><dd>אדם</dd></div>
    ${language}
    ${identifier}
  </dl>
  ${form}
  ${nationalIdControls(screen)}`;
}

const FIELD_HE: Record<string, string> = {
  given_name: 'שם פרטי',
  family_name: 'שם משפחה',
  legal_name: 'שם משפטי',
  preferred_language: 'שפה',
  national_id: 'ת.ז.',
};

function namedFields(inputs: Record<string, unknown>): string[] {
  const names: string[] = [];
  const listed = inputs.fields;
  if (Array.isArray(listed)) {
    for (const field of listed) {
      if (typeof field === 'string' && FIELD_HE[field] !== undefined) {
        names.push(FIELD_HE[field]);
      }
    }
  }
  const one = inputs.field;
  if (typeof one === 'string' && FIELD_HE[one] !== undefined) {
    names.push(FIELD_HE[one]);
  }
  return names;
}

function shownWhen(at: Date, zone: string): string {
  const time = new Intl.DateTimeFormat('en-GB', {
    timeZone: zone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(at);
  return `${dayIn(at, zone)} ${time}`;
}

function sameNameHint(profile: PartyProfile): Html {
  if (profile.sameName.length === 0) return h``;
  return h`<p class="party-same">עוד ${String(profile.sameName.length)} בשם זה
    ${profile.sameName.map(
      (other) => h`<a href="/parties/${other.partyId}">${other.fullName}</a>`,
    )}
  </p>`;
}

const CONTACT_ACTION_HE: Record<string, string> = {
  'parties.contact.add': 'הוספת קשר',
  'parties.contact.primary': 'קשר ראשי',
  'parties.contact.close': 'סגירת קשר',
};

const CHANNEL_HE: Record<string, string> = {
  PHONE: 'טלפון',
  EMAIL: 'דוא״ל',
};

function historyWhat(
  action: string,
  inputs: Record<string, unknown>,
): string[] {
  if (action === 'parties.create') {
    const channel =
      typeof inputs.channel === 'string'
        ? CHANNEL_HE[inputs.channel]
        : undefined;
    return channel === undefined ? ['יצירה'] : ['יצירה', channel];
  }
  if (action === 'estate.provider.link') {
    const kind = providerKindText(inputs.kind);
    return kind === undefined ? ['ספק שירות'] : ['ספק שירות', kind];
  }
  const contact = CONTACT_ACTION_HE[action];
  if (contact !== undefined) {
    const channel =
      typeof inputs.channel === 'string'
        ? CHANNEL_HE[inputs.channel]
        : undefined;
    return channel === undefined ? [contact] : [contact, channel];
  }
  return namedFields(inputs);
}

function historyList(rows: readonly ProfileHistory[]): Html {
  if (rows.length === 0) return h`<p class="lede">אין שינויים.</p>`;
  return h`<ul class="party-contacts">
    ${rows.map(
      (row) => h`<li>
        <span>${row.who}</span>
        <span dir="ltr">${row.when}</span>
        ${row.what.map((field) => h`<span>${field}</span>`)}
      </li>`,
    )}
  </ul>`;
}

function contactActions(screen: ProfileScreen, contact: ProfileContact): Html {
  const partyId = screen.profile.partyId;
  const primary = contact.isPrimary
    ? h``
    : h`<form method="post" action="/parties/${partyId}/contacts/${contact.contactId}/primary">
        ${csrfInput(screen.csrf)}
        <button class="btn btn-secondary" type="submit">סמן כראשי</button>
      </form>`;
  return h`${primary}
    <form method="post" action="/parties/${partyId}/contacts/${contact.contactId}/close">
      ${csrfInput(screen.csrf)}
      <label>נסגר ב־
        <input name="valid_to" type="date" value="${screen.day ?? ''}" />
      </label>
      <button class="btn btn-secondary" type="submit">סגירה</button>
    </form>`;
}

function addContact(screen: ProfileScreen): Html {
  if (screen.mayWriteParty !== true) return h``;
  const partyId = screen.profile.partyId;
  const draft = screen.contactDraft;
  const email = draft?.channel === 'EMAIL';
  const held = screen.contactHeld;
  const heldNote =
    held === undefined || held === null
      ? h``
      : held.partyId === ''
        ? h`<p class="party-refusal">המספר כבר רשום כאן.</p>`
        : h`<p class="party-refusal">${held.open === false ? 'המספר רשום על' : 'המספר פתוח אצל'} <a href="/parties/${held.partyId}">${held.fullName}</a>.</p>`;
  const refusal =
    screen.contactRefusal === undefined ||
    screen.contactRefusal === null ||
    screen.contactRefusal === ''
      ? h``
      : h`<p class="party-refusal">${screen.contactRefusal}</p>`;
  return h`<form class="party-contact-add" method="post" action="/parties/${partyId}/contacts">
    ${csrfInput(screen.csrf)}
    ${heldNote}
    ${refusal}
    <fieldset class="party-choice">
      <legend>ערוץ</legend>
      <label><input type="radio" name="channel" value="PHONE"${email ? h`` : h` checked`} /> טלפון</label>
      <label><input type="radio" name="channel" value="EMAIL"${email ? h` checked` : h``} /> דוא״ל</label>
    </fieldset>
    <label>מספר או כתובת
      <input name="value" value="${draft?.value ?? ''}" autocomplete="off" maxlength="320" required />
    </label>
    <label>תווית
      <input name="label" value="${draft?.label ?? ''}" placeholder="למשל יוסי – סדרן" autocomplete="off" />
    </label>
    <label>בתוקף מ־
      <input name="valid_from" type="date" value="${draft?.validFrom || screen.day || ''}" />
    </label>
    <button class="btn" type="submit">שמירה</button>
  </form>`;
}

function providerKindText(value: unknown): string | undefined {
  if (
    value === 'IN_HOUSE_CREW' ||
    value === 'CONTRACTOR' ||
    value === 'DEVELOPER_WARRANTY'
  ) {
    return PROVIDER_KIND_HE[value];
  }
  return undefined;
}

function providerSection(screen: ProfileScreen): Html {
  const refused =
    screen.providerRefusal !== undefined &&
    screen.providerRefusal !== null &&
    screen.providerRefusal !== '';
  const refusal = refused
    ? h`<p class="party-refusal">${screen.providerRefusal}</p>`
    : h``;
  if (screen.profile.kind !== 'COMPANY' || screen.mayWriteParty !== true) {
    if (!refused) return h``;
    return h`<section class="glass" id="provider">${refusal}</section>`;
  }
  const chosen = screen.labels.providerKind ?? null;
  const options = (Object.keys(PROVIDER_KIND_HE) as ProviderKind[]).map(
    (kind) => {
      const selected = kind === chosen;
      return h`<option value="${kind}"${selected ? h` selected` : h``}>${PROVIDER_KIND_HE[kind]}</option>`;
    },
  );
  return h`<section class="glass" id="provider">
    <h2>ספק שירות</h2>
    <form class="party-provider" method="post" action="/parties/${screen.profile.partyId}/provider">
      ${csrfInput(screen.csrf)}
      ${refusal}
      <label>סוג
        <select name="kind">${options}</select>
      </label>
      <button class="btn" type="submit">סימון</button>
    </form>
  </section>`;
}

function contacts(screen: ProfileScreen): Html {
  const rows = screen.profile.contacts;
  const writing = screen.mayWriteParty === true;
  const list =
    rows.length === 0
      ? h``
      : h`<ul class="party-contacts">
          ${rows.map(
            (contact) => h`<li>
              ${blank(contact.value)}
              ${contact.label ? h`<span>${contact.label}</span>` : h``}
              <span>${contact.validTo === null ? 'פתוח' : 'סגור'}</span>
              ${contact.isPrimary ? h`<span>ראשי</span>` : h``}
              <span dir="ltr">${dates(contact)}</span>
              ${writing && contact.validTo === null ? contactActions(screen, contact) : h``}
            </li>`,
          )}
        </ul>`;
  if (rows.length === 0 && !writing)
    return h`<p class="lede">אין פרטי קשר.</p>`;
  return h`${addContact(screen)}${list}`;
}

export function renderPartyProfile(screen: ProfileScreen): string {
  const { profile } = screen;
  const body = h`<div class="glass-stage party-directory">
    <header class="page-head">
      <p class="lede"><a class="back" href="/parties">אנשי קשר</a></p>
      <h1>${profile.fullName}</h1>
      ${sameNameHint(profile)}
    </header>
    <section class="glass">
      <h2>זהות</h2>
      ${identity(screen)}
    </section>
    <section class="glass">
      <h2>תוויות</h2>
      ${labelMarks(screen.labels, true)}
    </section>
    ${providerSection(screen)}
    <section class="glass">
      <h2>פרטי קשר</h2>
      ${contacts(screen)}
    </section>
    <section class="glass" id="party-history">
      <h2>היסטוריה</h2>
      ${historyList(screen.history ?? [])}
    </section>
  </div>`;
  return renderPage({
    title: `${profile.fullName} — אנשי קשר — דונה דום`,
    styles,
    nav: navOf(screen, 'parties'),
    body,
  });
}

function emptyDraft(kind: CreateDraft['kind']): CreateDraft {
  return {
    kind,
    givenName: '',
    familyName: '',
    legalName: '',
    language: 'he',
    contact: '',
    identifier: '',
  };
}

function createDraft(body: unknown): CreateDraft {
  const language = formField(body, 'language');
  const known = (Object.keys(LANGUAGE_HE) as PartyProfile['language'][]).find(
    (code) => code === language,
  );
  return {
    kind: formField(body, 'kind') === 'COMPANY' ? 'COMPANY' : 'PERSON',
    givenName: formField(body, 'given_name'),
    familyName: formField(body, 'family_name'),
    legalName: formField(body, 'legal_name'),
    language: known ?? 'he',
    contact: formField(body, 'contact'),
    identifier: formField(body, 'identifier'),
  };
}

function foldedContact(
  raw: string,
): { channel: 'PHONE' | 'EMAIL'; value: string } | null {
  const typed = raw.trim();
  if (typed === '') return null;
  try {
    return { channel: 'PHONE', value: normalisePhone(typed) };
  } catch (error) {
    if (!(error instanceof KernelError)) throw error;
  }
  try {
    return { channel: 'EMAIL', value: normaliseEmail(typed) };
  } catch (error) {
    if (!(error instanceof KernelError)) throw error;
  }
  throw new KernelError(
    'invalid',
    typed.includes('@')
      ? 'email is not an address'
      : 'phone is not a valid E.164 number',
  );
}

function createRefusal(error: KernelError): string {
  if (error.message === 'a party needs a contact or an identifier') {
    return 'אי אפשר ליצור איש קשר בלי פרטי קשר ובלי ת.ז.';
  }
  if (error.message.startsWith('family_name ')) return 'חסר שם משפחה.';
  if (error.message.startsWith('legal_name ')) return 'חסר שם משפטי.';
  if (error.message === 'a person has no legal name') {
    return 'לאדם אין שם משפטי.';
  }
  if (error.message === 'a company has a legal name and no person name') {
    return 'לחברה אין שם פרטי.';
  }
  if (error.message === 'preferred_language is not a known language') {
    return 'השפה אינה תקינה.';
  }
  if (error.message === 'kind is not a party kind') return 'הסוג אינו תקין.';
  return contactRefusal(error);
}

export function renderPartyCreate(screen: {
  csrf: string;
  mayFile: boolean;
  mayReadParties: boolean;
  mayReadNationalId?: boolean;
  openCalls?: number;
  draft: CreateDraft;
  refusal?: string | null;
  contactHeld?: { partyId: string; fullName: string; open?: boolean } | null;
  nationalIdConflict?: NationalIdConflict | null;
}): string {
  const { draft } = screen;
  const person = draft.kind === 'PERSON';
  const title = person ? 'אדם חדש' : 'חברה חדשה';
  const names = person
    ? h`<label>שם פרטי
        <input name="given_name" value="${draft.givenName}" autocomplete="off" maxlength="200" />
      </label>
      <label>שם משפחה
        <input name="family_name" value="${draft.familyName}" autocomplete="off" maxlength="200" required />
      </label>`
    : h`<label>שם משפטי
        <input name="legal_name" value="${draft.legalName}" autocomplete="off" maxlength="200" required />
      </label>`;
  const identifier =
    screen.mayReadNationalId === true
      ? h`<label>ת.ז.
          <input name="identifier" inputmode="numeric" autocomplete="off" maxlength="64" />
        </label>`
      : h``;
  const hint =
    screen.mayReadNationalId === true
      ? 'חובה פרטי קשר אחד, או ת.ז.'
      : 'חובה פרטי קשר אחד.';
  const refusal =
    screen.refusal === undefined ||
    screen.refusal === null ||
    screen.refusal === ''
      ? h``
      : h`<p class="party-refusal">${screen.refusal}</p>`;
  const held = screen.contactHeld;
  const heldNote =
    held === undefined || held === null
      ? h``
      : held.partyId === ''
        ? h`<p class="party-refusal">המספר כבר רשום כאן.</p>`
        : h`<p class="party-refusal">${held.open === false ? 'המספר רשום על' : 'המספר פתוח אצל'} <a href="/parties/${held.partyId}">${held.fullName}</a>.</p>`;
  const clash = screen.nationalIdConflict;
  const clashNote =
    clash === undefined || clash === null
      ? h``
      : clash.partyId === ''
        ? h`<p class="party-refusal">הת.ז. כבר רשומה על איש קשר אחר.</p>`
        : h`<p class="party-refusal">הת.ז. כבר רשומה על <a href="/parties/${clash.partyId}">${clash.fullName}</a>.</p>`;
  const body = h`<div class="glass-stage party-directory">
    <header class="page-head">
      <p class="lede"><a class="back" href="/parties">אנשי קשר</a></p>
      <h1>${title}</h1>
    </header>
    <form class="glass party-create" method="post" action="/parties">
      ${csrfInput(screen.csrf)}
      <input type="hidden" name="kind" value="${draft.kind}" />
      ${refusal}
      ${heldNote}
      ${clashNote}
      ${names}
      <label>שפה
        <select name="language">${languageOptions(draft.language)}</select>
      </label>
      <label>טלפון או דוא״ל
        <input name="contact" value="${draft.contact}" autocomplete="off" maxlength="320" />
      </label>
      ${identifier}
      <p class="lede">${hint}</p>
      <button class="btn" type="submit">יצירה</button>
    </form>
  </div>`;
  return renderPage({
    title: `${title} — אנשי קשר — דונה דום`,
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
  mayReadNationalId: boolean;
  mayWriteParty: boolean;
  openCalls?: number;
} {
  const role = request.staff?.role ?? null;
  return {
    csrf: csrfFrom(request),
    mayFile: can(role, 'documents.write'),
    mayReadParties: can(role, 'party.read'),
    mayReadNationalId: can(role, 'party.national_id.read'),
    mayWriteParty: can(role, 'party.write'),
    openCalls: request.openCalls,
  };
}

function formField(body: unknown, name: string): string {
  if (body === null || typeof body !== 'object') {
    throw new KernelError('invalid', 'that form carried no fields');
  }
  const value = (body as Record<string, unknown>)[name];
  return typeof value === 'string' ? value : '';
}

interface ContactDraft {
  channel: string;
  value: string;
  label: string;
  validFrom: string;
}

function contactDraft(body: unknown, day: string): ContactDraft {
  const from = formField(body, 'valid_from').trim();
  return {
    channel: formField(body, 'channel'),
    value: formField(body, 'value'),
    label: formField(body, 'label'),
    validFrom: from === '' ? day : from,
  };
}

function contactRefusal(error: KernelError): string {
  if (
    error.message === 'phone is not a valid E.164 number' ||
    error.message === 'phone is required'
  ) {
    return 'המספר אינו תקין.';
  }
  if (error.message === 'email is not an address') return 'הכתובת אינה תקינה.';
  if (error.message === 'channel is not a contact channel') {
    return 'הערוץ אינו תקין.';
  }
  if (error.message === 'the date is not a day') return 'התאריך אינו יום.';
  if (error.message === 'that contact cannot be closed') {
    return 'אי אפשר לסגור את הקשר.';
  }
  if (error.message === 'that contact cannot be primary') {
    return 'אי אפשר לסמן את הקשר כראשי.';
  }
  return 'אי אפשר לשמור את הקשר.';
}

function conflictOf(error: KernelError): NationalIdConflict | null {
  const partyId = error.details?.partyId;
  const fullName = error.details?.fullName;
  if (typeof partyId !== 'string' || typeof fullName !== 'string') return null;
  return { partyId, fullName };
}

async function audit(
  deps: { pool: Pool; clock: Clock },
  request: FastifyRequest,
  action: string,
  inputs: Record<string, unknown>,
  subjectId?: string,
): Promise<void> {
  await createAuditLog(deps.pool, deps.clock).write(
    {
      actorKind: 'staff',
      actorId: request.staff?.staffAccountId,
      actorRole: request.staff?.role ?? undefined,
      action,
      subjectId,
      inputs,
    },
    { outcome: 'ok' },
  );
}

export function registerPartyDirectoryRoutes(
  app: FastifyInstance,
  deps: { pool: Pool; clock: Clock },
): void {
  const READ = { config: { staff: 'party.read' } } as const;
  const WRITE = { config: { staff: 'party.write' } } as const;
  const IDENTIFIER = { config: { staff: 'party.national_id.read' } } as const;

  async function opened(
    request: FastifyRequest,
    partyId: string,
  ): Promise<ProfileScreen> {
    const profile = await readPartyProfile(deps.pool, partyId);
    if (!profile) throw new KernelError('not_found', 'route not found');
    const byParty = await labelsByParty(deps.pool, deps.clock, [
      profile.partyId,
    ]);
    const recorded = (
      await auditsForSubject(deps.pool, profile.partyId)
    ).filter(
      (row) =>
        row.action.startsWith('parties.') ||
        row.action === 'estate.provider.link',
    );
    const actors = await accountsByIds(
      deps.pool,
      recorded.flatMap((row) => (row.actorId === null ? [] : [row.actorId])),
    );
    const whoOf = new Map(
      actors.map((account) => [
        account.staffAccountId,
        account.displayName ?? account.email,
      ]),
    );
    const history = recorded.map((row) => {
      const what = historyWhat(row.action, row.inputs);
      return {
        who:
          (row.actorId !== null ? whoOf.get(row.actorId) : undefined) ??
          row.actorRole ??
          '—',
        when: shownWhen(row.at, deps.clock.zone),
        what,
      };
    });
    return {
      ...screenOf(request),
      profile,
      labels: byParty.get(profile.partyId) ?? NO_LABELS,
      history,
      day: today(deps.clock),
    };
  }

  app.get('/parties', READ, async (request, reply) => {
    html(reply);
    const raw = asked(request.query);
    const label = askedLabel(request.query);
    const parsed = directoryQuery(raw);
    if (
      parsed.kind === 'nationalId' &&
      !can(request.staff?.role ?? null, 'party.national_id.read')
    ) {
      throw new KernelError('not_allowed', 'not_allowed');
    }
    const found = await searchParties(deps.pool, parsed);
    if (parsed.kind === 'nationalId') {
      await audit(deps, request, 'parties.national_id.search', {
        partyIds: found.map((row) => row.partyId).sort(),
      });
    }
    const byParty = await labelsByParty(
      deps.pool,
      deps.clock,
      found.map((row) => row.partyId),
    );
    const rows = found.flatMap((row) => {
      const labels = byParty.get(row.partyId) ?? NO_LABELS;
      if (!carries(label, labels)) return [];
      return [{ ...row, ...labels }];
    });
    const byIdentifier = parsed.kind === 'nationalId';
    return renderPartyDirectory({
      ...screenOf(request),
      query: byIdentifier ? '' : raw.trim().slice(0, QUERY_MAX),
      nationalIdSearch: byIdentifier,
      label,
      rows,
    });
  });

  app.get('/parties/new', WRITE, async (request, reply) => {
    html(reply);
    const raw =
      request.query !== null && typeof request.query === 'object'
        ? (request.query as Record<string, unknown>).kind
        : '';
    const kind =
      raw === 'person' ? 'PERSON' : raw === 'company' ? 'COMPANY' : null;
    if (kind === null) throw new KernelError('not_found', 'route not found');
    return renderPartyCreate({
      ...screenOf(request),
      draft: emptyDraft(kind),
    });
  });

  app.post('/parties', WRITE, async (request, reply) => {
    const draft = createDraft(request.body);
    const identifier = draft.identifier.trim();
    if (
      identifier !== '' &&
      !can(request.staff?.role ?? null, 'party.national_id.read')
    ) {
      throw new KernelError('not_allowed', 'not_allowed');
    }
    try {
      const rawKind = formField(request.body, 'kind');
      if (rawKind !== 'PERSON' && rawKind !== 'COMPANY') {
        throw new KernelError('invalid', 'kind is not a party kind');
      }
      const contact = foldedContact(draft.contact);
      const partyId = await inTransaction(deps.pool, async (db) => {
        const created = await createPartyByHand(db, {
          kind: rawKind,
          givenName: draft.givenName,
          familyName: draft.familyName,
          legalName: draft.legalName,
          preferredLanguage: formField(request.body, 'language'),
          nationalId: identifier === '' ? null : identifier,
          contact:
            contact === null
              ? null
              : {
                  channel: contact.channel,
                  value: contact.value,
                  validFrom: today(deps.clock),
                },
        });
        await createAuditLog(db, deps.clock).write(
          {
            actorKind: 'staff',
            actorId: request.staff?.staffAccountId,
            actorRole: request.staff?.role ?? undefined,
            action: 'parties.create',
            subjectId: created.partyId,
            inputs: {
              partyId: created.partyId,
              ...(created.contact === null
                ? {}
                : { channel: created.contact.channel }),
            },
          },
          { outcome: 'ok' },
        );
        return created.partyId;
      });
      return reply.code(303).header('location', `/parties/${partyId}`).send();
    } catch (error) {
      if (!(error instanceof KernelError)) throw error;
      if (error.code !== 'invalid' && error.code !== 'conflict') throw error;
      html(reply);
      reply.code(error.code === 'conflict' ? 409 : 400);
      const other = conflictOf(error) ?? { partyId: '', fullName: '' };
      return renderPartyCreate({
        ...screenOf(request),
        draft,
        refusal: error.code === 'invalid' ? createRefusal(error) : null,
        contactHeld:
          error.message === 'that number is already held'
            ? { ...other, open: error.details?.open === true }
            : null,
        nationalIdConflict:
          error.message === 'that identifier is already held' ? other : null,
      });
    }
  });

  app.get<{ Params: { partyId: string } }>(
    '/parties/:partyId',
    READ,
    async (request, reply) => {
      html(reply);
      return renderPartyProfile(
        await opened(request, validId(request.params.partyId, 'party')),
      );
    },
  );

  app.post<{ Params: { partyId: string } }>(
    '/parties/:partyId',
    WRITE,
    async (request, reply) => {
      const partyId = validId(request.params.partyId, 'party');
      try {
        await inTransaction(deps.pool, async (db) => {
          const change = await updatePartyIdentity(db, {
            partyId,
            givenName: formField(request.body, 'given_name'),
            familyName: formField(request.body, 'family_name'),
            legalName: formField(request.body, 'legal_name'),
            preferredLanguage: formField(request.body, 'language'),
          });
          if (change.fields.length > 0) {
            await createAuditLog(db, deps.clock).write(
              {
                actorKind: 'staff',
                actorId: request.staff?.staffAccountId,
                actorRole: request.staff?.role ?? undefined,
                action: 'parties.identity.write',
                subjectId: partyId,
                inputs: { partyId, fields: change.fields },
              },
              { outcome: 'ok' },
            );
          }
        });
      } catch (error) {
        if (!(error instanceof KernelError) || error.code !== 'invalid') {
          throw error;
        }
        html(reply);
        reply.code(400);
        return renderPartyProfile({
          ...(await opened(request, partyId)),
          refusal: error.message,
        });
      }
      return reply.code(303).header('location', `/parties/${partyId}`).send();
    },
  );

  app.post<{ Params: { partyId: string } }>(
    '/parties/:partyId/national-id/reveal',
    IDENTIFIER,
    async (request, reply) => {
      const partyId = validId(request.params.partyId, 'party');
      const value = await readPartyNationalId(deps.pool, partyId);
      if (value !== null) {
        await audit(
          deps,
          request,
          'parties.national_id.reveal',
          { partyId },
          partyId,
        );
      }
      html(reply);
      return renderPartyProfile({
        ...(await opened(request, partyId)),
        revealedNationalId: value,
      });
    },
  );

  app.post<{ Params: { partyId: string } }>(
    '/parties/:partyId/national-id',
    IDENTIFIER,
    async (request, reply) => {
      const partyId = validId(request.params.partyId, 'party');
      try {
        await setPartyNationalId(
          deps.pool,
          partyId,
          formField(request.body, 'identifier'),
        );
      } catch (error) {
        if (error instanceof KernelError && error.code === 'conflict') {
          html(reply);
          reply.code(409);
          return renderPartyProfile({
            ...(await opened(request, partyId)),
            nationalIdConflict: conflictOf(error) ?? {
              partyId: '',
              fullName: '',
            },
          });
        }
        throw error;
      }
      await audit(
        deps,
        request,
        'parties.national_id.write',
        { partyId, field: 'national_id' },
        partyId,
      );
      return reply.code(303).header('location', `/parties/${partyId}`).send();
    },
  );

  async function contactFailed(
    error: unknown,
    request: FastifyRequest,
    reply: FastifyReply,
    partyId: string,
    draft?: ContactDraft,
  ): Promise<string> {
    if (!(error instanceof KernelError)) throw error;
    if (error.code !== 'conflict' && error.code !== 'invalid') throw error;
    html(reply);
    const screen = await opened(request, partyId);
    if (error.code === 'conflict') {
      reply.code(409);
      const heldId = error.details?.partyId;
      const fullName = error.details?.fullName;
      return renderPartyProfile({
        ...screen,
        contactHeld:
          typeof heldId === 'string' && typeof fullName === 'string'
            ? { partyId: heldId, fullName, open: error.details?.open === true }
            : { partyId: '', fullName: '' },
        contactDraft: draft,
      });
    }
    reply.code(400);
    return renderPartyProfile({
      ...screen,
      contactRefusal: contactRefusal(error),
      contactDraft: draft,
    });
  }

  async function recordContact(
    db: Queryable,
    request: FastifyRequest,
    action: string,
    partyId: string,
    contact: { contactId: string; channel: string },
  ): Promise<void> {
    await createAuditLog(db, deps.clock).write(
      {
        actorKind: 'staff',
        actorId: request.staff?.staffAccountId,
        actorRole: request.staff?.role ?? undefined,
        action,
        subjectId: partyId,
        inputs: {
          partyId,
          contactId: contact.contactId,
          channel: contact.channel,
        },
      },
      { outcome: 'ok' },
    );
  }

  app.post<{ Params: { partyId: string } }>(
    '/parties/:partyId/contacts',
    WRITE,
    async (request, reply) => {
      const partyId = validId(request.params.partyId, 'party');
      const day = today(deps.clock);
      const draft = contactDraft(request.body, day);
      try {
        if (draft.channel !== 'PHONE' && draft.channel !== 'EMAIL') {
          throw new KernelError('invalid', 'channel is not a contact channel');
        }
        const value =
          draft.channel === 'EMAIL'
            ? normaliseEmail(draft.value)
            : normalisePhone(draft.value);
        await inTransaction(deps.pool, async (db) => {
          const added = await addPartyContact(db, {
            partyId,
            channel: draft.channel,
            value,
            label: draft.label,
            validFrom: draft.validFrom,
          });
          await recordContact(
            db,
            request,
            'parties.contact.add',
            partyId,
            added,
          );
        });
      } catch (error) {
        return contactFailed(error, request, reply, partyId, draft);
      }
      return reply.code(303).header('location', `/parties/${partyId}`).send();
    },
  );

  app.post<{ Params: { partyId: string; contactId: string } }>(
    '/parties/:partyId/contacts/:contactId/primary',
    WRITE,
    async (request, reply) => {
      const partyId = validId(request.params.partyId, 'party');
      const contactId = validId(request.params.contactId, 'contact');
      try {
        await inTransaction(deps.pool, async (db) => {
          const marked = await setPrimaryPartyContact(db, {
            partyId,
            contactId,
          });
          await recordContact(
            db,
            request,
            'parties.contact.primary',
            partyId,
            marked,
          );
        });
      } catch (error) {
        return contactFailed(error, request, reply, partyId);
      }
      return reply.code(303).header('location', `/parties/${partyId}`).send();
    },
  );

  app.post<{ Params: { partyId: string; contactId: string } }>(
    '/parties/:partyId/contacts/:contactId/close',
    WRITE,
    async (request, reply) => {
      const partyId = validId(request.params.partyId, 'party');
      const contactId = validId(request.params.contactId, 'contact');
      const posted = formField(request.body, 'valid_to').trim();
      const validTo = posted === '' ? today(deps.clock) : posted;
      try {
        await inTransaction(deps.pool, async (db) => {
          const closed = await closePartyContact(db, {
            partyId,
            contactId,
            validTo,
          });
          await recordContact(
            db,
            request,
            'parties.contact.close',
            partyId,
            closed,
          );
        });
      } catch (error) {
        return contactFailed(error, request, reply, partyId);
      }
      return reply.code(303).header('location', `/parties/${partyId}`).send();
    },
  );

  app.post<{ Params: { partyId: string } }>(
    '/parties/:partyId/provider',
    WRITE,
    async (request, reply) => {
      const partyId = validId(request.params.partyId, 'party');
      const actorId = request.staff?.staffAccountId;
      if (actorId === undefined) {
        throw new KernelError('not_allowed', 'not_allowed');
      }
      try {
        await linkProvider(deps.pool, deps.clock, {
          partyId,
          kind: formField(request.body, 'kind'),
          actorId,
          actorRole: request.staff?.role ?? undefined,
        });
      } catch (error) {
        if (!(error instanceof KernelError)) throw error;
        if (error.code !== 'invalid' && error.code !== 'conflict') throw error;
        html(reply);
        reply.code(error.code === 'conflict' ? 409 : 400);
        const reason =
          error.message === 'a person is not a service provider'
            ? 'אדם אינו ספק שירות.'
            : error.message === 'a provider already has that name'
              ? 'כבר רשום ספק בשם זה.'
              : 'הסוג אינו תקין.';
        return renderPartyProfile({
          ...(await opened(request, partyId)),
          providerRefusal: reason,
        });
      }
      return reply.code(303).header('location', `/parties/${partyId}`).send();
    },
  );
}
