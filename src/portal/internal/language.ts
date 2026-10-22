// Which language a portal request is in. The rows live in the copy list. A later
// language is another set of those rows, and this function does not grow a branch.

import { portalLanguages } from './copy.ts';

/** The browser keeps the tenant's choice. It wins over the party record. */
export const PORTAL_LANG_COOKIE = 'dona_portal_lang';

const YEAR_SECONDS = 365 * 24 * 60 * 60;

export const PORTAL_LANG_MAX_AGE = YEAR_SECONDS;

/**
 * The choice, when it is one of the portal languages. Otherwise the party's
 * preferred language, when that is one of them. Otherwise Hebrew.
 */
export function startingLanguage(input: {
  chosen: string | null;
  preferred: string | null;
}): string {
  const known = new Set(portalLanguages());
  if (input.chosen !== null && known.has(input.chosen)) return input.chosen;
  if (input.preferred !== null && known.has(input.preferred)) {
    return input.preferred;
  }
  return 'he';
}

/** A path on this host. Anything else returns home, so the sheet cannot send the browser away. */
export function languageReturn(value: string): string {
  if (value.length === 0 || value.length > 200) return '/';
  if (!/^\/(?!\/)[A-Za-z0-9/_.?=&%-]*$/.test(value)) return '/';
  return value;
}
