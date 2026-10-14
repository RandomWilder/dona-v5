// #240. The title is computed from the party and the flat. A lease reading that
// names a different address raises a flag on the tenancy page and does not block.
//
// Seam: HTTP at the app, the four places an operator reads the title, and the
// activation press.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  type Finding,
  type Opening,
  withOpening,
} from '../../tests/support/lease-opening.ts';
import {
  DEFAULT_TERMS_PROFILE,
  PROTOCOL_CONFIRM_ACTION,
} from '../evidence/contract.ts';
import { newId } from '../kernel/ids.ts';
import { skipReason } from '../kernel/pg-support.ts';

const ON = new Date('2026-10-14T09:00:00.000Z');
const START = '2026-01-01';
const END = '2027-10-31';
const MAIN = 'יוסף כהן';
const RENAMED = 'דנה כהן';

const household = (address: string): Finding[] => [
  { field_key: 'start_date', value: START, word_ids: [0] },
  { field_key: 'end_date', value: END, word_ids: [1] },
  { field_key: 'apartment_number', value: '7', word_ids: [2] },
  { field_key: 'address', value: address, word_ids: [3] },
  { field_key: 'main_tenant_name', value: MAIN, word_ids: [4] },
  { field_key: 'main_tenant_id_number', value: '000000018', word_ids: [5] },
];

function waitingRow(body: string, documentId: string): string {
  const at = body.indexOf(`data-document="${documentId}"`);
  assert.ok(at >= 0, 'the lease is listed');
  const end = body.indexOf('</li>', at);
  return body.slice(at, end);
}

function heading(body: string, pattern: RegExp): string {
  const found = body.match(pattern);
  assert.ok(found?.[1], pattern.source);
  return found[1];
}

async function placeOf(opening: Opening): Promise<{
  addressLine: string;
  city: string;
  unitNumber: string;
}> {
  const row = await opening.db.query<{
    address_line: string;
    city: string;
    unit_number: string;
  }>(
    `SELECT b.address_line, b.city, u.unit_number
       FROM unit u
       JOIN space s ON s.space_id = u.unit_id
       JOIN building b ON b.building_id = s.building_id
      WHERE u.unit_id = $1`,
    [opening.unitId],
  );
  const place = row.rows[0];
  assert.ok(place);
  return {
    addressLine: place.address_line,
    city: place.city,
    unitNumber: place.unit_number,
  };
}

describe('estate · #240 the tenancy title and the address flag', () => {
  it('computes the title in the four places, and flags a disagreeing address without blocking', async (t) => {
    const ran = await withOpening(
      { tag: 'title-240', on: ON, findings: household },
      async (o) => {
        const place = await placeOf(o);
        const readTitle = `${MAIN} · ${place.addressLine} · דירה ${place.unitNumber} · ${START}`;
        const unitTitle = `${MAIN} · ${place.addressLine}, ${place.city} · דירה ${place.unitNumber} · ${START}`;

        for (const key of [
          'start_date',
          'end_date',
          'main_tenant_name',
          'address',
          'apartment_number',
        ]) {
          await o.approve(key);
        }
        const waiting = waitingRow(
          (await o.get('/estate/tenancies')).body,
          o.documentId,
        );
        assert.match(
          waiting,
          new RegExp(readTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
        );

        const pressed = await o.post(`/documents/filing/${o.documentId}/open`, {
          terms_profile: DEFAULT_TERMS_PROFILE,
        });
        assert.equal(pressed.statusCode, 302, pressed.body.slice(0, 300));

        const tenancy = await o.db.query<{ tenancy_id: string }>(
          `SELECT tenancy_id FROM tenancy WHERE unit_id = $1`,
          [o.unitId],
        );
        const tenancyId = tenancy.rows[0]?.tenancy_id ?? '';
        assert.ok(tenancyId);

        const book = await o.get('/estate/tenancies');
        assert.match(book.body, new RegExp(unitTitle));
        const page = await o.get(`/estate/tenancies/${tenancyId}`);
        assert.match(
          heading(page.body, /<h1 class="b-title">([\s\S]*?)<\/h1>/),
          new RegExp(unitTitle),
        );
        assert.doesNotMatch(page.body, /אינה כתובת הדירה/);
        const draft = await o.get(`/documents/filing/${o.documentId}`);
        assert.match(
          heading(draft.body, /<h2>([\s\S]*?)<span class="chip">טיוטה/),
          new RegExp(unitTitle),
        );

        await o.db.query(
          `UPDATE party SET given_name = 'דנה'
            WHERE party_id = (
              SELECT party_id FROM tenancy_party
               WHERE tenancy_id = $1 AND role = 'PRIMARY_TENANT'
            )`,
          [tenancyId],
        );
        const renamed = unitTitle.replace(MAIN, RENAMED);
        const bookAfter = await o.get('/estate/tenancies');
        assert.match(bookAfter.body, new RegExp(renamed));
        assert.doesNotMatch(bookAfter.body, new RegExp(unitTitle));
        const pageAfter = await o.get(`/estate/tenancies/${tenancyId}`);
        const h1 = heading(
          pageAfter.body,
          /<h1 class="b-title">([\s\S]*?)<\/h1>/,
        );
        assert.match(h1, new RegExp(renamed));
        assert.doesNotMatch(h1, /יוסף/);
        const draftAfter = await o.get(`/documents/filing/${o.documentId}`);
        const h2 = heading(
          draftAfter.body,
          /<h2>([\s\S]*?)<span class="chip">טיוטה/,
        );
        assert.match(h2, new RegExp(renamed));
        assert.doesNotMatch(h2, /יוסף/);

        await o.db.query(
          `UPDATE building SET address_line = 'רחוב אחר 9'
            WHERE building_id = (
              SELECT s.building_id FROM unit u
                JOIN space s ON s.space_id = u.unit_id
               WHERE u.unit_id = $1
            )`,
          [o.unitId],
        );
        const type = await o.db.query<{ document_type_id: string }>(
          `SELECT document_type_id FROM document_type WHERE type_key = 'handover_protocol'`,
        );
        const documentId = newId();
        await o.db.query(
          `INSERT INTO document (
             document_id, document_type_id, storage_uri, file_hash,
             ingested_at, verification_verdict
           ) VALUES ($1, $2, $3, $4, $5, 'unguarded')`,
          [
            documentId,
            type.rows[0]?.document_type_id,
            `gs://x/${documentId}.pdf`,
            `hash-${documentId}`,
            ON,
          ],
        );
        await o.db.query(
          `INSERT INTO document_link (document_id, entity_type, entity_id, link_role)
           VALUES ($1, 'TENANCY', $2, 'EVIDENCE')`,
          [documentId, tenancyId],
        );
        await o.db.query(
          `INSERT INTO audit_log (
             id, at, actor_kind, actor_id, action, subject_id, inputs, outcome
           ) VALUES ($1, $2, 'staff', $3, $4, $5, '{}'::jsonb, 'ok')`,
          [newId(), ON, 'אסף', PROTOCOL_CONFIRM_ACTION, documentId],
        );

        const flagged = await o.get(`/estate/tenancies/${tenancyId}`);
        assert.match(flagged.body, /אינה כתובת הדירה/);
        assert.match(flagged.body, /הדקל/);
        assert.match(flagged.body, /רחוב אחר 9/);
        assert.match(flagged.body, /אינו חוסם/);
        const gate = flagged.body.split('מה נבדק')[1] ?? '';
        assert.doesNotMatch(gate, /אינה כתובת הדירה/);
        assert.match(
          flagged.body,
          /<button class="btn btn-primary" type="submit">הפעלת ההשכרה<\/button>/,
        );

        const activated = await o.post(
          `/estate/tenancies/${tenancyId}/activate`,
          {},
        );
        assert.equal(activated.statusCode, 302, activated.body.slice(0, 300));
        const status = await o.db.query<{ status: string }>(
          `SELECT status FROM tenancy WHERE tenancy_id = $1`,
          [tenancyId],
        );
        assert.equal(status.rows[0]?.status, 'ACTIVE');
        const still = await o.get(`/estate/tenancies/${tenancyId}`);
        assert.match(still.body, /אינה כתובת הדירה/);
      },
    );
    if (!ran) t.skip(skipReason);
  });
});
