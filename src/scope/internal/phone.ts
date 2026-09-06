// E.164 normalisation at the edge. Slice 2.3, and the conversion half of a pair whose storage half
// landed at 2.1 as `phone_is_e164` on party_contact.
//
// The workbook's note on PartyContact.value: "One format, always. Mixed formats break the inbound
// lookup silently." Silently is the operative word. A number stored as +972521234567 and asked for
// as 052-123-4567 resolves to nobody, and a scope of nothing is exactly what correct isolation looks
// like — nothing on any screen is wrong, the tenant is simply not recognised. That is why the
// database rejects a badly-formatted number rather than storing it, and why the conversion lives
// here rather than being left to each caller.
//
// Written rather than installed. libphonenumber is the right answer for a product parsing numbers
// from many countries with carrier-specific rules; this parses one default region and the whole rule
// is that an Israeli national number drops its leading zero. AGENTS.md asks for a stated reason
// before a runtime dependency, and "one country's leading zero" is not one.
import { KernelError } from '../../kernel/errors.ts';

// The same expression 0006_parties.sql's `phone_is_e164` CHECK holds, and src/scope/phone.test.ts
// asserts they are still the same string. The edge must not accept what the database will reject:
// the two halves drifting is how a validated input becomes a 23514 in the importer at 3am.
export const E164_PATTERN = /^\+[1-9][0-9]{7,14}$/;

// Where a number with no country on it is assumed to be from. One region, stated once.
const DEFAULT_COUNTRY_CODE = '972';

// What a person or an export puts between the digits, plus the direction marks an RTL interface
// wraps a number in when it is copied off a screen. The marks are invisible, so without this they
// reach the CHECK as characters and the row is rejected for a reason nobody can see.
const SEPARATORS = /[\s\-().‎‏‪-‮⁦-⁩]/g;

const DIGITS_ONLY = /^[0-9]+$/;

function invalid(): never {
  // The message names the shape and never the value: SPEC.md's "PII never in logs", and an error
  // message is a log line the moment anything catches it.
  throw new KernelError('invalid', 'phone is not a valid E.164 number');
}

/**
 * Turns what a register, a webhook or a person typed into the one format the database stores.
 *
 * Accepts an already-international number as it stands, `00` as the international prefix, a national
 * number with its leading zero, and a bare number that already carries the default country code.
 * Everything else raises `invalid` rather than guessing.
 */
export function normalisePhone(input: string): string {
  if (typeof input !== 'string') {
    throw new KernelError('invalid', 'phone is required');
  }
  const stripped = input.replace(SEPARATORS, '');

  let candidate: string;
  if (stripped.startsWith('+')) {
    candidate = stripped;
  } else if (stripped.startsWith('00')) {
    // The international prefix as dialled from most of the world.
    candidate = `+${stripped.slice(2)}`;
  } else if (stripped.startsWith('0')) {
    // A national number. The leading zero is a trunk prefix and is not part of the number.
    candidate = `+${DEFAULT_COUNTRY_CODE}${stripped.slice(1)}`;
  } else if (stripped.startsWith(DEFAULT_COUNTRY_CODE)) {
    candidate = `+${stripped}`;
  } else {
    // **Deliberately not "assume the default region".** 521234567 is nine digits that would pass the
    // E.164 shape as +521234567, which is a Mexican subscriber. A register row silently becoming a
    // different country's number is worse than a row rejected with its line number, which is what
    // slice 2.4's importer will do with this.
    return invalid();
  }

  if (!DIGITS_ONLY.test(candidate.slice(1))) return invalid();
  // +972 followed by a leading zero: a national number concatenated onto a country code, which is
  // the most common way a phone column is wrongly internationalised. It satisfies E.164's shape and
  // matches nothing, ever, so it is the one case worth naming beyond the pattern.
  if (candidate.startsWith(`+${DEFAULT_COUNTRY_CODE}0`)) return invalid();
  if (!E164_PATTERN.test(candidate)) return invalid();
  return candidate;
}
