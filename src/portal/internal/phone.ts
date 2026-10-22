// An Israeli mobile, and nothing else. The prefix on the screen is +972, so the field is the
// national number and a person types 50-000-0000 rather than 050. Landlines and every other
// country stop here, before a code exists.
import { KernelError } from '../../kernel/errors.ts';
import { normalisePhone } from '../../scope/contract.ts';

const NATIONAL_WITHOUT_TRUNK = /^5\d{8}$/;
const ISRAELI_MOBILE = /^\+9725\d{8}$/;
const SEPARATORS = /[\s\-().‎‏‪-‮⁦-⁩]/g;

export function israeliMobile(input: string): string | null {
  if (typeof input !== 'string') return null;
  const compact = input.replace(SEPARATORS, '');
  const typed = NATIONAL_WITHOUT_TRUNK.test(compact) ? `0${compact}` : input;
  try {
    const e164 = normalisePhone(typed);
    return ISRAELI_MOBILE.test(e164) ? e164 : null;
  } catch (error) {
    if (error instanceof KernelError) return null;
    throw error;
  }
}

/** 050-000-0000, the shape a person dials, from the E.164 the row stores. */
export function nationalDisplay(e164: string): string {
  const national = `0${e164.slice(4)}`;
  return `${national.slice(0, 3)}-${national.slice(3, 6)}-${national.slice(6)}`;
}
