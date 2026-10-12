// #196. The Gmail standby, on recorded Gmail API payloads. No test calls Google.
import assert from 'node:assert/strict';
import { glob, readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  GMAIL_SCOPE,
  normaliseGmailMessage,
  normaliseOutlookMessage,
} from './contract.ts';

const RECEIVED = '2026-10-06T09:15:00.000Z';

const OUTLOOK = {
  id: 'AAMkAG-first',
  conversationId: 'AAQkAG-thread-1',
  subject: 'נזילה בכיור',
  body: { contentType: 'text', content: 'יש נזילה מתחת לכיור' },
  from: { emailAddress: { name: 'יעל', address: 'yael@tenant.test' } },
  receivedDateTime: '2026-10-06T09:15:00Z',
  hasAttachments: false,
};

const GMAIL = {
  id: '18f0a1b2c3d4e5f6',
  threadId: '18f0a1thread0001',
  labelIds: ['INBOX', 'UNREAD'],
  internalDate: '1791278100000',
  payload: {
    mimeType: 'text/plain',
    filename: '',
    headers: [
      { name: 'From', value: 'יעל <yael@tenant.test>' },
      { name: 'Subject', value: 'נזילה בכיור' },
      { name: 'Date', value: 'Tue, 06 Oct 2026 09:15:00 +0000' },
    ],
    body: {
      size: 37,
      data: Buffer.from('יש נזילה מתחת לכיור').toString('base64url'),
    },
  },
};

const OUTLOOK_REPLY = {
  id: 'AAMkAG-reply',
  conversationId: 'AAQkAG-thread-1',
  subject: 'RE: נזילה בכיור',
  body: { contentType: 'html', content: '<p>עדיין נוזל</p>' },
  from: { emailAddress: { address: 'yael@tenant.test' } },
  receivedDateTime: '2026-10-06T10:00:00Z',
  hasAttachments: false,
};

const GMAIL_REPLY = {
  id: '18f0reply0000001',
  threadId: '18f0a1thread0001',
  labelIds: ['INBOX'],
  internalDate: '1791280800000',
  payload: {
    mimeType: 'text/html',
    filename: '',
    headers: [
      { name: 'From', value: 'yael@tenant.test' },
      { name: 'Subject', value: 'RE: נזילה בכיור' },
    ],
    body: {
      size: 22,
      data: Buffer.from('<p>עדיין נוזל</p>').toString('base64url'),
    },
  },
};

const OUTLOOK_FILE = {
  id: 'AAMkAG-file',
  conversationId: 'AAQkAG-thread-2',
  subject: 'חשבון',
  body: { contentType: 'text', content: 'מצורף החשבון' },
  from: { emailAddress: { address: 'dana@tenant.test' } },
  receivedDateTime: '2026-10-06T11:00:00Z',
  hasAttachments: true,
};

const OUTLOOK_ATTACHMENT = {
  id: 'att-1',
  name: 'cheshbon.pdf',
  contentType: 'application/pdf',
  size: 2048,
  isInline: false,
};

const GMAIL_FILE = {
  id: '18f0file00000001',
  threadId: '18f0a1thread0002',
  labelIds: ['INBOX'],
  internalDate: '1791284400000',
  payload: {
    mimeType: 'multipart/mixed',
    filename: '',
    headers: [
      { name: 'From', value: 'Dana <dana@tenant.test>' },
      { name: 'Subject', value: 'חשבון' },
    ],
    body: { size: 0 },
    parts: [
      {
        mimeType: 'text/plain',
        filename: '',
        body: {
          size: 22,
          data: Buffer.from('מצורף החשבון').toString('base64url'),
        },
      },
      {
        mimeType: 'application/pdf',
        filename: 'cheshbon.pdf',
        headers: [
          {
            name: 'Content-Disposition',
            value: 'attachment; filename="cheshbon.pdf"',
          },
          { name: 'Content-Type', value: 'application/pdf' },
        ],
        body: { attachmentId: 'ANGjdJ-att', size: 2048 },
      },
    ],
  },
};

describe('channel · gmail', () => {
  it('normalises a recorded message into the same incoming email as Outlook', () => {
    const outlook = normaliseOutlookMessage(OUTLOOK, []);
    const gmail = normaliseGmailMessage(GMAIL);
    assert.ok(outlook);
    assert.ok(gmail);
    assert.equal(gmail.sourceChannel, outlook.sourceChannel);
    assert.equal(gmail.senderAddress, outlook.senderAddress);
    assert.equal(gmail.receivedAt.toISOString(), RECEIVED);
    assert.equal(
      gmail.receivedAt.toISOString(),
      outlook.receivedAt.toISOString(),
    );
    assert.equal(gmail.subject, outlook.subject);
    assert.equal(gmail.body, outlook.body);
    assert.equal(gmail.echo, false);
    assert.deepEqual(gmail.attachments ?? [], outlook.attachments ?? []);
    assert.equal(gmail.externalMessageId, '18f0a1b2c3d4e5f6');
    assert.equal(gmail.externalThreadId, '18f0a1thread0001');
  });

  it('keeps a reply on the Gmail thread, as Outlook keeps one on the conversation', () => {
    const outlookFirst = normaliseOutlookMessage(OUTLOOK, []);
    const outlookReply = normaliseOutlookMessage(OUTLOOK_REPLY, []);
    const gmailFirst = normaliseGmailMessage(GMAIL);
    const gmailReply = normaliseGmailMessage(GMAIL_REPLY);
    assert.ok(outlookFirst);
    assert.ok(outlookReply);
    assert.ok(gmailFirst);
    assert.ok(gmailReply);
    assert.equal(outlookReply.externalThreadId, outlookFirst.externalThreadId);
    assert.equal(gmailReply.externalThreadId, gmailFirst.externalThreadId);
    assert.notEqual(gmailReply.externalMessageId, gmailFirst.externalMessageId);
    assert.equal(gmailReply.body, outlookReply.body);
    assert.equal(gmailReply.subject, outlookReply.subject);
    assert.equal(gmailReply.senderAddress, outlookReply.senderAddress);
    assert.equal(
      gmailReply.receivedAt.toISOString(),
      '2026-10-06T10:00:00.000Z',
    );
  });

  it('normalises an email with an attachment the way Outlook does', () => {
    const outlook = normaliseOutlookMessage(OUTLOOK_FILE, [OUTLOOK_ATTACHMENT]);
    const gmail = normaliseGmailMessage(GMAIL_FILE);
    assert.ok(outlook);
    assert.ok(gmail);
    assert.equal(gmail.body, outlook.body);
    assert.equal(gmail.senderAddress, outlook.senderAddress);
    assert.equal(gmail.subject, outlook.subject);
    assert.deepEqual(gmail.attachments, outlook.attachments);
    assert.equal(gmail.externalThreadId, '18f0a1thread0002');
  });

  it('keeps an attachment’s bytes and skips an image embedded in the message', () => {
    const pdf = Buffer.from('%PDF-1.4\n');
    const outlook = normaliseOutlookMessage(OUTLOOK_FILE, [
      { ...OUTLOOK_ATTACHMENT, contentBytes: pdf.toString('base64') },
      {
        ...OUTLOOK_ATTACHMENT,
        id: 'att-logo',
        name: 'logo.png',
        isInline: true,
        contentBytes: pdf.toString('base64'),
      },
    ]);
    const gmail = normaliseGmailMessage({
      ...GMAIL_FILE,
      payload: {
        ...GMAIL_FILE.payload,
        parts: [
          GMAIL_FILE.payload.parts[0],
          {
            ...GMAIL_FILE.payload.parts[1],
            body: { size: pdf.length, data: pdf.toString('base64url') },
          },
          {
            mimeType: 'image/png',
            filename: 'logo.png',
            headers: [
              {
                name: 'Content-Disposition',
                value: 'inline; filename="logo.png"',
              },
            ],
            body: { size: pdf.length, data: pdf.toString('base64url') },
          },
        ],
      },
    });
    assert.ok(outlook);
    assert.ok(gmail);
    assert.equal(gmail.attachments?.length, 1);
    assert.equal(gmail.attachments?.[0]?.fileName, 'cheshbon.pdf');
    assert.equal(gmail.attachments?.[0]?.byteSize, pdf.length);
    assert.equal(gmail.attachments?.[0]?.bytes?.equals(pdf), true);
    assert.deepEqual(gmail.attachments, outlook.attachments);
  });

  it('keeps a photo pasted into the body, as Outlook does', () => {
    const photo = Buffer.alloc(64 * 1024, 1);
    const gmail = normaliseGmailMessage({
      ...GMAIL_FILE,
      payload: {
        ...GMAIL_FILE.payload,
        parts: [
          GMAIL_FILE.payload.parts[0],
          {
            mimeType: 'image/png',
            filename: 'image.png',
            headers: [
              {
                name: 'Content-Disposition',
                value: 'inline; filename="image.png"',
              },
            ],
            body: { size: photo.length, data: photo.toString('base64url') },
          },
        ],
      },
    });
    const outlook = normaliseOutlookMessage(OUTLOOK_FILE, [
      {
        ...OUTLOOK_ATTACHMENT,
        name: 'image.png',
        contentType: 'image/png',
        isInline: true,
        contentBytes: photo.toString('base64'),
      },
    ]);
    assert.ok(gmail);
    assert.ok(outlook);
    assert.equal(gmail.attachments?.length, 1);
    assert.equal(gmail.attachments?.[0]?.bytes?.equals(photo), true);
    assert.deepEqual(gmail.attachments, outlook.attachments);
  });

  it('keeps an email that is only an attachment', () => {
    const outlook = normaliseOutlookMessage(
      {
        ...OUTLOOK_FILE,
        subject: '   ',
        body: { contentType: 'text', content: '  ' },
      },
      [OUTLOOK_ATTACHMENT],
    );
    const gmail = normaliseGmailMessage({
      ...GMAIL_FILE,
      payload: {
        ...GMAIL_FILE.payload,
        headers: [
          { name: 'From', value: 'Dana <dana@tenant.test>' },
          { name: 'Subject', value: '   ' },
        ],
        parts: [GMAIL_FILE.payload.parts[1]],
      },
    });
    assert.ok(outlook);
    assert.ok(gmail);
    assert.equal(gmail.subject, null);
    assert.equal(gmail.body, 'cheshbon.pdf');
    assert.equal(gmail.subject, outlook.subject);
    assert.equal(gmail.body, outlook.body);
  });

  it('keeps a body the message marks inline, and only skips an embedded file', () => {
    const outlook = normaliseOutlookMessage(OUTLOOK, []);
    const gmail = normaliseGmailMessage({
      ...GMAIL,
      payload: {
        ...GMAIL.payload,
        headers: [
          ...GMAIL.payload.headers,
          { name: 'Content-Disposition', value: 'inline' },
        ],
      },
    });
    assert.ok(outlook);
    assert.ok(gmail);
    assert.equal(gmail.body, outlook.body);
    assert.deepEqual(gmail.attachments ?? [], []);
  });

  it('keeps a sender that is not an email address', () => {
    const outlook = normaliseOutlookMessage(
      {
        ...OUTLOOK,
        from: { emailAddress: { address: 'not-an-email' } },
      },
      [],
    );
    const gmail = normaliseGmailMessage({
      ...GMAIL,
      payload: {
        ...GMAIL.payload,
        headers: [
          { name: 'From', value: 'not-an-email' },
          { name: 'Subject', value: 'נזילה בכיור' },
        ],
      },
    });
    assert.ok(outlook);
    assert.ok(gmail);
    assert.equal(gmail.senderAddress, 'not-an-email');
    assert.equal(gmail.senderAddress, outlook.senderAddress);
  });

  it('takes the address when the display name has no brackets', () => {
    const outlook = normaliseOutlookMessage(OUTLOOK, []);
    const gmail = normaliseGmailMessage({
      ...GMAIL,
      payload: {
        ...GMAIL.payload,
        headers: [
          { name: 'From', value: 'יעל yael@tenant.test' },
          { name: 'Subject', value: 'נזילה בכיור' },
        ],
      },
    });
    assert.ok(outlook);
    assert.ok(gmail);
    assert.equal(gmail.senderAddress, 'yael@tenant.test');
    assert.equal(gmail.senderAddress, outlook.senderAddress);
  });

  it('drops a payload that is not a Gmail message', () => {
    assert.equal(normaliseGmailMessage({ snippet: 'no id' }), null);
    assert.equal(normaliseGmailMessage({ ...GMAIL, threadId: '' }), null);
    assert.equal(normaliseGmailMessage({ ...GMAIL, internalDate: '' }), null);
  });

  it('is not configured or scheduled, and holds no scope beyond gmail.readonly', async () => {
    assert.equal(GMAIL_SCOPE, 'https://www.googleapis.com/auth/gmail.readonly');
    const root = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      '../..',
    );
    const adapter = await readFile(
      path.join(root, 'src/channel/internal/gmail.ts'),
      'utf8',
    );
    assert.doesNotMatch(adapter, /setInterval|process\.env/);
    const scopes = new Set<string>();
    const beyond =
      /gmail\.(modify|send|compose|insert|metadata|labels|settings)\b|mail\.google\.com/;
    for (const file of await sourceFiles(root)) {
      if (file.endsWith('.test.ts')) continue;
      const source = await readFile(file, 'utf8');
      assert.doesNotMatch(source, beyond, file);
      for (const match of source.matchAll(
        /https:\/\/www\.googleapis\.com\/auth\/gmail\.[a-z.]+/g,
      )) {
        const found = match[0];
        if (found) scopes.add(found);
      }
    }
    assert.deepEqual([...scopes], [GMAIL_SCOPE]);
    for (const file of ['src/serve.ts', 'src/app.ts', '.env.example']) {
      const source = await readFile(path.join(root, file), 'utf8');
      assert.equal(source.toLowerCase().includes('gmail'), false, file);
    }
  });
});

async function sourceFiles(root: string): Promise<string[]> {
  const found: string[] = [];
  for (const dir of ['src', 'infra', '.github']) {
    for await (const entry of glob('**/*.{ts,yml,yaml,sh,example}', {
      cwd: path.join(root, dir),
    })) {
      found.push(path.join(root, dir, entry));
    }
  }
  found.push(path.join(root, '.env.example'));
  return found;
}
