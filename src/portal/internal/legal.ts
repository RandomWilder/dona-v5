// The texts a tenant is shown, and the record that they read the current one.
// A version is a row. The request sees the newest row whose time is not in the
// future of the injected clock. Opt-ins are the same catalogue and stay off
// until this identity turns one on.

import type { Pool } from 'pg';
import type { Clock } from '../../kernel/clock.ts';
import { newId } from '../../kernel/ids.ts';

export const PORTAL_LANGUAGE = 'he';

const OPT_IN_KEY = /^[a-z0-9_]{1,40}$/;

export interface NoticeText {
  id: string;
  title: string;
  summary: string;
  body: string;
}

export interface NoticeOptIn {
  key: string;
  title: string;
  summary: string;
  on: boolean;
}

export interface NoticeScreen {
  due: boolean;
  privacy: NoticeText;
  terms: NoticeText;
  optIns: NoticeOptIn[];
}

interface CurrentRow {
  legal_text_id: string;
  kind: string;
  opt_in_key: string;
  title: string;
  summary: string;
  body: string;
  acknowledged: boolean;
  enabled: boolean;
}

async function current(
  pool: Pool,
  identityId: string,
  now: Date,
): Promise<CurrentRow[]> {
  const { rows } = await pool.query<CurrentRow>(
    `SELECT DISTINCT ON (t.kind, t.opt_in_key)
            t.legal_text_id, t.kind, t.opt_in_key, t.title, t.summary, t.body,
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
      WHERE t.language = $1
        AND t.created_at <= $3
      ORDER BY t.kind, t.opt_in_key, t.version DESC`,
    [PORTAL_LANGUAGE, identityId, now],
  );
  return rows;
}

function textOf(rows: CurrentRow[], kind: string): NoticeText | null {
  const row = rows.find((item) => item.kind === kind);
  if (row === undefined) return null;
  return {
    id: row.legal_text_id,
    title: row.title,
    summary: row.summary,
    body: row.body,
  };
}

export async function loadNotice(
  pool: Pool,
  identityId: string,
  now: Date,
): Promise<NoticeScreen | null> {
  const rows = await current(pool, identityId, now);
  const privacy = textOf(rows, 'privacy');
  const terms = textOf(rows, 'terms');
  if (privacy === null || terms === null) return null;
  return {
    due:
      !rows.some(
        (item) =>
          item.kind === 'privacy' &&
          item.legal_text_id === privacy.id &&
          item.acknowledged,
      ) ||
      !rows.some(
        (item) =>
          item.kind === 'terms' &&
          item.legal_text_id === terms.id &&
          item.acknowledged,
      ),
    privacy,
    terms,
    optIns: rows
      .filter(
        (item) => item.kind === 'opt_in' && OPT_IN_KEY.test(item.opt_in_key),
      )
      .map((item) => ({
        key: item.opt_in_key,
        title: item.title,
        summary: item.summary,
        on: item.enabled,
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
): Promise<boolean> {
  const { rows } = await pool.query<{ legal_text_id: string; kind: string }>(
    `SELECT legal_text_id, kind
       FROM portal_legal_text
      WHERE legal_text_id = ANY($1::uuid[])
        AND language = $2
        AND kind IN ('privacy', 'terms')`,
    [[shown.privacyId, shown.termsId], PORTAL_LANGUAGE],
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
  const texts = await current(pool, identityId, now);
  for (const row of texts) {
    if (row.kind !== 'opt_in' || !OPT_IN_KEY.test(row.opt_in_key)) continue;
    await pool.query(
      `INSERT INTO portal_opt_in
         (portal_identity_id, opt_in_key, enabled, updated_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (portal_identity_id, opt_in_key)
       DO UPDATE SET enabled = EXCLUDED.enabled, updated_at = EXCLUDED.updated_at`,
      [identityId, row.opt_in_key, enabled.has(row.opt_in_key), now],
    );
  }
  return true;
}
