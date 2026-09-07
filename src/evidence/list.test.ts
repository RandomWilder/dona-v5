// What is filed, listed and searched. Slice 3.6.
//
// The claims are about SQL: unit A's lease does not appear on unit B, a lone `%` is text not a
// wildcard, and the same LIMIT estate's search carries is what cuts this one off. An in-memory
// double would prove this file and the query string agree, which is not the constraint.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { PoolClient } from 'pg';
import type { EstatePlan } from '../estate/contract.ts';
import { importEstate } from '../estate/contract.ts';
import { newId } from '../kernel/ids.ts';
import {
  inRolledBackTransaction,
  migratedPoolOrNull,
  skipReason,
} from '../kernel/pg-support.ts';
import {
  ingestDocument,
  linkDocument,
  listLinkedDocuments,
  SEARCH_LIMIT,
  searchDocuments,
  upsertDocumentType,
} from './contract.ts';

const CITY = 'עיר בדיקת מסמכים';
const BUILDING = 'בניין בדיקת מסמכים';
const ADDRESS = 'רחוב הבדיקה 36';
const INGESTED_AT = new Date('2026-09-07T09:00:00.000Z');
const BLOCK = 't36';
let sequence = 0;
function typeKey(name: string): string {
  sequence += 1;
  return `${BLOCK}-${name}-${sequence}`;
}

function plan(): EstatePlan {
  return {
    projects: [
      {
        name: 'מכרז בדיקת מסמכים',
        projectCode: 'DOC-LIST-TEST',
        tenderRef: null,
        status: 'ACTIVE',
      },
    ],
    buildings: [
      {
        name: BUILDING,
        addressLine: ADDRESS,
        city: CITY,
        projectCode: 'DOC-LIST-TEST',
        handoverDate: '2025-03-01',
        warrantyEndDate: '2027-03-01',
        status: 'ACTIVE',
        spaces: [
          { kind: 'UNIT', name: 'דירה 1', floor: '1', accessNote: null },
          { kind: 'UNIT', name: 'דירה 2', floor: '1', accessNote: null },
        ],
        units: [
          {
            spaceName: 'דירה 1',
            unitNumber: '1',
            rooms: 3,
            areaSqm: 70,
            hasMamad: true,
            parkingSpaceName: null,
            storageSpaceName: null,
            warrantyEndDate: null,
            conditionStatus: 'READY',
          },
          {
            spaceName: 'דירה 2',
            unitNumber: '2',
            rooms: 3,
            areaSqm: 70,
            hasMamad: false,
            parkingSpaceName: null,
            storageSpaceName: null,
            warrantyEndDate: null,
            conditionStatus: 'READY',
          },
        ],
      },
    ],
  };
}

async function seedType(
  db: PoolClient,
  labelHe: string,
  labelEn: string,
): Promise<string> {
  const result = await upsertDocumentType(db, {
    typeKey: typeKey(labelEn),
    labelHe,
    labelEn,
    verificationTerms: ['המושכר'],
    isActive: true,
  });
  return result.id;
}

async function fileOn(
  db: PoolClient,
  documentTypeId: string,
  entityType: 'UNIT' | 'BUILDING',
  entityId: string,
  fileHash: string,
  verdict: 'verified' | 'unverified' | 'unguarded' = 'verified',
): Promise<string> {
  const filed = await ingestDocument(
    db,
    {
      documentTypeId,
      storageUri: `gs://dona-v5-test-docs/${entityType.toLowerCase()}/${entityId}/${fileHash}.pdf`,
      fileHash,
      driveFileId: null,
      validFrom: '2025-01-01',
      validTo: '2026-12-31',
      verificationVerdict: verdict,
    },
    INGESTED_AT,
  );
  await linkDocument(db, {
    documentId: filed.id,
    entityType,
    entityId,
    linkRole: 'SUBJECT',
  });
  return filed.id;
}

async function unitsOf(
  db: PoolClient,
): Promise<{ one: string; two: string; buildingId: string }> {
  const rows = await db.query<{
    unit_id: string;
    unit_number: string;
    building_id: string;
  }>(
    `SELECT u.unit_id, u.unit_number, s.building_id
       FROM unit u
       JOIN space s ON s.space_id = u.unit_id
       JOIN building b ON b.building_id = s.building_id
      WHERE b.city = $1
      ORDER BY u.unit_number`,
    [CITY],
  );
  const one = rows.rows.find((row) => row.unit_number === '1');
  const two = rows.rows.find((row) => row.unit_number === '2');
  assert.ok(one && two);
  return { one: one.unit_id, two: two.unit_id, buildingId: one.building_id };
}

describe('evidence · listing and search', () => {
  it('lists, isolates, and searches without treating wildcards as wildcards', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await t.test(
        'lists a unit’s lease and not the neighbour’s, once even with a tenancy link',
        async () => {
          await inRolledBackTransaction(pool, async (db) => {
            await importEstate(db, plan());
            const { one, two } = await unitsOf(db);
            const typeId = await seedType(db, 'חוזה שכירות', 'Lease');
            const documentId = await fileOn(
              db,
              typeId,
              'UNIT',
              one,
              `${BLOCK}-lease-a`,
            );
            await linkDocument(db, {
              documentId,
              entityType: 'TENANCY',
              entityId: newId(),
              linkRole: 'EVIDENCE',
            });
            await fileOn(db, typeId, 'UNIT', two, `${BLOCK}-lease-b`);

            const onOne = await listLinkedDocuments(db, 'UNIT', one);
            const onTwo = await listLinkedDocuments(db, 'UNIT', two);
            assert.equal(onOne.length, 1);
            assert.equal(onOne[0]?.documentId, documentId);
            assert.equal(onOne[0]?.labelHe, 'חוזה שכירות');
            assert.equal(onOne[0]?.verificationVerdict, 'verified');
            assert.match(onOne[0]?.storageUri ?? '', /^gs:\/\//);
            assert.equal(onTwo.length, 1);
            assert.notEqual(onTwo[0]?.documentId, documentId);
          });
        },
      );

      await t.test('groups the panel by type then ingest date', async () => {
        await inRolledBackTransaction(pool, async (db) => {
          await importEstate(db, plan());
          const { one } = await unitsOf(db);
          const lease = await seedType(db, 'חוזה שכירות', 'Lease');
          const bill = await seedType(db, 'ארנונה', 'Arnona');
          await fileOn(db, lease, 'UNIT', one, `${BLOCK}-order-lease`);
          await fileOn(
            db,
            bill,
            'UNIT',
            one,
            `${BLOCK}-order-bill`,
            'unverified',
          );
          const listed = await listLinkedDocuments(db, 'UNIT', one);
          assert.deepEqual(
            listed.map((row) => row.labelHe),
            ['ארנונה', 'חוזה שכירות'],
          );
          assert.equal(listed[0]?.verificationVerdict, 'unverified');
        });
      });

      await t.test(
        'finds a lease by its type label and by its unit number',
        async () => {
          await inRolledBackTransaction(pool, async (db) => {
            await importEstate(db, plan());
            const { one, buildingId } = await unitsOf(db);
            const typeId = await seedType(
              db,
              'חוזה שכירות ייחודי',
              'UniqueLease',
            );
            const documentId = await fileOn(
              db,
              typeId,
              'UNIT',
              one,
              `${BLOCK}-search-lease`,
            );
            const byType = await searchDocuments(db, 'שכירות ייחודי');
            assert.equal(
              byType.documents.some((hit) => hit.documentId === documentId),
              true,
            );
            const byUnit = await searchDocuments(db, '1');
            assert.equal(
              byUnit.documents.some((hit) => hit.documentId === documentId),
              true,
            );
            assert.equal(
              byUnit.documents.find((hit) => hit.documentId === documentId)
                ?.unitNumber,
              '1',
            );
            const byBuilding = await searchDocuments(db, BUILDING);
            assert.equal(
              byBuilding.documents.some((hit) => hit.documentId === documentId),
              true,
            );
            // A city holds hundreds of apartments; matching documents by city is the
            // same bad answer estate refused for units.
            const byCity = await searchDocuments(db, CITY);
            assert.equal(
              byCity.documents.filter((hit) => hit.documentId === documentId)
                .length,
              0,
            );
            const protocol = await seedType(
              db,
              'מסירת הבניין ייחודית',
              'UniqueHandover',
            );
            const buildingDoc = await fileOn(
              db,
              protocol,
              'BUILDING',
              buildingId,
              `${BLOCK}-search-building`,
            );
            const buildingHits = await searchDocuments(
              db,
              'מסירת הבניין ייחודית',
            );
            assert.equal(
              buildingHits.documents.some(
                (hit) => hit.documentId === buildingDoc,
              ),
              true,
            );
          });
        },
      );

      await t.test('treats a wildcard as text, not as a wildcard', async () => {
        await inRolledBackTransaction(pool, async (db) => {
          await importEstate(db, plan());
          const { one } = await unitsOf(db);
          const typeId = await seedType(db, 'חוזה שכירות', 'Lease');
          await fileOn(db, typeId, 'UNIT', one, `${BLOCK}-wild-lease`);
          const wild = await searchDocuments(db, '%');
          assert.equal(wild.documents.length, 0, 'a lone % matched rows');
          const underscore = await searchDocuments(db, '_');
          assert.equal(underscore.documents.length, 0);
        });
      });

      await t.test(
        'cuts off at the same limit estate’s search does',
        async () => {
          await inRolledBackTransaction(pool, async (db) => {
            await importEstate(db, plan());
            const { one } = await unitsOf(db);
            const typeId = await seedType(db, 'חוזה גבול', 'LimitLease');
            for (let n = 0; n < SEARCH_LIMIT + 1; n += 1) {
              await fileOn(
                db,
                typeId,
                'UNIT',
                one,
                `${BLOCK}-limit-${String(n).padStart(3, '0')}`,
              );
            }
            const found = await searchDocuments(db, 'חוזה גבול');
            assert.equal(found.documents.length, SEARCH_LIMIT);
            assert.equal(found.truncated, true);
          });
        },
      );
    } finally {
      await pool.end();
    }
  });
});
