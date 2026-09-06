// Estate's HTTP surface. Slice 1.11.
//
// Two screens and a redirect, and no JSON: these routes return HTML because the only consumer is a
// stakeholder's phone. When the agent needs estate data it will call a module command, not this.
import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { validId } from '../../kernel/validate.ts';
import { getBuilding, listBuildings } from './read-model.ts';
import { renderBuildingPage, renderBuildingsPage } from './views.ts';

export interface EstateDeps {
  pool: Pool;
}

function html(reply: { header: (k: string, v: string) => unknown }): void {
  reply.header('content-type', 'text/html; charset=utf-8');
  // Until assets are content-hashed, a cached page against a fresh stylesheet is the failure mode
  // (kernel/ui/assets.ts says the same about the stylesheet itself).
  reply.header('cache-control', 'no-cache');
  reply.header('x-content-type-options', 'nosniff');
}

export function registerEstateRoutes(
  app: FastifyInstance,
  deps: EstateDeps,
): void {
  // There is exactly one screen, so the root is it. This redirect is temporary by construction and
  // is owned by the slice that adds a second module's screen (tasks/roadmap.md).
  app.get('/', async (_request, reply) => {
    reply.redirect('/estate', 302);
  });

  app.get('/estate', async (_request, reply) => {
    const buildings = await listBuildings(deps.pool);
    html(reply);
    return renderBuildingsPage(buildings);
  });

  app.get('/estate/buildings/:buildingId', async (request, reply) => {
    const { buildingId } = request.params as { buildingId: string };
    // Validated at the edge, before it reaches a query: a malformed id is `invalid` and a
    // well-formed one that is not there is `not_found`, and neither leaks which. getBuilding throws
    // the second; both render through the app's error handler in the SPEC.md shape.
    const detail = await getBuilding(
      deps.pool,
      validId(buildingId, 'buildingId'),
    );
    html(reply);
    return renderBuildingPage(detail);
  });
}
