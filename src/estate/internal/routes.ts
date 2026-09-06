// Estate's HTTP surface. Slice 1.11, and four screens from 2.6.
//
// These routes return HTML because the only consumer is a stakeholder's phone. When the agent needs
// estate data it will call a module command, not this. There is no JSON API, which is not an
// omission: a JSON endpoint would have to be scoped before the screens could be shown to anybody,
// and these screens are shown to nobody who is not in the room.
//
// **Nothing here has a session, and every screen is built so that it does not need one yet.** Week 5
// is where staff auth lands (tasks/roadmap.md); until then the rule these routes keep is that no
// party name and no contact value reaches a response. The occupancy chip is a state and a count,
// search never touches `party`, and Q5 shows a unit and a date.
import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import type { Clock } from '../../kernel/clock.ts';
import { validId } from '../../kernel/validate.ts';
import { resolveOccupiedUnits } from '../../scope/contract.ts';
import {
  countUnitsByBuilding,
  EXPIRING_WINDOW_DAYS,
  getBuilding,
  listBuildings,
  listExpiringLeases,
  searchEstate,
} from './read-model.ts';
import {
  type OccupancyByBuilding,
  type OccupancyByUnit,
  renderBuildingPage,
  renderBuildingsPage,
  renderExpiringPage,
  renderIndexPage,
  renderSearchPage,
} from './views.ts';

export interface EstateDeps {
  pool: Pool;
  /** Injected, never read here: a screen whose answer changes at midnight is one no test can pin. */
  clock: Clock;
}

/** What a search box may be sent before it stops being a search box. */
const MAX_TERM = 80;

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
  // 1.11 made this a 302 to `/estate` and said it would stop being one the week a second screen
  // existed. This is that week.
  app.get('/', async (_request, reply) => {
    html(reply);
    return renderIndexPage();
  });

  app.get('/estate', async (_request, reply) => {
    const buildings = await listBuildings(deps.pool);
    // **Two questions, two modules, and neither learns the other's rule.** `src/scope/` says which
    // units are let today, because deciding when a tenancy counts is what only that module may do;
    // estate says which building they are in, because that is its own structure. One query each,
    // rather than one per building — and one audit line, rather than one per card.
    const occupied = await resolveOccupiedUnits(
      deps.pool,
      null,
      deps.clock.now(),
    );
    const byBuilding: OccupancyByBuilding = await countUnitsByBuilding(
      deps.pool,
      occupied.map((unit) => unit.unit_id),
    );
    html(reply);
    return renderBuildingsPage(buildings, byBuilding);
  });

  app.get('/estate/search', async (request, reply) => {
    const asked = (request.query as { q?: string }).q ?? '';
    // Validated at the edge (AGENTS.md): trimmed, capped, and the LIKE metacharacters escaped in the
    // read model. A term is bound as a parameter, and a parameter can still mean `%`.
    const term = asked.trim().slice(0, MAX_TERM);
    const results =
      term === ''
        ? { buildings: [], units: [], truncated: false }
        : await searchEstate(deps.pool, term);
    html(reply);
    return renderSearchPage(term, results);
  });

  app.get('/estate/expiring', async (_request, reply) => {
    const leases = await listExpiringLeases(deps.pool, deps.clock.now());
    html(reply);
    return renderExpiringPage(leases, EXPIRING_WINDOW_DAYS);
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
    const occupied = await resolveOccupiedUnits(
      deps.pool,
      detail.units.map((unit) => unit.unit_id),
      deps.clock.now(),
    );
    const occupancy: OccupancyByUnit = new Map(
      occupied.map((unit) => [unit.unit_id, unit.occupants]),
    );
    html(reply);
    return renderBuildingPage(detail, occupancy);
  });
}
