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
import { KernelError } from '../../kernel/errors.ts';
import type { Html } from '../../kernel/ui/html.ts';
import { requireText, validId } from '../../kernel/validate.ts';
import { resolveOccupiedUnits } from '../../scope/contract.ts';
import { can, csrfFrom } from '../../staff/contract.ts';
import { addCalendarYears, WARRANTY_YEARS } from './assets.ts';
import { importEstate } from './importer.ts';
import type {
  BuildingPlan,
  BuildingStatus,
  ProjectPlan,
  ProjectStatus,
} from './plan.ts';
import {
  countUnitsByBuilding,
  EXPIRING_WINDOW_DAYS,
  getBuilding,
  getUnit,
  listBuildings,
  listExpiringLeases,
  listProjects,
  type ProjectOption,
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
  renderNewBuildingPage,
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
  expireDueTenancies: (db: Pool, at: Date) => Promise<void>;
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

/**
 * **Slice 6.1, flow A11.** ADMIN only ([SPEC-staff.md](SPEC-staff.md)): an operator files paper, an
 * admin shapes the estate.
 *
 * **The `GET` carries it too, and deliberately not `estate.read`.** A form an operator may render
 * and may not post is a door that answers `not_allowed` after they have typed an address into it —
 * and the refusal says nothing more, by design, so they would learn nothing from it.
 *
 * **No `csrf: 'in-body'`**, which `tasks/todo.md` specified for this slice. That flag is not "the
 * token travels in the body" — it is an exemption from the composition root's CSRF `preHandler`,
 * and it exists for one reason: `POST /documents` is a multipart stream that the hook cannot read
 * without consuming it. This body is urlencoded, the hook parses it, and `src/guard.test.ts`
 * asserts the exempt list is exactly one route so the exemption cannot spread.
 */
const ESTATE_WRITE = { config: { staff: 'estate.write' } } as const;

/** The form's own vocabularies, checked at the edge against the CHECK constraints they mirror. */
const STATUSES: readonly BuildingStatus[] = [
  'ACTIVE',
  'IN_CONSTRUCTION',
  'EXITED',
];

function buildingStatus(value: unknown): BuildingStatus {
  const status = requireText(value, 'status', 32);
  if (!(STATUSES as readonly string[]).includes(status)) {
    throw new KernelError('invalid', 'status is not a building status');
  }
  return status as BuildingStatus;
}

/**
 * The project the form named, rebuilt **from the row** rather than from the post.
 *
 * `project.project_code` is a natural key under `ON CONFLICT … DO UPDATE`, so a name arriving from
 * the form would rename an existing project on a typo — silently, because an import correcting a
 * typo is exactly what `DO UPDATE` is there for. The form chooses among rows; it does not invent
 * one. A code that names no row is `invalid` and not a new project.
 */
function chosenProject(
  value: unknown,
  projects: readonly ProjectOption[],
): ProjectPlan | null {
  if (value === undefined || value === null || String(value).trim() === '') {
    return null;
  }
  const code = requireText(value, 'project_code', 64);
  const row = projects.find((project) => project.project_code === code);
  if (row === undefined) {
    throw new KernelError('invalid', 'project_code names no project');
  }
  return {
    name: row.name,
    projectCode: row.project_code,
    tenderRef: row.tender_ref,
    status: row.status as ProjectStatus,
  };
}

/**
 * One `BuildingPlan`, zero spaces, zero units. `validateBuildingSpaces` iterates both, so the empty
 * building needs no special case in the importer — which is why A11 needs no estate command of its
 * own.
 *
 * **A blank תקופת הבדק is derived, not required**: handover plus `WARRANTY_YEARS`, through 3.5's
 * own `addCalendarYears`, which also refuses a non-ISO date with `invalid` and is therefore the
 * handover field's edge validation as well.
 */
function buildingFromForm(
  body: unknown,
  projects: readonly ProjectOption[],
): { plan: BuildingPlan; projects: ProjectPlan[] } {
  const form = (body ?? {}) as Record<string, unknown>;
  const project = chosenProject(form.project_code, projects);
  const handoverDate = requireText(form.handover_date, 'handover_date', 10);
  const declaredEnd = form.warranty_end_date;
  const warrantyEndDate =
    declaredEnd === undefined ||
    declaredEnd === null ||
    String(declaredEnd).trim() === ''
      ? addCalendarYears(handoverDate, WARRANTY_YEARS)
      : requireText(declaredEnd, 'warranty_end_date', 10);
  return {
    plan: {
      name: requireText(form.name, 'name', 200),
      addressLine: requireText(form.address_line, 'address_line', 200),
      city: requireText(form.city, 'city', 120),
      projectCode: project === null ? null : project.projectCode,
      // Not a date library and not a regex of its own: `addCalendarYears` already rejects anything
      // that is not `YYYY-MM-DD`, and running it over both dates is what makes the derived branch
      // and the declared branch validate identically.
      handoverDate: addCalendarYears(handoverDate, 0),
      warrantyEndDate: addCalendarYears(warrantyEndDate, 0),
      status: buildingStatus(form.status),
      spaces: [],
      units: [],
    },
    projects: project === null ? [] : [project],
  };
}

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
    return renderBuildingsPage(
      buildings,
      byBuilding,
      nav,
      can(request.staff?.role ?? null, 'estate.write'),
    );
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

  // Written above `/estate/buildings/:buildingId` for a reader, not for the router: Fastify's
  // find-my-way gives a static segment priority over a parametric one whatever the registration
  // order, which is what stops `new` from arriving at `validId` as a malformed building id. The
  // acceptance suite asserts the 200 rather than trusting either fact.
  app.get('/estate/buildings/new', ESTATE_WRITE, async (request, reply) => {
    const projects = await listProjects(deps.pool);
    const csrf = csrfFrom(request);
    html(reply);
    return renderNewBuildingPage({
      nav: deps.chrome(csrf, 'estate'),
      csrf,
      projects,
    });
  });

  app.post('/estate/buildings', ESTATE_WRITE, async (request, reply) => {
    // Read first: the plan is rebuilt from the chosen row, so the form's `project_code` is checked
    // against what exists rather than trusted.
    const projects = await listProjects(deps.pool);
    const { plan, projects: named } = buildingFromForm(request.body, projects);
    // **`importEstate`, not a new estate command.** Idempotence is `building.address_key`'s: the
    // same address posted twice updates the row and returns the id already there, so a double
    // submit converges for this form and for every other writer.
    await importEstate(deps.pool, { projects: named, buildings: [plan] });
    return reply.code(303).header('location', '/estate').send();
  });

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
    await deps.expireDueTenancies(deps.pool, deps.clock.now());
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
