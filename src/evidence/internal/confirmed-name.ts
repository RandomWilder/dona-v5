// #200. The extraction of a household name stays one string. The human confirms a given name
// and a family name. The stored confirmation keeps both, so a family name of more than one
// word is not split again on the way into the party.
import { requireText } from '../../kernel/validate.ts';

/** Between the given name and the family name in a confirmed value. Not a character a name uses. */
const SPLIT = '\u001f';

export const HOUSEHOLD_NAME_FIELDS: ReadonlySet<string> = new Set([
  'main_tenant_name',
  'second_tenant_name',
  'tenant_name',
  'guarantor_name',
]);

/**
 * The proposal on the confirmation screen. The first word is the given name and the remainder
 * is the family name, so "דנה בן דוד" proposes family "בן דוד". One word is a family name alone.
 * This is not what gets stored: the human can replace either field.
 */
export function proposeNameSplit(extracted: string): {
  givenName: string;
  familyName: string;
} {
  const trimmed = extracted.trim();
  const at = trimmed.indexOf(' ');
  if (at === -1) {
    return { givenName: '', familyName: trimmed };
  }
  return {
    givenName: trimmed.slice(0, at),
    familyName: trimmed.slice(at + 1).trim(),
  };
}

/** What the party is written from. A confirmed value keeps the boundary the human set. */
export function readConfirmedName(stored: string): {
  givenName: string | null;
  familyName: string;
} {
  const at = stored.indexOf(SPLIT);
  if (at === -1) {
    const proposed = proposeNameSplit(stored);
    return {
      givenName: proposed.givenName === '' ? null : proposed.givenName,
      familyName: proposed.familyName,
    };
  }
  const given = stored.slice(0, at).trim();
  return {
    givenName: given === '' ? null : given,
    familyName: stored.slice(at + 1).trim(),
  };
}

/** The name a screen shows. A confirmation that carries the boundary prints as a display name. */
export function displayConfirmedName(stored: string): string {
  if (!stored.includes(SPLIT)) return stored;
  const name = readConfirmedName(stored);
  return name.givenName === null
    ? name.familyName
    : `${name.givenName} ${name.familyName}`;
}

/**
 * The value stored on the extracted field when the human submitted the two fields.
 * The extraction's own column is not rewritten.
 */
export function storeConfirmedName(
  givenName: string,
  familyName: string,
): string {
  const family = requireText(familyName, 'family_name', 200);
  const given = givenName.trim();
  if (given === '') return `${SPLIT}${family}`;
  return `${requireText(given, 'given_name', 200)}${SPLIT}${family}`;
}

/**
 * The approved value a name form posted. Other fields keep posting one `approved_value`.
 * A name form posts `given_name` and `family_name` and no combined string.
 */
export function approvedNameFromForm(
  fields: Record<string, string | undefined>,
): string | undefined {
  if (fields.family_name === undefined && fields.given_name === undefined) {
    return fields.approved_value;
  }
  return storeConfirmedName(fields.given_name ?? '', fields.family_name ?? '');
}
