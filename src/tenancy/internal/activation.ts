// A5 — the activation gate and the person command that spends it. #106.
//
// Evidence-side facts arrive through an injected reader. This file imports no evidence module.
import { addDays, type Clock, today as dayOf } from '../../kernel/clock.ts';
import { KernelError } from '../../kernel/errors.ts';
import { newId } from '../../kernel/ids.ts';
import { requireText } from '../../kernel/validate.ts';
import type { Queryable } from './types.ts';

export const REQUIRED_FOR_ACTIVATION = ['lease', 'handover_protocol'] as const;

/** Keys a few weeks early are ordinary. A handover before the start minus this many days is a flag. */
export const EARLY_HANDOVER_DAYS = 30;

export type RequiredActivationDocument =
  (typeof REQUIRED_FOR_ACTIVATION)[number];

export interface TenancyDocumentFact {
  typeKey: string;
  approved: boolean;
  validTo: string | null;
  /** Set on an approved handover protocol, from A6's confirm. Absent otherwise. */
  handoverDate: string | null;
  /** Lease reading of the street address. Null when this fact is not a lease, or none was read. */
  addressRead?: string | null;
  /** Lease reading of the flat number. Null when this fact is not a lease, or none was read. */
  apartmentRead?: string | null;
}

export type TenancyDocumentsReader = (
  db: Queryable,
  tenancyId: string,
) => Promise<TenancyDocumentFact[]>;

export interface BlockingLetting {
  tenancyId: string;
  startDate: string;
  endDate: string;
}

/** #156. A named person waived the handover protocol for this one letting. */
export interface ProtocolWaiver {
  actor: string;
  at: Date;
  reason: string;
}

export type ActivationCheck =
  | {
      rule: 'lease' | 'start_reached' | 'within_term';
      passed: boolean;
    }
  | {
      rule: 'handover_protocol';
      passed: boolean;
      waived?: ProtocolWaiver;
    }
  | {
      rule: 'unit_free';
      passed: true;
    }
  | {
      rule: 'unit_free';
      passed: false;
      blocking: BlockingLetting;
    };

export type ActivationFlag =
  | {
      rule: 'lapsed_document';
      typeKey: string;
    }
  | {
      rule: 'handover_outside_term';
      handoverDate: string;
      /** `early` is before the start minus `EARLY_HANDOVER_DAYS`; `late` is after the end. */
      edge: 'early' | 'late';
    }
  | {
      /** The lease reading's address and flat do not fold to the unit's own. Not a check. #240. */
      rule: 'place_disagrees';
      addressRead: string;
      apartmentRead: string;
      addressLine: string;
      unitNumber: string;
    };

/** The cross-check's fold, injected so this module does not import evidence. #240. */
export interface PlaceFold {
  addressMatches(extracted: string, addressLine: string): boolean;
  apartmentMatches(extracted: string, unitNumber: string): boolean;
}

export interface ActivationGate {
  checks: ActivationCheck[];
  canActivate: boolean;
  activatableOn: string | null;
  /** Confirmed handover date, when the letting holds an approved protocol that named one. */
  handoverDate: string | null;
  flags: ActivationFlag[];
}

/** #162. A draft's book chip, read off the gate. Not a stored status. */
export type DraftLabel = 'ready' | 'waiting' | 'draft';

export function draftLabel(gate: {
  canActivate: boolean;
  checks: readonly { passed: boolean; rule: string }[];
}): DraftLabel {
  if (gate.canActivate) return 'ready';
  const open = gate.checks.filter((check) => !check.passed);
  if (open.length === 1 && open[0]?.rule === 'start_reached') return 'waiting';
  return 'draft';
}

export interface ActivateTenancySpec {
  tenancyId: string;
  actor: string;
}

function held(
  facts: readonly TenancyDocumentFact[],
  typeKey: string,
): TenancyDocumentFact | undefined {
  return facts.find((fact) => fact.typeKey === typeKey && fact.approved);
}

export async function activationGate(
  db: Queryable,
  clock: Clock,
  tenancyId: string,
  documents: TenancyDocumentsReader,
  place?: PlaceFold,
): Promise<ActivationGate> {
  const current = await db.query<{
    status: string;
    unit_id: string;
    start_date: string;
    end_date: string;
  }>(
    `SELECT status, unit_id, start_date::text AS start_date, end_date::text AS end_date
       FROM tenancy WHERE tenancy_id = $1`,
    [tenancyId],
  );
  const row = current.rows[0];
  if (!row) {
    throw new KernelError('not_found', 'tenancy not found');
  }
  const today = dayOf(clock);
  const facts = await documents(db, tenancyId);
  const waiver = await db.query<{
    actor: string;
    at: Date;
    reason: string;
  }>(
    `SELECT actor, at, reason
       FROM tenancy_completeness_exception
      WHERE tenancy_id = $1 AND rule = 'handover_protocol'`,
    [tenancyId],
  );
  const recorded = waiver.rows[0];
  const checks: ActivationCheck[] = REQUIRED_FOR_ACTIVATION.map((typeKey) => {
    const passed = held(facts, typeKey) !== undefined;
    if (typeKey === 'handover_protocol' && !passed && recorded) {
      return {
        rule: 'handover_protocol' as const,
        passed: true,
        waived: {
          actor: recorded.actor,
          at: recorded.at,
          reason: recorded.reason,
        },
      };
    }
    return { rule: typeKey, passed };
  });
  const startReached = today >= row.start_date;
  const withinTerm = today <= row.end_date;
  checks.push({ rule: 'start_reached', passed: startReached });
  checks.push({ rule: 'within_term', passed: withinTerm });
  const overlap = await db.query<{
    tenancy_id: string;
    start_date: string;
    end_date: string;
  }>(
    `SELECT tenancy_id, start_date::text AS start_date, end_date::text AS end_date
       FROM tenancy
      WHERE unit_id = $1
        AND status = 'ACTIVE'
        AND tenancy_id <> $2
        AND daterange(start_date, end_date, '[]') && daterange($3::date, $4::date, '[]')
      ORDER BY start_date
      LIMIT 1`,
    [row.unit_id, tenancyId, row.start_date, row.end_date],
  );
  const blocker = overlap.rows[0];
  checks.push(
    blocker
      ? {
          rule: 'unit_free',
          passed: false,
          blocking: {
            tenancyId: blocker.tenancy_id,
            startDate: blocker.start_date,
            endDate: blocker.end_date,
          },
        }
      : { rule: 'unit_free', passed: true },
  );
  const documentsPass = REQUIRED_FOR_ACTIVATION.every(
    (typeKey) => checks.find((check) => check.rule === typeKey)?.passed,
  );
  const lapsed: ActivationFlag[] =
    row.status === 'ACTIVE'
      ? REQUIRED_FOR_ACTIVATION.flatMap((typeKey) => {
          const fact = held(facts, typeKey);
          if (
            fact?.validTo !== null &&
            fact !== undefined &&
            fact.validTo < today
          ) {
            return [{ rule: 'lapsed_document' as const, typeKey }];
          }
          return [];
        })
      : [];
  const handoverDate = confirmedHandover(facts);
  const outside = handoverOutside(handoverDate, row.start_date, row.end_date);
  const located = await db.query<{
    unit_number: string;
    address_line: string;
  }>(
    `SELECT u.unit_number, b.address_line
       FROM unit u
       JOIN space s ON s.space_id = u.unit_id
       JOIN building b ON b.building_id = s.building_id
      WHERE u.unit_id = $1`,
    [row.unit_id],
  );
  const disagreed = placeDisagrees(facts, located.rows[0], place);
  const flags = [...lapsed];
  if (outside) flags.push(outside);
  if (disagreed) flags.push(disagreed);
  return {
    checks,
    canActivate:
      row.status === 'DRAFT' && checks.every((check) => check.passed),
    activatableOn:
      row.status === 'DRAFT' &&
      documentsPass &&
      withinTerm &&
      !blocker &&
      !startReached
        ? row.start_date
        : null,
    handoverDate,
    flags,
  };
}

function placeDisagrees(
  facts: readonly TenancyDocumentFact[],
  unit: { address_line: string; unit_number: string } | undefined,
  place: PlaceFold | undefined,
): ActivationFlag | null {
  if (!place || !unit) return null;
  const lease = facts.find((fact) => fact.typeKey === 'lease' && fact.approved);
  const addressRead = lease?.addressRead?.trim() ?? '';
  const apartmentRead = lease?.apartmentRead?.trim() ?? '';
  if (addressRead === '' || apartmentRead === '') return null;
  const addressFits = place.addressMatches(addressRead, unit.address_line);
  const apartmentFits = place.apartmentMatches(apartmentRead, unit.unit_number);
  if (addressFits && apartmentFits) return null;
  return {
    rule: 'place_disagrees',
    addressRead,
    apartmentRead,
    addressLine: unit.address_line,
    unitNumber: unit.unit_number,
  };
}

function confirmedHandover(
  facts: readonly TenancyDocumentFact[],
): string | null {
  const date = held(facts, 'handover_protocol')?.handoverDate;
  if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
  return null;
}

function handoverOutside(
  handoverDate: string | null,
  startDate: string,
  endDate: string,
): ActivationFlag | null {
  if (handoverDate === null) return null;
  if (handoverDate < addDays(startDate, -EARLY_HANDOVER_DAYS)) {
    return { rule: 'handover_outside_term', handoverDate, edge: 'early' };
  }
  if (handoverDate > endDate) {
    return { rule: 'handover_outside_term', handoverDate, edge: 'late' };
  }
  return null;
}

const EXCLUSION_VIOLATION = '23P01';

function pgCode(error: unknown): string | undefined {
  if (error !== null && typeof error === 'object' && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    return typeof code === 'string' ? code : undefined;
  }
  return undefined;
}

export async function activateTenancy(
  db: Queryable,
  clock: Clock,
  spec: ActivateTenancySpec,
  documents: TenancyDocumentsReader,
): Promise<void> {
  const actor = requireText(spec.actor, 'actor', 200);
  const gate = await activationGate(db, clock, spec.tenancyId, documents);
  if (!gate.canActivate) {
    throw new KernelError('invalid', 'this tenancy cannot be activated', {
      checks: gate.checks,
      activatableOn: gate.activatableOn,
    });
  }
  try {
    const updated = await db.query<{ tenancy_id: string }>(
      `UPDATE tenancy SET status = 'ACTIVE'
        WHERE tenancy_id = $1 AND status = 'DRAFT'
        RETURNING tenancy_id`,
      [spec.tenancyId],
    );
    if (!updated.rows[0]) {
      throw new KernelError('conflict', 'this tenancy cannot be activated');
    }
  } catch (error) {
    if (pgCode(error) === EXCLUSION_VIOLATION) {
      throw new KernelError(
        'conflict',
        'that unit already has an active tenancy on these dates',
      );
    }
    throw error;
  }
  await db.query(
    `INSERT INTO tenancy_event (
       tenancy_event_id, tenancy_id, at, actor, kind, field,
       old_value, new_value, source_document_id, extracted_field_id
     ) VALUES ($1, $2, $3, $4, 'activated', 'status',
               'DRAFT', 'ACTIVE', NULL, NULL)`,
    [newId(), spec.tenancyId, clock.now(), actor],
  );
}

// The queues and the tenancy book read their list, then each tenancy's gate on its own. A tenancy
// purged in between is not incomplete, not waiting and not a draft; it is gone, and the screen
// leaves it out rather than failing whole.
export async function gateOrGone(
  db: Queryable,
  clock: Clock,
  tenancyId: string,
  documents: TenancyDocumentsReader,
): Promise<ActivationGate | null> {
  try {
    return await activationGate(db, clock, tenancyId, documents);
  } catch (error) {
    if (error instanceof KernelError && error.code === 'not_found') return null;
    throw error;
  }
}
