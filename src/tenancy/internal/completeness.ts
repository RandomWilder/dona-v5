// A4 — incomplete tenancies, derived. Slice 4.8. Gate misses join the same
// query at #108: the rule ids are the activation gate's, never a second copy.
import { addDays, type Clock, dayIn, today } from '../../kernel/clock.ts';
import { KernelError } from '../../kernel/errors.ts';
import {
  type ActivationCheck,
  activationGate,
  type TenancyDocumentsReader,
} from './activation.ts';
import type { Queryable } from './types.ts';

export type CompletenessRule = 'guarantor' | ActivationCheck['rule'];

export interface ProtocolWaiverView {
  actor: string;
  /** The office day the waiver was recorded. `YYYY-MM-DD`. */
  at: string;
  reason: string;
}

export interface IncompleteTenancy {
  tenancy_id: string;
  unit_id: string;
  unit_number: string;
  building_id: string;
  building_name: string;
  city: string;
  start_date: string;
  end_date: string;
  status: string;
  missing: CompletenessRule;
  expected_document_id: string;
  expected_document_label: string;
  /** Set when this letting's protocol was waived and another rule still misses. */
  protocolWaiver: ProtocolWaiverView | null;
}

export interface CompletenessExceptionSpec {
  tenancyId: string;
  rule: CompletenessRule;
  actor: string;
  reason: string;
  at: Date;
}

/** How far ahead a draft whose only miss is the start date is listed as arming soon. #158. */
export const ACTIVATION_QUEUE_DAYS = 14;

export interface ActivationQueueDraft {
  tenancy_id: string;
  unit_number: string;
  address_line: string;
  city: string;
  start_date: string;
  end_date: string;
}

/** A draft the gate will activate today. `ready_since` is the lease start — the date the gate reports as `activatableOn` before that day. */
export interface ReadyToActivate extends ActivationQueueDraft {
  ready_since: string;
  /** The office day is after `ready_since`, so the press was missed. */
  missed: boolean;
}

/** A draft whose only gate miss is `start_reached`, arming within `ACTIVATION_QUEUE_DAYS`. */
export interface ArmingSoon extends ActivationQueueDraft {
  /** The gate's `activatableOn`. */
  activatable_on: string;
}

export interface ActivationQueue {
  ready: ReadyToActivate[];
  soon: ArmingSoon[];
  withinDays: number;
}

type QueuePlace = Omit<IncompleteTenancy, 'missing'>;

const PLACE_SQL = `
SELECT t.tenancy_id,
       t.unit_id,
       u.unit_number,
       b.building_id,
       b.name AS building_name,
       b.city,
       t.start_date::text AS start_date,
       t.end_date::text AS end_date,
       t.status,
       d.document_id AS expected_document_id,
       d.label_he AS expected_document_label
  FROM tenancy t
  JOIN unit u ON u.unit_id = t.unit_id
  JOIN space s ON s.space_id = u.unit_id
  JOIN building b ON b.building_id = s.building_id
  JOIN LATERAL (
    SELECT doc.document_id, dt.label_he
      FROM document_link dl
      JOIN document doc ON doc.document_id = dl.document_id
      JOIN document_type dt ON dt.document_type_id = doc.document_type_id
     WHERE dl.entity_type = 'TENANCY'
       AND dl.entity_id = t.tenancy_id
     ORDER BY (dt.type_key = 'lease') DESC, doc.ingested_at ASC
     LIMIT 1
  ) d ON true
 WHERE t.status IN ('DRAFT', 'ACTIVE')`;

const GUARANTOR_SQL = `${PLACE_SQL}
   AND NOT EXISTS (
     SELECT 1 FROM tenancy_party tp
      WHERE tp.tenancy_id = t.tenancy_id AND tp.role = 'GUARANTOR'
   )
   AND NOT EXISTS (
     SELECT 1 FROM tenancy_completeness_exception e
      WHERE e.tenancy_id = t.tenancy_id AND e.rule = 'guarantor'
   )`;

function byPlaceThenRule(a: IncompleteTenancy, b: IncompleteTenancy): number {
  return (
    a.city.localeCompare(b.city, 'he') ||
    a.building_name.localeCompare(b.building_name, 'he') ||
    a.unit_number.localeCompare(b.unit_number, 'he') ||
    a.missing.localeCompare(b.missing)
  );
}

export async function listIncompleteTenancies(
  db: Queryable,
  clock: Clock,
  documents: TenancyDocumentsReader,
): Promise<IncompleteTenancy[]> {
  const guarantor = await db.query<QueuePlace>(GUARANTOR_SQL);
  const places = await db.query<QueuePlace>(PLACE_SQL);
  const waived = await db.query<{
    tenancy_id: string;
    actor: string;
    at: Date;
    reason: string;
  }>(
    `SELECT tenancy_id, actor, at, reason
       FROM tenancy_completeness_exception
      WHERE rule = 'handover_protocol'`,
  );
  const waiverByTenancy = new Map(
    waived.rows.map((row) => [
      row.tenancy_id,
      {
        actor: row.actor,
        reason: row.reason,
        at: dayIn(row.at, clock.zone),
      },
    ]),
  );
  const withWaiver = (row: QueuePlace): IncompleteTenancy['protocolWaiver'] =>
    waiverByTenancy.get(row.tenancy_id) ?? null;
  const rows: IncompleteTenancy[] = [
    ...guarantor.rows.map((row) => ({
      ...row,
      missing: 'guarantor' as const,
      protocolWaiver: withWaiver(row),
    })),
  ];
  for (const place of places.rows) {
    const gate = await activationGate(db, clock, place.tenancy_id, documents);
    for (const check of gate.checks) {
      if (check.passed) continue;
      rows.push({
        ...place,
        missing: check.rule,
        protocolWaiver: withWaiver(place),
      });
    }
  }
  return rows.sort(byPlaceThenRule);
}

const DRAFT_SQL = `
SELECT t.tenancy_id,
       u.unit_number,
       b.address_line,
       b.city,
       t.start_date::text AS start_date,
       t.end_date::text AS end_date
  FROM tenancy t
  JOIN unit u ON u.unit_id = t.unit_id
  JOIN space s ON s.space_id = u.unit_id
  JOIN building b ON b.building_id = s.building_id
 WHERE t.status = 'DRAFT'
   AND EXISTS (
     SELECT 1 FROM document_link dl
      WHERE dl.entity_type = 'TENANCY' AND dl.entity_id = t.tenancy_id
   )`;

function byStart(
  a: { start_date: string; tenancy_id: string },
  b: { start_date: string; tenancy_id: string },
): number {
  return (
    a.start_date.localeCompare(b.start_date) ||
    a.tenancy_id.localeCompare(b.tenancy_id)
  );
}

/**
 * #158. Drafts the office should press, classified from `activationGate` and from nothing else.
 * A passing gate is ready. A single `start_reached` miss whose `activatableOn` falls inside
 * `ACTIVATION_QUEUE_DAYS` is arming soon. No party, no name.
 */
export async function listActivationQueue(
  db: Queryable,
  clock: Clock,
  documents: TenancyDocumentsReader,
): Promise<ActivationQueue> {
  const day = today(clock);
  const horizon = addDays(day, ACTIVATION_QUEUE_DAYS);
  const places = await db.query<ActivationQueueDraft>(DRAFT_SQL);
  const ready: ReadyToActivate[] = [];
  const soon: ArmingSoon[] = [];
  for (const place of places.rows) {
    const gate = await activationGate(db, clock, place.tenancy_id, documents);
    if (gate.canActivate) {
      ready.push({
        ...place,
        ready_since: place.start_date,
        missed: place.start_date < day,
      });
      continue;
    }
    const open = gate.checks.filter((check) => !check.passed);
    const onlyStart = open.length === 1 && open[0]?.rule === 'start_reached';
    if (
      onlyStart &&
      gate.activatableOn !== null &&
      gate.activatableOn <= horizon
    ) {
      soon.push({ ...place, activatable_on: gate.activatableOn });
    }
  }
  ready.sort(byStart);
  soon.sort(byStart);
  return { ready, soon, withinDays: ACTIVATION_QUEUE_DAYS };
}

const FOREIGN_KEY_VIOLATION = '23503';

export async function recordCompletenessException(
  db: Queryable,
  spec: CompletenessExceptionSpec,
): Promise<'recorded' | 'alreadyRecorded'> {
  try {
    const result = await db.query<{ tenancy_id: string }>(
      `INSERT INTO tenancy_completeness_exception
         (tenancy_id, rule, at, actor, reason)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (tenancy_id, rule) DO NOTHING
       RETURNING tenancy_id`,
      [spec.tenancyId, spec.rule, spec.at, spec.actor, spec.reason],
    );
    return result.rows[0] ? 'recorded' : 'alreadyRecorded';
  } catch (error) {
    if ((error as { code?: string }).code === FOREIGN_KEY_VIOLATION) {
      throw new KernelError('not_found', 'tenancy not found');
    }
    throw error;
  }
}
