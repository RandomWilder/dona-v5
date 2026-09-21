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
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Pool } from 'pg';
import type { ChromeDest } from '../../chrome.ts';
import type { Clock } from '../../kernel/clock.ts';
import { inTransaction } from '../../kernel/db.ts';
import { KernelError } from '../../kernel/errors.ts';
import type { Html } from '../../kernel/ui/html.ts';
import { optionalText, requireText, validId } from '../../kernel/validate.ts';
import { resolveOccupiedUnits } from '../../scope/contract.ts';
import {
  can,
  clearOfficeRetrievalThread,
  csrfFrom,
  loadOfficeRetrievalThread,
} from '../../staff/contract.ts';
import { addCalendarYears, WARRANTY_YEARS } from './assets.ts';
import { importEstate, upsertUnitRow } from './importer.ts';
import type {
  BuildingPlan,
  BuildingStatus,
  ConditionStatus,
  ProjectPlan,
  ProjectStatus,
  UnitRowSpec,
} from './plan.ts';
import {
  addressKeyOf,
  countUnitsByBuilding,
  EXPIRING_WINDOW_DAYS,
  findBuildingAtAddress,
  getBuilding,
  getUnit,
  listApprovedCapturesForTenancy,
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
  type OfficeRetrievalView,
  type PromotedFieldView,
  renderBuildingPage,
  renderBuildingsPage,
  renderExpiringPage,
  renderIncompletePage,
  renderNewBuildingPage,
  renderNewUnitPage,
  renderSearchPage,
  renderTenancyDetailPage,
  renderUnitPage,
  type TenancyEventView,
  type TenancyPersonView,
} from './views.ts';

export interface EstateDeps {
  pool: Pool;
  /** Injected, never read here: a screen whose answer changes at midnight is one no test can pin. */
  clock: Clock;
  /**
   * Slice 5.2b. Built at the composition root, because this module may not name staff's routes
   * and the kernel may not name anyone's. **`mayFile` from 6.9**: the rail's documents destination
   * is gated on `documents.write`, so the caller passes the stance rather than the rail guessing it.
   */
  chrome: (csrf: string, dest: ChromeDest, mayFile: boolean) => Html;
  /**
   * Slice 3.6 / 4.4. Injected from evidence so this module never imports it — evidence already
   * imports estate, and the other direction would be a cycle. Structural: the composition root
   * wires the real functions.
   */
  listLinkedDocuments: (
    db: Pool,
    entityType: 'BUILDING' | 'UNIT' | 'TENANCY',
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
  expireDueTenancies: (db: Pool, clock: Clock) => Promise<void>;
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
  getTenancy: (
    db: Pool,
    tenancyId: string,
  ) => Promise<{
    tenancy_id: string;
    unit_id: string;
    start_date: string;
    end_date: string;
    status: string;
    rent_amount: string | null;
    rent_currency: string | null;
    option_end_date: string | null;
  }>;
  listTenancyParties: (
    db: Pool,
    tenancyId: string,
  ) => Promise<
    readonly {
      party_id: string;
      role: string;
      is_service_contact: boolean;
    }[]
  >;
  listPartyNames: (
    db: Pool,
    partyIds: readonly string[],
  ) => Promise<readonly { party_id: string; full_name: string }[]>;
  activationGate: (
    db: Pool,
    tenancyId: string,
  ) => Promise<{
    checks: readonly { rule: string; passed: boolean }[];
    canActivate: boolean;
    activatableOn: string | null;
    flags: readonly { typeKey: string }[];
  }>;
  activateTenancy: (
    db: Pool,
    spec: { tenancyId: string; actor: string },
  ) => Promise<void>;
  /**
   * #114 / #121. Injected from evidence so this module never imports it. Bound is this Unit or
   * this Building.
   */
  runOfficeTurn: (spec: {
    staffAccountId: string;
    bound: { kind: 'unit' | 'building'; id: string };
    question: string;
  }) => Promise<void>;
}

/** What a search box may be sent before it stops being a search box. */
const MAX_TERM = 80;

/**
 * **A12's walk, carried through A11 and A13. Slice 6.9.**
 *
 * A refusal on the document screen offers an admin the building and the flat, prefilled from what
 * the place reader read; these two forms are where that offer lands, and `next=intake` is what
 * brings the admin back to A12 with the new flat as the document's anchor.
 *
 * **It is the only state the walk has.** The bytes are not held — no staging store, no fifth
 * `PlaceKind` ([SPEC-flows.md](SPEC-flows.md) A12) — so the file is attached again at the end, and
 * everything else here is a *default in an input* that the admin reads against the paper and edits.
 * Nothing about A11's or A13's writes changes; a value that arrives wrong costs a correction.
 *
 * Bounded at the edge like every other request value, and `INTAKE` is a literal rather than a URL:
 * a redirect target taken from a query string is an open redirect, and this one can only ever be
 * this application's own document screen.
 */
const INTAKE = 'intake';

interface IntakeCarry {
  next?: string;
  typeKey?: string;
  unitNumber?: string;
}

/** Reads the carry off a query string. Absent, or anything but the literal, is *no walk*. */
function carryFromQuery(request: FastifyRequest): IntakeCarry {
  const query = request.query as {
    next?: string;
    type?: string;
    unit_number?: string;
  };
  if (query.next !== INTAKE) {
    return {};
  }
  return {
    next: INTAKE,
    ...(query.type
      ? { typeKey: optionalText(query.type, 'type', 64) ?? undefined }
      : {}),
    ...(query.unit_number
      ? {
          unitNumber:
            optionalText(query.unit_number, 'unit_number', 32) ?? undefined,
        }
      : {}),
  };
}

/** The same carry off a posted body, where it rides as hidden inputs. */
function carryFromBody(body: unknown): IntakeCarry {
  const form = (body ?? {}) as Record<string, unknown>;
  if (form.next !== INTAKE) {
    return {};
  }
  return {
    next: INTAKE,
    ...(form.type
      ? { typeKey: optionalText(form.type, 'type', 64) ?? undefined }
      : {}),
    ...(form.unit_number
      ? {
          unitNumber:
            optionalText(form.unit_number, 'unit_number', 32) ?? undefined,
        }
      : {}),
  };
}

/** The query string the next step in the walk is reached with. Empty when there is no walk. */
function carryQuery(carry: IntakeCarry): string {
  if (!carry.next) {
    return '';
  }
  const params = new URLSearchParams({ next: INTAKE });
  if (carry.typeKey) {
    params.set('type', carry.typeKey);
  }
  if (carry.unitNumber) {
    params.set('unit_number', carry.unitNumber);
  }
  return `?${params}`;
}

/**
 * Whether this viewer may file a document, for the rail and for nothing else. **Slice 6.9.**
 *
 * Estate's screens have to answer a question about evidence's door because the rail is one bar
 * across the whole console, and the alternative — a rail that guesses, or one that is built per
 * module — is how a console grows two navigations. It is `can` and not a second matrix.
 */
function mayFile(request: FastifyRequest): boolean {
  return can(request.staff?.role ?? null, 'documents.write');
}

function requireStaffAccountId(request: FastifyRequest): string {
  const id = request.staff?.staffAccountId;
  if (!id) {
    throw new KernelError('not_allowed', 'not_allowed');
  }
  return id;
}

async function officeRetrieval(
  pool: Pool,
  request: FastifyRequest,
  bound: { kind: 'unit' | 'building'; id: string },
  csrf: string,
): Promise<OfficeRetrievalView | undefined> {
  if (!can(request.staff?.role ?? null, 'documents.read')) {
    return undefined;
  }
  const staffAccountId = request.staff?.staffAccountId;
  if (!staffAccountId) return undefined;
  const thread = await loadOfficeRetrievalThread(pool, staffAccountId, bound);
  return { csrf, bound, thread, notice: officeAskNotice(request) };
}

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
/** Asking and clearing an office retrieval panel. No new permission — SPEC-staff.md. */
const ASK = { config: { staff: 'documents.read' } } as const;

const OFFICE_ASK_UNAVAILABLE = 'לא ניתן לענות עכשיו. נסו שוב בעוד רגע.';

function officeAskNotice(request: FastifyRequest): string | undefined {
  const ask = (request.query as { ask?: string }).ask;
  return ask === 'unavailable' ? OFFICE_ASK_UNAVAILABLE : undefined;
}

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

/** The apartment form's own vocabulary, checked at the edge against the CHECK it mirrors (6.2). */
const CONDITIONS: readonly ConditionStatus[] = [
  'READY',
  'RENOVATION',
  'WITHHELD',
];

function conditionStatus(value: unknown): ConditionStatus {
  const status = requireText(value, 'condition_status', 32);
  if (!(CONDITIONS as readonly string[]).includes(status)) {
    throw new KernelError('invalid', 'condition_status is not a condition');
  }
  return status as ConditionStatus;
}

/**
 * A non-negative number from a text field. Local rather than in `src/kernel/validate.ts` for the
 * reason that file states: what lives there is the shape of a value, and `rooms` is a number this
 * module's own column has an opinion about. A second module wanting it is what moves it down.
 *
 * `Number('')` is `0` and `Number('78,5')` is `NaN`; both are rejected here rather than reaching
 * `numeric` as a cast error, which would surface as `unavailable` and name no field.
 */
function requireNumber(value: unknown, field: string, max: number): number {
  const text = requireText(value, field, 16);
  const parsed = Number(text);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > max) {
    throw new KernelError('invalid', `${field} is not a number in range`);
  }
  return parsed;
}

function optionalNumber(
  value: unknown,
  field: string,
  max: number,
): number | null {
  if (value === undefined || value === null || String(value).trim() === '') {
    return null;
  }
  return requireNumber(value, field, max);
}

/** An input a form posts empty is an input nobody typed into. See `unitFromForm`'s `floor`. */
function blankToNull(value: unknown): unknown {
  return value === undefined || value === null || String(value).trim() === ''
    ? null
    : value;
}

/** A checkbox is present or absent; `src/settings-page.ts` reads its own the same way. */
function checked(value: unknown): boolean {
  return value === 'true' || value === 'on';
}

/**
 * What one apartment posted from A13's screen is, minus the building it goes in.
 *
 * `floor` is named separately because it lives on Space and not on Unit, which is `UnitRowSpec`'s
 * own shape and not a decision this form makes. A blank `warranty_end_date` is null and means *the
 * building's date applies* (R14) — not *no warranty*.
 */
function unitFromForm(body: unknown): {
  unit: UnitRowSpec['unit'];
  floor: string | null;
} {
  const form = (body ?? {}) as Record<string, unknown>;
  const unitNumber = requireText(form.unit_number, 'unit_number', 32);
  const declaredEnd = form.warranty_end_date;
  return {
    unit: {
      // **The `UNIT` space is named by the bare unit number**, which is what
      // `src/register/internal/importer.ts` passes. Two writers spelling it two ways would be two
      // apartments behind one door, because `space` is keyed (building_id, space_kind, name).
      spaceName: unitNumber,
      unitNumber,
      rooms: requireNumber(form.rooms, 'rooms', 20),
      areaSqm: optionalNumber(form.area_sqm, 'area_sqm', 10_000),
      hasMamad: checked(form.has_mamad),
      // 3.5's `addCalendarYears` with a zero offset, for 6.1's reason: it already refuses anything
      // that is not `YYYY-MM-DD`, so the date is validated by the function that would consume it.
      warrantyEndDate:
        declaredEnd === undefined ||
        declaredEnd === null ||
        String(declaredEnd).trim() === ''
          ? null
          : addCalendarYears(
              requireText(declaredEnd, 'warranty_end_date', 10),
              0,
            ),
      conditionStatus: conditionStatus(form.condition_status),
    },
    // **A blank text input is absent, not empty.** `optionalText` answers null for a field a caller
    // omitted and `invalid` for one it sent empty — which is right for an API and wrong for a form,
    // where every input posts whether or not it was typed into. Floor is optional (a קרקע-less
    // building has none to say), so the empty string is normalised before it gets there.
    floor: optionalText(blankToNull(form.floor), 'floor', 32),
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
    const occupied = await resolveOccupiedUnits(deps.pool, null, deps.clock);
    const byBuilding: OccupancyByBuilding = await countUnitsByBuilding(
      deps.pool,
      occupied.map((unit) => unit.unit_id),
    );
    html(reply);
    const nav = deps.chrome(csrfFrom(request), 'estate', mayFile(request));
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
      deps.chrome(csrfFrom(request), 'search', mayFile(request)),
    );
  });

  app.get('/estate/expiring', READ, async (request, reply) => {
    const leases = await listExpiringLeases(deps.pool, deps.clock);
    html(reply);
    return renderExpiringPage(
      leases,
      EXPIRING_WINDOW_DAYS,
      deps.chrome(csrfFrom(request), 'expiring', mayFile(request)),
    );
  });

  app.get('/estate/incomplete', READ, async (request, reply) => {
    const rows = await deps.listIncompleteTenancies(deps.pool);
    const csrf = csrfFrom(request);
    html(reply);
    return renderIncompletePage(
      rows,
      csrf,
      deps.chrome(csrf, 'incomplete', mayFile(request)),
    );
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
    const query = request.query as { address_line?: string; city?: string };
    const carry = carryFromQuery(request);
    const addressLine =
      optionalText(blankToNull(query.address_line), 'address_line', 200) ??
      undefined;
    const city =
      optionalText(blankToNull(query.city), 'city', 120) ?? undefined;
    html(reply);
    return renderNewBuildingPage({
      nav: deps.chrome(csrf, 'estate', mayFile(request)),
      csrf,
      projects,
      // **Slice 6.9.** The name defaults to the street, because A12 read a street and never a
      // building's name — and a required field left empty is a form an admin fills in twice.
      prefill: {
        ...(addressLine ? { addressLine, name: addressLine } : {}),
        ...(city ? { city } : {}),
      },
      carry,
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
    // **The walk on, when this form was opened from A12's refusal. Slice 6.9.** `importEstate`
    // reports counts and not ids, so the building it just upserted is read back by the natural key
    // it is keyed on — the same `address_key` and the same `=` A12's own resolution uses. A read,
    // not a second write path: 6.1's ruling that the importer is the one writer is unchanged.
    const carry = carryFromBody(request.body);
    if (carry.next) {
      const created = await findBuildingAtAddress(deps.pool, [
        addressKeyOf(plan.city, plan.addressLine),
      ]);
      if (created) {
        return reply
          .code(303)
          .header(
            'location',
            `/estate/buildings/${created.building_id}/units/new${carryQuery(carry)}`,
          )
          .send();
      }
    }
    return reply.code(303).header('location', '/estate').send();
  });

  // **Slice 6.2, flow A13.** Same stance on both halves, and `new` is again a static segment
  // sitting under a parametric one — find-my-way prefers the static whatever the registration
  // order, and the acceptance suite asserts the 200 rather than trusting that.
  app.get<{ Params: { buildingId: string } }>(
    '/estate/buildings/:buildingId/units/new',
    ESTATE_WRITE,
    async (request, reply) => {
      const { building } = await getBuilding(
        deps.pool,
        validId(request.params.buildingId, 'buildingId'),
      );
      const csrf = csrfFrom(request);
      const carry = carryFromQuery(request);
      html(reply);
      return renderNewUnitPage({
        nav: deps.chrome(csrf, 'estate', mayFile(request)),
        csrf,
        building,
        prefill: carry.unitNumber ? { unitNumber: carry.unitNumber } : {},
        carry,
      });
    },
  );

  app.post<{ Params: { buildingId: string } }>(
    '/estate/buildings/:buildingId/units',
    ESTATE_WRITE,
    async (request, reply) => {
      const buildingId = validId(request.params.buildingId, 'buildingId');
      // Edge first, then the read: a form this route was never going to accept should not cost a
      // query, and `getBuilding` is what turns an id that is not there into `not_found`.
      const { unit, floor } = unitFromForm(request.body);
      const { building } = await getBuilding(deps.pool, buildingId);
      // **The building is rebuilt from its own row.** `upsertUnitRow` upserts the building it is
      // handed and `DO UPDATE` sets `project_id` from it, so a building assembled from the form
      // would unlink the project while adding a flat (SPEC-flows.md A13). `project` is null
      // because the project already exists: `upsertBuilding` resolves it by code.
      const spec: UnitRowSpec = {
        project: null,
        building: {
          name: building.name,
          addressLine: building.address_line,
          city: building.city,
          projectCode: building.project_code,
          handoverDate: building.handover_date,
          warrantyEndDate: building.warranty_end_date,
          status: building.status as BuildingStatus,
        },
        unit,
        floor,
      };
      // One flat is four statements — a `UNIT` space, two bays and the unit — and handed a `Pool`
      // each would be its own transaction. A failure between them would leave a `UNIT` space with
      // no unit on it: legal in this schema (a lobby is one) and visible on the building page as a
      // דירות count with no card. **Slice 6.3 took the third writer down to the kernel**, which is
      // the move 6.2 wrote here as a condition: this is `src/kernel/db.ts`'s `inTransaction` now,
      // and the `BEGIN`/`ROLLBACK` pair is written once for the whole application.
      const written = await inTransaction(deps.pool, (db) =>
        upsertUnitRow(db, spec),
      );
      // Back to A12 with the new flat as the document's anchor. Slice 6.9: `upsertUnitRow` already
      // returns the id, so there is nothing to look up and nothing to guess.
      const carry = carryFromBody(request.body);
      if (carry.next) {
        const back = new URLSearchParams({ anchor: written.unitId });
        if (carry.typeKey) {
          back.set('type', carry.typeKey);
        }
        return reply
          .code(303)
          .header('location', `/documents/new?${back}`)
          .send();
      }
      return reply
        .code(303)
        .header('location', `/estate/buildings/${buildingId}`)
        .send();
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
      deps.clock,
    );
    const occupancy: OccupancyByUnit = new Map(
      occupied.map((unit) => [unit.unit_id, unit.occupants]),
    );
    const documents = await deps.listLinkedDocuments(
      deps.pool,
      'BUILDING',
      detail.building.building_id,
    );
    const csrf = csrfFrom(request);
    html(reply);
    return renderBuildingPage(
      detail,
      occupancy,
      deps.chrome(csrf, 'estate', mayFile(request)),
      documents,
      // Slice 6.2: the door to A13's screen, rendered for a viewer who may walk through it and for
      // nobody else — the buildings list's rule, one level down.
      can(request.staff?.role ?? null, 'estate.write'),
      await officeRetrieval(
        deps.pool,
        request,
        {
          kind: 'building',
          id: detail.building.building_id,
        },
        csrf,
      ),
    );
  });

  app.get('/estate/units/:unitId', READ, async (request, reply) => {
    const { unitId } = request.params as { unitId: string };
    const unit = await getUnit(deps.pool, validId(unitId, 'unitId'));
    const occupied = await resolveOccupiedUnits(
      deps.pool,
      [unit.unit_id],
      deps.clock,
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
    await deps.expireDueTenancies(deps.pool, deps.clock);
    const events = await deps.listTenancyEvents(deps.pool, unit.unit_id);
    const csrf = csrfFrom(request);
    html(reply);
    return renderUnitPage(
      unit,
      occupied[0]?.occupants,
      documents,
      deps.chrome(csrf, 'estate', mayFile(request)),
      promoted,
      events,
      await officeRetrieval(
        deps.pool,
        request,
        {
          kind: 'unit',
          id: unit.unit_id,
        },
        csrf,
      ),
    );
  });

  app.post<{ Params: { unitId: string } }>(
    '/estate/units/:unitId/office-turn',
    ASK,
    async (request, reply) => {
      const unitId = validId(request.params.unitId, 'unitId');
      await getUnit(deps.pool, unitId);
      const posted = request.body as { question?: string };
      try {
        await deps.runOfficeTurn({
          staffAccountId: requireStaffAccountId(request),
          bound: { kind: 'unit', id: unitId },
          question: requireText(posted.question, 'question', 2000),
        });
      } catch (error) {
        if (error instanceof KernelError && error.code === 'unavailable') {
          return reply
            .code(303)
            .header('location', `/estate/units/${unitId}?ask=unavailable`)
            .send();
        }
        throw error;
      }
      return reply
        .code(303)
        .header('location', `/estate/units/${unitId}`)
        .send();
    },
  );

  app.post<{ Params: { unitId: string } }>(
    '/estate/units/:unitId/office-thread',
    ASK,
    async (request, reply) => {
      const unitId = validId(request.params.unitId, 'unitId');
      await getUnit(deps.pool, unitId);
      await clearOfficeRetrievalThread(
        deps.pool,
        requireStaffAccountId(request),
        {
          kind: 'unit',
          id: unitId,
        },
      );
      return reply
        .code(303)
        .header('location', `/estate/units/${unitId}`)
        .send();
    },
  );

  app.post<{ Params: { buildingId: string } }>(
    '/estate/buildings/:buildingId/office-turn',
    ASK,
    async (request, reply) => {
      const buildingId = validId(request.params.buildingId, 'buildingId');
      await getBuilding(deps.pool, buildingId);
      const posted = request.body as { question?: string };
      try {
        await deps.runOfficeTurn({
          staffAccountId: requireStaffAccountId(request),
          bound: { kind: 'building', id: buildingId },
          question: requireText(posted.question, 'question', 2000),
        });
      } catch (error) {
        if (error instanceof KernelError && error.code === 'unavailable') {
          return reply
            .code(303)
            .header(
              'location',
              `/estate/buildings/${buildingId}?ask=unavailable`,
            )
            .send();
        }
        throw error;
      }
      return reply
        .code(303)
        .header('location', `/estate/buildings/${buildingId}`)
        .send();
    },
  );

  app.post<{ Params: { buildingId: string } }>(
    '/estate/buildings/:buildingId/office-thread',
    ASK,
    async (request, reply) => {
      const buildingId = validId(request.params.buildingId, 'buildingId');
      await getBuilding(deps.pool, buildingId);
      await clearOfficeRetrievalThread(
        deps.pool,
        requireStaffAccountId(request),
        {
          kind: 'building',
          id: buildingId,
        },
      );
      return reply
        .code(303)
        .header('location', `/estate/buildings/${buildingId}`)
        .send();
    },
  );

  app.get('/estate/tenancies/:tenancyId', READ, async (request, reply) => {
    const tenancyId = validId(
      (request.params as { tenancyId: string }).tenancyId,
      'tenancyId',
    );
    const letting = await deps.getTenancy(deps.pool, tenancyId);
    const unit = await getUnit(deps.pool, letting.unit_id);
    const [members, documents, gate, captures] = await Promise.all([
      deps.listTenancyParties(deps.pool, tenancyId),
      deps.listLinkedDocuments(deps.pool, 'TENANCY', tenancyId),
      deps.activationGate(deps.pool, tenancyId),
      listApprovedCapturesForTenancy(deps.pool, tenancyId),
    ]);
    const names = await deps.listPartyNames(
      deps.pool,
      members.map((member) => member.party_id),
    );
    const byId = new Map(names.map((row) => [row.party_id, row.full_name]));
    const people: TenancyPersonView[] = members.map((member) => ({
      fullName: byId.get(member.party_id) ?? '',
      role: member.role,
      isServiceContact: member.is_service_contact,
    }));
    const csrf = csrfFrom(request);
    html(reply);
    return renderTenancyDetailPage({
      tenancyId,
      status: letting.status,
      startDate: letting.start_date,
      endDate: letting.end_date,
      rentAmount: letting.rent_amount,
      rentCurrency: letting.rent_currency,
      optionEndDate: letting.option_end_date,
      unit,
      people,
      documents,
      captures,
      checks: gate.checks,
      canActivate: gate.canActivate,
      activatableOn: gate.activatableOn,
      flags: gate.flags,
      csrf,
      nav: deps.chrome(csrf, 'estate', mayFile(request)),
    });
  });

  app.post<{ Params: { tenancyId: string } }>(
    '/estate/tenancies/:tenancyId/activate',
    WRITE,
    async (request, reply) => {
      const tenancyId = validId(request.params.tenancyId, 'tenancyId');
      await deps.activateTenancy(deps.pool, {
        tenancyId,
        actor: requireText(request.staff?.email ?? '', 'actor', 200),
      });
      return reply.redirect(`/estate/tenancies/${tenancyId}`);
    },
  );
}
