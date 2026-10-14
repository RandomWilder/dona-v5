// What makes a phone or an email read off a lease approvable, and who already holds one. #235.
//
// Evidence may not import `src/scope/` (SPEC.md module map), and the rule is scope's: a number
// stored in one format and asked for in another resolves to nobody. So it is put together here, at
// the composition root, as `src/party-directory.ts` folds a contact typed on אנשי קשר (#206), and
// handed to evidence as `ContactRules`.
import { type ContactRules, NOT_A_MOBILE } from './evidence/contract.ts';
import { KernelError } from './kernel/errors.ts';
import {
  normaliseEmail,
  normalisePhone,
  partyHoldingContact,
} from './scope/contract.ts';

// An Israeli mobile number after `normalisePhone`: the country code, a 5, then eight digits.
const ISRAELI_MOBILE = /^\+9725[0-9]{8}$/;

export const contactRules: ContactRules = {
  normalise(channel, value) {
    if (channel === 'EMAIL') return normaliseEmail(value);
    let phone: string;
    try {
      phone = normalisePhone(value);
    } catch {
      throw new KernelError('invalid', NOT_A_MOBILE);
    }
    if (!ISRAELI_MOBILE.test(phone)) {
      throw new KernelError('invalid', NOT_A_MOBILE);
    }
    return phone;
  },
  // Scope's own separators and rule decide: a value that is not a mobile number as read, and is
  // one with a 0 in front, was read without its trunk prefix.
  offer(channel, value) {
    if (channel === 'EMAIL') return value;
    const mobile = (candidate: string) => {
      try {
        return ISRAELI_MOBILE.test(normalisePhone(candidate));
      } catch {
        return false;
      }
    };
    const trimmed = value.trim();
    return !mobile(trimmed) && mobile(`0${trimmed}`) ? `0${trimmed}` : value;
  },
  holder: (db, spec) => partyHoldingContact(db, spec),
};
