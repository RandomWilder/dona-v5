// The composition root. The walking skeleton (slice 1.3), rewired onto the kernel (slice 1.4), and
// given its first screens at 1.11.
//
// /health is the endpoint infra/smoke.sh asks, and the only claim it makes is one it can prove: the
// process is up *and* it can reach the database. "Deployed but silently broken" is what that script
// exists to make impossible (docs/pipeline.md §5).
//
// Modules are wired here and nowhere else, through their contract.ts. registerUiAssets has existed
// since the 1.4 kernel lift with nothing to serve; this is the slice that gives it a page to serve
// the stylesheet to.
import Fastify, { type FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { registerEstateRoutes } from './estate/contract.ts';
import {
  listLinkedDocuments,
  listPromotedFieldsForUnit,
  registerDocumentRoutes,
  searchDocuments,
} from './evidence/contract.ts';
import { type Clock, systemClock } from './kernel/clock.ts';
import { httpStatus, KernelError, toErrorBody } from './kernel/errors.ts';
import type { Extractor } from './kernel/extraction.ts';
import {
  configuredBucket,
  createMemoryStore,
  type ObjectStore,
} from './kernel/objects.ts';
import type { OcrText } from './kernel/ocr.ts';
import { createPdfjsText, type PdfText } from './kernel/pdf.ts';
import { registerUiAssets } from './kernel/ui/assets.ts';
import { registerFormBodies } from './kernel/ui/forms.ts';
import type { WorkRunner } from './kernel/work.ts';
import {
  createUnconfiguredIdentity,
  type IdentityProvider,
  registerStaffRoutes,
} from './staff/contract.ts';
import {
  listIncompleteTenancies,
  recordCompletenessException,
} from './tenancy/contract.ts';

export interface AppDeps {
  pool: Pool;
  version: string;
  /** Injected here and nowhere deeper. SPEC.md: the clock is a dependency, never a global read. */
  clock?: Clock;
  /**
   * Where a filed document's bytes go (slice 3.3). **Memory unless the caller says otherwise**, so a
   * test builds an app without reaching a bucket and `npm run dev` on a clean clone still starts;
   * `serve.ts` passes the configured store and prints which one it is.
   */
  objects?: ObjectStore;
  /** The PDF reader the verification guard reads text through. */
  pdf?: PdfText;
  /** The OCR reader. Absent or unconfigured leaves scans unverified. */
  ocr?: OcrText;
  extractor?: Extractor;
  work?: WorkRunner;
  /** The bucket a `storage_uri` names, which is not the same statement as which store is running. */
  bucket?: string;
  /**
   * Who signs in (slice 5.1). **Unconfigured unless the caller says otherwise**, on the same
   * argument the object store makes: a test builds an app without an API key, `npm run dev` on a
   * clean clone still starts, and `/staff/login` says the provider is not configured rather than
   * answering a real password as though it were wrong.
   */
  identity?: IdentityProvider;
}

export function buildApp(deps: AppDeps): FastifyInstance {
  const app = Fastify({ logger: false });

  // Fastify's own bodies never reach the wire: its 404 echoes the requested path back and its 500
  // carries the thrown message. Both render as SPEC.md's { code, message } instead. 1.3 wrote the
  // 503 body as a literal and deliberately left these two out, because writing the shape twice is
  // how two copies drift — kernel/errors.ts owns it from this slice, so they land now.
  app.setNotFoundHandler(async (_request, reply) => {
    const error = new KernelError('not_found', 'route not found');
    reply.code(httpStatus(error.code));
    return toErrorBody(error);
  });

  app.setErrorHandler(async (caught, _request, reply) => {
    const body = toErrorBody(caught);
    reply.code(httpStatus(body.code));
    return body;
  });

  app.get('/health', async (_request, reply) => {
    try {
      await deps.pool.query('SELECT 1');
      return { ok: true, version: deps.version, db: 'up' };
    } catch {
      // Never the caught error's text: a pg connection failure carries the connection string, and
      // toErrorBody exists so internals never reach the wire.
      const error = new KernelError('unavailable', 'database unreachable');
      reply.code(httpStatus(error.code));
      return { ok: false, version: deps.version, ...toErrorBody(error) };
    }
  });

  registerUiAssets(app);
  // One parser for every HTML form in this system (slice 5.1). Estate has posted one since 2.6 and
  // staff is the second module to, so it belongs to the root rather than to whichever module got
  // there first.
  registerFormBodies(app);
  registerEstateRoutes(app, {
    pool: deps.pool,
    clock: deps.clock ?? systemClock,
    listLinkedDocuments,
    searchDocuments,
    listPromotedFieldsForUnit,
    listIncompleteTenancies,
    recordCompletenessException,
  });
  // Slice 5.1. The staff routes are the only ones behind a session today; the seven that have
  // served unauthenticated since week 1 go behind `requireStaff` at 5.2, which owns the CSRF token
  // and the per-caller upload bound in the same change.
  registerStaffRoutes(app, {
    pool: deps.pool,
    clock: deps.clock ?? systemClock,
    identity: deps.identity ?? createUnconfiguredIdentity(),
  });
  registerDocumentRoutes(app, {
    pool: deps.pool,
    clock: deps.clock ?? systemClock,
    objects: deps.objects ?? createMemoryStore(),
    pdf: deps.pdf ?? createPdfjsText(),
    ocr: deps.ocr,
    extractor: deps.extractor,
    work: deps.work,
    bucket: deps.bucket ?? configuredBucket(),
  });

  return app;
}
