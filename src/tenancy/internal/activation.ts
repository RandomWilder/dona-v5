// A5 — the activation gate and the person command that spends it. #106.
//
// Evidence-side facts arrive through an injected reader. This file imports no evidence module.
import { type Clock, today as dayOf } from '../../kernel/clock.ts';
import { KernelError } from '../../kernel/errors.ts';
import { newId } from '../../kernel/ids.ts';
import { requireText } from '../../kernel/validate.ts';
import type { Queryable } from './types.ts';

export const REQUIRED_FOR_ACTIVATION = ['lease', 'handover_protocol'] as const;

export type RequiredActivationDocument =
  (typeof REQUIRED_FOR_ACTIVATION)[number];

export interface TenancyDocumentFact {
  typeKey: string;
  approved: boolean;
  validTo: string | null;
}

export type TenancyDocumentsReader = (
  db: Queryable,
  tenancyId: string,
) => Promise<TenancyDocumentFact[]>;

export interface ActivationCheck {
  rule: RequiredActivationDocument | 'start_reached' | 'within_term';
  passed: boolean;
}

export interface ActivationFlag {
  rule: 'lapsed_document';
  typeKey: string;
}

export interface ActivationGate {
  checks: ActivationCheck[];
  canActivate: boolean;
  activatableOn: string | null;
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
    start_date: string;
    end_date: string;
  }>(
    `SELECT status, start_date::text AS start_date, end_date::text AS end_date
       FROM tenancy WHERE tenancy_id = $1`,
    [tenancyId],
  );
  const row = current.rows[0];
  if (!row) {
    throw new KernelError('not_found', 'tenancy not found');
  }
  const today = dayOf(clock);
  const facts = await documents(db, tenancyId);
  const checks: ActivationCheck[] = REQUIRED_FOR_ACTIVATION.map((typeKey) => ({
    rule: typeKey,
    passed: held(facts, typeKey) !== undefined,
  }));
  const startReached = today >= row.start_date;
  const withinTerm = today <= row.end_date;
  checks.push({ rule: 'start_reached', passed: startReached });
  checks.push({ rule: 'within_term', passed: withinTerm });
  const documentsPass = REQUIRED_FOR_ACTIVATION.every(
    (typeKey) => checks.find((check) => check.rule === typeKey)?.passed,
  );
  const flags: ActivationFlag[] =
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
  return {
    checks,
    canActivate:
      row.status === 'DRAFT' && checks.every((check) => check.passed),
    activatableOn:
      row.status === 'DRAFT' && documentsPass && withinTerm && !startReached
        ? row.start_date
        : null,
    flags,
  };
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
