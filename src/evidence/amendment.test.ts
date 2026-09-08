// Slice 4.7, flow A3: an addendum completes an existing tenancy.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { PoolClient } from 'pg';
import { createAuditLog } from '../kernel/audit.ts';
import { fixedClock } from '../kernel/clock.ts';
import type { KernelError } from '../kernel/errors.ts';
import { createFakeExtractor } from '../kernel/extraction.ts';
import { newId } from '../kernel/ids.ts';
import { createMemoryStore } from '../kernel/objects.ts';
import { createFakePdfText } from '../kernel/pdf.ts';
import {
  inRolledBackTransaction,
  migratedPoolOrNull,
  skipReason,
} from '../kernel/pg-support.ts';
import { upsertTermsProfile } from '../tenancy/contract.ts';
import type { IntakeDeps } from './contract.ts';
import {
  applyDocumentTypeCatalogue,
  confirmLeaseTenancy,
  fileDocument,
  listExtractedFields,
  listPromotedFieldsForUnit,
  proposeLeaseTenancy,
  renderTenancyPage,
} from './contract.ts';
import { seedDocumentTypes } from './fixtures/document-types.ts';

const AT = new Date('2026-09-08T12:00:00.000Z');
const BUCKET = 'dona-v5-test-docs';
const LEASE_MARKERS = 'חוזה שכירות המושכר תקופת השכירות השוכר';
const AMEND_MARKERS = 'נספח לחוזה השכירות';
const ADDRESS = 'רקפת 12';

const pdfBytes = (marker: string): Buffer =>
  Buffer.from(`%PDF-1.4\n% ${marker}\n`, 'latin1');

async function insertUnit(
  db: PoolClient,
  unitNumber: string,
  addressLine: string,
): Promise<string> {
  const buildingId = newId();
  const unitId = newId();
  await db.query(
    `INSERT INTO building (building_id, name, address_line, city,
                           handover_date, warranty_end_date, status)
     VALUES ($1, 'amend-building', $2, $3, '2020-01-01', '2022-01-01', 'ACTIVE')`,
    [buildingId, addressLine, `Shoham-${buildingId.slice(0, 8)}`],
  );
  await db.query(
    `INSERT INTO space (space_id, building_id, space_kind, name)
     VALUES ($1, $2, 'UNIT', $3)`,
    [unitId, buildingId, `דירה ${unitNumber}`],
  );
  await db.query(
    `INSERT INTO unit (unit_id, unit_number, rooms, has_mamad, condition_status)
     VALUES ($1, $2, 3.5, true, 'READY')`,
    [unitId, unitNumber],
  );
  return unitId;
}

function intake(
  db: PoolClient,
  markers: string,
  findings: Array<{ field_key: string; value: string; word_ids: number[] }>,
): IntakeDeps {
  return {
    db,
    objects: createMemoryStore(),
    pdf: createFakePdfText([markers]),
    audit: createAuditLog(db, fixedClock(AT)),
    clock: fixedClock(AT),
    bucket: BUCKET,
    extractor: createFakeExtractor(() => ({ findings })),
    extractModel: 'gpt-test',
  };
}

async function fileLease(db: PoolClient, unitId: string): Promise<string> {
  const filed = await fileDocument(intake(db, LEASE_MARKERS, matchingLease), {
    bytes: pdfBytes(`lease-${unitId.slice(0, 8)}`),
    typeKey: 'lease',
    place: { kind: 'UNIT', id: unitId },
    tenancyId: null,
  });
  assert.equal(filed.filed, true);
  if (!filed.filed) {
    throw new Error('not filed');
  }
  return filed.documentId;
}

async function fileAmendment(
  db: PoolClient,
  unitId: string,
  tenancyId: string | null,
  findings: Array<{ field_key: string; value: string; word_ids: number[] }>,
  marker: string,
): Promise<string> {
  const filed = await fileDocument(intake(db, AMEND_MARKERS, findings), {
    bytes: pdfBytes(marker),
    typeKey: 'lease_amendment',
    place: { kind: 'UNIT', id: unitId },
    tenancyId,
  });
  assert.equal(filed.filed, true);
  if (!filed.filed) {
    throw new Error('not filed');
  }
  return filed.documentId;
}

const matchingLease = [
  { field_key: 'start_date', value: '2026-03-01', word_ids: [0] },
  { field_key: 'end_date', value: '2027-02-28', word_ids: [1] },
  { field_key: 'apartment_number', value: '12', word_ids: [2] },
  { field_key: 'address', value: 'רקפת 12 שוהם', word_ids: [3] },
  { field_key: 'tenant_name', value: 'יעל כהן', word_ids: [4] },
];

async function confirmLease(
  db: PoolClient,
  unitId: string,
): Promise<{ documentId: string; tenancyId: string }> {
  const profile = `a3-${unitId.slice(0, 8)}`;
  await upsertTermsProfile(db, profile);
  const documentId = await fileLease(db, unitId);
  const proposed = await proposeLeaseTenancy(db, documentId);
  const roles = Object.fromEntries(
    proposed.people.map((person) => [
      person.extractedFieldId,
      person.proposedRole,
    ]),
  );
  const confirmed = await confirmLeaseTenancy(
    {
      db,
      audit: createAuditLog(db, fixedClock(AT)),
      clock: fixedClock(AT),
    },
    {
      documentId,
      termsProfileName: profile,
      confirmedBy: 'אסף',
      roles,
    },
  );
  return { documentId, tenancyId: confirmed.tenancyId };
}

describe('evidence · flow A3 completes a tenancy from an addendum', () => {
  it('writes a guarantor under the existing tenancy; a second confirm is a no-op', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await inRolledBackTransaction(pool, async (db) => {
        await applyDocumentTypeCatalogue(db, seedDocumentTypes);
        const unitId = await insertUnit(db, '12', ADDRESS);
        const { tenancyId } = await confirmLease(db, unitId);
        const documentId = await fileAmendment(
          db,
          unitId,
          tenancyId,
          [{ field_key: 'guarantor_name', value: 'רותם ערב', word_ids: [0] }],
          'a3-guarantor',
        );
        const proposed = await proposeLeaseTenancy(db, documentId);
        assert.equal(proposed.typeKey, 'lease_amendment');
        assert.equal(proposed.people.length, 1);
        assert.equal(proposed.people[0]?.proposedRole, 'GUARANTOR');
        assert.equal(proposed.alreadyEstablished, false);

        const deps = {
          db,
          audit: createAuditLog(db, fixedClock(AT)),
          clock: fixedClock(AT),
        };
        const confirmed = await confirmLeaseTenancy(deps, {
          documentId,
          termsProfileName: '',
          confirmedBy: 'אסף',
          roles: {
            [proposed.people[0]?.extractedFieldId ?? '']: 'GUARANTOR',
          },
        });
        assert.equal(confirmed.alreadyEstablished, false);
        assert.equal(confirmed.tenancyId, tenancyId);
        assert.equal(confirmed.partiesWritten, 1);

        const guarantor = await db.query<{
          role: string;
          is_service_contact: boolean;
        }>(
          `SELECT role, is_service_contact FROM tenancy_party
            WHERE tenancy_id = $1 AND role = 'GUARANTOR'`,
          [tenancyId],
        );
        assert.equal(guarantor.rows.length, 1);
        assert.equal(guarantor.rows[0]?.is_service_contact, false);

        const again = await confirmLeaseTenancy(deps, {
          documentId,
          termsProfileName: '',
          confirmedBy: 'אסף',
          roles: {
            [proposed.people[0]?.extractedFieldId ?? '']: 'GUARANTOR',
          },
        });
        assert.equal(again.alreadyEstablished, true);
        assert.equal(again.partiesWritten, 0);
        const count = await db.query<{ n: string }>(
          `SELECT count(*)::text AS n FROM tenancy_party
            WHERE tenancy_id = $1 AND role = 'GUARANTOR'`,
          [tenancyId],
        );
        assert.equal(count.rows[0]?.n, '1');
      });
    } finally {
      await pool.end();
    }
  });

  it('a later end date overwrites the column and keeps both provenances', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await inRolledBackTransaction(pool, async (db) => {
        await applyDocumentTypeCatalogue(db, seedDocumentTypes);
        const unitId = await insertUnit(db, '12', ADDRESS);
        const { documentId: leaseId, tenancyId } = await confirmLease(
          db,
          unitId,
        );
        const documentId = await fileAmendment(
          db,
          unitId,
          tenancyId,
          [{ field_key: 'new_end_date', value: '2028-02-28', word_ids: [0] }],
          'a3-date',
        );
        const confirmed = await confirmLeaseTenancy(
          {
            db,
            audit: createAuditLog(db, fixedClock(AT)),
            clock: fixedClock(AT),
          },
          {
            documentId,
            termsProfileName: '',
            confirmedBy: 'אסף',
            roles: {},
          },
        );
        assert.equal(confirmed.partiesWritten, 0);

        const tenancy = await db.query<{ end_date: string }>(
          `SELECT end_date::text FROM tenancy WHERE tenancy_id = $1`,
          [tenancyId],
        );
        assert.equal(tenancy.rows[0]?.end_date, '2028-02-28');

        const leaseStamp = await listExtractedFields(db, leaseId);
        assert.equal(
          leaseStamp.find((row) => row.fieldKey === 'end_date')?.promotedTo,
          'tenancy.end_date',
        );
        const amendStamp = await listExtractedFields(db, documentId);
        assert.equal(
          amendStamp.find((row) => row.fieldKey === 'new_end_date')?.promotedTo,
          'tenancy.end_date',
        );

        const events = await db.query<{
          old_value: string;
          new_value: string;
        }>(
          `SELECT old_value, new_value FROM tenancy_event
            WHERE tenancy_id = $1 AND field = 'end_date'
            ORDER BY at, tenancy_event_id`,
          [tenancyId],
        );
        assert.equal(events.rows.length, 2);
        assert.equal(events.rows[1]?.old_value, '2027-02-28');
        assert.equal(events.rows[1]?.new_value, '2028-02-28');

        const onUnit = await listPromotedFieldsForUnit(db, unitId);
        const dates = onUnit.filter(
          (row) => row.value === '2027-02-28' || row.value === '2028-02-28',
        );
        assert.equal(dates.length, 2);
      });
    } finally {
      await pool.end();
    }
  });

  it('refuses an addendum with no tenancy and writes no party', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await inRolledBackTransaction(pool, async (db) => {
        await applyDocumentTypeCatalogue(db, seedDocumentTypes);
        const unitId = await insertUnit(db, '12', ADDRESS);
        await confirmLease(db, unitId);
        const documentId = await fileAmendment(
          db,
          unitId,
          null,
          [{ field_key: 'guarantor_name', value: 'רותם ערב', word_ids: [0] }],
          'a3-unbound',
        );
        const proposed = await proposeLeaseTenancy(db, documentId);
        await assert.rejects(
          () =>
            confirmLeaseTenancy(
              {
                db,
                audit: createAuditLog(db, fixedClock(AT)),
                clock: fixedClock(AT),
              },
              {
                documentId,
                termsProfileName: '',
                confirmedBy: 'אסף',
                roles: {
                  [proposed.people[0]?.extractedFieldId ?? '']: 'GUARANTOR',
                },
              },
            ),
          (error: KernelError) =>
            error.code === 'invalid' && error.message.includes('tenancy'),
        );
        const parties = await db.query<{ n: string }>(
          `SELECT count(*)::text AS n FROM tenancy_party tp
             JOIN tenancy t ON t.tenancy_id = tp.tenancy_id
            WHERE t.unit_id = $1 AND tp.role = 'GUARANTOR'`,
          [unitId],
        );
        assert.equal(parties.rows[0]?.n, '0');
      });
    } finally {
      await pool.end();
    }
  });
});

describe('evidence · addendum confirm screen', () => {
  const unit = {
    unit_id: '11111111-1111-4111-8111-111111111111',
    unit_number: '4',
    building_id: '22222222-2222-4222-8222-222222222222',
    building_name: 'בדיקה',
    address_line: 'האלון 12',
    city: 'אשדוד',
  };

  it('writes without a terms profile', () => {
    const html = renderTenancyPage({
      documentId: '33333333-3333-4333-8333-333333333333',
      typeKey: 'lease_amendment',
      unit,
      startDate: null,
      endDate: '2028-02-28',
      apartmentNumber: null,
      address: null,
      people: [
        {
          extractedFieldId: '44444444-4444-4444-8444-444444444444',
          fieldKey: 'guarantor_name',
          value: 'רותם',
          proposedRole: 'GUARANTOR',
        },
      ],
      matchesUnit: true,
      alreadyEstablished: false,
      boundToTenancy: true,
      termsProfileNames: [],
    });
    assert.match(html, /אישור נספח/);
    assert.match(html, /אישור וכתיבה/);
    assert.doesNotMatch(html, /<select name="terms_profile"/);
  });
});
