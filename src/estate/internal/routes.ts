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
import type { ChromeDest } from '../../chrome.ts';
import type { Clock } from '../../kernel/clock.ts';
import type { Html } from '../../kernel/ui/html.ts';
import { requireText, validId } from '../../kernel/validate.ts';
import { resolveOccupiedUnits } from '../../scope/contract.ts';
import { csrfFrom } from '../../staff/contract.ts';
import {
  countUnitsByBuilding,
  EXPIRING_WINDOW_DAYS,
  getBuilding,
  getUnit,
  listBuildings,
  listExpiringLeases,
  searchEstate,
} from './read-model.ts';
import {
  type DocumentSearchHit,
  type FiledDocumentView,
  type IncompleteTenancyRow,
  type OccupancyByBuilding,
  type OccupancyByUnit,
  type PromotedFieldView,
  renderBuildingPage,
  renderBuildingsPage,
  renderExpiringPage,
  renderIncompletePage,
  renderSearchPage,
  renderUnitPage,
  type TenancyEventView,
} from './views.ts';

export interface EstateDeps {
  pool: Pool;
  /** Injected, never read here: a screen whose answer changes at midnight is one no test can pin. */
  clock: Clock;
  /**
   * Slice 5.2b. Built at the composition root, because this module may not name staff's routes
   * and the kernel may not name anyone's.
   */
  chrome: (csrf: string, dest: ChromeDest) => Html;
  /**
   * Slice 3.6 / 4.4. Injected from evidence so this module never imports it — evidence already
   * imports estate, and the other direction would be a cycle. Structural: the composition root
   * wires the real functions.
   */
  listLinkedDocuments: (
    db: Pool,
    entityType: 'BUILDING' | 'UNIT',
    entityId: string,
  ) => Promise<readonly FiledDocumentView[]>;
  searchDocuments: (
    db: Pool,
    term: string,
  ) => Promise<{
    documents: readonly DocumentSearchHit[];
    truncated: boolean;
  }>;
  listPromotedFieldsForUnit: (
    db: Pool,
    unitId: string,
  ) => Promise<readonly PromotedFieldView[]>;
  listTenancyEvents: (
    db: Pool,
    unitId: string,
  ) => Promise<readonly TenancyEventView[]>;
  listIncompleteTenancies: (
    db: Pool,
  ) => Promise<readonly IncompleteTenancyRow[]>;
  recordCompletenessException: (
    db: Pool,
    spec: {
      tenancyId: string;
      rule: 'guarantor';
      actor: string;
      reason: string;
      at: Date;
    },
  ) => Promise<'recorded' | 'alreadyRecorded'>;
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

/**
 * **What every route on this module declares, from slice 5.2.** These screens served
 * unauthenticated from week 1 to week 5 — deliberately, on fixture data, and stated in six files
 * rather than hidden in one. They are behind the session now, and the stance is written at the
 * route because `src/app.ts` refuses to start the process for a route that declares none: a
 * screen added here next month is guarded before anybody remembers to guard it.
 *
 * `estate.read` and not `documents.read`, even on the screens that list filed paper: what those
 * panels show is estate's answer about a building or a unit, and the document module's own routes
 * are where `documents.read` is asked for. The exception POST writes a tenancy row through
 * `src/tenancy/`, so it asks for `tenancy.write` rather than for anything of estate's.
 */
const READ = { config: { staff: 'estate.read' } } as const;
const WRITE = { config: { staff: 'tenancy.write' } } as const;

export function registerEstateRoutes(
  app: FastifyInstance,
  deps: EstateDeps,
): void {
  // The urlencoded parser lived here from 2.6 and moved to `src/kernel/ui/forms.ts` at 5.1, when
  // `src/staff/` became the second module with a form. The composition root registers it once.

  // `GET /` was registered here from 1.11 and **moved to the composition root at 5.2**, with the
  // view it rendered. It is `src/app.ts` and `src/index-page.ts` now.

  app.get('/estate', READ, async (request, reply) => {
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
    const nav = deps.chrome(csrfFrom(request), 'estate');
    return renderBuildingsPage(buildings, byBuilding, nav);
  });

  app.get('/estate/search', READ, async (request, reply) => {
    const asked = (request.query as { q?: string }).q ?? '';
    // Validated at the edge (AGENTS.md): trimmed, capped, and the LIKE metacharacters escaped in the
    // read model. A term is bound as a parameter, and a parameter can still mean `%`.
    const term = asked.trim().slice(0, MAX_TERM);
    const estate =
      term === ''
        ? { buildings: [], units: [], truncated: false }
        : await searchEstate(deps.pool, term);
    const documents =
      term === ''
        ? { documents: [], truncated: false }
        : await deps.searchDocuments(deps.pool, term);
    html(reply);
    return renderSearchPage(
      term,
      {
        ...estate,
        documents: documents.documents,
        truncated: estate.truncated || documents.truncated,
      },
      deps.chrome(csrfFrom(request), 'search'),
    );
  });

  app.get('/estate/expiring', READ, async (request, reply) => {
    const leases = await listExpiringLeases(deps.pool, deps.clock.now());
    html(reply);
    return renderExpiringPage(
      leases,
      EXPIRING_WINDOW_DAYS,
      deps.chrome(csrfFrom(request), 'expiring'),
    );
  });

  app.get('/estate/incomplete', READ, async (request, reply) => {
    const rows = await deps.listIncompleteTenancies(deps.pool);
    const csrf = csrfFrom(request);
    html(reply);
    return renderIncompletePage(rows, csrf, deps.chrome(csrf, 'incomplete'));
  });

  app.post<{ Params: { tenancyId: string } }>(
    '/estate/incomplete/:tenancyId/exception',
    WRITE,
    async (request, reply) => {
      const tenancyId = validId(request.params.tenancyId, 'tenancyId');
      const posted = request.body as { reason?: string };
      await deps.recordCompletenessException(deps.pool, {
        tenancyId,
        rule: 'guarantor',
        actor: requireText(request.staff?.email ?? '', 'actor', 200),
        reason: requireText(posted.reason ?? '', 'reason', 200),
        at: deps.clock.now(),
      });
      return reply.redirect('/estate/incomplete');
    },
  );

  app.get('/estate/buildings/:buildingId', READ, async (request, reply) => {
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
    const documents = await deps.listLinkedDocuments(
      deps.pool,
      'BUILDING',
      detail.building.building_id,
    );
    html(reply);
    return renderBuildingPage(
      detail,
      occupancy,
      deps.chrome(csrfFrom(request), 'estate'),
      documents,
    );
  });

  app.get('/estate/units/:unitId', READ, async (request, reply) => {
    const { unitId } = request.params as { unitId: string };
    const unit = await getUnit(deps.pool, validId(unitId, 'unitId'));
    const occupied = await resolveOccupiedUnits(
      deps.pool,
      [unit.unit_id],
      deps.clock.now(),
    );
    const documents = await deps.listLinkedDocuments(
      deps.pool,
      'UNIT',
      unit.unit_id,
    );
    const promoted = await deps.listPromotedFieldsForUnit(
      deps.pool,
      unit.unit_id,
    );
    const events = await deps.listTenancyEvents(deps.pool, unit.unit_id);
    html(reply);
    return renderUnitPage(
      unit,
      occupied[0]?.occupants,
      documents,
      deps.chrome(csrfFrom(request), 'estate'),
      promoted,
      events,
    );
  });
}
