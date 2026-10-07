// #190. An email's file shows on the call and opens. Filing it makes one
// Unassigned document, and filing it again does not make a second.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Pool } from 'pg';
import { seedOccupancy } from '../../tests/policy/fixtures.ts';
import { asOperator, signIn } from '../../tests/support/session.ts';
import { buildApp } from '../app.ts';
import {
  listLinkedDocuments,
  upsertDocumentType,
} from '../evidence/contract.ts';
import { fixedClock } from '../kernel/clock.ts';
import { createMemoryStore } from '../kernel/objects.ts';
import { createFakePdfText } from '../kernel/pdf.ts';
import {
  inRolledBackTransaction,
  migratedPoolOrNull,
  skipReason,
} from '../kernel/pg-support.ts';
import { addOperator } from '../staff/contract.ts';
import {
  fileAttachment,
  type IncomingMessage,
  listMessagesOnCall,
  readAttachment,
  receiveIncoming,
  type Sorter,
  type SortVerdict,
} from './contract.ts';

const AT = new Date('2026-10-06T12:00:00.000Z');
const PDF = Buffer.from('%PDF-1.4\n% fabricated\n', 'latin1');
const BUCKET = 'dona-v5-test-attach';

const CALL: SortVerdict = {
  label: 'call',
  categoryCode: null,
  summary: null,
};

function sorter(): Sorter {
  return {
    async sort() {
      return CALL;
    },
    async translate() {
      return { bodyHe: null };
    },
  };
}

function incoming(over: Partial<IncomingMessage> = {}): IncomingMessage {
  return {
    sourceChannel: 'EMAIL',
    externalMessageId: 'msg-190',
    externalThreadId: 'thread-190',
    senderAddress: 'one@file-190.test',
    receivedAt: AT,
    subject: 'חשבון',
    body: 'מצורף המסמך',
    attachments: [
      {
        fileName: 'lease.pdf',
        contentType: 'application/pdf',
        byteSize: 22,
        bytes: PDF,
      },
    ],
    ...over,
  };
}

describe('channel · attachments on the call', () => {
  it('shows the file name, type and size, and opens the bytes', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await inRolledBackTransaction(pool, async (db) => {
        const clock = fixedClock(AT);
        const objects = createMemoryStore();
        const app = buildApp({
          pool: db as unknown as Pool,
          version: '9.9.9-test',
          clock,
          objects,
          bucket: BUCKET,
        });
        await upsertDocumentType(db, {
          typeKey: 'paper_190_page',
          labelHe: 'מסמך מקריאה',
          labelEn: null,
          verificationTerms: null,
          isActive: true,
        });
        const who = await signIn(db as unknown as Pool, clock, {
          email: 'ops@attach-190.test',
          role: 'OPERATOR',
        });
        const client = asOperator(app, who);
        const outcome = await receiveIncoming(
          db,
          clock,
          { sorter: sorter(), matchesEmergency: async () => false, objects },
          incoming({
            externalMessageId: 'attach-190.test-1',
            externalThreadId: 'attach-190.test-thread',
            senderAddress: 'tenant@attach-190.test',
          }),
        );
        assert.equal(outcome.kind, 'call');
        if (outcome.kind !== 'call') return;
        const page = await client.inject({
          method: 'GET',
          url: `/calls/${outcome.callId}`,
        });
        assert.equal(page.statusCode, 200);
        assert.match(page.body, /data-file="lease\.pdf"/);
        assert.match(page.body, /data-type="application\/pdf"/);
        assert.match(page.body, /data-size="22"/);
        assert.match(page.body, /תייק כמסמך/);
        const open = page.body.match(
          new RegExp(
            `/calls/${outcome.callId}/messages/([0-9a-f-]{36})/files/0`,
          ),
        );
        assert.ok(open);
        const file = await client.inject({ method: 'GET', url: open[0] });
        assert.equal(file.statusCode, 200);
        assert.equal(file.headers['content-type'], 'application/pdf');
        assert.equal(file.body, PDF.toString('latin1'));
        await app.close();
      });
    } finally {
      await pool.end();
    }
  });

  it('files one unassigned document, and filing again is that document', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await inRolledBackTransaction(pool, async (db) => {
        const clock = fixedClock(AT);
        const objects = createMemoryStore();
        const tenant = await seedOccupancy(db, '1901', {
          phone: '+972501901901',
          email: 'one@file-190.test',
          contactFrom: '2026-01-01',
          contactTo: null,
          tenancyFrom: '2026-01-01',
          tenancyTo: '2027-01-01',
        });
        await upsertDocumentType(db, {
          typeKey: 'paper_190',
          labelHe: 'מסמך מקריאה',
          labelEn: 'Call paper',
          verificationTerms: null,
          isActive: true,
        });
        const { account } = await addOperator(db, clock, {
          email: 'ops@file-190.test',
          role: 'OPERATOR',
        });
        const outcome = await receiveIncoming(
          db,
          clock,
          { sorter: sorter(), matchesEmergency: async () => false, objects },
          incoming(),
        );
        assert.equal(outcome.kind, 'call');
        if (outcome.kind !== 'call') return;
        const messages = await listMessagesOnCall(db, outcome.callId);
        const message = messages[0];
        assert.ok(message);
        const opened = await readAttachment(db, objects, {
          callId: outcome.callId,
          messageId: message.id,
          index: 0,
        });
        assert.equal(opened.bytes.equals(PDF), true);
        const filing = {
          objects,
          pdf: createFakePdfText([]),
          bucket: BUCKET,
        };
        const spec = {
          callId: outcome.callId,
          messageId: message.id,
          index: 0,
          typeKey: 'paper_190',
          actorId: account.staffAccountId,
          actorRole: account.role,
        };
        const first = await fileAttachment(db, clock, filing, spec);
        const second = await fileAttachment(db, clock, filing, spec);
        assert.equal(second.documentId, first.documentId);
        const onUnit = await listLinkedDocuments(db, 'UNIT', tenant.unitId);
        assert.equal(onUnit.length, 1);
        assert.equal(onUnit[0]?.documentId, first.documentId);
        const onTenancy = await listLinkedDocuments(
          db,
          'TENANCY',
          tenant.tenancyId,
        );
        assert.equal(onTenancy.length, 0);
        const audit = await db.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM audit_log
            WHERE action = 'channel.file_attachment'
              AND actor_id = $1
              AND subject_id = $2`,
          [account.staffAccountId, message.id],
        );
        assert.equal(audit.rows[0]?.n, 1);
        const evidence = await db.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM audit_log
            WHERE action = 'evidence.file_document'
              AND actor_id = $1`,
          [account.staffAccountId],
        );
        assert.equal(evidence.rows[0]?.n, 1);
      });
    } finally {
      await pool.end();
    }
  });
});
