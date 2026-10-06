// Opening a service call by hand, then identifying the requester, setting the
// trade, and closing it by an Exit. #182 opened the call. #183 is the two
// commands after that. #184 closes it before a visit.
//
// PHONE and WALK_IN skip the sorter. The channel is written once; nothing in this
// module updates it, and the database trigger refuses a later write that tries.
// Identifying links this call to one party and writes no contact. A guarantor
// who is not a service contact is refused by the database, not by this file
// hiding the name.
import { createAuditLog } from '../../kernel/audit.ts';
import type { Clock } from '../../kernel/clock.ts';
import { inTransaction } from '../../kernel/db.ts';
import { KernelError } from '../../kernel/errors.ts';
import { newId } from '../../kernel/ids.ts';
import { INSERTED, type UpsertResult } from '../../kernel/upsert.ts';
import { requireText, validId } from '../../kernel/validate.ts';
import type { Queryable } from './types.ts';

export const SOURCE_CHANNELS = [
  'WHATSAPP',
  'EMAIL',
  'PHONE',
  'WALK_IN',
] as const;
export type SourceChannel = (typeof SOURCE_CHANNELS)[number];

export const CALL_STATES = [
  'NEW',
  'IDENTIFIED',
  'TRIAGED',
  'RESPONSIBILITY_SET',
  'WINDOWS_COLLECTED',
  'OFFERED',
  'SCHEDULED',
  'CLOSED',
] as const;
export type CallState = (typeof CALL_STATES)[number];

export const EXIT_KINDS = [
  'ANSWERED',
  'FORWARDED',
  'DUPLICATE',
  'CANCELLED',
] as const;
export type ExitKind = (typeof EXIT_KINDS)[number];

/** Any state before SCHEDULED. A visit has not been set, so an Exit can close it. */
const EXITABLE_STATES = [
  'NEW',
  'IDENTIFIED',
  'TRIAGED',
  'RESPONSIBILITY_SET',
  'WINDOWS_COLLECTED',
  'OFFERED',
] as const satisfies readonly CallState[];

export function canExit(state: CallState): boolean {
  return (EXITABLE_STATES as readonly string[]).includes(state);
}

export const MANUAL_CHANNELS = ['PHONE', 'WALK_IN'] as const;
export type ManualChannel = (typeof MANUAL_CHANNELS)[number];

export type CallSender = { kind: 'named'; name: string } | { kind: 'unknown' };

export interface CallParty {
  id: string;
  name: string;
}

export interface CallCategory {
  id: string;
  code: string;
  labelHe: string;
  active: boolean;
}

export interface ServiceCall {
  id: string;
  sourceChannel: SourceChannel;
  state: CallState;
  description: string;
  sender: CallSender;
  openedAt: Date;
  requester: CallParty | null;
  category: CallCategory | null;
}

export type TransitionKind = 'OPENED' | 'IDENTIFIED' | 'TRIAGED' | ExitKind;

export interface CallLink {
  id: string;
  description: string;
}

export interface CallExit {
  kind: ExitKind;
  note: string | null;
  department: string | null;
  duplicateOf: CallLink | null;
  at: Date;
  actorId: string;
  actorLabel: string;
}

export interface CallTransition {
  kind: TransitionKind;
  at: Date;
  actorId: string;
  actorLabel: string;
  partyName: string | null;
  categoryLabel: string | null;
  note?: string | null;
  department?: string | null;
  duplicateOf?: CallLink | null;
}

export interface ServiceCallDetail extends ServiceCall {
  timeline: readonly CallTransition[];
  exit: CallExit | null;
  /** Calls that named this one as the call they repeat. */
  repeatedBy: readonly CallLink[];
}

export interface OpenCallSpec {
  sourceChannel: string;
  description: string;
  sender: CallSender;
  openedBy: string;
  actorRole?: string | null;
}

export interface IdentifyCallSpec {
  callId: string;
  partyId: string;
  actorId: string;
  actorRole?: string | null;
}

export interface SetCategorySpec {
  callId: string;
  categoryId: string;
  actorId: string;
  actorRole?: string | null;
}

export interface ExitCallSpec {
  callId: string;
  kind: string;
  note?: string | null;
  department?: string | null;
  duplicateOf?: string | null;
  actorId: string;
  actorRole?: string | null;
}

export interface CallListFilter {
  state?: CallState;
  categoryId?: string;
}

export interface CategorySpec {
  code: string;
  labelHe: string;
  labelEn: string | null;
  isActive: boolean;
}

export interface CategoryRow {
  id: string;
  code: string;
  labelHe: string;
  labelEn: string | null;
  isActive: boolean;
}

export const DESCRIPTION_MAX = 4000;
export const SENDER_MAX = 200;
export const NOTE_MAX = 2000;
export const DEPARTMENT_MAX = 120;

const CATEGORY_CODE = /^[A-Z][A-Z0-9_]{0,63}$/;

function refuse(field: 'channel' | 'description' | 'sender'): never {
  throw new KernelError('invalid', `${field} is required`, { field });
}

function requiredText(
  value: string,
  field: 'description' | 'sender',
  max: number,
): string {
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > max) refuse(field);
  return trimmed;
}

function manualChannel(value: string): ManualChannel {
  for (const channel of MANUAL_CHANNELS) {
    if (value === channel) return channel;
  }
  return refuse('channel');
}

function senderOf(unknown: boolean, label: string | null): CallSender {
  if (unknown || label === null || label.trim().length === 0) {
    return { kind: 'unknown' };
  }
  return { kind: 'named', name: label.trim() };
}

function idOf(value: string, field: string): string {
  try {
    return validId(value, field);
  } catch (error) {
    if (error instanceof KernelError && error.code === 'invalid') {
      throw new KernelError('invalid', `${field} is not an id`, {
        field,
        reason: 'id',
      });
    }
    throw error;
  }
}

interface PgError {
  code?: string;
  message?: string;
}

function pgError(error: unknown): PgError {
  if (error !== null && typeof error === 'object') {
    const row = error as { code?: unknown; message?: unknown };
    return {
      code: typeof row.code === 'string' ? row.code : undefined,
      message: typeof row.message === 'string' ? row.message : undefined,
    };
  }
  return {};
}

interface CallRow {
  service_call_id: string;
  source_channel: SourceChannel;
  state: CallState;
  description: string;
  sender_label: string | null;
  sender_unknown: boolean;
  opened_at: Date;
  opened_by: string;
  opener_label: string;
  requester_party_id: string | null;
  requester_name: string | null;
  category_id: string | null;
  category_code: string | null;
  category_label_he: string | null;
  category_active: boolean | null;
  exit_kind: string | null;
  exit_note: string | null;
  exit_department: string | null;
  duplicate_of: string | null;
  duplicate_description: string | null;
  closed_at: Date | null;
  closed_by: string | null;
  closer_label: string | null;
}

const CALL_SELECT = `SELECT sc.service_call_id, sc.source_channel, sc.state, sc.description,
            sc.sender_label, sc.sender_unknown, sc.opened_at, sc.opened_by,
            COALESCE(NULLIF(btrim(opener.display_name), ''), opener.email) AS opener_label,
            sc.requester_party_id, requester.full_name AS requester_name,
            sc.category_id, category.code AS category_code,
            category.label_he AS category_label_he,
            category.is_active AS category_active,
            sc.exit_kind, sc.exit_note, sc.exit_department,
            sc.duplicate_of, other.description AS duplicate_description,
            sc.closed_at, sc.closed_by,
            COALESCE(NULLIF(btrim(closer.display_name), ''), closer.email) AS closer_label
       FROM service_call sc
       JOIN staff_account opener ON opener.staff_account_id = sc.opened_by
       LEFT JOIN party requester ON requester.party_id = sc.requester_party_id
       LEFT JOIN call_category category ON category.category_id = sc.category_id
       LEFT JOIN service_call other ON other.service_call_id = sc.duplicate_of
       LEFT JOIN staff_account closer ON closer.staff_account_id = sc.closed_by`;

function toCall(row: CallRow): ServiceCall {
  return {
    id: row.service_call_id,
    sourceChannel: row.source_channel,
    state: row.state,
    description: row.description,
    sender: senderOf(row.sender_unknown, row.sender_label),
    openedAt: row.opened_at,
    requester:
      row.requester_party_id === null || row.requester_name === null
        ? null
        : { id: row.requester_party_id, name: row.requester_name },
    category:
      row.category_id === null ||
      row.category_code === null ||
      row.category_label_he === null ||
      row.category_active === null
        ? null
        : {
            id: row.category_id,
            code: row.category_code,
            labelHe: row.category_label_he,
            active: row.category_active,
          },
  };
}

function isExitKind(value: string): value is ExitKind {
  for (const kind of EXIT_KINDS) {
    if (value === kind) return true;
  }
  return false;
}

function exitOf(row: CallRow): CallExit | null {
  if (
    row.exit_kind === null ||
    row.closed_at === null ||
    row.closed_by === null ||
    row.closer_label === null ||
    !isExitKind(row.exit_kind)
  ) {
    return null;
  }
  return {
    kind: row.exit_kind,
    note: row.exit_note,
    department: row.exit_department,
    duplicateOf:
      row.duplicate_of === null || row.duplicate_description === null
        ? null
        : { id: row.duplicate_of, description: row.duplicate_description },
    at: row.closed_at,
    actorId: row.closed_by,
    actorLabel: row.closer_label,
  };
}

function isState(value: string): value is CallState {
  for (const state of CALL_STATES) {
    if (value === state) return true;
  }
  return false;
}

interface LockedCall {
  state: CallState;
  requester_party_id: string | null;
  category_id: string | null;
}

async function lockCall(db: Queryable, id: string): Promise<LockedCall> {
  const { rows } = await db.query<LockedCall>(
    `SELECT state, requester_party_id, category_id
       FROM service_call
      WHERE service_call_id = $1
      FOR UPDATE`,
    [id],
  );
  const row = rows[0];
  if (!row || !isState(row.state)) {
    throw new KernelError('not_found', 'call not found');
  }
  return row;
}

async function requireDetail(
  db: Queryable,
  id: string,
): Promise<ServiceCallDetail> {
  const detail = await getCall(db, id);
  if (!detail) throw new KernelError('not_found', 'call not found');
  return detail;
}

export async function openCall(
  db: Queryable,
  clock: Clock,
  spec: OpenCallSpec,
): Promise<ServiceCall> {
  const sourceChannel = manualChannel(spec.sourceChannel);
  const description = requiredText(
    spec.description,
    'description',
    DESCRIPTION_MAX,
  );
  const openedBy = validId(spec.openedBy, 'openedBy');
  const senderLabel =
    spec.sender.kind === 'unknown'
      ? null
      : requiredText(spec.sender.name, 'sender', SENDER_MAX);
  const senderUnknown = senderLabel === null;
  const id = newId(clock);
  const openedAt = clock.now();

  await inTransaction(db, async (tx) => {
    await tx.query(
      `INSERT INTO service_call
         (service_call_id, source_channel, state, description, sender_label,
          sender_unknown, opened_at, opened_by)
       VALUES ($1, $2, 'NEW', $3, $4, $5, $6, $7)`,
      [
        id,
        sourceChannel,
        description,
        senderLabel,
        senderUnknown,
        openedAt,
        openedBy,
      ],
    );
    await createAuditLog(tx, clock).write(
      {
        actorKind: 'staff',
        actorId: openedBy,
        actorRole: spec.actorRole ?? undefined,
        action: 'calls.open',
        subjectId: id,
        inputs: {
          sourceChannel,
          sender: senderUnknown ? 'unknown' : 'named',
        },
      },
      { outcome: 'ok' },
    );
  });

  return {
    id,
    sourceChannel,
    state: 'NEW',
    description,
    sender: senderOf(senderUnknown, senderLabel),
    openedAt,
    requester: null,
    category: null,
  };
}

export async function countOpenCalls(db: Queryable): Promise<number> {
  const { rows } = await db.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM service_call WHERE state <> 'CLOSED'`,
  );
  return rows[0]?.n ?? 0;
}

export async function listOpenCalls(
  db: Queryable,
  filter: CallListFilter = {},
): Promise<ServiceCall[]> {
  const state = filter.state ?? null;
  const categoryId =
    filter.categoryId === undefined
      ? null
      : validId(filter.categoryId, 'category');
  const { rows } = await db.query<CallRow>(
    `${CALL_SELECT}
      WHERE sc.state = COALESCE($1::text, sc.state)
        AND ($1::text IS NOT NULL OR sc.state <> 'CLOSED')
        AND ($2::uuid IS NULL OR sc.category_id = $2)
      ORDER BY sc.opened_at DESC, sc.service_call_id DESC`,
    [state, categoryId],
  );
  return rows.map(toCall);
}

export async function getCall(
  db: Queryable,
  callId: string,
): Promise<ServiceCallDetail | null> {
  const id = validId(callId, 'call');
  const { rows } = await db.query<CallRow>(
    `${CALL_SELECT} WHERE sc.service_call_id = $1`,
    [id],
  );
  const row = rows[0];
  if (!row) return null;
  const events = await db.query<{
    kind: string;
    at: Date;
    actor_id: string;
    actor_label: string;
    party_name: string | null;
    category_label: string | null;
    note: string | null;
    department: string | null;
    duplicate_of: string | null;
    duplicate_description: string | null;
  }>(
    `SELECT t.kind, t.at, t.actor_id,
            COALESCE(NULLIF(btrim(actor.display_name), ''), actor.email) AS actor_label,
            party.full_name AS party_name,
            category.label_he AS category_label,
            t.note, t.department, t.duplicate_of,
            dup.description AS duplicate_description
       FROM service_call_transition t
       JOIN staff_account actor ON actor.staff_account_id = t.actor_id
       LEFT JOIN party ON party.party_id = t.party_id
       LEFT JOIN call_category category ON category.category_id = t.category_id
       LEFT JOIN service_call dup ON dup.service_call_id = t.duplicate_of
      WHERE t.service_call_id = $1
      ORDER BY t.at,
               CASE t.kind WHEN 'IDENTIFIED' THEN 1 WHEN 'TRIAGED' THEN 2 ELSE 3 END,
               t.transition_id`,
    [id],
  );
  const links = await db.query<{
    service_call_id: string;
    description: string;
  }>(
    `SELECT service_call_id, description
       FROM service_call
      WHERE duplicate_of = $1
      ORDER BY closed_at, service_call_id`,
    [id],
  );
  const opened: CallTransition = {
    kind: 'OPENED',
    at: row.opened_at,
    actorId: row.opened_by,
    actorLabel: row.opener_label,
    partyName: null,
    categoryLabel: null,
  };
  const timeline: CallTransition[] = [opened];
  for (const event of events.rows) {
    const kind =
      event.kind === 'IDENTIFIED' || event.kind === 'TRIAGED'
        ? event.kind
        : isExitKind(event.kind)
          ? event.kind
          : null;
    if (kind === null) continue;
    timeline.push({
      kind,
      at: event.at,
      actorId: event.actor_id,
      actorLabel: event.actor_label,
      partyName: event.party_name,
      categoryLabel: event.category_label,
      note: event.note,
      department: event.department,
      duplicateOf:
        event.duplicate_of === null || event.duplicate_description === null
          ? null
          : {
              id: event.duplicate_of,
              description: event.duplicate_description,
            },
    });
  }
  return {
    ...toCall(row),
    timeline,
    exit: exitOf(row),
    repeatedBy: links.rows.map((link) => ({
      id: link.service_call_id,
      description: link.description,
    })),
  };
}

export async function identifyCall(
  db: Queryable,
  clock: Clock,
  spec: IdentifyCallSpec,
): Promise<ServiceCallDetail> {
  const callId = idOf(spec.callId, 'call');
  const partyId = idOf(spec.partyId, 'party');
  const actorId = idOf(spec.actorId, 'actor');
  await inTransaction(db, async (tx) => {
    const current = await lockCall(tx, callId);
    if (current.state !== 'NEW') {
      throw new KernelError('invalid', 'only a new call can be identified', {
        field: 'state',
        reason: 'identify',
      });
    }
    await tx.query('SAVEPOINT identify_call');
    try {
      await tx.query(
        `UPDATE service_call
            SET state = 'IDENTIFIED', requester_party_id = $2
          WHERE service_call_id = $1`,
        [callId, partyId],
      );
      await tx.query('RELEASE SAVEPOINT identify_call');
    } catch (error) {
      await tx.query('ROLLBACK TO SAVEPOINT identify_call');
      const pg = pgError(error);
      if (pg.code === '23514' && pg.message?.includes('guarantor') === true) {
        throw new KernelError(
          'invalid',
          'a guarantor cannot be the requester',
          { field: 'party', reason: 'guarantor' },
        );
      }
      if (pg.code === '23503') {
        throw new KernelError('not_found', 'party not found', {
          field: 'party',
        });
      }
      throw error;
    }
    await tx.query(
      `INSERT INTO service_call_transition
         (transition_id, service_call_id, kind, actor_id, at, party_id)
       VALUES ($1, $2, 'IDENTIFIED', $3, $4, $5)`,
      [newId(clock), callId, actorId, clock.now(), partyId],
    );
    await createAuditLog(tx, clock).write(
      {
        actorKind: 'staff',
        actorId,
        actorRole: spec.actorRole ?? undefined,
        action: 'calls.identify',
        subjectId: callId,
        inputs: { partyId },
      },
      { outcome: 'ok' },
    );
  });
  return requireDetail(db, callId);
}

export async function setCallCategory(
  db: Queryable,
  clock: Clock,
  spec: SetCategorySpec,
): Promise<ServiceCallDetail> {
  const callId = idOf(spec.callId, 'call');
  const categoryId = idOf(spec.categoryId, 'category');
  const actorId = idOf(spec.actorId, 'actor');
  await inTransaction(db, async (tx) => {
    const current = await lockCall(tx, callId);
    if (current.state !== 'IDENTIFIED' && current.state !== 'TRIAGED') {
      throw new KernelError(
        'invalid',
        'a category is set once the requester is known',
        { field: 'state', reason: 'category' },
      );
    }
    if (current.state === 'TRIAGED' && current.category_id === categoryId) {
      return;
    }
    const chosen = await tx.query<{ is_active: boolean }>(
      `SELECT is_active FROM call_category WHERE category_id = $1`,
      [categoryId],
    );
    const category = chosen.rows[0];
    if (!category) {
      throw new KernelError('not_found', 'category not found', {
        field: 'category',
      });
    }
    if (!category.is_active) {
      throw new KernelError('invalid', 'only an active category can be set', {
        field: 'category',
        reason: 'inactive',
      });
    }
    await tx.query(
      `UPDATE service_call
          SET state = 'TRIAGED', category_id = $2
        WHERE service_call_id = $1`,
      [callId, categoryId],
    );
    await tx.query(
      `INSERT INTO service_call_transition
         (transition_id, service_call_id, kind, actor_id, at, category_id)
       VALUES ($1, $2, 'TRIAGED', $3, $4, $5)`,
      [newId(clock), callId, actorId, clock.now(), categoryId],
    );
    await createAuditLog(tx, clock).write(
      {
        actorKind: 'staff',
        actorId,
        actorRole: spec.actorRole ?? undefined,
        action: 'calls.triage',
        subjectId: callId,
        inputs: { categoryId },
      },
      { outcome: 'ok' },
    );
  });
  return requireDetail(db, callId);
}

function exitKindOf(value: string): ExitKind {
  for (const kind of EXIT_KINDS) {
    if (value === kind) return kind;
  }
  throw new KernelError('invalid', 'exit is not one of the four', {
    field: 'exit',
  });
}

function trimmed(
  value: string | null | undefined,
  field: 'note' | 'department',
  max: number,
): string | null {
  if (value == null) return null;
  const text = value.trim();
  if (text.length === 0) return null;
  if (text.length > max) {
    throw new KernelError('invalid', `${field} is too long`, { field });
  }
  return text;
}

function present(value: string | null, field: 'note' | 'department'): string {
  if (value === null) {
    throw new KernelError('invalid', `${field} is required`, { field });
  }
  return value;
}

/**
 * Closes a call by one Exit. The reason is whatever that Exit requires: a
 * note, a department and a note, or another call. A closed call stays closed.
 */
export async function exitCall(
  db: Queryable,
  clock: Clock,
  spec: ExitCallSpec,
): Promise<ServiceCallDetail> {
  const callId = idOf(spec.callId, 'call');
  const actorId = idOf(spec.actorId, 'actor');
  const kind = exitKindOf(spec.kind);
  const note = trimmed(spec.note, 'note', NOTE_MAX);
  const department = trimmed(spec.department, 'department', DEPARTMENT_MAX);
  let duplicateOf: string | null = null;
  if (kind === 'ANSWERED' || kind === 'CANCELLED') {
    present(note, 'note');
  } else if (kind === 'FORWARDED') {
    present(note, 'note');
    present(department, 'department');
  } else {
    const raw = spec.duplicateOf?.trim() ?? '';
    if (raw.length === 0) {
      throw new KernelError('invalid', 'duplicate names the other call', {
        field: 'duplicate',
      });
    }
    duplicateOf = idOf(raw, 'duplicate');
    if (duplicateOf === callId) {
      throw new KernelError('invalid', 'a call cannot repeat itself', {
        field: 'duplicate',
        reason: 'self',
      });
    }
  }
  const storedNote = kind === 'DUPLICATE' ? note : present(note, 'note');
  const storedDepartment = kind === 'FORWARDED' ? department : null;
  const storedDuplicate = kind === 'DUPLICATE' ? duplicateOf : null;

  await inTransaction(db, async (tx) => {
    const current = await lockCall(tx, callId);
    if (current.state === 'CLOSED') {
      throw new KernelError('invalid', 'a closed call cannot change', {
        field: 'state',
        reason: 'closed',
      });
    }
    if (!canExit(current.state)) {
      throw new KernelError(
        'invalid',
        'an exit is only from a state before it is scheduled',
        { field: 'state', reason: 'exit' },
      );
    }
    if (storedDuplicate !== null) {
      const found = await tx.query(
        `SELECT 1 FROM service_call WHERE service_call_id = $1`,
        [storedDuplicate],
      );
      if (!found.rows[0]) {
        throw new KernelError('not_found', 'call not found', {
          field: 'duplicate',
        });
      }
    }
    const at = clock.now();
    await tx.query(
      `UPDATE service_call
          SET state = 'CLOSED', exit_kind = $2, exit_note = $3,
              exit_department = $4, duplicate_of = $5,
              closed_at = $6, closed_by = $7
        WHERE service_call_id = $1`,
      [
        callId,
        kind,
        storedNote,
        storedDepartment,
        storedDuplicate,
        at,
        actorId,
      ],
    );
    await tx.query(
      `INSERT INTO service_call_transition
         (transition_id, service_call_id, kind, actor_id, at, note, department,
          duplicate_of)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        newId(clock),
        callId,
        kind,
        actorId,
        at,
        storedNote,
        storedDepartment,
        storedDuplicate,
      ],
    );
    await createAuditLog(tx, clock).write(
      {
        actorKind: 'staff',
        actorId,
        actorRole: spec.actorRole ?? undefined,
        action: 'calls.exit',
        subjectId: callId,
        inputs: {
          kind,
          department: storedDepartment,
          duplicateOf: storedDuplicate,
        },
      },
      { outcome: 'ok' },
    );
  });
  return requireDetail(db, callId);
}

const CALL_SEARCH_LIMIT = 8;

/** Other calls whose description matches, for naming the one a duplicate repeats. */
export async function findCallsByDescription(
  db: Queryable,
  query: string,
  exceptId: string,
): Promise<CallLink[]> {
  const trimmedQuery = query.trim();
  if (trimmedQuery.length === 0 || trimmedQuery.length > 80) return [];
  const except = validId(exceptId, 'call');
  const pattern = `%${trimmedQuery.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
  const { rows } = await db.query<{
    service_call_id: string;
    description: string;
  }>(
    `SELECT service_call_id, description
       FROM service_call
      WHERE service_call_id <> $1
        AND description ILIKE $2 ESCAPE '\\'
      ORDER BY opened_at DESC, service_call_id DESC
      LIMIT $3`,
    [except, pattern, CALL_SEARCH_LIMIT],
  );
  return rows.map((row) => ({
    id: row.service_call_id,
    description: row.description,
  }));
}

function categoryCode(value: string): string {
  const code = value.trim().toUpperCase();
  if (!CATEGORY_CODE.test(code)) {
    throw new KernelError('invalid', 'code is not a category code', {
      field: 'code',
    });
  }
  return code;
}

/**
 * Adds a category, or updates the one holding this `code`.
 *
 * **There is no delete.** A category is deactivated and never deleted: calls
 * that already carry it keep it, and the trigger refuses the DELETE.
 */
export async function upsertCategory(
  db: Queryable,
  spec: CategorySpec,
): Promise<UpsertResult> {
  const code = categoryCode(spec.code);
  const labelHe = requireText(spec.labelHe, 'label_he', 120);
  const labelEn =
    spec.labelEn === null ? null : requireText(spec.labelEn, 'label_en', 120);
  const result = await db.query<{ category_id: string; inserted: boolean }>(
    `INSERT INTO call_category (category_id, code, label_he, label_en, is_active)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (code) DO UPDATE
       SET label_he = EXCLUDED.label_he,
           label_en = EXCLUDED.label_en,
           is_active = EXCLUDED.is_active
     RETURNING category_id, ${INSERTED}`,
    [newId(), code, labelHe, labelEn, spec.isActive],
  );
  const row = result.rows[0];
  if (!row) {
    throw new KernelError('conflict', 'category upsert returned no row');
  }
  return { id: row.category_id, inserted: row.inserted };
}

export async function listCategories(
  db: Queryable,
  options: { activeOnly?: boolean } = {},
): Promise<CategoryRow[]> {
  const activeOnly = options.activeOnly === true;
  const { rows } = await db.query<{
    category_id: string;
    code: string;
    label_he: string;
    label_en: string | null;
    is_active: boolean;
  }>(
    `SELECT category_id, code, label_he, label_en, is_active
       FROM call_category
      WHERE ($1::boolean = false OR is_active)
      ORDER BY code`,
    [activeOnly],
  );
  return rows.map((row) => ({
    id: row.category_id,
    code: row.code,
    labelHe: row.label_he,
    labelEn: row.label_en,
    isActive: row.is_active,
  }));
}
