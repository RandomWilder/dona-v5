// E9 / E10 commands. Slice 5.7.
//
// upsertObligationType has no delete, here or on the contract. createObligation copies
// default_responsible_party onto the row and does not take an override.
import { type Clock, today as dayOf } from '../../kernel/clock.ts';
import { KernelError } from '../../kernel/errors.ts';
import { newId } from '../../kernel/ids.ts';
import { INSERTED, type UpsertResult } from '../../kernel/upsert.ts';
import { type ObligationStatus, obligationStatus } from './status.ts';
import type { Queryable } from './types.ts';

export type ResponsibleParty = 'TENANT' | 'OPERATOR';

export interface ObligationTypeSpec {
  code: string;
  labelHe: string;
  labelEn: string | null;
  defaultResponsibleParty: ResponsibleParty;
  requiresEvidence: boolean;
  isActive: boolean;
}

export interface ObligationTypeRow {
  obligationTypeId: string;
  code: string;
  labelHe: string;
  labelEn: string | null;
  defaultResponsibleParty: ResponsibleParty;
  requiresEvidence: boolean;
  isActive: boolean;
}

export interface ObligationSpec {
  tenancyId: string;
  obligationTypeId: string;
  validFrom: string | null;
  validTo: string | null;
  evidenceDocumentId: string | null;
}

export interface ObligationRow {
  obligationId: string;
  tenancyId: string;
  obligationTypeId: string;
  responsibleParty: ResponsibleParty;
  validFrom: string | null;
  validTo: string | null;
  evidenceDocumentId: string | null;
  status: ObligationStatus;
}

function pgCode(error: unknown): string | undefined {
  if (error !== null && typeof error === 'object' && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    return typeof code === 'string' ? code : undefined;
  }
  return undefined;
}

/**
 * Adds an obligation type, or updates the one holding this `code`.
 *
 * **There is no delete, here or on the contract.** A type is deactivated (`isActive: false`)
 * and never deleted: old obligations still point at it, and those are the records a dispute
 * reads. The trigger in `0026_obligation.sql` refuses the delete even with no children.
 */
export async function upsertObligationType(
  db: Queryable,
  spec: ObligationTypeSpec,
): Promise<UpsertResult> {
  const result = await db.query<{
    obligation_type_id: string;
    inserted: boolean;
  }>(
    `INSERT INTO obligation_type (
       obligation_type_id, code, label_he, label_en,
       default_responsible_party, requires_evidence, is_active
     ) VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (code) DO UPDATE
       SET label_he = EXCLUDED.label_he,
           label_en = EXCLUDED.label_en,
           default_responsible_party = EXCLUDED.default_responsible_party,
           requires_evidence = EXCLUDED.requires_evidence,
           is_active = EXCLUDED.is_active
     RETURNING obligation_type_id, ${INSERTED}`,
    [
      newId(),
      spec.code,
      spec.labelHe,
      spec.labelEn,
      spec.defaultResponsibleParty,
      spec.requiresEvidence,
      spec.isActive,
    ],
  );
  const row = result.rows[0];
  if (!row) {
    throw new KernelError('conflict', 'obligation type upsert returned no row');
  }
  return { id: row.obligation_type_id, inserted: row.inserted };
}

/**
 * The catalogue, including inactive rows. The settings screen is the reader (slice 5.8).
 * Filing an obligation still looks up by id; this list is for an administrator, not a tenant.
 */
export async function listObligationTypes(
  db: Queryable,
): Promise<ObligationTypeRow[]> {
  const result = await db.query<{
    obligation_type_id: string;
    code: string;
    label_he: string;
    label_en: string | null;
    default_responsible_party: ResponsibleParty;
    requires_evidence: boolean;
    is_active: boolean;
  }>(
    `SELECT obligation_type_id, code, label_he, label_en,
            default_responsible_party, requires_evidence, is_active
       FROM obligation_type
      ORDER BY code`,
  );
  return result.rows.map((row) => ({
    obligationTypeId: row.obligation_type_id,
    code: row.code,
    labelHe: row.label_he,
    labelEn: row.label_en,
    defaultResponsibleParty: row.default_responsible_party,
    requiresEvidence: row.requires_evidence,
    isActive: row.is_active,
  }));
}

/**
 * Creates one obligation. `responsible_party` is copied from the type and is not an input.
 */
export async function createObligation(
  db: Queryable,
  spec: ObligationSpec,
): Promise<{ id: string }> {
  const type = await db.query<{ default_responsible_party: ResponsibleParty }>(
    `SELECT default_responsible_party FROM obligation_type
      WHERE obligation_type_id = $1`,
    [spec.obligationTypeId],
  );
  const typeRow = type.rows[0];
  if (!typeRow) {
    throw new KernelError('not_found', 'obligation type not found');
  }
  const id = newId();
  try {
    await db.query(
      `INSERT INTO obligation (
         obligation_id, tenancy_id, obligation_type_id, responsible_party,
         valid_from, valid_to, evidence_document_id
       ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        id,
        spec.tenancyId,
        spec.obligationTypeId,
        typeRow.default_responsible_party,
        spec.validFrom,
        spec.validTo,
        spec.evidenceDocumentId,
      ],
    );
  } catch (error) {
    const code = pgCode(error);
    if (code === '23503') {
      throw new KernelError('not_found', 'tenancy or document not found');
    }
    if (code === '23514') {
      throw new KernelError('invalid', 'the obligation period is not ordered');
    }
    throw error;
  }
  return { id };
}

interface ObligationQueryRow {
  obligation_id: string;
  tenancy_id: string;
  obligation_type_id: string;
  responsible_party: ResponsibleParty;
  valid_from: string | null;
  valid_to: string | null;
  evidence_document_id: string | null;
  requires_evidence: boolean;
}

function toRow(row: ObligationQueryRow, today: string): ObligationRow {
  return {
    obligationId: row.obligation_id,
    tenancyId: row.tenancy_id,
    obligationTypeId: row.obligation_type_id,
    responsibleParty: row.responsible_party,
    validFrom: row.valid_from,
    validTo: row.valid_to,
    evidenceDocumentId: row.evidence_document_id,
    status: obligationStatus({
      requiresEvidence: row.requires_evidence,
      evidenceDocumentId: row.evidence_document_id,
      validTo: row.valid_to,
      today,
    }),
  };
}

const SELECT_OBLIGATION = `
  SELECT o.obligation_id, o.tenancy_id, o.obligation_type_id, o.responsible_party,
         o.valid_from::text, o.valid_to::text, o.evidence_document_id, t.requires_evidence
    FROM obligation o
    JOIN obligation_type t ON t.obligation_type_id = o.obligation_type_id`;

export async function getObligation(
  db: Queryable,
  obligationId: string,
  clock: Clock,
): Promise<ObligationRow | null> {
  const result = await db.query<ObligationQueryRow>(
    `${SELECT_OBLIGATION} WHERE o.obligation_id = $1`,
    [obligationId],
  );
  const row = result.rows[0];
  if (!row) return null;
  return toRow(row, dayOf(clock));
}

export async function listObligationsForTenancy(
  db: Queryable,
  tenancyId: string,
  clock: Clock,
): Promise<ObligationRow[]> {
  const result = await db.query<ObligationQueryRow>(
    `${SELECT_OBLIGATION} WHERE o.tenancy_id = $1 ORDER BY o.obligation_id`,
    [tenancyId],
  );
  const today = dayOf(clock);
  return result.rows.map((row) => toRow(row, today));
}

export interface ObligationTypeCatalogueReport {
  types: { created: number; updated: number };
}

export async function applyObligationTypeCatalogue(
  db: Queryable,
  catalogue: ObligationTypeSpec[],
): Promise<ObligationTypeCatalogueReport> {
  const report: ObligationTypeCatalogueReport = {
    types: { created: 0, updated: 0 },
  };
  for (const spec of catalogue) {
    const result = await upsertObligationType(db, spec);
    if (result.inserted) report.types.created += 1;
    else report.types.updated += 1;
  }
  return report;
}
