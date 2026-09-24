// POLICY CASE — ending the outgoing letting is what lets the incoming one activate.
//
// #154. `one_active_tenancy_per_unit` is partial on ACTIVE, so a draft may overlap a
// live letting. The activation gate names that letting and refuses before the update;
// the constraint still rejects a promotion that skips the gate. The person command
// that clears the block is `endTenancyEarly`: the outgoing row leaves ACTIVE, its
// contractual end stays, and the draft can then activate.
//
// Written red first against the command as it stood before #154: there was no command.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { listTenancyDocumentFacts } from '../../src/evidence/contract.ts';
import { fixedClock } from '../../src/kernel/clock.ts';
import { KernelError } from '../../src/kernel/errors.ts';
import { newId } from '../../src/kernel/ids.ts';
import {
  activateTenancy,
  endTenancyEarly,
  getTenancy,
  listTenancyEvents,
} from '../../src/tenancy/contract.ts';
import { seedOccupancy } from './fixtures.ts';
import { inRolledBackTransaction, policyPool, skipReason } from './support.ts';

const AT = new Date('2026-09-24T09:00:00.000Z');
const CLOCK = fixedClock(AT);
const ACTOR = 'אסף';
const CONTRACTUAL_END = '2026-10-31';
const MOVE_OUT = '2026-09-24';

async function linkApproved(
  db: Parameters<typeof seedOccupancy>[0],
  tenancyId: string,
  typeKey: string,
): Promise<void> {
  const typeId = newId();
  const documentId = newId();
  const type = await db.query<{ document_type_id: string }>(
    `INSERT INTO document_type (
       document_type_id, type_key, label_he, label_en, verification_terms, is_active
     ) VALUES ($1, $2, $3, NULL, NULL, true)
     ON CONFLICT (type_key) DO UPDATE SET label_he = EXCLUDED.label_he
     RETURNING document_type_id`,
    [typeId, typeKey, typeKey === 'lease' ? 'חוזה שכירות' : 'פרוטוקול מסירה'],
  );
  const documentTypeId = type.rows[0]?.document_type_id ?? typeId;
  await db.query(
    `INSERT INTO document (
       document_id, document_type_id, storage_uri, file_hash,
       ingested_at, verification_verdict
     ) VALUES ($1, $2, $3, $4, $5, 'unguarded')`,
    [
      documentId,
      documentTypeId,
      `gs://x/${documentId}.pdf`,
      `hash-${documentId}`,
      AT,
    ],
  );
  await db.query(
    `INSERT INTO document_link (document_id, entity_type, entity_id, link_role)
     VALUES ($1, 'TENANCY', $2, 'EVIDENCE')`,
    [documentId, tenancyId],
  );
}

describe('policy · ending a letting early frees the unit', () => {
  it('blocks the incoming draft until the outgoing letting is ended', async (t) => {
    const pool = await policyPool();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await inRolledBackTransaction(pool, async (db) => {
        const outgoing = await seedOccupancy(db, '1541', {
          phone: '+972501541541',
          contactFrom: '2025-11-01',
          contactTo: null,
          tenancyFrom: '2025-11-01',
          tenancyTo: CONTRACTUAL_END,
          status: 'ACTIVE',
        });
        const incoming = await seedOccupancy(db, '1541', {
          phone: '+972501541542',
          contactFrom: '2026-09-15',
          contactTo: null,
          tenancyFrom: '2026-09-15',
          tenancyTo: '2027-09-14',
          status: 'DRAFT',
          unitId: outgoing.unitId,
        });
        for (const typeKey of ['lease', 'handover_protocol']) {
          await linkApproved(db, incoming.tenancyId, typeKey);
        }

        await assert.rejects(
          () =>
            activateTenancy(
              db,
              CLOCK,
              { tenancyId: incoming.tenancyId, actor: ACTOR },
              listTenancyDocumentFacts,
            ),
          (error: unknown) => {
            if (!(error instanceof KernelError) || error.code !== 'invalid') {
              return false;
            }
            const checks = error.details?.checks as
              | Array<{
                  rule: string;
                  passed: boolean;
                  blocking?: { tenancyId: string };
                }>
              | undefined;
            const free = checks?.find((row) => row.rule === 'unit_free');
            return (
              free?.passed === false &&
              free.blocking?.tenancyId === outgoing.tenancyId
            );
          },
        );

        await endTenancyEarly(db, CLOCK, {
          tenancyId: outgoing.tenancyId,
          actualMoveOut: MOVE_OUT,
          noticeDate: '2026-08-20',
          actor: ACTOR,
        });

        const ended = await getTenancy(db, outgoing.tenancyId);
        assert.equal(ended.status, 'TERMINATED_EARLY');
        assert.equal(ended.end_date, CONTRACTUAL_END);
        const dates = await db.query<{
          actual_move_out: string;
          notice_date: string;
        }>(
          `SELECT actual_move_out::text, notice_date::text
             FROM tenancy WHERE tenancy_id = $1`,
          [outgoing.tenancyId],
        );
        assert.equal(dates.rows[0]?.actual_move_out, MOVE_OUT);
        assert.equal(dates.rows[0]?.notice_date, '2026-08-20');

        const log = await listTenancyEvents(db, outgoing.unitId);
        const events = log.filter(
          (row) => row.tenancy_id === outgoing.tenancyId,
        );
        assert.equal(events.length, 1);
        assert.equal(events[0]?.kind, 'ended_early');
        assert.equal(events[0]?.actor, ACTOR);
        assert.equal(events[0]?.field, 'status');
        assert.equal(events[0]?.old_value, 'ACTIVE');
        assert.equal(events[0]?.new_value, 'TERMINATED_EARLY');
        assert.equal(events[0]?.source_document_id, null);
        assert.equal(events[0]?.at, AT.toISOString());

        await activateTenancy(
          db,
          CLOCK,
          { tenancyId: incoming.tenancyId, actor: ACTOR },
          listTenancyDocumentFacts,
        );
        const live = await getTenancy(db, incoming.tenancyId);
        assert.equal(live.status, 'ACTIVE');
      });
    } finally {
      await pool.end();
    }
  });
});
