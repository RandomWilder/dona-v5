// #283. Every attachment is quarantined and scanned before it can be opened.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Pool } from 'pg';
import { asOperator, signIn } from '../../tests/support/session.ts';
import { buildApp } from '../app.ts';
import { fixedClock } from '../kernel/clock.ts';
import { createMemoryStore } from '../kernel/objects.ts';
import { createFakePdfText } from '../kernel/pdf.ts';
import {
  inRolledBackTransaction,
  migratedPoolOrNull,
  skipReason,
} from '../kernel/pg-support.ts';
import {
  fileAttachment,
  holdAttachment,
  type IncomingMessage,
  listMessagesOnCall,
  type MalwareScanner,
  readAttachment,
  receiveIncoming,
  type Sorter,
  scannerFromEnv,
} from './contract.ts';
import { classifyAttachment } from './internal/attachments.ts';

const AT = new Date('2026-10-21T12:00:00.000Z');
const PDF = Buffer.from('%PDF-1.4\n% fabricated\n', 'latin1');

function sorter(): Sorter {
  return {
    async sort() {
      return { label: 'call', categoryCode: null, summary: null };
    },
    async translate() {
      return { bodyHe: null };
    },
  };
}

function scanner(verdict: 'clean' | 'infected' | 'down'): MalwareScanner {
  return {
    async scan() {
      if (verdict === 'down') throw new Error('scanner down');
      return verdict;
    },
  };
}

function incoming(
  channel: 'EMAIL' | 'WHATSAPP',
  bytes: Buffer,
  fileName: string,
): IncomingMessage {
  return {
    sourceChannel: channel,
    externalMessageId: `scan-${channel}-${fileName}`,
    externalThreadId: `scan-${channel}`,
    senderAddress: channel === 'EMAIL' ? 'one@scan-283.test' : '+972501112233',
    receivedAt: AT,
    subject: null,
    body: 'מצורף',
    attachments: [
      {
        fileName,
        contentType: 'application/octet-stream',
        byteSize: bytes.length,
        bytes,
      },
    ],
  };
}

describe('channel · attachment scan', () => {
  it('the local scanner is not built where K_SERVICE is set', async () => {
    assert.equal(scannerFromEnv({ K_SERVICE: 'dona' }), undefined);
    const local = scannerFromEnv({});
    assert.ok(local);
    assert.equal(await local.scan(PDF), 'clean');
    const eicar = Buffer.concat([
      PDF,
      Buffer.from(
        'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*',
      ),
    ]);
    assert.equal(await local.scan(eicar), 'infected');
  });

  it('opens a clean file and refuses one the allowlist does not name', async (t) => {
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
          scanner: scanner('clean'),
        });
        const who = await signIn(db as unknown as Pool, clock, {
          email: 'ops@scan-283.test',
          role: 'OPERATOR',
        });
        const client = asOperator(app, who);
        const outcome = await receiveIncoming(
          db,
          clock,
          {
            sorter: sorter(),
            matchesEmergency: async () => false,
            objects,
            scanner: scanner('clean'),
          },
          incoming('EMAIL', PDF, 'lease.pdf'),
        );
        assert.equal(outcome.kind, 'call');
        if (outcome.kind !== 'call') return;
        const page = await client.inject({
          method: 'GET',
          url: `/calls/${outcome.callId}`,
        });
        const open = page.body.match(
          new RegExp(`/calls/${outcome.callId}/messages/[0-9a-f-]{36}/files/0`),
        );
        assert.ok(open);
        const file = await client.inject({ method: 'GET', url: open[0] });
        assert.equal(file.statusCode, 200);
        assert.equal(file.body, PDF.toString('latin1'));

        const refused = await receiveIncoming(
          db,
          clock,
          {
            sorter: sorter(),
            matchesEmergency: async () => false,
            objects,
            scanner: scanner('clean'),
          },
          {
            ...incoming('WHATSAPP', Buffer.from('not-a-photo'), 'note.txt'),
            externalMessageId: 'scan-WHATSAPP-note',
            externalThreadId: 'scan-WHATSAPP-note',
          },
        );
        assert.equal(refused.kind, 'call');
        if (refused.kind !== 'call') return;
        const messages = await listMessagesOnCall(db, refused.callId);
        assert.equal(messages[0]?.attachments[0]?.fileName, 'note.txt');
        assert.equal(messages[0]?.attachments[0]?.openable, false);
        const hidden = await client.inject({
          method: 'GET',
          url: `/calls/${refused.callId}`,
        });
        assert.doesNotMatch(hidden.body, /\/files\/0/);
        await app.close();
      });
    } finally {
      await pool.end();
    }
  });

  it('keeps an infected file unopenable and writes an audit row', async (t) => {
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
          scanner: scanner('infected'),
        });
        const who = await signIn(db as unknown as Pool, clock, {
          email: 'ops@scan-infected.test',
          role: 'OPERATOR',
        });
        const client = asOperator(app, who);
        const outcome = await receiveIncoming(
          db,
          clock,
          {
            sorter: sorter(),
            matchesEmergency: async () => false,
            objects,
            scanner: scanner('infected'),
          },
          incoming('WHATSAPP', PDF, 'leak.pdf'),
        );
        assert.equal(outcome.kind, 'call');
        if (outcome.kind !== 'call') return;
        const messages = await listMessagesOnCall(db, outcome.callId);
        const message = messages[0];
        assert.ok(message);
        assert.equal(message.attachments[0]?.openable, false);
        const page = await client.inject({
          method: 'GET',
          url: `/calls/${outcome.callId}`,
        });
        assert.doesNotMatch(page.body, /\/files\/0/);
        assert.equal(
          (
            await client.inject({
              method: 'GET',
              url: `/calls/${outcome.callId}/messages/${message.id}/files/0`,
            })
          ).statusCode,
          404,
        );
        await assert.rejects(
          () =>
            readAttachment(db, objects, {
              callId: outcome.callId,
              messageId: message.id,
              index: 0,
            }),
          /attachment not found/,
        );
        await assert.rejects(
          () =>
            fileAttachment(
              db,
              clock,
              { objects, pdf: createFakePdfText([]), bucket: 'b' },
              {
                callId: outcome.callId,
                messageId: message.id,
                index: 0,
                typeKey: 'paper',
                actorId: who.staffAccountId,
              },
            ),
          /attachment has no file/,
        );
        const audit = await db.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM audit_log
            WHERE action = 'channel.attachment_infected'
              AND subject_id = $1`,
          [message.id],
        );
        assert.equal(audit.rows[0]?.n, 1);
        await app.close();
      });
    } finally {
      await pool.end();
    }
  });

  it('does not open a file when the scanner is down, and does not call it infected', async (t) => {
    const pool = await migratedPoolOrNull();
    if (!pool) {
      t.skip(skipReason);
      return;
    }
    try {
      await inRolledBackTransaction(pool, async (db) => {
        const clock = fixedClock(AT);
        const objects = createMemoryStore();
        const outcome = await receiveIncoming(
          db,
          clock,
          {
            sorter: sorter(),
            matchesEmergency: async () => false,
            objects,
            scanner: scanner('down'),
          },
          incoming('EMAIL', PDF, 'bill.pdf'),
        );
        assert.equal(outcome.kind, 'call');
        if (outcome.kind !== 'call') return;
        const messages = await listMessagesOnCall(db, outcome.callId);
        const message = messages[0];
        assert.ok(message);
        assert.equal(message.attachments[0]?.openable, false);
        const audit = await db.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM audit_log
            WHERE action = 'channel.attachment_infected'
              AND subject_id = $1`,
          [message.id],
        );
        assert.equal(audit.rows[0]?.n, 0);
      });
    } finally {
      await pool.end();
    }
  });

  it('keeps MP4 and WebM, and refuses a DASH brand and a Matroska file', () => {
    const ftyp = (brand: string) => {
      const bytes = Buffer.alloc(16);
      bytes.write('ftyp', 4, 'ascii');
      bytes.write(brand, 8, 'ascii');
      return bytes;
    };
    const ebml = Buffer.from([0x1a, 0x45, 0xdf, 0xa3]);
    assert.equal(classifyAttachment(ftyp('isom')).ok, true);
    assert.equal(classifyAttachment(ftyp('qt  ')).ok, true);
    assert.equal(classifyAttachment(ftyp('dash')).ok, false);
    assert.equal(
      classifyAttachment(Buffer.concat([ebml, Buffer.from('webm')])).ok,
      true,
    );
    assert.equal(
      classifyAttachment(Buffer.concat([ebml, Buffer.from('matroska')])).ok,
      false,
    );
  });

  it('refuses a ninth file on the same report', async (t) => {
    const pool = await migratedPoolOrNull();
    if (pool === null) return t.skip(skipReason);
    t.after(() => pool.end());
    const clock = fixedClock(AT);
    const objects = createMemoryStore();
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
    await inRolledBackTransaction(pool, async (db) => {
      const spec = {
        ownerId: '01a15ea4-5e8b-7ce8-8aa7-4de82a68b95d',
        submissionId: '01a15ea4-4ca9-7d11-9755-b26617aa3b97',
      };
      for (let n = 0; n < 8; n += 1) {
        const saved = await holdAttachment(
          db,
          clock,
          objects,
          scanner('clean'),
          {
            ...spec,
            fileName: `p${n}.jpg`,
            bytes: jpeg,
          },
        );
        assert.equal(saved.status, 'clean');
      }
      const ninth = await holdAttachment(db, clock, objects, scanner('clean'), {
        ...spec,
        fileName: 'p8.jpg',
        bytes: jpeg,
      });
      assert.deepEqual(ninth, { status: 'refused', reason: 'many' });
    });
  });
});
