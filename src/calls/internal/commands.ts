// Opening a service call by hand, then identifying the requester, setting the
// trade, and closing it by an Exit. #182 opened the call. #183 is the two
// commands after that. #184 closes it before a visit. #186 opens one from the
// intake door, with no staff account, and returns one to the filtered list.
//
// PHONE and WALK_IN skip the sorter. The channel is written once; nothing in this
// module updates it, and the database trigger refuses a later write that tries.
// Identifying links this call to one party and writes no contact. A guarantor
// who is not a service contact is refused by the database, not by this file
// hiding the name.
import { createAuditLog } from '../../kernel/audit.ts';
import { type Clock, calendarDate, today } from '../../kernel/clock.ts';
import { inTransaction } from '../../kernel/db.ts';
import { KernelError } from '../../kernel/errors.ts';
import { newId } from '../../kernel/ids.ts';
import { INSERTED, type UpsertResult } from '../../kernel/upsert.ts';
import { requireText, validId } from '../../kernel/validate.ts';
import { upsertPartyContact } from '../../parties/contract.ts';
import { normaliseEmail, normalisePhone } from '../../scope/contract.ts';
import { businessDaysElapsed } from './business-days.ts';
import { emergencyTermMatches } from './emergency.ts';
import type { Queryable } from './types.ts';

export const SOURCE_CHANNELS = [
  'WHATSAPP',
  'EMAIL',
  'PHONE',
  'WALK_IN',
  'PORTAL',
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

export type SorterLabel = 'call' | 'unsure' | 'noise';

export const INTAKE_CHANNELS = ['WHATSAPP', 'EMAIL', 'PORTAL'] as const;
export type IntakeChannel = (typeof INTAKE_CHANNELS)[number];

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

/** Whether the office may enter while the tenant is out. #282. */
export type EntryPermission = 'YES' | 'ARRANGE' | 'HOME';

export type EmergencyMark =
  | { flagged: false }
  | { flagged: true; by: 'terms' }
  | {
      flagged: true;
      by: 'staff';
      actorId: string;
      actorLabel: string;
    };

/** One call on a party's profile. The calls that name that party as requester. #209. */
export interface RequesterCall {
  id: string;
  openedAt: Date;
  state: CallState;
  description: string;
  /** The Category's Hebrew label. Null when none is set. */
  categoryLabel: string | null;
  emergency: boolean;
}

export interface ServiceCall {
  id: string;
  /** The number the sender is shown. Set when the row is read from the table. */
  callNumber?: number;
  sourceChannel: SourceChannel;
  state: CallState;
  description: string;
  sender: CallSender;
  openedAt: Date;
  requester: CallParty | null;
  category: CallCategory | null;
  emergency: EmergencyMark;
  /** Flagged now, or a flag was recorded. A closed row says היה חירום from this. */
  wasEmergency: boolean;
  /** A mark, not a state. Unsure, a sorter failure, or an emergency the sorter did not call a call. */
  toReview: boolean;
  summary: string | null;
  /** The sorter's Category. Not the one a person set, and it does not move the call. */
  proposal: CallCategory | null;
  /** The tenant's Category on a portal report. Not the call's Category. #282. */
  suggestion: CallCategory | null;
  /** Null on a call that is not a portal report. */
  entry: EntryPermission | null;
  /** The tenancy a portal report names. Null on every other call. */
  tenancy: { id: string; unitNumber: string; addressLine: string } | null;
  sorterLabel: SorterLabel | null;
  /** The model that produced the proposal. Null when there was no verdict. */
  sorterModel: string | null;
  /** The prompt version that produced the proposal. */
  sorterPrompt: string | null;
  /** Returned to the filtered list. Not closed, and not in the open list. */
  returned: boolean;
  /** How a closed call left. Null on an open call. */
  exit: CallExit | null;
}

export type TransitionKind =
  | 'OPENED'
  | 'IDENTIFIED'
  | 'TRIAGED'
  | 'FLAGGED'
  | 'CLEARED'
  | 'REPLIED'
  | ExitKind;

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
  actorId: string | null;
  actorLabel: string;
  partyName: string | null;
  categoryLabel: string | null;
  /** Set on a FLAGGED event: the terms, or the staff account. */
  flagBy: 'terms' | 'staff' | null;
  note?: string | null;
  department?: string | null;
  duplicateOf?: CallLink | null;
  /** Set on a REPLIED event: the text matched the stored draft, or the person edited it. */
  replyMark?: 'edited' | 'as_written' | null;
}

export interface ServiceCallDetail extends ServiceCall {
  timeline: readonly CallTransition[];
  /** Calls that named this one as the call they repeat. */
  repeatedBy: readonly CallLink[];
  /** Later calls that name this one as the call they continue. Newest first. */
  continuedBy: readonly CallLink[];
  /** The closed call this one continues, when the thread's call was already closed. */
  predecessor: CallLink | null;
  /** Who returned it to the filtered list, when it was returned. */
  returnedBy: string | null;
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

export interface IdentifyByAddressSpec {
  callId: string;
  partyId: string;
}

export interface SaveSenderContactSpec {
  callId: string;
  actorId: string;
  actorRole?: string | null;
}

export interface SetCategorySpec {
  callId: string;
  categoryId: string;
  actorId: string;
  actorRole?: string | null;
}

export interface EmergencyActorSpec {
  callId: string;
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
  emergency?: boolean;
  toReview?: boolean;
  /** Amber excludes past. Red is past only. Late is near or past, and has no band of its own. */
  band?: ResponseBand | 'late';
}

export interface OpenIntakeCallSpec {
  sourceChannel: string;
  description: string;
  senderAddress: string;
  emergency: boolean;
  toReview: boolean;
  sorterLabel: SorterLabel | null;
  summary: string | null;
  proposedCategoryId: string | null;
  predecessorId: string | null;
  /** Set when a person rescues a filtered message. The door passes null. */
  openedBy: string | null;
  actorRole?: string | null;
  sorterModel: string | null;
  sorterPrompt: string | null;
  /** A portal report. All three, or none. */
  suggestedCategoryId?: string | null;
  entryPermission?: EntryPermission | null;
  tenancyId?: string | null;
}

export interface ReturnCallSpec {
  callId: string;
  actorId: string;
  actorRole?: string | null;
}

export interface ReturnedCall {
  id: string;
  title: string;
  senderLabel: string | null;
  senderUnknown: boolean;
  sorterLabel: SorterLabel | null;
  sourceChannel: SourceChannel;
  at: Date;
}

export interface EmergencySettings {
  terms: readonly string[];
  termsText: string;
  phone: string;
  hours: string;
}

export interface SaveEmergencySettingsSpec {
  termsText: string;
  phone: string;
  hours: string;
  actorId: string;
  actorRole?: string | null;
}

/** Whole minutes. Amber is the first band; red is the later one. */
export interface ResponseGoal {
  amberMinutes: number;
  redMinutes: number;
}

export interface SaveResponseGoalSpec {
  amberMinutes: number;
  redMinutes: number;
  actorId: string;
  actorRole?: string | null;
}

/** Whole business days. Amber is the first band; red is the later one. */
export interface HandlingGoal {
  amberDays: number;
  redDays: number;
}

/** The two clocks, the dates the handling clock skips, and the office zone. */
export interface OfficeMeasure {
  goal: ResponseGoal;
  handling: HandlingGoal;
  nonWorkingDates: readonly string[];
  zone: string;
}

export interface SaveHandlingGoalSpec {
  amberDays: number;
  redDays: number;
  actorId: string;
  actorRole?: string | null;
}

export interface ChangeNonWorkingDateSpec {
  op: 'add' | 'remove';
  date: string;
  actorId: string;
  actorRole?: string | null;
}

export type ResponseBand = 'amber' | 'red';

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
export const ADDRESS_MAX = 320;
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
  call_number: number;
  source_channel: SourceChannel;
  state: CallState;
  description: string;
  sender_label: string | null;
  sender_unknown: boolean;
  opened_at: Date;
  opened_by: string | null;
  opener_label: string | null;
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
  emergency: boolean;
  was_emergency: boolean;
  emergency_by: string | null;
  emergency_actor: string | null;
  emergency_actor_label: string | null;
  to_review: boolean;
  sorter_label: string | null;
  sorter_summary: string | null;
  proposed_category_id: string | null;
  proposed_code: string | null;
  proposed_label_he: string | null;
  proposed_active: boolean | null;
  suggested_category_id: string | null;
  suggested_code: string | null;
  suggested_label_he: string | null;
  suggested_active: boolean | null;
  entry_permission: string | null;
  tenancy_id: string | null;
  report_unit_number: string | null;
  report_address_line: string | null;
  predecessor_id: string | null;
  predecessor_description: string | null;
  returned_at: Date | null;
  returner_label: string | null;
  sorter_model: string | null;
  sorter_prompt: string | null;
}

const CALL_SELECT = `SELECT sc.service_call_id, sc.call_number, sc.source_channel, sc.state, sc.description,
            sc.sender_label, sc.sender_unknown, sc.opened_at, sc.opened_by,
            COALESCE(NULLIF(btrim(opener.display_name), ''), opener.email) AS opener_label,
            sc.requester_party_id, requester.full_name AS requester_name,
            sc.category_id, category.code AS category_code,
            category.label_he AS category_label_he,
            category.is_active AS category_active,
            sc.exit_kind, sc.exit_note, sc.exit_department,
            sc.duplicate_of, other.description AS duplicate_description,
            sc.closed_at, sc.closed_by,
            COALESCE(NULLIF(btrim(closer.display_name), ''), closer.email) AS closer_label,
            sc.emergency, sc.emergency_by, sc.emergency_actor,
            COALESCE(
              NULLIF(btrim(flagger.display_name), ''),
              flagger.email
            ) AS emergency_actor_label,
            sc.to_review, sc.sorter_label, sc.sorter_summary,
            sc.proposed_category_id, proposed.code AS proposed_code,
            proposed.label_he AS proposed_label_he,
            proposed.is_active AS proposed_active,
            sc.suggested_category_id, suggested.code AS suggested_code,
            suggested.label_he AS suggested_label_he,
            suggested.is_active AS suggested_active,
            sc.entry_permission, sc.tenancy_id,
            report_unit.unit_number AS report_unit_number,
            report_building.address_line AS report_address_line,
            sc.predecessor_id, predecessor.description AS predecessor_description,
            sc.returned_at, sc.sorter_model, sc.sorter_prompt,
            COALESCE(
              NULLIF(btrim(returner.display_name), ''),
              returner.email
            ) AS returner_label,
            (sc.emergency OR EXISTS (
              SELECT 1
                FROM service_call_transition flagged
               WHERE flagged.service_call_id = sc.service_call_id
                 AND flagged.kind = 'FLAGGED'
            )) AS was_emergency
       FROM service_call sc
       LEFT JOIN staff_account opener ON opener.staff_account_id = sc.opened_by
       LEFT JOIN party requester ON requester.party_id = sc.requester_party_id
       LEFT JOIN call_category category ON category.category_id = sc.category_id
       LEFT JOIN call_category proposed ON proposed.category_id = sc.proposed_category_id
       LEFT JOIN call_category suggested ON suggested.category_id = sc.suggested_category_id
       LEFT JOIN tenancy report_tenancy ON report_tenancy.tenancy_id = sc.tenancy_id
       LEFT JOIN unit report_unit ON report_unit.unit_id = report_tenancy.unit_id
       LEFT JOIN space report_space ON report_space.space_id = report_unit.unit_id
       LEFT JOIN building report_building ON report_building.building_id = report_space.building_id
       LEFT JOIN service_call predecessor ON predecessor.service_call_id = sc.predecessor_id
       LEFT JOIN service_call other ON other.service_call_id = sc.duplicate_of
       LEFT JOIN staff_account closer ON closer.staff_account_id = sc.closed_by
       LEFT JOIN staff_account flagger ON flagger.staff_account_id = sc.emergency_actor
       LEFT JOIN staff_account returner ON returner.staff_account_id = sc.returned_by`;

function categoryOf(
  id: string | null,
  code: string | null,
  label: string | null,
  active: boolean | null,
): CallCategory | null {
  if (id === null || code === null || label === null || active === null) {
    return null;
  }
  return { id, code, labelHe: label, active };
}

function entryPermissionOf(value: string | null): EntryPermission | null {
  if (value === 'YES' || value === 'ARRANGE' || value === 'HOME') return value;
  return null;
}

function sorterLabelOf(value: string | null): SorterLabel | null {
  if (value === 'call' || value === 'unsure' || value === 'noise') return value;
  return null;
}

function toCall(row: CallRow): ServiceCall {
  return {
    id: row.service_call_id,
    callNumber: Number(row.call_number),
    sourceChannel: row.source_channel,
    state: row.state,
    description: row.description,
    sender: senderOf(row.sender_unknown, row.sender_label),
    openedAt: row.opened_at,
    requester:
      row.requester_party_id === null || row.requester_name === null
        ? null
        : { id: row.requester_party_id, name: row.requester_name },
    category: categoryOf(
      row.category_id,
      row.category_code,
      row.category_label_he,
      row.category_active,
    ),
    emergency: emergencyOf(row),
    wasEmergency: row.was_emergency,
    toReview: row.to_review,
    summary: row.sorter_summary,
    proposal: categoryOf(
      row.proposed_category_id,
      row.proposed_code,
      row.proposed_label_he,
      row.proposed_active,
    ),
    suggestion: categoryOf(
      row.suggested_category_id,
      row.suggested_code,
      row.suggested_label_he,
      row.suggested_active,
    ),
    entry: entryPermissionOf(row.entry_permission),
    tenancy:
      row.tenancy_id === null
        ? null
        : {
            id: row.tenancy_id,
            unitNumber: row.report_unit_number ?? '',
            addressLine: row.report_address_line ?? '',
          },
    sorterLabel: sorterLabelOf(row.sorter_label),
    sorterModel: row.sorter_model,
    sorterPrompt: row.sorter_prompt,
    returned: row.returned_at !== null,
    exit: exitOf(row),
  };
}

function emergencyOf(row: CallRow): EmergencyMark {
  if (!row.emergency || row.emergency_by === null) return { flagged: false };
  if (row.emergency_by === 'TERMS') return { flagged: true, by: 'terms' };
  if (
    row.emergency_by === 'STAFF' &&
    row.emergency_actor !== null &&
    row.emergency_actor_label !== null
  ) {
    return {
      flagged: true,
      by: 'staff',
      actorId: row.emergency_actor,
      actorLabel: row.emergency_actor_label,
    };
  }
  return { flagged: false };
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
  source_channel: SourceChannel;
  requester_party_id: string | null;
  category_id: string | null;
  emergency: boolean;
  returned_at: Date | null;
}

async function lockCall(db: Queryable, id: string): Promise<LockedCall> {
  const { rows } = await db.query<LockedCall>(
    `SELECT state, source_channel, requester_party_id, category_id, emergency,
            returned_at
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

  const flagged = await inTransaction(db, async (tx) => {
    const settings = await readEmergencySettings(tx);
    const byTerms = emergencyTermMatches(description, settings.terms);
    await tx.query(
      `INSERT INTO service_call
         (service_call_id, source_channel, state, description, sender_label,
          sender_unknown, opened_at, opened_by, emergency, emergency_by)
       VALUES ($1, $2, 'NEW', $3, $4, $5, $6, $7, $8, $9)`,
      [
        id,
        sourceChannel,
        description,
        senderLabel,
        senderUnknown,
        openedAt,
        openedBy,
        byTerms,
        byTerms ? 'TERMS' : null,
      ],
    );
    if (byTerms) {
      await tx.query(
        `INSERT INTO service_call_transition
           (transition_id, service_call_id, kind, actor_id, at, setter)
         VALUES ($1, $2, 'FLAGGED', NULL, $3, 'TERMS')`,
        [newId(clock), id, openedAt],
      );
    }
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
          emergency: byTerms ? 'terms' : null,
        },
      },
      { outcome: 'ok' },
    );
    return byTerms;
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
    emergency: flagged ? { flagged: true, by: 'terms' } : { flagged: false },
    wasEmergency: flagged,
    toReview: false,
    summary: null,
    proposal: null,
    suggestion: null,
    entry: null,
    tenancy: null,
    sorterLabel: null,
    sorterModel: null,
    sorterPrompt: null,
    returned: false,
    exit: null,
  };
}

function reportOf(spec: OpenIntakeCallSpec): {
  suggestedCategoryId: string;
  entryPermission: EntryPermission;
  tenancyId: string;
} | null {
  const suggested =
    spec.suggestedCategoryId == null
      ? null
      : validId(spec.suggestedCategoryId, 'category');
  const tenancy =
    spec.tenancyId == null ? null : validId(spec.tenancyId, 'tenancy');
  const entry = spec.entryPermission ?? null;
  if (
    entry !== null &&
    entry !== 'YES' &&
    entry !== 'ARRANGE' &&
    entry !== 'HOME'
  ) {
    throw new KernelError('invalid', 'entry is not a permission', {
      field: 'entry',
    });
  }
  const named = [suggested, entry, tenancy].filter((value) => value !== null);
  if (named.length === 0) return null;
  if (suggested === null || entry === null || tenancy === null) {
    throw new KernelError(
      'invalid',
      'a report names a category, an entry and a tenancy',
      { field: 'report' },
    );
  }
  return {
    suggestedCategoryId: suggested,
    entryPermission: entry,
    tenancyId: tenancy,
  };
}

function summaryOf(value: string | null): string | null {
  if (value === null) return null;
  const summary = value.trim();
  if (summary.length === 0 || summary.length > DESCRIPTION_MAX) {
    throw new KernelError('invalid', 'summary is not a short text', {
      field: 'summary',
    });
  }
  return summary;
}

function intakeChannel(value: string): IntakeChannel {
  for (const channel of INTAKE_CHANNELS) {
    if (value === channel) return channel;
  }
  throw new KernelError('invalid', 'channel is not an intake channel', {
    field: 'channel',
  });
}

/**
 * Opens a call from the intake door. The emergency flag is the door's
 * decision, already made, and this command only records it. A person rescuing
 * a filtered message passes their staff account; the door passes none.
 */
export async function openIntakeCall(
  db: Queryable,
  clock: Clock,
  spec: OpenIntakeCallSpec,
): Promise<ServiceCall> {
  const sourceChannel = intakeChannel(spec.sourceChannel);
  const description = requiredText(
    spec.description,
    'description',
    DESCRIPTION_MAX,
  );
  const senderLabel = requiredText(spec.senderAddress, 'sender', ADDRESS_MAX);
  const openedBy =
    spec.openedBy === null ? null : validId(spec.openedBy, 'openedBy');
  const predecessorId =
    spec.predecessorId === null
      ? null
      : validId(spec.predecessorId, 'predecessor');
  const proposedCategoryId =
    spec.proposedCategoryId === null
      ? null
      : validId(spec.proposedCategoryId, 'category');
  const summary = summaryOf(spec.summary);
  const report = reportOf(spec);
  const id = newId(clock);
  const openedAt = clock.now();

  await inTransaction(db, async (tx) => {
    if (predecessorId !== null) {
      const found = await tx.query<{ state: string }>(
        `SELECT state FROM service_call WHERE service_call_id = $1`,
        [predecessorId],
      );
      if (found.rows[0]?.state !== 'CLOSED') {
        throw new KernelError('invalid', 'predecessor is not a closed call', {
          field: 'predecessor',
        });
      }
    }
    if (proposedCategoryId !== null) {
      const found = await tx.query(
        `SELECT 1 FROM call_category WHERE category_id = $1`,
        [proposedCategoryId],
      );
      if (!found.rows[0]) {
        throw new KernelError('invalid', 'category not found', {
          field: 'category',
        });
      }
    }
    if (report !== null) {
      const category = await tx.query<{ is_active: boolean }>(
        `SELECT is_active FROM call_category WHERE category_id = $1`,
        [report.suggestedCategoryId],
      );
      if (category.rows[0]?.is_active !== true) {
        throw new KernelError('invalid', 'category is not active', {
          field: 'category',
        });
      }
      const tenancy = await tx.query(
        `SELECT 1 FROM tenancy WHERE tenancy_id = $1`,
        [report.tenancyId],
      );
      if (!tenancy.rows[0]) {
        throw new KernelError('invalid', 'tenancy not found', {
          field: 'tenancy',
        });
      }
    }
    await tx.query(
      `INSERT INTO service_call
         (service_call_id, source_channel, state, description, sender_label,
          sender_unknown, opened_at, opened_by, emergency, emergency_by,
          to_review, sorter_label, sorter_summary, proposed_category_id,
          predecessor_id, sorter_model, sorter_prompt,
          suggested_category_id, entry_permission, tenancy_id)
       VALUES ($1, $2, 'NEW', $3, $4, false, $5, $6, $7, $8, $9, $10, $11, $12,
               $13, $14, $15, $16, $17, $18)`,
      [
        id,
        sourceChannel,
        description,
        senderLabel,
        openedAt,
        openedBy,
        spec.emergency,
        spec.emergency ? 'TERMS' : null,
        spec.toReview,
        spec.sorterLabel,
        summary,
        proposedCategoryId,
        predecessorId,
        spec.sorterModel,
        spec.sorterPrompt,
        report?.suggestedCategoryId ?? null,
        report?.entryPermission ?? null,
        report?.tenancyId ?? null,
      ],
    );
    if (spec.emergency) {
      await tx.query(
        `INSERT INTO service_call_transition
           (transition_id, service_call_id, kind, actor_id, at, setter)
         VALUES ($1, $2, 'FLAGGED', NULL, $3, 'TERMS')`,
        [newId(clock), id, openedAt],
      );
    }
    await createAuditLog(tx, clock).write(
      {
        actorKind: openedBy === null ? 'system' : 'staff',
        actorId: openedBy ?? undefined,
        actorRole: spec.actorRole ?? undefined,
        action: openedBy === null ? 'calls.intake' : 'calls.rescue',
        subjectId: id,
        inputs: {
          sourceChannel,
          emergency: spec.emergency ? 'terms' : null,
          toReview: spec.toReview,
          sorterLabel: spec.sorterLabel,
        },
      },
      { outcome: 'ok' },
    );
  });

  const opened = await getCall(db, id);
  if (!opened) throw new KernelError('not_found', 'call not found');
  return opened;
}

/**
 * Whether a message on this thread can attach. The row is locked, so the
 * caller is already inside the transaction that will write the message.
 */
export async function callIsAttachable(
  db: Queryable,
  callId: string,
): Promise<boolean> {
  const id = validId(callId, 'call');
  const { rows } = await db.query<{
    state: string;
    returned_at: Date | null;
  }>(
    `SELECT state, returned_at
       FROM service_call
      WHERE service_call_id = $1
      FOR UPDATE`,
    [id],
  );
  const row = rows[0];
  if (!row || !isState(row.state)) return false;
  return row.state !== 'CLOSED' && row.returned_at === null;
}

/** Flags an open call from a later message. A flag already set is left as it is. */
export async function flagCallByTerms(
  db: Queryable,
  clock: Clock,
  callId: string,
): Promise<void> {
  const id = validId(callId, 'call');
  await inTransaction(db, async (tx) => {
    const current = await lockCall(tx, id);
    if (current.emergency) return;
    if (current.state === 'CLOSED' || current.returned_at !== null) return;
    const at = clock.now();
    await tx.query(
      `UPDATE service_call
          SET emergency = true, emergency_by = 'TERMS', emergency_actor = NULL
        WHERE service_call_id = $1`,
      [id],
    );
    await tx.query(
      `INSERT INTO service_call_transition
         (transition_id, service_call_id, kind, actor_id, at, setter)
       VALUES ($1, $2, 'FLAGGED', NULL, $3, 'TERMS')`,
      [newId(clock), id, at],
    );
    await createAuditLog(tx, clock).write(
      {
        actorKind: 'system',
        action: 'calls.emergency.flag',
        subjectId: id,
        inputs: { by: 'terms' },
      },
      { outcome: 'ok' },
    );
  });
}

/**
 * Not an Exit. The call leaves the open list and the rail, and it is not
 * closed, so it counts in no closed figure. The sorter's label stays.
 */
export async function returnToFiltered(
  db: Queryable,
  clock: Clock,
  spec: ReturnCallSpec,
): Promise<ServiceCallDetail> {
  const callId = idOf(spec.callId, 'call');
  const actorId = idOf(spec.actorId, 'actor');
  await inTransaction(db, async (tx) => {
    const current = await lockCall(tx, callId);
    if (current.state === 'CLOSED') {
      throw new KernelError('invalid', 'a closed call is not returned', {
        field: 'state',
        reason: 'closed',
      });
    }
    if (current.returned_at !== null) {
      throw new KernelError('invalid', 'call is already filtered', {
        field: 'call',
        reason: 'returned',
      });
    }
    if (current.source_channel === 'PORTAL') {
      throw new KernelError('invalid', 'a portal call is not returned', {
        field: 'call',
        reason: 'portal',
      });
    }
    await tx.query(
      `UPDATE service_call
          SET returned_at = $2, returned_by = $3, office_label = 'returned'
        WHERE service_call_id = $1`,
      [callId, clock.now(), actorId],
    );
    await createAuditLog(tx, clock).write(
      {
        actorKind: 'staff',
        actorId,
        actorRole: spec.actorRole ?? undefined,
        action: 'calls.return',
        subjectId: callId,
        inputs: {},
      },
      { outcome: 'ok' },
    );
  });
  return requireDetail(db, callId);
}

/** A returned call comes back onto the open list. The same call, not a second one. */
export async function restoreReturnedCall(
  db: Queryable,
  clock: Clock,
  spec: ReturnCallSpec,
): Promise<ServiceCallDetail> {
  const callId = idOf(spec.callId, 'call');
  const actorId = idOf(spec.actorId, 'actor');
  await inTransaction(db, async (tx) => {
    const current = await lockCall(tx, callId);
    if (current.returned_at === null) {
      throw new KernelError('invalid', 'call is not filtered', {
        field: 'call',
        reason: 'open',
      });
    }
    await tx.query(
      `UPDATE service_call
          SET returned_at = NULL, returned_by = NULL, office_label = NULL
        WHERE service_call_id = $1`,
      [callId],
    );
    await createAuditLog(tx, clock).write(
      {
        actorKind: 'staff',
        actorId,
        actorRole: spec.actorRole ?? undefined,
        action: 'calls.rescue',
        subjectId: callId,
        inputs: {},
      },
      { outcome: 'ok' },
    );
  });
  return requireDetail(db, callId);
}

export async function listReturnedCalls(
  db: Queryable,
): Promise<ReturnedCall[]> {
  const { rows } = await db.query<{
    service_call_id: string;
    description: string;
    sender_label: string | null;
    sender_unknown: boolean;
    sorter_label: string | null;
    source_channel: SourceChannel;
    returned_at: Date;
  }>(
    `SELECT service_call_id, description, sender_label, sender_unknown,
            sorter_label, source_channel, returned_at
       FROM service_call
      WHERE returned_at IS NOT NULL
      ORDER BY returned_at DESC, service_call_id DESC`,
  );
  return rows.map((row) => ({
    id: row.service_call_id,
    title: row.description,
    senderLabel: row.sender_label,
    senderUnknown: row.sender_unknown,
    sorterLabel: sorterLabelOf(row.sorter_label),
    sourceChannel: row.source_channel,
    at: row.returned_at,
  }));
}

export async function countOpenCalls(db: Queryable): Promise<number> {
  const { rows } = await db.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM service_call
      WHERE state <> 'CLOSED' AND returned_at IS NULL`,
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
  const emergency = filter.emergency ?? null;
  const toReview = filter.toReview ?? null;
  const { rows } = await db.query<CallRow>(
    `${CALL_SELECT}
      WHERE sc.state = COALESCE($1::text, sc.state)
        AND ($1::text IS NOT NULL OR sc.state <> 'CLOSED')
        AND sc.returned_at IS NULL
        AND ($2::uuid IS NULL OR sc.category_id = $2)
        AND ($3::boolean IS NULL OR sc.emergency = $3)
        AND ($4::boolean IS NULL OR sc.to_review = $4)
      ORDER BY sc.emergency DESC, sc.opened_at DESC, sc.service_call_id DESC`,
    [state, categoryId, emergency, toReview],
  );
  return rows.map(toCall);
}

export interface ClosedWindow {
  /** A close later than this. */
  after: Date;
  /** A close not later than this. */
  upTo: Date;
  categoryId?: string;
}

/** The calls closed inside one window, newest close first. A returned call is not closed. #224. */
export async function listClosedCalls(
  db: Queryable,
  window: ClosedWindow,
): Promise<ServiceCall[]> {
  const categoryId =
    window.categoryId === undefined
      ? null
      : validId(window.categoryId, 'category');
  const { rows } = await db.query<CallRow>(
    `${CALL_SELECT}
      WHERE sc.state = 'CLOSED'
        AND sc.returned_at IS NULL
        AND sc.closed_at > $1
        AND sc.closed_at <= $2
        AND ($3::uuid IS NULL OR sc.category_id = $3)
      ORDER BY sc.closed_at DESC, sc.service_call_id DESC`,
    [window.after, window.upTo, categoryId],
  );
  return rows.map(toCall);
}

/** The newest close at or before this moment of a call matching the category and the exit. */
export async function newestCloseAtOrBefore(
  db: Queryable,
  at: Date,
  filter: { categoryId: string | null; exit: ExitKind | null },
): Promise<Date | null> {
  const categoryId =
    filter.categoryId === null ? null : validId(filter.categoryId, 'category');
  const { rows } = await db.query<{ closed_at: Date }>(
    `SELECT closed_at FROM service_call
      WHERE state = 'CLOSED'
        AND returned_at IS NULL
        AND closed_at <= $1
        AND ($2::uuid IS NULL OR category_id = $2)
        AND ($3::text IS NULL OR exit_kind = $3)
      ORDER BY closed_at DESC
      LIMIT 1`,
    [at, categoryId, filter.exit],
  );
  return rows[0]?.closed_at ?? null;
}

/**
 * The calls that name this party as requester, newest first. A call that names
 * nobody, and a call that names someone else, are not in the list. #209.
 */
export async function listCallsByRequester(
  db: Queryable,
  partyId: string,
): Promise<RequesterCall[]> {
  const id = validId(partyId, 'party');
  const { rows } = await db.query<{
    service_call_id: string;
    opened_at: Date;
    state: string;
    emergency: boolean;
    description: string;
    category_label_he: string | null;
  }>(
    `SELECT sc.service_call_id, sc.opened_at, sc.state, sc.emergency, sc.description,
            category.label_he AS category_label_he
       FROM service_call sc
       LEFT JOIN call_category category ON category.category_id = sc.category_id
      WHERE sc.requester_party_id = $1
      ORDER BY sc.opened_at DESC, sc.service_call_id DESC`,
    [id],
  );
  return rows.map((row) => {
    if (!isState(row.state)) {
      throw new KernelError('invalid', 'call state is not a state', {
        field: 'state',
      });
    }
    return {
      id: row.service_call_id,
      openedAt: row.opened_at,
      state: row.state,
      description: row.description,
      categoryLabel: row.category_label_he,
      emergency: row.emergency,
    };
  });
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
    actor_id: string | null;
    actor_label: string | null;
    setter: string | null;
    party_name: string | null;
    category_label: string | null;
    note: string | null;
    department: string | null;
    duplicate_of: string | null;
    duplicate_description: string | null;
    reply_mark: string | null;
  }>(
    `SELECT t.kind, t.at, t.actor_id, t.setter,
            COALESCE(NULLIF(btrim(actor.display_name), ''), actor.email) AS actor_label,
            party.full_name AS party_name,
            category.label_he AS category_label,
            t.note, t.department, t.duplicate_of, t.reply_mark,
            dup.description AS duplicate_description
       FROM service_call_transition t
       LEFT JOIN staff_account actor ON actor.staff_account_id = t.actor_id
       LEFT JOIN party ON party.party_id = t.party_id
       LEFT JOIN call_category category ON category.category_id = t.category_id
       LEFT JOIN service_call dup ON dup.service_call_id = t.duplicate_of
      WHERE t.service_call_id = $1
      ORDER BY t.at,
               CASE t.kind
                 WHEN 'FLAGGED' THEN 1
                 WHEN 'IDENTIFIED' THEN 2
                 WHEN 'TRIAGED' THEN 3
                 ELSE 4
               END,
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
  const continued = await db.query<{
    service_call_id: string;
    description: string;
  }>(
    `SELECT service_call_id, description
       FROM service_call
      WHERE predecessor_id = $1
      ORDER BY opened_at DESC, service_call_id DESC`,
    [id],
  );
  const opened: CallTransition = {
    kind: 'OPENED',
    at: row.opened_at,
    actorId: row.opened_by,
    actorLabel: row.opener_label ?? 'קליטה',
    partyName: null,
    categoryLabel: null,
    flagBy: null,
  };
  const timeline: CallTransition[] = [opened];
  for (const event of events.rows) {
    const flagged =
      event.kind === 'FLAGGED' &&
      (event.setter === 'TERMS' || event.setter === 'STAFF');
    const cleared = event.kind === 'CLEARED' && event.actor_id !== null;
    const replied =
      event.kind === 'REPLIED' &&
      (event.reply_mark === 'edited' || event.reply_mark === 'as_written');
    const kind = flagged
      ? 'FLAGGED'
      : cleared
        ? 'CLEARED'
        : replied
          ? 'REPLIED'
          : event.kind === 'IDENTIFIED' || event.kind === 'TRIAGED'
            ? event.kind
            : isExitKind(event.kind)
              ? event.kind
              : null;
    if (kind === null) continue;
    timeline.push({
      kind,
      at: event.at,
      actorId: event.actor_id,
      actorLabel:
        event.kind === 'IDENTIFIED' && event.setter === 'ADDRESS'
          ? 'הכתובת'
          : (event.actor_label ?? ''),
      partyName: event.party_name,
      categoryLabel: event.category_label,
      flagBy:
        kind === 'FLAGGED'
          ? event.setter === 'TERMS'
            ? 'terms'
            : 'staff'
          : null,
      note: event.note,
      replyMark:
        kind === 'REPLIED'
          ? event.reply_mark === 'as_written'
            ? 'as_written'
            : 'edited'
          : null,
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
    repeatedBy: links.rows.map((link) => ({
      id: link.service_call_id,
      description: link.description,
    })),
    continuedBy: continued.rows.map((link) => ({
      id: link.service_call_id,
      description: link.description,
    })),
    predecessor:
      row.predecessor_id === null || row.predecessor_description === null
        ? null
        : {
            id: row.predecessor_id,
            description: row.predecessor_description,
          },
    returnedBy: row.returner_label,
  };
}

/** Sets the requester on a new call. The caller writes the transition and the audit. */
async function linkRequester(
  db: Queryable,
  callId: string,
  partyId: string,
): Promise<void> {
  const current = await lockCall(db, callId);
  if (current.state !== 'NEW') {
    throw new KernelError('invalid', 'only a new call can be identified', {
      field: 'state',
      reason: 'identify',
    });
  }
  await db.query('SAVEPOINT link_requester');
  try {
    await db.query(
      `UPDATE service_call
          SET state = 'IDENTIFIED', requester_party_id = $2
        WHERE service_call_id = $1`,
      [callId, partyId],
    );
    await db.query('RELEASE SAVEPOINT link_requester');
  } catch (error) {
    await db.query('ROLLBACK TO SAVEPOINT link_requester');
    const pg = pgError(error);
    if (pg.code === '23514' && pg.message?.includes('guarantor') === true) {
      throw new KernelError('invalid', 'a guarantor cannot be the requester', {
        field: 'party',
        reason: 'guarantor',
      });
    }
    if (pg.code === '23503') {
      throw new KernelError('not_found', 'party not found', {
        field: 'party',
      });
    }
    throw error;
  }
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
    await linkRequester(tx, callId, partyId);
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

/**
 * The door's identify step. No staff account: the timeline names the address
 * match. One party, already resolved by the isolation join.
 */
export async function identifyByAddress(
  db: Queryable,
  clock: Clock,
  spec: IdentifyByAddressSpec,
): Promise<ServiceCallDetail> {
  const callId = idOf(spec.callId, 'call');
  const partyId = idOf(spec.partyId, 'party');
  await inTransaction(db, async (tx) => {
    await linkRequester(tx, callId, partyId);
    await tx.query(
      `INSERT INTO service_call_transition
         (transition_id, service_call_id, kind, actor_id, at, party_id, setter)
       VALUES ($1, $2, 'IDENTIFIED', NULL, $3, $4, 'ADDRESS')`,
      [newId(clock), callId, clock.now(), partyId],
    );
    await createAuditLog(tx, clock).write(
      {
        actorKind: 'system',
        action: 'calls.identify',
        subjectId: callId,
        inputs: { partyId, by: 'address' },
      },
      { outcome: 'ok' },
    );
  });
  return requireDetail(db, callId);
}

/**
 * Adds the call's sender address to the requester. A person identified the
 * call first; this command is the separate act that writes the contact.
 */
export async function saveSenderContact(
  db: Queryable,
  clock: Clock,
  spec: SaveSenderContactSpec,
): Promise<ServiceCallDetail> {
  const callId = idOf(spec.callId, 'call');
  const actorId = idOf(spec.actorId, 'actor');
  await inTransaction(db, async (tx) => {
    const current = await lockCall(tx, callId);
    if (current.requester_party_id === null) {
      throw new KernelError('invalid', 'the requester is not identified', {
        field: 'state',
        reason: 'contact',
      });
    }
    const identifiedByPerson = await tx.query(
      `SELECT 1 FROM service_call_transition
        WHERE service_call_id = $1
          AND kind = 'IDENTIFIED'
          AND actor_id IS NOT NULL`,
      [callId],
    );
    if (!identifiedByPerson.rows[0]) {
      throw new KernelError('invalid', 'only a person saves a contact', {
        field: 'state',
        reason: 'contact',
      });
    }
    const sender = await tx.query<{
      source_channel: string;
      sender_label: string | null;
      sender_unknown: boolean;
    }>(
      `SELECT source_channel, sender_label, sender_unknown
         FROM service_call
        WHERE service_call_id = $1`,
      [callId],
    );
    const row = sender.rows[0];
    if (!row || row.sender_unknown || row.sender_label === null) {
      throw new KernelError('invalid', 'this call has no address to save', {
        field: 'sender',
        reason: 'contact',
      });
    }
    const contact = contactOf(row.source_channel, row.sender_label);
    try {
      await tx.query('SAVEPOINT save_sender_contact');
      await upsertPartyContact(tx, {
        partyId: current.requester_party_id,
        channel: contact.channel,
        value: contact.value,
        isPrimary: false,
        validFrom: today(clock),
        validTo: null,
        verifiedAt: null,
      });
      await tx.query('RELEASE SAVEPOINT save_sender_contact');
    } catch (error) {
      await tx.query('ROLLBACK TO SAVEPOINT save_sender_contact');
      const pg = pgError(error);
      if (pg.code === '23P01') {
        const holders = await tx.query<{ party_id: string }>(
          `SELECT DISTINCT party_id
             FROM party_contact
            WHERE channel = $1 AND value = $2`,
          [contact.channel, contact.value],
        );
        const someoneElse = holders.rows.some(
          (holder) => holder.party_id !== current.requester_party_id,
        );
        if (someoneElse || holders.rows.length === 0) {
          throw new KernelError(
            'invalid',
            'that address already belongs to someone',
            { field: 'sender', reason: 'taken' },
          );
        }
      } else {
        throw error;
      }
    }
    await createAuditLog(tx, clock).write(
      {
        actorKind: 'staff',
        actorId,
        actorRole: spec.actorRole ?? undefined,
        action: 'calls.save_contact',
        subjectId: callId,
        inputs: {
          partyId: current.requester_party_id,
          channel: contact.channel,
        },
      },
      { outcome: 'ok' },
    );
  });
  return requireDetail(db, callId);
}

function contactOf(
  sourceChannel: string,
  sender: string,
): { channel: 'EMAIL' | 'PHONE'; value: string } {
  if (sourceChannel === 'EMAIL') {
    return { channel: 'EMAIL', value: normaliseEmail(sender) };
  }
  if (sourceChannel === 'WHATSAPP') {
    return { channel: 'PHONE', value: normalisePhone(sender) };
  }
  throw new KernelError('invalid', 'this call has no address to save', {
    field: 'sender',
    reason: 'contact',
  });
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

async function recordEmergency(
  db: Queryable,
  clock: Clock,
  spec: EmergencyActorSpec,
  action: 'flag' | 'clear',
): Promise<ServiceCallDetail> {
  const callId = idOf(spec.callId, 'call');
  const actorId = idOf(spec.actorId, 'actor');
  await inTransaction(db, async (tx) => {
    const current = await lockCall(tx, callId);
    if (current.state === 'CLOSED') {
      throw new KernelError('invalid', 'a closed call cannot change', {
        field: 'state',
        reason: 'closed',
      });
    }
    const flagging = action === 'flag';
    if (current.emergency === flagging) return;
    const at = clock.now();
    if (flagging) {
      await tx.query(
        `UPDATE service_call
            SET emergency = true, emergency_by = 'STAFF', emergency_actor = $2
          WHERE service_call_id = $1`,
        [callId, actorId],
      );
      await tx.query(
        `INSERT INTO service_call_transition
           (transition_id, service_call_id, kind, actor_id, at, setter)
         VALUES ($1, $2, 'FLAGGED', $3, $4, 'STAFF')`,
        [newId(clock), callId, actorId, at],
      );
    } else {
      await tx.query(
        `UPDATE service_call
            SET emergency = false, emergency_by = NULL, emergency_actor = NULL
          WHERE service_call_id = $1`,
        [callId],
      );
      await tx.query(
        `INSERT INTO service_call_transition
           (transition_id, service_call_id, kind, actor_id, at)
         VALUES ($1, $2, 'CLEARED', $3, $4)`,
        [newId(clock), callId, actorId, at],
      );
    }
    await createAuditLog(tx, clock).write(
      {
        actorKind: 'staff',
        actorId,
        actorRole: spec.actorRole ?? undefined,
        action: flagging ? 'calls.emergency.flag' : 'calls.emergency.clear',
        subjectId: callId,
        inputs: {},
      },
      { outcome: 'ok' },
    );
  });
  return requireDetail(db, callId);
}

export function flagEmergency(
  db: Queryable,
  clock: Clock,
  spec: EmergencyActorSpec,
): Promise<ServiceCallDetail> {
  return recordEmergency(db, clock, spec, 'flag');
}

export function clearEmergency(
  db: Queryable,
  clock: Clock,
  spec: EmergencyActorSpec,
): Promise<ServiceCallDetail> {
  return recordEmergency(db, clock, spec, 'clear');
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

const EMERGENCY_TERMS_KEY = 'calls.emergency_terms';
const DUTY_PHONE_KEY = 'calls.duty_phone';
const DUTY_HOURS_KEY = 'calls.duty_hours';

// Placeholders, the same sentences the migration seeds. A missing row — a
// database mid-migration — must not take opening a call down.
const TERMS_FALLBACK = 'הצפה\nשריפה\nדליפת גז\nתקוע במעלית\nקצר חשמלי';
const PHONE_FALLBACK = '000-000-0000';
const HOURS_FALLBACK = 'טרם נקבעו';
const TERMS_MAX = 4000;
const PHONE_MAX = 40;
const HOURS_MAX = 200;

function splitTerms(text: string): string[] {
  return text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function storedText(
  value: unknown,
  key: string,
  fallback: string,
  allowEmpty: boolean,
): string {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'string') {
    throw new KernelError('invalid', `setting ${key} is not text`, { key });
  }
  if (value.length === 0) return allowEmpty ? '' : fallback;
  return value;
}

export async function readEmergencySettings(
  db: Queryable,
): Promise<EmergencySettings> {
  const { rows } = await db.query<{ key: string; value: unknown }>(
    `SELECT key, value FROM config_settings WHERE key = ANY($1::text[])`,
    [[EMERGENCY_TERMS_KEY, DUTY_PHONE_KEY, DUTY_HOURS_KEY]],
  );
  const byKey = new Map(rows.map((row) => [row.key, row.value]));
  const termsText = storedText(
    byKey.get(EMERGENCY_TERMS_KEY),
    EMERGENCY_TERMS_KEY,
    TERMS_FALLBACK,
    true,
  );
  return {
    terms: splitTerms(termsText),
    termsText,
    phone: storedText(
      byKey.get(DUTY_PHONE_KEY),
      DUTY_PHONE_KEY,
      PHONE_FALLBACK,
      false,
    ),
    hours: storedText(
      byKey.get(DUTY_HOURS_KEY),
      DUTY_HOURS_KEY,
      HOURS_FALLBACK,
      false,
    ),
  };
}

async function writeSetting(
  db: Queryable,
  clock: Clock,
  key: string,
  value: string | number | readonly string[],
): Promise<void> {
  await db.query(
    `INSERT INTO config_settings (key, value, updated_at)
     VALUES ($1, $2::jsonb, $3)
     ON CONFLICT (key) DO UPDATE
       SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at`,
    [key, JSON.stringify(value), clock.now()],
  );
}

export async function saveEmergencySettings(
  db: Queryable,
  clock: Clock,
  spec: SaveEmergencySettingsSpec,
): Promise<EmergencySettings> {
  const actorId = validId(spec.actorId, 'actor');
  const phone = requireText(spec.phone, 'phone', PHONE_MAX);
  const hours = requireText(spec.hours, 'hours', HOURS_MAX);
  const raw = spec.termsText.trim();
  if (raw.length > TERMS_MAX) {
    throw new KernelError('invalid', 'terms are too long', { field: 'terms' });
  }
  const terms = splitTerms(raw);
  const termsText = terms.join('\n');
  await inTransaction(db, async (tx) => {
    await writeSetting(tx, clock, EMERGENCY_TERMS_KEY, termsText);
    await writeSetting(tx, clock, DUTY_PHONE_KEY, phone);
    await writeSetting(tx, clock, DUTY_HOURS_KEY, hours);
    await createAuditLog(tx, clock).write(
      {
        actorKind: 'staff',
        actorId,
        actorRole: spec.actorRole ?? undefined,
        action: 'calls.emergency.settings',
        inputs: { terms: terms.length },
      },
      { outcome: 'ok' },
    );
  });
  return { terms, termsText, phone, hours };
}

const AMBER_KEY = 'calls.response_amber_minutes';
const RED_KEY = 'calls.response_red_minutes';
const AMBER_FALLBACK = 240;
const RED_FALLBACK = 1440;
const GOAL_MINUTES_MAX = 60 * 24 * 365;

/** Whole minutes since the call opened. The same count the list's age uses. */
export function ageMinutes(openedAt: Date, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - openedAt.getTime()) / 60_000));
}

/**
 * Amber, then red. Exactly on a threshold has not passed it. A closed call
 * is neither, whatever its age.
 */
function bandPast(
  age: number,
  amber: number,
  red: number,
): ResponseBand | null {
  if (age > red) return 'red';
  if (age > amber) return 'amber';
  return null;
}

export function responseGoalBand(
  state: CallState,
  openedAt: Date,
  now: Date,
  goal: ResponseGoal,
): ResponseBand | null {
  if (state === 'CLOSED') return null;
  return bandPast(
    ageMinutes(openedAt, now),
    goal.amberMinutes,
    goal.redMinutes,
  );
}

/**
 * The clock that applies to this call. An open emergency uses the minute goal.
 * Every other open call uses the handling age in business days. A closed call
 * is neither.
 */
export function officeBand(
  call: {
    state: CallState;
    openedAt: Date;
    emergency: { flagged: boolean };
  },
  now: Date,
  measure: OfficeMeasure,
): ResponseBand | null {
  if (call.emergency.flagged) {
    return responseGoalBand(call.state, call.openedAt, now, measure.goal);
  }
  if (call.state === 'CLOSED') return null;
  const age = businessDaysElapsed(
    call.openedAt,
    now,
    measure.zone,
    measure.nonWorkingDates,
  );
  return bandPast(age, measure.handling.amberDays, measure.handling.redDays);
}

function wholeMinutes(value: number, field: string): number {
  if (!Number.isInteger(value) || value < 0 || value > GOAL_MINUTES_MAX) {
    throw new KernelError('invalid', `${field} must be whole minutes`, {
      field,
    });
  }
  return value;
}

function storedMinutes(value: unknown, fallback: number): number {
  if (value === undefined || value === null) return fallback;
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) {
    return value;
  }
  throw new KernelError('invalid', 'response goal is not whole minutes');
}

export async function readResponseGoal(db: Queryable): Promise<ResponseGoal> {
  const { rows } = await db.query<{ key: string; value: unknown }>(
    `SELECT key, value FROM config_settings WHERE key = ANY($1::text[])`,
    [[AMBER_KEY, RED_KEY]],
  );
  const byKey = new Map(rows.map((row) => [row.key, row.value]));
  return {
    amberMinutes: storedMinutes(byKey.get(AMBER_KEY), AMBER_FALLBACK),
    redMinutes: storedMinutes(byKey.get(RED_KEY), RED_FALLBACK),
  };
}

export async function saveResponseGoal(
  db: Queryable,
  clock: Clock,
  spec: SaveResponseGoalSpec,
): Promise<ResponseGoal> {
  const actorId = validId(spec.actorId, 'actor');
  const amberMinutes = wholeMinutes(spec.amberMinutes, 'amber');
  const redMinutes = wholeMinutes(spec.redMinutes, 'red');
  if (redMinutes <= amberMinutes) {
    throw new KernelError('invalid', 'red must be older than amber', {
      field: 'red',
    });
  }
  await inTransaction(db, async (tx) => {
    await writeSetting(tx, clock, AMBER_KEY, amberMinutes);
    await writeSetting(tx, clock, RED_KEY, redMinutes);
    await createAuditLog(tx, clock).write(
      {
        actorKind: 'staff',
        actorId,
        actorRole: spec.actorRole ?? undefined,
        action: 'calls.response_goal',
        inputs: { amberMinutes, redMinutes },
      },
      { outcome: 'ok' },
    );
  });
  return { amberMinutes, redMinutes };
}

const HANDLING_AMBER_KEY = 'calls.handling_amber_days';
const HANDLING_RED_KEY = 'calls.handling_red_days';
const NON_WORKING_KEY = 'calls.non_working_dates';
const HANDLING_AMBER_FALLBACK = 2;
const HANDLING_RED_FALLBACK = 5;
const HANDLING_DAYS_MAX = 366;

function wholeDays(value: number, field: string): number {
  if (!Number.isInteger(value) || value < 0 || value > HANDLING_DAYS_MAX) {
    throw new KernelError('invalid', `${field} must be whole business days`, {
      field,
    });
  }
  return value;
}

function storedDays(value: unknown, fallback: number): number {
  if (value === undefined || value === null) return fallback;
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) {
    return value;
  }
  throw new KernelError('invalid', 'handling clock is not whole days');
}

function storedDates(value: unknown): readonly string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new KernelError('invalid', 'non-working dates are not a date list');
  }
  return [...new Set(value.map((item) => calendarDate(String(item))))].sort();
}

export async function readHandlingGoal(db: Queryable): Promise<HandlingGoal> {
  const { rows } = await db.query<{ key: string; value: unknown }>(
    `SELECT key, value FROM config_settings WHERE key = ANY($1::text[])`,
    [[HANDLING_AMBER_KEY, HANDLING_RED_KEY]],
  );
  const byKey = new Map(rows.map((row) => [row.key, row.value]));
  return {
    amberDays: storedDays(
      byKey.get(HANDLING_AMBER_KEY),
      HANDLING_AMBER_FALLBACK,
    ),
    redDays: storedDays(byKey.get(HANDLING_RED_KEY), HANDLING_RED_FALLBACK),
  };
}

export async function saveHandlingGoal(
  db: Queryable,
  clock: Clock,
  spec: SaveHandlingGoalSpec,
): Promise<HandlingGoal> {
  const actorId = validId(spec.actorId, 'actor');
  const amberDays = wholeDays(spec.amberDays, 'amber');
  const redDays = wholeDays(spec.redDays, 'red');
  if (redDays <= amberDays) {
    throw new KernelError('invalid', 'red must be older than amber', {
      field: 'red',
    });
  }
  await inTransaction(db, async (tx) => {
    await writeSetting(tx, clock, HANDLING_AMBER_KEY, amberDays);
    await writeSetting(tx, clock, HANDLING_RED_KEY, redDays);
    await createAuditLog(tx, clock).write(
      {
        actorKind: 'staff',
        actorId,
        actorRole: spec.actorRole ?? undefined,
        action: 'calls.handling_clock',
        inputs: { amberDays, redDays },
      },
      { outcome: 'ok' },
    );
  });
  return { amberDays, redDays };
}

export async function readNonWorkingDates(
  db: Queryable,
): Promise<readonly string[]> {
  const { rows } = await db.query<{ value: unknown }>(
    `SELECT value FROM config_settings WHERE key = $1`,
    [NON_WORKING_KEY],
  );
  return storedDates(rows[0]?.value);
}

/**
 * Adds or removes one non-working date. A date already kept, or a removal of
 * one that is not, changes nothing and writes no audit row.
 */
export async function changeNonWorkingDate(
  db: Queryable,
  clock: Clock,
  spec: ChangeNonWorkingDateSpec,
): Promise<readonly string[]> {
  const actorId = validId(spec.actorId, 'actor');
  const date = calendarDate(spec.date);
  if (spec.op !== 'add' && spec.op !== 'remove') {
    throw new KernelError('invalid', 'op is not add or remove', {
      field: 'op',
    });
  }
  return inTransaction(db, async (tx) => {
    const current = await readNonWorkingDates(tx);
    const has = current.includes(date);
    if (spec.op === 'add' && has) return current;
    if (spec.op === 'remove' && !has) return current;
    const next =
      spec.op === 'add'
        ? [...current, date].sort()
        : current.filter((kept) => kept !== date);
    await writeSetting(tx, clock, NON_WORKING_KEY, next);
    await createAuditLog(tx, clock).write(
      {
        actorKind: 'staff',
        actorId,
        actorRole: spec.actorRole ?? undefined,
        action: 'calls.non_working_date',
        inputs: { change: spec.op, date },
      },
      { outcome: 'ok' },
    );
    return next;
  });
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
