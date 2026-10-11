// The conversion half of an email address, beside the phone one. #189.
//
// A contact saved from a call is stored already folded. The join folds the address it is asked, and
// compares that to the stored value. `Ada@House.test` and `ada@house.test` are one address. An
// empty string, or one with no `@`, is not an address: raising here keeps a scope of nothing for a
// real miss.
import { KernelError } from '../../kernel/errors.ts';

const EMAIL_MAX = 320;

export function normaliseEmail(address: string): string {
  const value = address.trim().toLowerCase();
  if (value.length === 0 || value.length > EMAIL_MAX || !value.includes('@')) {
    throw new KernelError('invalid', 'email is not an address', {
      field: 'email',
    });
  }
  return value;
}
