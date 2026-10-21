// The word a tenant sees. SPEC-calls, derived on read, never stored. A state
// the table does not name is in progress, so the internal name stays inside.

export type TenantStatus =
  | 'received'
  | 'handling'
  | 'waiting'
  | 'visit'
  | 'answered'
  | 'forwarded'
  | 'merged'
  | 'cancelled';

const NAMED: Record<string, TenantStatus> = {
  NEW: 'received',
  IDENTIFIED: 'received',
  TRIAGED: 'handling',
  RESPONSIBILITY_SET: 'handling',
  WINDOWS_COLLECTED: 'waiting',
  OFFERED: 'waiting',
  SCHEDULED: 'visit',
};

const EXIT: Record<string, TenantStatus> = {
  ANSWERED: 'answered',
  FORWARDED: 'forwarded',
  DUPLICATE: 'merged',
  CANCELLED: 'cancelled',
};

export function tenantStatus(
  state: string,
  exitKind: string | null,
): TenantStatus {
  if (state === 'CLOSED') {
    if (exitKind === null) return 'handling';
    return EXIT[exitKind] ?? 'handling';
  }
  return NAMED[state] ?? 'handling';
}
