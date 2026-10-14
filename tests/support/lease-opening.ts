// פתיחת טיוטה's operator path, for any suite that needs a filed, readable lease. #234, #235.
//
// It files a fixture lease through A16 against a fresh flat, under a rolled-back transaction, and
// hands back the operator's own verbs: get, post, approve a field, count what was written. It sits
// in `tests/` for `session.ts`'s reason: two suites (A16's and the policy gate's) drive the same
// path, and two copies of it is how they come to disagree about what filing a lease looks like.
import assert from 'node:assert/strict';
import type { Pool, PoolClient } from 'pg';
import { specimenDocuments } from '../../evals/fixtures/specimen-clauses.ts';
import { buildApp } from '../../src/app.ts';
import type { EstatePlan } from '../../src/estate/contract.ts';
import { importEstate } from '../../src/estate/contract.ts';
import {
  applyDocumentTypeCatalogue,
  DEFAULT_TERMS_PROFILE,
  fileDocument,
} from '../../src/evidence/contract.ts';
import { seedDocumentTypes } from '../../src/evidence/fixtures/document-types.ts';
import { createAuditLog } from '../../src/kernel/audit.ts';
import { type Clock, fixedClock } from '../../src/kernel/clock.ts';
import { createFakeExtractor } from '../../src/kernel/extraction.ts';
import { createMemoryStore } from '../../src/kernel/objects.ts';
import { fakeItems } from '../../src/kernel/pdf.ts';
import {
  inRolledBackTransaction,
  migratedPoolOrNull,
} from '../../src/kernel/pg-support.ts';
import { upsertTermsProfile } from '../../src/tenancy/contract.ts';
import { asOperator, type SignedIn, signIn } from './session.ts';

const BOUNDARY = '----dona234';

export type Finding = { field_key: string; value: string; word_ids: number[] };

const lease = (): string => {
  const found = specimenDocuments.find(
    (document) => document.file === 'lease-standard.md',
  );
  if (!found) throw new Error('lease-standard.md is not in the corpus');
  return found.text;
};

export interface Opening {
  clock: Clock;
  db: PoolClient;
  unitId: string;
  documentId: string;
  get: (url: string) => Promise<{
    statusCode: number;
    body: string;
    headers: { location?: string };
  }>;
  post: (
    url: string,
    fields: Record<string, string>,
  ) => Promise<{
    statusCode: number;
    body: string;
    headers: { location?: string };
  }>;
  /** Approves every unapproved row of a key. `fields` is posted with each, e.g. a corrected value. */
  approve: (fieldKey: string, fields?: Record<string, string>) => Promise<void>;
  counts: () => Promise<{
    tenancies: number;
    tenancyLinks: number;
    signatories: number;
  }>;
}

export async function withOpening(
  spec: {
    tag: string;
    on: Date;
    findings: (address: string) => Finding[];
    /**
     * Files the lease the way every door did before #237: under the flat's place path, with its
     * `UNIT` `SUBJECT` link written at upload. Through the contract, because no door does it now.
     */
    placed?: boolean;
  },
  run: (opening: Opening) => Promise<void>,
): Promise<boolean> {
  const pool = await migratedPoolOrNull();
  if (!pool) return false;
  const city = `עיר פתיחה ${spec.tag}`;
  const address = `הדקל ${spec.tag.length + 40}`;
  const findings = spec.findings(address);
  const text = `כתובת המושכר: ${address}, ${city}, דירה 7\n${lease()}`;
  try {
    await inRolledBackTransaction(pool, async (db) => {
      const clock = fixedClock(spec.on);
      const objects = createMemoryStore();
      const pdf = {
        async pages() {
          return [
            {
              number: 1,
              width: 595,
              height: 842,
              items: fakeItems(text, null),
            },
          ];
        },
        describe: () => 'fake',
      };
      const extractor = createFakeExtractor(() => ({ findings }));
      const bucket = `dona-v5-test-${spec.tag}`;
      const app = buildApp({
        pool: db as unknown as Pool,
        version: '9.9.9-test',
        clock,
        objects,
        pdf,
        extractor,
        bucket,
      });
      try {
        await applyDocumentTypeCatalogue(db, seedDocumentTypes);
        const plan: EstatePlan = {
          projects: [
            {
              name: `מכרז ${spec.tag}`,
              projectCode: `TEST-${spec.tag}`,
              tenderRef: null,
              status: 'ACTIVE',
            },
          ],
          buildings: [
            {
              name: `בניין ${spec.tag}`,
              addressLine: address,
              city,
              projectCode: `TEST-${spec.tag}`,
              handoverDate: '2025-03-01',
              warrantyEndDate: '2027-03-01',
              status: 'ACTIVE',
              spaces: [
                { kind: 'UNIT', name: 'דירה 7', floor: '1', accessNote: null },
              ],
              units: [
                {
                  spaceName: 'דירה 7',
                  unitNumber: '7',
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
        await importEstate(db, plan);
        await upsertTermsProfile(db, DEFAULT_TERMS_PROFILE);
        const found = await db.query<{ unit_id: string }>(
          `SELECT u.unit_id FROM unit u
             JOIN space s ON s.space_id = u.unit_id
             JOIN building b ON b.building_id = s.building_id
            WHERE b.city = $1 AND b.address_line = $2`,
          [city, address],
        );
        const unitId = found.rows[0]?.unit_id ?? '';
        assert.ok(unitId);
        const who: SignedIn = await signIn(db as unknown as Pool, clock, {
          email: `admin@${spec.tag}.test`,
          role: 'ADMIN',
        });
        const client = asOperator(app as never, who);
        const get = (url: string) =>
          client.inject({ method: 'GET', url }) as Promise<{
            statusCode: number;
            body: string;
            headers: { location?: string };
          }>;
        const post = (url: string, fields: Record<string, string>) =>
          client.inject({
            method: 'POST',
            url,
            headers: { 'content-type': 'application/x-www-form-urlencoded' },
            payload: new URLSearchParams({
              csrf: who.csrf,
              ...fields,
            }).toString(),
          }) as Promise<{
            statusCode: number;
            body: string;
            headers: { location?: string };
          }>;
        const send = (fields: Record<string, string>, marker: string) => {
          const parts: Buffer[] = [];
          for (const [name, value] of Object.entries({
            csrf: who.csrf,
            ...fields,
          })) {
            parts.push(
              Buffer.from(
                `--${BOUNDARY}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
              ),
            );
          }
          parts.push(
            Buffer.from(
              `--${BOUNDARY}\r\nContent-Disposition: form-data; name="file"; filename="שכירות.pdf"\r\n` +
                'Content-Type: application/octet-stream\r\n\r\n',
            ),
            Buffer.from(`%PDF-1.4\n% ${marker}\n`, 'latin1'),
            Buffer.from(`\r\n--${BOUNDARY}--\r\n`),
          );
          return client.inject({
            method: 'POST',
            url: '/documents/filing',
            payload: Buffer.concat(parts),
            headers: {
              'content-type': `multipart/form-data; boundary=${BOUNDARY}`,
            },
          }) as Promise<{
            statusCode: number;
            body: string;
            headers: { location?: string };
          }>;
        };
        const seen = await send({}, `${spec.tag}-seen`);
        assert.equal(seen.statusCode, 302, seen.body.slice(0, 300));
        let documentId: string;
        if (spec.placed) {
          const placed = await fileDocument(
            {
              db,
              objects,
              pdf,
              extractor,
              audit: createAuditLog(db, clock),
              clock,
              bucket,
            },
            {
              bytes: Buffer.from(`%PDF-1.4\n% ${spec.tag}-filed\n`, 'latin1'),
              typeKey: 'lease',
              place: { kind: 'UNIT', id: unitId },
              tenancyId: null,
              filedBy: who.staffAccountId,
            },
          );
          assert.ok(placed.filed);
          documentId = placed.documentId;
        } else {
          const filed = await send({ unit: unitId }, `${spec.tag}-filed`);
          assert.equal(filed.statusCode, 302, filed.body.slice(0, 300));
          documentId =
            String(filed.headers.location ?? '').match(
              /\/documents\/filing\/([0-9a-f-]{36})$/,
            )?.[1] ?? '';
        }
        assert.ok(documentId);

        const approve = async (
          fieldKey: string,
          fields: Record<string, string> = {},
        ) => {
          const rows = await db.query<{ id: string }>(
            `SELECT e.extracted_field_id AS id FROM extracted_field e
               JOIN document_type_field f
                 ON f.document_type_field_id = e.document_type_field_id
              WHERE e.document_id = $1 AND f.field_key = $2
                AND e.approved_at IS NULL`,
            [documentId, fieldKey],
          );
          for (const row of rows.rows) {
            const stamped = await post(
              `/documents/filing/${documentId}/approve`,
              { extracted_field_id: row.id, ...fields },
            );
            assert.equal(stamped.statusCode, 302, stamped.body.slice(0, 300));
            assert.equal(
              stamped.headers.location,
              `/documents/filing/${documentId}`,
            );
          }
        };
        const counts = async () => {
          const result = await db.query<{
            tenancies: string;
            tenancy_links: string;
            signatories: string;
          }>(
            `SELECT
               (SELECT count(*) FROM tenancy WHERE unit_id = $1)::text AS tenancies,
               (SELECT count(*) FROM document_link
                 WHERE document_id = $2 AND entity_type = 'TENANCY')::text AS tenancy_links,
               (SELECT count(*) FROM document_link
                 WHERE document_id = $2 AND link_role = 'SIGNATORY')::text AS signatories`,
            [unitId, documentId],
          );
          const row = result.rows[0];
          return {
            tenancies: Number(row?.tenancies),
            tenancyLinks: Number(row?.tenancy_links),
            signatories: Number(row?.signatories),
          };
        };
        await run({
          clock,
          db,
          unitId,
          documentId,
          get,
          post,
          approve,
          counts,
        });
      } finally {
        await app.close();
      }
    });
  } finally {
    await pool.end();
  }
  return true;
}
