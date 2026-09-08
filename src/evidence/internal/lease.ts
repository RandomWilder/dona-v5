// Flow A2 (slice 4.6) and A3 (slice 4.7). Extracted fields propose a draft tenancy or an
// addendum onto an existing one; a human confirms roles.
//
// The confirm page recomputes from extracted_field plus the unit — no staging table. Capture is
// already immutable. Estate, parties and tenancy write through their contracts.
import type { Pool } from 'pg';
import { getUnit, type UnitHit } from '../../estate/contract.ts';
import type { AuditLog } from '../../kernel/audit.ts';
import type { Clock } from '../../kernel/clock.ts';
import { KernelError } from '../../kernel/errors.ts';
import { requireText, validId } from '../../kernel/validate.ts';
import { createParty } from '../../parties/contract.ts';
import {
  findTermsProfileByName,
  listTermsProfiles,
  type TenancyRole,
  upsertTenancy,
  upsertTenancyParty,
} from '../../tenancy/contract.ts';
import { getFiledDocument, linkDocument } from './documents.ts';
import { type ExtractedRow, listExtractedFields } from './extract.ts';
import { promoteExtractedField } from './promote.ts';
import type { Queryable } from './types.ts';

const ROLES: ReadonlySet<string> = new Set([
  'PRIMARY_TENANT',
  'CO_TENANT',
  'GUARANTOR',
  'OCCUPANT',
]);

export interface LeaseDeps {
  db: Queryable;
  audit: AuditLog;
  clock: Clock;
}

export interface ProposedPerson {
  extractedFieldId: string;
  fieldKey: 'tenant_name' | 'guarantor_name';
  value: string;
  proposedRole: TenancyRole;
}

export interface LeaseProposal {
  documentId: string;
  typeKey: 'lease' | 'lease_amendment';
  unit: UnitHit;
  startDate: string | null;
  endDate: string | null;
  apartmentNumber: string | null;
  address: string | null;
  people: ProposedPerson[];
  matchesUnit: boolean;
  alreadyEstablished: boolean;
  boundToTenancy: boolean;
  /** Existing annex names. Empty means confirm cannot write — never a default insert. */
  termsProfileNames: string[];
}

export interface ConfirmLeaseSpec {
  documentId: string;
  termsProfileName: string;
  confirmedBy: string;
  roles: Record<string, TenancyRole>;
}

export interface ConfirmLeaseResult {
  tenancyId: string;
  alreadyEstablished: boolean;
  partiesWritten: number;
}

function asPool(db: Queryable): Pool | null {
  if ('connect' in db && !('release' in db)) {
    return db as Pool;
  }
  return null;
}

async function inTransaction<T>(
  db: Queryable,
  work: (db: Queryable) => Promise<T>,
): Promise<T> {
  const pool = asPool(db);
  if (!pool) {
    return work(db);
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

function foldPlace(value: string): string {
  return value
    .replaceAll('דירה', '')
    .replaceAll(/[\s,.-]/g, '')
    .toLowerCase();
}

export function apartmentMatches(
  extracted: string,
  unitNumber: string,
): boolean {
  return foldPlace(extracted) === foldPlace(unitNumber);
}

export function addressMatches(
  extracted: string,
  addressLine: string,
): boolean {
  const captured = foldPlace(extracted);
  const unit = foldPlace(addressLine);
  if (captured.length === 0 || unit.length === 0) {
    return false;
  }
  return captured.includes(unit) || unit.includes(captured);
}

function firstValue(
  rows: readonly ExtractedRow[],
  fieldKey: string,
): string | null {
  return rows.find((row) => row.fieldKey === fieldKey)?.value ?? null;
}

function peopleOf(rows: readonly ExtractedRow[]): ProposedPerson[] {
  const tenants = rows
    .filter((row) => row.fieldKey === 'tenant_name')
    .sort(
      (a, b) =>
        a.page - b.page ||
        a.bbox.y - b.bbox.y ||
        a.bbox.x - b.bbox.x ||
        a.extractedFieldId.localeCompare(b.extractedFieldId),
    );
  const guarantors = rows.filter((row) => row.fieldKey === 'guarantor_name');
  const people: ProposedPerson[] = [];
  tenants.forEach((row, at) => {
    people.push({
      extractedFieldId: row.extractedFieldId,
      fieldKey: 'tenant_name',
      value: row.value,
      proposedRole: at === 0 ? 'PRIMARY_TENANT' : 'CO_TENANT',
    });
  });
  for (const row of guarantors) {
    people.push({
      extractedFieldId: row.extractedFieldId,
      fieldKey: 'guarantor_name',
      value: row.value,
      proposedRole: 'GUARANTOR',
    });
  }
  return people;
}

async function unitIdOf(db: Queryable, documentId: string): Promise<string> {
  const link = await db.query<{ entity_id: string }>(
    `SELECT entity_id FROM document_link
      WHERE document_id = $1 AND entity_type = 'UNIT' AND link_role = 'SUBJECT'
      LIMIT 1`,
    [documentId],
  );
  const unitId = link.rows[0]?.entity_id;
  if (!unitId) {
    throw new KernelError('invalid', 'that document is not bound to a unit');
  }
  return unitId;
}

async function tenancyLinkOf(
  db: Queryable,
  documentId: string,
): Promise<string | null> {
  const link = await db.query<{ entity_id: string }>(
    `SELECT entity_id FROM document_link
      WHERE document_id = $1 AND entity_type = 'TENANCY'
      ORDER BY entity_id
      LIMIT 1`,
    [documentId],
  );
  return link.rows[0]?.entity_id ?? null;
}

async function amendmentAlreadyConfirmed(
  db: Queryable,
  documentId: string,
): Promise<boolean> {
  const done = await db.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM audit_log
      WHERE action = 'evidence.confirm_amendment'
        AND subject_id = $1
        AND outcome = 'ok'`,
    [documentId],
  );
  return (done.rows[0]?.n ?? '0') !== '0';
}

export async function proposeLeaseTenancy(
  db: Queryable,
  documentId: string,
): Promise<LeaseProposal> {
  const filed = await getFiledDocument(db, validId(documentId, 'document'));
  if (filed.typeKey !== 'lease' && filed.typeKey !== 'lease_amendment') {
    throw new KernelError('invalid', 'that document is not a lease');
  }
  const unitId = await unitIdOf(db, filed.documentId);
  const unit = await getUnit(db, unitId);
  const rows = await listExtractedFields(db, filed.documentId);
  const boundToTenancy = (await tenancyLinkOf(db, filed.documentId)) !== null;
  if (filed.typeKey === 'lease_amendment') {
    return {
      documentId: filed.documentId,
      typeKey: 'lease_amendment',
      unit,
      startDate: firstValue(rows, 'effective_date'),
      endDate: firstValue(rows, 'new_end_date'),
      apartmentNumber: null,
      address: null,
      people: peopleOf(rows),
      matchesUnit: true,
      alreadyEstablished: await amendmentAlreadyConfirmed(db, filed.documentId),
      boundToTenancy,
      termsProfileNames: [],
    };
  }
  const apartmentNumber = firstValue(rows, 'apartment_number');
  const address = firstValue(rows, 'address');
  const matchesUnit =
    apartmentNumber !== null &&
    address !== null &&
    apartmentMatches(apartmentNumber, unit.unit_number) &&
    addressMatches(address, unit.address_line);
  return {
    documentId: filed.documentId,
    typeKey: 'lease',
    unit,
    startDate: firstValue(rows, 'start_date'),
    endDate: firstValue(rows, 'end_date'),
    apartmentNumber,
    address,
    people: peopleOf(rows),
    matchesUnit,
    alreadyEstablished: boundToTenancy,
    boundToTenancy,
    termsProfileNames: await listTermsProfiles(db),
  };
}

function asRole(value: string | undefined): TenancyRole {
  if (!value || !ROLES.has(value)) {
    throw new KernelError(
      'invalid',
      'every named person needs a confirmed role',
    );
  }
  return value as TenancyRole;
}

async function confirmAmendment(
  deps: LeaseDeps,
  db: Queryable,
  spec: {
    documentId: string;
    confirmedBy: string;
    roles: Record<string, TenancyRole>;
    proposed: LeaseProposal;
  },
): Promise<ConfirmLeaseResult> {
  const { documentId, confirmedBy, proposed } = spec;
  if (proposed.alreadyEstablished) {
    const existing = await tenancyLinkOf(db, documentId);
    if (!existing) {
      throw new KernelError(
        'invalid',
        'that document is not bound to a tenancy',
      );
    }
    return {
      tenancyId: existing,
      alreadyEstablished: true,
      partiesWritten: 0,
    };
  }
  const tenancyId = await tenancyLinkOf(db, documentId);
  if (!tenancyId) {
    throw new KernelError('invalid', 'that document is not bound to a tenancy');
  }
  for (const person of proposed.people) {
    asRole(spec.roles[person.extractedFieldId]);
  }

  const rows = await listExtractedFields(db, documentId);
  const promote = {
    db,
    audit: deps.audit,
    clock: deps.clock,
  };
  const endDate = rows.find((field) => field.fieldKey === 'new_end_date');
  if (endDate) {
    await promoteExtractedField(promote, {
      extractedFieldId: endDate.extractedFieldId,
      promotedBy: confirmedBy,
    });
  }

  let partiesWritten = 0;
  for (const person of proposed.people) {
    const role = asRole(spec.roles[person.extractedFieldId]);
    const party = await createParty(db, {
      kind: 'PERSON',
      fullName: person.value,
      preferredLanguage: 'he',
    });
    await upsertTenancyParty(db, {
      tenancyId,
      partyId: party.id,
      role,
      isServiceContact: role !== 'GUARANTOR',
    });
    await linkDocument(db, {
      documentId,
      entityType: 'PARTY',
      entityId: party.id,
      linkRole: 'SIGNATORY',
    });
    partiesWritten += 1;
  }

  await deps.audit.write(
    {
      actorKind: 'staff',
      actorId: confirmedBy,
      action: 'evidence.confirm_amendment',
      subjectId: documentId,
      inputs: { tenancyId, partiesWritten },
    },
    { outcome: 'ok' },
  );

  return { tenancyId, alreadyEstablished: false, partiesWritten };
}

export async function confirmLeaseTenancy(
  deps: LeaseDeps,
  spec: ConfirmLeaseSpec,
): Promise<ConfirmLeaseResult> {
  const documentId = validId(spec.documentId, 'document');
  const confirmedBy = requireText(spec.confirmedBy, 'confirmed_by', 200);

  return inTransaction(deps.db, async (db) => {
    const proposed = await proposeLeaseTenancy(db, documentId);
    if (proposed.typeKey === 'lease_amendment') {
      return confirmAmendment(deps, db, {
        documentId,
        confirmedBy,
        roles: spec.roles,
        proposed,
      });
    }
    const termsProfileName = requireText(
      spec.termsProfileName,
      'terms_profile',
      200,
    );
    const existing = await tenancyLinkOf(db, documentId);
    if (existing) {
      return {
        tenancyId: existing,
        alreadyEstablished: true,
        partiesWritten: 0,
      };
    }
    if (!proposed.matchesUnit) {
      throw new KernelError('invalid', 'the document does not match this unit');
    }
    if (!proposed.startDate || !proposed.endDate) {
      throw new KernelError('invalid', 'the lease is missing dates');
    }
    const tenants = proposed.people.filter(
      (person) => person.fieldKey === 'tenant_name',
    );
    if (tenants.length === 0) {
      throw new KernelError('invalid', 'the lease names no tenant');
    }
    for (const person of proposed.people) {
      asRole(spec.roles[person.extractedFieldId]);
    }

    const profileId = await findTermsProfileByName(db, termsProfileName);
    if (!profileId) {
      throw new KernelError('invalid', 'that terms profile does not exist');
    }

    const collision = await db.query<{ tenancy_id: string }>(
      `SELECT tenancy_id FROM tenancy
        WHERE unit_id = $1 AND start_date = $2`,
      [proposed.unit.unit_id, proposed.startDate],
    );
    if (collision.rows[0]) {
      throw new KernelError(
        'conflict',
        'that unit already has a lease starting on this date',
      );
    }

    const tenancy = await upsertTenancy(db, {
      unitId: proposed.unit.unit_id,
      startDate: proposed.startDate,
      endDate: proposed.endDate,
      status: 'DRAFT',
      termsProfileId: profileId,
      noticeDate: null,
      actualMoveOut: null,
    });
    await linkDocument(db, {
      documentId,
      entityType: 'TENANCY',
      entityId: tenancy.id,
      linkRole: 'EVIDENCE',
    });

    const rows = await listExtractedFields(db, documentId);
    const promote = {
      db,
      audit: deps.audit,
      clock: deps.clock,
    };
    for (const fieldKey of ['start_date', 'end_date'] as const) {
      const row = rows.find((field) => field.fieldKey === fieldKey);
      if (row) {
        await promoteExtractedField(promote, {
          extractedFieldId: row.extractedFieldId,
          promotedBy: confirmedBy,
        });
      }
    }

    let partiesWritten = 0;
    for (const person of proposed.people) {
      const role = asRole(spec.roles[person.extractedFieldId]);
      const party = await createParty(db, {
        kind: 'PERSON',
        fullName: person.value,
        preferredLanguage: 'he',
      });
      await upsertTenancyParty(db, {
        tenancyId: tenancy.id,
        partyId: party.id,
        role,
        isServiceContact: role !== 'GUARANTOR',
      });
      await linkDocument(db, {
        documentId,
        entityType: 'PARTY',
        entityId: party.id,
        linkRole: 'SIGNATORY',
      });
      partiesWritten += 1;
    }

    await deps.audit.write(
      {
        actorKind: 'staff',
        actorId: confirmedBy,
        action: 'evidence.confirm_lease',
        subjectId: documentId,
        inputs: {
          tenancyId: tenancy.id,
          partiesWritten,
        },
      },
      { outcome: 'ok' },
    );

    return {
      tenancyId: tenancy.id,
      alreadyEstablished: false,
      partiesWritten,
    };
  });
}
