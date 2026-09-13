// Derived obligation status. Not a column — the workbook's E9 `status` is computed from dates
// plus whether evidence exists (SPEC-tenancy.md). The window is 60 days, matching the
// expiring-leases list, so two "soon" answers do not mean two different numbers.

export type ObligationStatus = 'SATISFIED' | 'EXPIRING' | 'EXPIRED' | 'MISSING';

export const OBLIGATION_EXPIRING_WINDOW_DAYS = 60;

export interface ObligationStatusInput {
  requiresEvidence: boolean;
  evidenceDocumentId: string | null;
  validTo: string | null;
  today: string;
}

function addUtcDays(isoDate: string, days: number): string {
  const t = Date.parse(`${isoDate}T00:00:00.000Z`);
  return new Date(t + days * 86_400_000).toISOString().slice(0, 10);
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
    input.validTo <= addUtcDays(input.today, OBLIGATION_EXPIRING_WINDOW_DAYS)
  ) {
    return 'EXPIRING';
  }
  return 'SATISFIED';
}

export function utcDay(at: Date): string {
  return at.toISOString().slice(0, 10);
}
