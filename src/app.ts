// The walking skeleton (slice 1.3). One route, and the only claim it makes is one it can prove:
// the process is up *and* it can reach the database. "Deployed but silently broken" is what
// infra/smoke.sh exists to make impossible (docs/pipeline.md §5), and this is the endpoint it asks.
import Fastify, { type FastifyInstance } from 'fastify';
import type { Pool } from 'pg';

export interface AppDeps {
  pool: Pool;
  version: string;
}

// SPEC.md "Error shape": one shape everywhere — { code, message, details? } — with `unavailable`
// as the code for a dependency that is down. It is written as a literal here because
// src/kernel/errors.ts owns it from slice 1.4 and has not landed yet; 1.4 rewires this onto
// KernelError/toErrorBody rather than leaving two copies to drift (carried in tasks/todo.md 1.4).
const DB_UNAVAILABLE = {
  code: 'unavailable',
  message: 'database unreachable',
} as const;

export function buildApp(deps: AppDeps): FastifyInstance {
  const app = Fastify({ logger: false });

  app.get('/health', async (_request, reply) => {
    try {
      await deps.pool.query('SELECT 1');
      return { ok: true, version: deps.version, db: 'up' };
    } catch {
      // Never the caught error's text: a pg connection failure carries the connection string,
      // and SPEC.md's error shape exists so internals never reach the wire.
      reply.code(503);
      return { ok: false, version: deps.version, ...DB_UNAVAILABLE };
    }
  });

  return app;
}
