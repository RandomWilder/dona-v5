import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import type { ChromeDest, signedInChrome } from '../../chrome.ts';
import { createAuditLog } from '../../kernel/audit.ts';
import type { Clock } from '../../kernel/clock.ts';
import { createSettings, readOcrSettings } from '../../kernel/config.ts';
import type { Embedder } from '../../kernel/embeddings.ts';
import { KernelError } from '../../kernel/errors.ts';
import type { ObjectStore } from '../../kernel/objects.ts';
import type { OcrText } from '../../kernel/ocr.ts';
import type { PdfText } from '../../kernel/pdf.ts';
import { renderPage } from '../../kernel/ui/page.ts';
import {
  CSRF_FIELD,
  can,
  csrfFrom,
  readSessionCookie,
  verifyCsrf,
} from '../../staff/contract.ts';
import { listPolicyLibrary, uploadPolicyDocument } from './library.ts';
import { renderPolicyPage } from './views.ts';

const READ = { config: { staff: 'estate.read' } } as const;
const UPLOAD = {
  config: { staff: 'settings.write', csrf: 'in-body' },
} as const;

export interface PolicyDeps {
  pool: Pool;
  clock: Clock;
  objects: ObjectStore;
  pdf: PdfText;
  embedder: Embedder;
  ocr?: OcrText;
  bucket: string;
  chrome: typeof signedInChrome;
}

export function registerPolicyRoutes(
  app: FastifyInstance,
  deps: PolicyDeps,
): void {
  app.get('/policy', READ, async (request, reply) => {
    const library = await listPolicyLibrary(deps.pool);
    const role = request.staff?.role ?? null;
    const page = renderPolicyPage(library, {
      csrf: csrfFrom(request),
      mayUpload: can(role, 'settings.write'),
    });
    reply.header('content-type', 'text/html; charset=utf-8');
    reply.header('cache-control', 'no-store');
    return renderPage({
      title: page.title,
      styles: page.styles,
      nav: deps.chrome(
        csrfFrom(request),
        'policy' satisfies ChromeDest,
        can(role, 'documents.write'),
        can(role, 'party.read'),
        request.openCalls,
      ),
      body: page.body,
    });
  });

  app.post('/policy', UPLOAD, async (request, reply) => {
    const token = readSessionCookie(request.headers.cookie);
    if (token === null) {
      throw new KernelError('not_allowed', 'not_allowed');
    }
    const upload = await readUpload(request);
    verifyCsrf(token, upload.fields[CSRF_FIELD]);
    const staff = request.staff;
    if (staff == null) {
      throw new KernelError('not_allowed', 'not_allowed');
    }
    const settings = createSettings(deps.pool);
    const ocr = await readOcrSettings(settings);
    const client = await deps.pool.connect();
    try {
      await client.query('BEGIN');
      await uploadPolicyDocument(
        {
          db: client,
          objects: deps.objects,
          pdf: deps.pdf,
          embedder: deps.embedder,
          audit: createAuditLog(client, deps.clock),
          clock: deps.clock,
          bucket: deps.bucket,
          ocr: deps.ocr,
          ocrVersion: ocr.processorVersion,
        },
        {
          sectionKey: upload.fields.section_key ?? '',
          title: upload.fields.title ?? '',
          effectiveFrom: upload.fields.effective_from ?? '',
          bytes: upload.bytes,
          uploadedBy: staff.staffAccountId,
        },
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
    return reply.code(303).header('location', '/policy').send();
  });
}

async function readUpload(request: {
  parts: () => AsyncIterableIterator<
    | { type: 'field'; fieldname: string; value: unknown }
    | {
        type: 'file';
        fieldname: string;
        file: { truncated: boolean };
        toBuffer: () => Promise<Buffer>;
      }
  >;
}): Promise<{ fields: Record<string, string>; bytes: Buffer }> {
  const fields: Record<string, string> = {};
  let bytes: Buffer | null = null;
  for await (const part of request.parts()) {
    if (part.type === 'file') {
      const read = await part.toBuffer();
      if (part.file.truncated) {
        throw new KernelError('invalid', 'the file is larger than we accept');
      }
      if (part.fieldname === 'file' && !bytes) bytes = read;
      continue;
    }
    fields[part.fieldname] = String(part.value);
  }
  if (!bytes || bytes.length === 0) {
    throw new KernelError('invalid', 'no file was attached');
  }
  return { fields, bytes };
}
