// The texts a tenant is shown, and the record that they read the current one.
// A version is a row. The request sees the newest row whose time is not in the
// future of the injected clock. Opt-ins are the same catalogue and stay off
// until this identity turns one on.

import type { Pool } from 'pg';
import type { Clock } from '../../kernel/clock.ts';
import type { Queryable } from '../../kernel/db.ts';
import { newId } from '../../kernel/ids.ts';

export const FALLBACK_LANGUAGE = 'he';

const OPT_IN_KEY = /^[a-z0-9_]{1,40}$/;

export interface NoticeText {
  id: string;
  title: string;
  summary: string;
  body: string;
  /** True when this text is Hebrew because the chosen language has no row. */
  fallback: boolean;
}

export interface NoticeOptIn {
  key: string;
  title: string;
  summary: string;
  on: boolean;
  fallback: boolean;
}

export interface NoticeScreen {
  due: boolean;
  privacy: NoticeText;
  terms: NoticeText;
  optIns: NoticeOptIn[];
}

interface CurrentRow {
  legal_text_id: string;
  language: string;
  kind: string;
  opt_in_key: string;
  title: string;
  summary: string;
  body: string;
  acknowledged: boolean;
  enabled: boolean;
}

export function chooseShown<
  T extends { language: string; kind: string; opt_in_key: string },
>(rows: readonly T[], language: string): { row: T; fallback: boolean }[] {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const key = `${row.kind}\n${row.opt_in_key}`;
    const list = groups.get(key) ?? [];
    list.push(row);
    groups.set(key, list);
  }
  const chosen: { row: T; fallback: boolean }[] = [];
  for (const list of groups.values()) {
    const exact = list.find((row) => row.language === language);
    const hebrew = list.find((row) => row.language === FALLBACK_LANGUAGE);
    const row = exact ?? hebrew;
    if (row === undefined) continue;
    chosen.push({ row, fallback: row.language !== language });
  }
  return chosen;
}

async function current(
  pool: Pool,
  identityId: string,
  now: Date,
  language: string,
): Promise<CurrentRow[]> {
  const languages =
    language === FALLBACK_LANGUAGE ? [language] : [language, FALLBACK_LANGUAGE];
  const { rows } = await pool.query<CurrentRow>(
    `SELECT DISTINCT ON (t.language, t.kind, t.opt_in_key)
            t.legal_text_id, t.language, t.kind, t.opt_in_key, t.title, t.summary, t.body,
            (a.acknowledgement_id IS NOT NULL) AS acknowledged,
            COALESCE(o.enabled, false) AS enabled
       FROM portal_legal_text t
       LEFT JOIN portal_acknowledgement a
         ON a.legal_text_id = t.legal_text_id
        AND a.portal_identity_id = $2
       LEFT JOIN portal_opt_in o
         ON o.opt_in_key = t.opt_in_key
        AND t.kind = 'opt_in'
        AND o.portal_identity_id = $2
      WHERE t.language = ANY($1::text[])
        AND t.created_at <= $3
      ORDER BY t.language, t.kind, t.opt_in_key, t.version DESC`,
    [languages, identityId, now],
  );
  return rows;
}

function textOf(
  rows: { row: CurrentRow; fallback: boolean }[],
  kind: string,
): NoticeText | null {
  const found = rows.find((item) => item.row.kind === kind);
  if (found === undefined) return null;
  return {
    id: found.row.legal_text_id,
    title: found.row.title,
    summary: found.row.summary,
    body: found.row.body,
    fallback: found.fallback,
  };
}

export async function loadNotice(
  pool: Pool,
  identityId: string,
  now: Date,
  language: string,
): Promise<NoticeScreen | null> {
  const chosen = chooseShown(
    await current(pool, identityId, now, language),
    language,
  );
  const privacy = textOf(chosen, 'privacy');
  const terms = textOf(chosen, 'terms');
  if (privacy === null || terms === null) return null;
  return {
    due:
      !chosen.some(
        (item) =>
          item.row.kind === 'privacy' &&
          item.row.legal_text_id === privacy.id &&
          item.row.acknowledged,
      ) ||
      !chosen.some(
        (item) =>
          item.row.kind === 'terms' &&
          item.row.legal_text_id === terms.id &&
          item.row.acknowledged,
      ),
    privacy,
    terms,
    optIns: chosen
      .filter(
        (item) =>
          item.row.kind === 'opt_in' && OPT_IN_KEY.test(item.row.opt_in_key),
      )
      .map((item) => ({
        key: item.row.opt_in_key,
        title: item.row.title,
        summary: item.row.summary,
        on: item.row.enabled,
        fallback: item.fallback,
      })),
  };
}

export function chosenOptIns(
  body: unknown,
  keys: readonly string[],
): ReadonlySet<string> {
  const record =
    body !== null && typeof body === 'object'
      ? (body as Record<string, unknown>)
      : {};
  const chosen = new Set<string>();
  for (const key of keys) {
    if (!OPT_IN_KEY.test(key)) continue;
    const value = record[`opt_${key}`];
    if (typeof value === 'string' && value !== '') chosen.add(key);
  }
  return chosen;
}

const TEXT_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function shownTextId(body: unknown, name: string): string | null {
  if (body === null || typeof body !== 'object') return null;
  const value = (body as Record<string, unknown>)[name];
  return typeof value === 'string' && TEXT_ID.test(value) ? value : null;
}

export async function acknowledgeNotice(
  pool: Pool,
  clock: Clock,
  identityId: string,
  shown: { privacyId: string; termsId: string },
  enabled: ReadonlySet<string>,
  language: string,
): Promise<boolean> {
  const { rows } = await pool.query<{ legal_text_id: string; kind: string }>(
    `SELECT legal_text_id, kind
       FROM portal_legal_text
      WHERE legal_text_id = ANY($1::uuid[])
        AND kind IN ('privacy', 'terms')`,
    [[shown.privacyId, shown.termsId]],
  );
  const privacy = rows.find(
    (row) => row.legal_text_id === shown.privacyId && row.kind === 'privacy',
  );
  const terms = rows.find(
    (row) => row.legal_text_id === shown.termsId && row.kind === 'terms',
  );
  if (privacy === undefined || terms === undefined) return false;
  const now = clock.now();
  for (const row of [privacy, terms]) {
    await pool.query(
      `INSERT INTO portal_acknowledgement
         (acknowledgement_id, portal_identity_id, legal_text_id, acknowledged_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (portal_identity_id, legal_text_id) DO NOTHING`,
      [newId(clock), identityId, row.legal_text_id, now],
    );
  }
  const texts = chooseShown(
    await current(pool, identityId, now, language),
    language,
  );
  for (const item of texts) {
    if (item.row.kind !== 'opt_in' || !OPT_IN_KEY.test(item.row.opt_in_key)) {
      continue;
    }
    await pool.query(
      `INSERT INTO portal_opt_in
         (portal_identity_id, opt_in_key, enabled, updated_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (portal_identity_id, opt_in_key)
       DO UPDATE SET enabled = EXCLUDED.enabled, updated_at = EXCLUDED.updated_at`,
      [identityId, item.row.opt_in_key, enabled.has(item.row.opt_in_key), now],
    );
  }
  return true;
}

export interface PlaceholderText {
  title: string;
  language: string;
}

const LANGUAGE_ORDER = ['he', 'en', 'ru'];
const KIND_ORDER = ['privacy', 'terms', 'entry', 'opt_in'];

/**
 * The current texts that are still placeholders, in every portal language.
 * Current is the highest version at or before `now`, the same rule a tenant
 * request uses. An older placeholder does not count once a later version exists.
 */
export async function currentPlaceholderTexts(
  db: Queryable,
  now: Date,
): Promise<PlaceholderText[]> {
  const { rows } = await db.query<{
    title: string;
    language: string;
    kind: string;
    opt_in_key: string;
  }>(
    `SELECT title, language, kind, opt_in_key
       FROM (
         SELECT DISTINCT ON (language, kind, opt_in_key)
                title, language, kind, opt_in_key, placeholder
           FROM portal_legal_text
          WHERE created_at <= $1
          ORDER BY language, kind, opt_in_key, version DESC
       ) current
      WHERE placeholder`,
    [now],
  );
  return rows
    .sort((left, right) => {
      const byLanguage =
        LANGUAGE_ORDER.indexOf(left.language) -
        LANGUAGE_ORDER.indexOf(right.language);
      if (byLanguage !== 0) return byLanguage;
      const byKind =
        KIND_ORDER.indexOf(left.kind) - KIND_ORDER.indexOf(right.kind);
      if (byKind !== 0) return byKind;
      return left.opt_in_key.localeCompare(right.opt_in_key);
    })
    .map((row) => ({ title: row.title, language: row.language }));
}
