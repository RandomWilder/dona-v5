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
    };

export interface ActivationGate {
  checks: ActivationCheck[];
  canActivate: boolean;
  activatableOn: string | null;
  /** Confirmed handover date, when the letting holds an approved protocol that named one. */
  handoverDate: string | null;
  flags: ActivationFlag[];
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
    flags: outside ? [...lapsed, outside] : lapsed,
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
