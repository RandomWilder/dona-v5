// Slice 4.6, flow A2: confirm a lease into a DRAFT tenancy.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { PoolClient } from 'pg';
import { signedInChrome } from '../chrome.ts';
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
  proposeLeaseTenancy,
  renderTenancyPage,
} from './contract.ts';
import { seedDocumentTypes } from './fixtures/document-types.ts';

const AT = new Date('2026-09-08T09:00:00.000Z');
const NAV = signedInChrome('x'.repeat(64), 'estate');
const BUCKET = 'dona-v5-test-docs';
const MARKERS = 'חוזה שכירות המושכר תקופת השכירות השוכר';
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
     VALUES ($1, 'lease-building', $2, $3, '2020-01-01', '2022-01-01', 'ACTIVE')`,
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

async function fileLease(
  db: PoolClient,
  unitId: string,
  findings: Array<{ field_key: string; value: string; word_ids: number[] }>,
  marker: string,
) {
  const extractor = createFakeExtractor(() => ({ findings }));
  const filed = await fileDocument(
    {
      db,
      objects: createMemoryStore(),
      pdf: createFakePdfText([MARKERS]),
      audit: createAuditLog(db, fixedClock(AT)),
      clock: fixedClock(AT),
      bucket: BUCKET,
      extractor,
      extractModel: 'gpt-test',
    } satisfies IntakeDeps,
    {
      bytes: pdfBytes(marker),
      typeKey: 'lease',
      place: { kind: 'UNIT', id: unitId },
      tenancyId: null,
    },
  );
  assert.equal(filed.filed, true);
  if (!filed.filed) {
    throw new Error('not filed');
  }
  return filed.documentId;
}

const matchingFindings = [
  { field_key: 'start_date', value: '2026-03-01', word_ids: [0] },
  { field_key: 'end_date', value: '2027-02-28', word_ids: [1] },
  { field_key: 'apartment_number', value: '12', word_ids: [2] },
  { field_key: 'address', value: 'רקפת 12 שוהם', word_ids: [3] },
  { field_key: 'tenant_name', value: 'יעל כהן', word_ids: [4] },
  { field_key: 'tenant_name', value: 'דן לוי', word_ids: [5] },
];

describe('evidence · flow A2 confirms a lease into a draft tenancy', () => {
  it('writes two tenants, no guarantors, and a second confirm is a no-op', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await inRolledBackTransaction(pool, async (db) => {
        await applyDocumentTypeCatalogue(db, seedDocumentTypes);
        const unitId = await insertUnit(db, '12', ADDRESS);
        await upsertTermsProfile(db, `a2-${unitId.slice(0, 8)}`);
        const documentId = await fileLease(
          db,
          unitId,
          matchingFindings,
          'a2-two',
        );
        const proposed = await proposeLeaseTenancy(db, documentId);
        assert.equal(proposed.matchesUnit, true);
        assert.equal(proposed.people.length, 2);
        assert.equal(proposed.people[0]?.proposedRole, 'PRIMARY_TENANT');
        assert.equal(proposed.people[1]?.proposedRole, 'CO_TENANT');
        assert.ok(
          proposed.termsProfileNames.includes(`a2-${unitId.slice(0, 8)}`),
        );

        const roles = Object.fromEntries(
          proposed.people.map((person) => [
            person.extractedFieldId,
            person.proposedRole,
          ]),
        );
        const deps = {
          db,
          audit: createAuditLog(db, fixedClock(AT)),
          clock: fixedClock(AT),
        };
        const confirmed = await confirmLeaseTenancy(deps, {
          documentId,
          termsProfileName: `a2-${unitId.slice(0, 8)}`,
          confirmedBy: 'אסף',
          roles,
        });
        assert.equal(confirmed.alreadyEstablished, false);
        assert.equal(confirmed.partiesWritten, 2);

        const tenancy = await db.query<{ status: string; start_date: string }>(
          `SELECT status, start_date::text FROM tenancy WHERE tenancy_id = $1`,
          [confirmed.tenancyId],
        );
        assert.equal(tenancy.rows[0]?.status, 'DRAFT');
        assert.equal(tenancy.rows[0]?.start_date, '2026-03-01');

        const parties = await db.query<{ role: string }>(
          `SELECT role FROM tenancy_party WHERE tenancy_id = $1 ORDER BY role`,
          [confirmed.tenancyId],
        );
        assert.deepEqual(
          parties.rows.map((row) => row.role),
          ['CO_TENANT', 'PRIMARY_TENANT'],
        );

        const guarantors = await db.query<{ n: string }>(
          `SELECT count(*)::text AS n FROM tenancy_party
            WHERE tenancy_id = $1 AND role = 'GUARANTOR'`,
          [confirmed.tenancyId],
        );
        assert.equal(guarantors.rows[0]?.n, '0');

        const stamped = await listExtractedFields(db, documentId);
        assert.equal(
          stamped.find((row) => row.fieldKey === 'start_date')?.promotedTo,
          'tenancy.start_date',
        );

        const again = await confirmLeaseTenancy(deps, {
          documentId,
          termsProfileName: `a2-${unitId.slice(0, 8)}`,
          confirmedBy: 'אסף',
          roles,
        });
        assert.equal(again.alreadyEstablished, true);
        assert.equal(again.partiesWritten, 0);
        const partyCount = await db.query<{ n: string }>(
          `SELECT count(*)::text AS n FROM tenancy_party WHERE tenancy_id = $1`,
          [confirmed.tenancyId],
        );
        assert.equal(partyCount.rows[0]?.n, '2');
      });
    } finally {
      await pool.end();
    }
  });

  it('refuses a wrong apartment and writes no party', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await inRolledBackTransaction(pool, async (db) => {
        await applyDocumentTypeCatalogue(db, seedDocumentTypes);
        const unitId = await insertUnit(db, '12', ADDRESS);
        await upsertTermsProfile(db, `a2-miss-${unitId.slice(0, 8)}`);
        const documentId = await fileLease(
          db,
          unitId,
          [
            ...matchingFindings.filter(
              (row) => row.field_key !== 'apartment_number',
            ),
            {
              field_key: 'apartment_number',
              value: '4',
              word_ids: [2],
            },
          ],
          'a2-wrong',
        );
        const proposed = await proposeLeaseTenancy(db, documentId);
        assert.equal(proposed.matchesUnit, false);
        const roles = Object.fromEntries(
          proposed.people.map((person) => [
            person.extractedFieldId,
            person.proposedRole,
          ]),
        );
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
                termsProfileName: `a2-miss-${unitId.slice(0, 8)}`,
                confirmedBy: 'אסף',
                roles,
              },
            ),
          (error: KernelError) =>
            error.code === 'invalid' && error.message.includes('match'),
        );
        const parties = await db.query<{ n: string }>(
          `SELECT count(*)::text AS n FROM tenancy_party tp
             JOIN tenancy t ON t.tenancy_id = tp.tenancy_id
            WHERE t.unit_id = $1`,
          [unitId],
        );
        assert.equal(parties.rows[0]?.n, '0');
        const tenancies = await db.query<{ n: string }>(
          `SELECT count(*)::text AS n FROM tenancy WHERE unit_id = $1`,
          [unitId],
        );
        assert.equal(tenancies.rows[0]?.n, '0');
      });
    } finally {
      await pool.end();
    }
  });
});

describe('evidence · confirm screen lists terms profiles', () => {
  const unit = {
    unit_id: '11111111-1111-4111-8111-111111111111',
    unit_number: '4',
    building_id: '22222222-2222-4222-8222-222222222222',
    building_name: 'בדיקה',
    address_line: 'האלון 12',
    city: 'אשדוד',
  };
  const base = {
    documentId: '33333333-3333-4333-8333-333333333333',
    typeKey: 'lease' as const,
    unit,
    startDate: '2026-09-15',
    endDate: '2027-09-14',
    apartmentNumber: '4',
    address: 'האלון 12',
    people: [
      {
        extractedFieldId: '44444444-4444-4444-8444-444444444444',
        fieldKey: 'tenant_name' as const,
        value: 'יעל',
        proposedRole: 'PRIMARY_TENANT' as const,
      },
    ],
    matchesUnit: true,
    alreadyEstablished: false,
    boundToTenancy: false,
  };

  it('is a select of existing names, not a typed field', () => {
    const html = renderTenancyPage({
      nav: NAV,
      csrf: '',
      ...base,
      termsProfileNames: ['נספח תחזוקה — תקן'],
    });
    assert.match(html, /<select name="terms_profile"/);
    assert.match(html, /נספח תחזוקה — תקן/);
    assert.match(html, /אישור וכתיבה/);
  });

  it('withholds the write when none exist rather than inventing one', () => {
    const html = renderTenancyPage({
      nav: NAV,
      csrf: '',
      ...base,
      termsProfileNames: [],
    });
    assert.match(html, /אין נספח תחזוקה במערכת/);
    assert.doesNotMatch(html, /אישור וכתיבה/);
    assert.doesNotMatch(html, /<select name="terms_profile"/);
  });
});
