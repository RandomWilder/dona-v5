// The walking skeleton (slice 1.3), rewired onto the kernel (slice 1.4). One route, and the only
// claim it makes is one it can prove: the process is up *and* it can reach the database.
// "Deployed but silently broken" is what infra/smoke.sh exists to make impossible
// (docs/pipeline.md §5), and this is the endpoint it asks.
import Fastify, { type FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { httpStatus, KernelError, toErrorBody } from './kernel/errors.ts';

export interface AppDeps {
  pool: Pool;
  version: string;
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

  return app;
}
