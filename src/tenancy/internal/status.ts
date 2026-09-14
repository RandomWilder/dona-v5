// Derived obligation status. Not a column — the workbook's E9 `status` is computed from dates
// plus whether evidence exists (SPEC-tenancy.md). The window is 60 days, matching the
// expiring-leases list, so two "soon" answers do not mean two different numbers.
//
// **`today` arrives as a date and is never derived here, from slice 7.2b.** This file held `utcDay`,
// which dated the state machine in UTC — so before 03:00 local an obligation read EXPIRED a day
// late, and rule 3 says this machine is inspectable and defensible in a dispute. The caller asks
// `today(clock)` in the office's zone; the window arithmetic is `addDays` in the kernel, which is
// the same six lines this file used to own and is genuinely zone-free: a date-only string anchored
// at midnight UTC has no instant in it to shift.

import { addDays } from '../../kernel/clock.ts';

export type ObligationStatus = 'SATISFIED' | 'EXPIRING' | 'EXPIRED' | 'MISSING';

export const OBLIGATION_EXPIRING_WINDOW_DAYS = 60;

export interface ObligationStatusInput {
  requiresEvidence: boolean;
  evidenceDocumentId: string | null;
  validTo: string | null;
  today: string;
}

export function obligationStatus(
  input: ObligationStatusInput,
): ObligationStatus {
  if (input.requiresEvidence && input.evidenceDocumentId === null) {
    return 'MISSING';
  }
  if (input.validTo !== null && input.validTo < input.today) {
    return 'EXPIRED';
  }
  if (
    input.validTo !== null &&
    input.validTo <= addDays(input.today, OBLIGATION_EXPIRING_WINDOW_DAYS)
  ) {
    return 'EXPIRING';
  }
  return 'SATISFIED';
}
