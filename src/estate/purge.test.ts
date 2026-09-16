// Operator purge of a Building or a Unit. Screens have no delete; this command is the
// developer path. Tests go through listEstatePurge / applyEstatePurge.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { PoolClient } from 'pg';
import {
  ingestDocument,
  linkDocument,
  upsertDocumentType,
  upsertDocumentTypeField,
} from '../evidence/contract.ts';
import { fixedClock } from '../kernel/clock.ts';
import { KernelError } from '../kernel/errors.ts';
import { newId } from '../kernel/ids.ts';
import {
  inRolledBackTransaction,
  migratedPoolOrNull,
  skipReason,
} from '../kernel/pg-support.ts';
import { addOperator, appendOfficeRetrievalTurn } from '../staff/contract.ts';
import {
  applyEstatePurge,
  type EstatePlan,
  importEstate,
  listEstatePurge,
  parseEstatePurgeArgs,
  refuseProdDatabase,
} from './contract.ts';

const CITY = 'כפר סבא — בדיקת פינוי';
const STREET = 'הרב קוק';
const AT = new Date('2026-09-16T06:00:00.000Z');
const BLOCK = 'purge-op';
let sequence = 0;

function typeKey(): string {
  sequence += 1;
  return `${BLOCK}-${sequence}-${newId()}`;
}

function plan(addressLine: string, units: string[]): EstatePlan {
  const projectCode = `PURGE-${addressLine}`;
  return {
    projects: [
      {
        name: 'מכרז פינוי',
        projectCode,
        tenderRef: null,
        status: 'ACTIVE',
      },
    ],
    buildings: [
      {
        name: addressLine,
        addressLine,
        city: CITY,
        projectCode,
        handoverDate: '2025-03-01',
        warrantyEndDate: '2027-03-01',
        status: 'ACTIVE',
        spaces: units.map((unitNumber) => ({
          kind: 'UNIT' as const,
          name: `דירה ${unitNumber}`,
          floor: '1',
          accessNote: null,
        })),
        units: units.map((unitNumber) => ({
          spaceName: `דירה ${unitNumber}`,
          unitNumber,
          rooms: 3,
          areaSqm: 70,
          hasMamad: true,
          parkingSpaceName: null,
          storageSpaceName: null,
          warrantyEndDate: null,
          conditionStatus: 'READY' as const,
        })),
      },
    ],
  };
}

async function unitId(
  db: PoolClient,
  buildingId: string,
  unitNumber: string,
): Promise<string> {
  const { rows } = await db.query<{ unit_id: string }>(
    `SELECT u.unit_id
       FROM unit u
       JOIN space s ON s.space_id = u.unit_id
      WHERE s.building_id = $1 AND u.unit_number = $2`,
    [buildingId, unitNumber],
  );
  const id = rows[0]?.unit_id;
  assert.ok(id);
  return id;
}

async function fileLease(
  db: PoolClient,
  unitIdValue: string,
  hash: string,
): Promise<string> {
  const type = await upsertDocumentType(db, {
    typeKey: typeKey(),
    labelHe: 'חוזה שכירות',
    labelEn: 'lease',
    verificationTerms: ['המושכר'],
    isActive: true,
  });
  const ingested = await ingestDocument(
    db,
    {
      documentTypeId: type.id,
      storageUri: `gs://dona-v5-staging-docs/unit/${unitIdValue}/lease/${hash}.pdf`,
      fileHash: hash,
      driveFileId: null,
      validFrom: null,
      validTo: null,
      verificationVerdict: 'verified',
    },
    AT,
  );
  await linkDocument(db, {
    documentId: ingested.id,
    entityType: 'UNIT',
    entityId: unitIdValue,
    linkRole: 'SUBJECT',
  });
  return ingested.id;
}

async function seedLetting(
  db: PoolClient,
  unitIdValue: string,
  fullName: string,
): Promise<{ tenancyId: string; partyId: string }> {
  const profileId = newId();
  const tenancyId = newId();
  const partyId = newId();
  await db.query(
    `INSERT INTO terms_profile (terms_profile_id, name) VALUES ($1, $2)`,
    [profileId, `purge-${profileId}`],
  );
  await db.query(
    `INSERT INTO tenancy (tenancy_id, unit_id, start_date, end_date, status, terms_profile_id)
     VALUES ($1, $2, '2025-01-01', '2026-01-01', 'DRAFT', $3)`,
    [tenancyId, unitIdValue, profileId],
  );
  await db.query(
    `INSERT INTO party (party_id, party_kind, full_name) VALUES ($1, 'PERSON', $2)`,
    [partyId, fullName],
  );
  await db.query(
    `INSERT INTO tenancy_party (tenancy_id, party_id, role, is_service_contact)
     VALUES ($1, $2, 'PRIMARY_TENANT', true)`,
    [tenancyId, partyId],
  );
  return { tenancyId, partyId };
}

describe('estate · operator purge', () => {
  it('parses list and apply, and refuses a prod database url', () => {
    const listed = parseEstatePurgeArgs(['list', '--address', STREET]);
    assert.equal(listed.mode, 'list');
    if (listed.mode === 'list') {
      assert.equal(listed.query.address, STREET);
    }
    const applied = parseEstatePurgeArgs([
      'apply',
      '--building',
      '01900000-0000-7000-8000-000000000001',
      '--yes',
    ]);
    assert.equal(applied.mode, 'apply');
    if (applied.mode === 'apply') {
      assert.equal(applied.spec.kind, 'building');
      assert.equal(applied.yes, true);
    }
    assert.throws(
      () => parseEstatePurgeArgs(['apply']),
      (error: unknown) =>
        error instanceof KernelError && error.code === 'invalid',
    );
    assert.throws(
      () =>
        refuseProdDatabase(
          'postgres://x@localhost/dona?host=/cloudsql/dona-v5:me-west1:dona-prod',
        ),
      (error: unknown) =>
        error instanceof KernelError && error.code === 'not_allowed',
    );
    refuseProdDatabase(
      'postgres://x@localhost/dona?host=/cloudsql/dona-v5:me-west1:dona-staging',
    );
  });

  it('lists by street, applies one Building, and leaves the neighbour', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await inRolledBackTransaction(pool, async (db) => {
        await importEstate(db, plan(`${STREET} 45`, ['1']));
        await importEstate(db, plan(`${STREET} 50`, ['6']));
        const listed = await listEstatePurge(db, {
          address: STREET,
          city: CITY,
        });
        assert.equal(listed.length, 2);
        const fortyFive = listed.find((row) => row.addressLine.endsWith('45'));
        const fifty = listed.find((row) => row.addressLine.endsWith('50'));
        assert.ok(fortyFive);
        assert.ok(fifty);
        const unitA = await unitId(db, fortyFive.buildingId, '1');
        const unitB = await unitId(db, fifty.buildingId, '6');
        const hashA = `hash-a-${newId()}`;
        const hashB = `hash-b-${newId()}`;
        const docA = await fileLease(db, unitA, hashA);
        await fileLease(db, unitB, hashB);
        const { partyId: orphan } = await seedLetting(
          db,
          unitA,
          'דייר רחוב 45',
        );
        const { partyId: kept } = await seedLetting(db, unitB, 'דייר רחוב 50');
        const clock = fixedClock(AT);
        const { account } = await addOperator(db, clock, {
          email: `${newId(clock)}@purge.test`,
          role: 'OPERATOR',
        });
        await appendOfficeRetrievalTurn(db, clock, {
          staffAccountId: account.staffAccountId,
          bound: { kind: 'unit', id: unitA },
          question: 'מה גובה השכירות',
          answer: 'אין במסמכים האלה תשובה לשאלה הזו.',
          refused: true,
          citations: [],
          hitIds: [],
        });
        const field = await upsertDocumentTypeField(db, {
          documentTypeId:
            (
              await db.query<{ document_type_id: string }>(
                'SELECT document_type_id FROM document WHERE document_id = $1',
                [docA],
              )
            ).rows[0]?.document_type_id ?? '',
          fieldKey: `rent-${newId()}`,
          labelHe: 'שכירות',
          valueType: 'TEXT',
          isRequired: false,
          extractionHint: null,
          effectiveFrom: '2025-01-01',
          effectiveTo: null,
        });
        await db.query(
          `INSERT INTO extracted_field (
             extracted_field_id, document_id, document_type_field_id, value,
             page, bbox, confidence, model, extracted_at
           ) VALUES ($1, $2, $3, '4500', 1, '{"x":1,"y":2,"width":3,"height":4}',
                     null, 'fake', $4)`,
          [newId(), docA, field.id, AT],
        );
        await db.query(`SELECT set_config('dona.approving', 'on', true)`);
        await db.query(
          `UPDATE extracted_field
              SET approved_value = value, approved_by = 'ops@test', approved_at = $1
            WHERE document_id = $2`,
          [AT, docA],
        );
        await db.query(`SELECT set_config('dona.approving', 'off', true)`);

        const report = await applyEstatePurge(db, {
          kind: 'building',
          id: fortyFive.buildingId,
        });
        assert.equal(report.documentCount, 1);
        assert.ok(
          report.objectPrefixes.some((prefix) => prefix.startsWith('unit/')),
        );

        const gone = await db.query(
          'SELECT 1 FROM building WHERE building_id = $1',
          [fortyFive.buildingId],
        );
        assert.equal(gone.rows.length, 0);
        const neighbour = await db.query(
          'SELECT 1 FROM building WHERE building_id = $1',
          [fifty.buildingId],
        );
        assert.equal(neighbour.rows.length, 1);
        const reuse = await db.query(
          'SELECT 1 FROM document WHERE file_hash = $1',
          [hashA],
        );
        assert.equal(reuse.rows.length, 0);
        const stillFiled = await db.query(
          'SELECT 1 FROM document WHERE file_hash = $1',
          [hashB],
        );
        assert.equal(stillFiled.rows.length, 1);
        const orphanRow = await db.query(
          'SELECT 1 FROM party WHERE party_id = $1',
          [orphan],
        );
        assert.equal(orphanRow.rows.length, 0);
        const keptRow = await db.query(
          'SELECT 1 FROM party WHERE party_id = $1',
          [kept],
        );
        assert.equal(keptRow.rows.length, 1);
        const project = await db.query(
          `SELECT 1 FROM project WHERE project_code = $1`,
          [`PURGE-${STREET} 45`],
        );
        assert.equal(project.rows.length, 1);
        const thread = await db.query(
          `SELECT 1 FROM office_retrieval_thread
            WHERE bound_kind = 'unit' AND bound_id = $1`,
          [unitA],
        );
        assert.equal(thread.rows.length, 0);
      });
    } finally {
      await pool.end();
    }
  });

  it('applying one Unit leaves the sibling Unit and a Building-bound Document', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await inRolledBackTransaction(pool, async (db) => {
        await importEstate(db, plan(`${STREET} 54`, ['1', '2']));
        const [building] = await listEstatePurge(db, {
          address: `${STREET} 54`,
          city: CITY,
        });
        assert.ok(building);
        const one = await unitId(db, building.buildingId, '1');
        const two = await unitId(db, building.buildingId, '2');
        await fileLease(db, one, `u1-${newId()}`);
        await fileLease(db, two, `u2-${newId()}`);
        const type = await upsertDocumentType(db, {
          typeKey: typeKey(),
          labelHe: 'פרוטוקול',
          labelEn: 'protocol',
          verificationTerms: null,
          isActive: true,
        });
        const protocolHash = `proto-${newId()}`;
        const protocol = await ingestDocument(
          db,
          {
            documentTypeId: type.id,
            storageUri: `gs://dona-v5-staging-docs/building/${building.buildingId}/protocol/${protocolHash}.pdf`,
            fileHash: protocolHash,
            driveFileId: null,
            validFrom: null,
            validTo: null,
            verificationVerdict: 'verified',
          },
          AT,
        );
        await linkDocument(db, {
          documentId: protocol.id,
          entityType: 'BUILDING',
          entityId: building.buildingId,
          linkRole: 'SUBJECT',
        });

        await applyEstatePurge(db, { kind: 'unit', id: one });

        const sibling = await db.query(
          'SELECT 1 FROM unit WHERE unit_id = $1',
          [two],
        );
        assert.equal(sibling.rows.length, 1);
        const buildingRow = await db.query(
          'SELECT 1 FROM building WHERE building_id = $1',
          [building.buildingId],
        );
        assert.equal(buildingRow.rows.length, 1);
        const protocolRow = await db.query(
          'SELECT 1 FROM document WHERE document_id = $1',
          [protocol.id],
        );
        assert.equal(protocolRow.rows.length, 1);
        const unitDoc = await db.query(
          `SELECT 1 FROM document_link WHERE entity_type = 'UNIT' AND entity_id = $1`,
          [one],
        );
        assert.equal(unitDoc.rows.length, 0);
      });
    } finally {
      await pool.end();
    }
  });
});
