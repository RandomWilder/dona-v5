// One register line, validated before any SQL touches it. Slice 2.4.
//
// Validation at the edge (AGENTS.md), and here the edge is a line of a file somebody exported from a
// spreadsheet. Every check below is one that would otherwise fail deep inside a constraint with a
// message about a uuid or a regular expression, which says nothing about the line that is wrong.
//
// **A reason never echoes a person.** SPEC.md's "PII never in logs" applies to an error message the
// moment anything catches one, so `full_name`, `national_id` and `phone` are named as columns and
// never quoted back. Every other column may echo its value, because a rejection reading
// "tenancy_status 'LIVE' is not one of ..." is worth an order of magnitude more than one reading
// "tenancy_status is invalid" and costs nothing — the value is a vocabulary word, a date or a
// number. The set is explicit rather than inverted: a column added to this file is one somebody has
// to decide about.
import { normalisePhone } from '../../scope/contract.ts';

export const REGISTER_COLUMNS = [
  'project_code',
  'project_name',
  'building_name',
  'address_line',
  'city',
  'unit_number',
  'rooms',
  'area_sqm',
  'has_mamad',
  'tenancy_start',
  'tenancy_end',
  'tenancy_status',
  'terms_profile',
  'party_kind',
  'national_id',
  'full_name',
  'preferred_language',
  'role',
  'is_service_contact',
  'phone',
  'contact_from',
  'contact_to',
] as const;

export type RegisterColumn = (typeof REGISTER_COLUMNS)[number];

/** The three columns whose value never reaches a message. Everything else may be quoted back. */
const NEVER_ECHOED: ReadonlySet<RegisterColumn> = new Set([
  'national_id',
  'full_name',
  'phone',
]);

const TENANCY_STATUS = [
  'DRAFT',
  'ACTIVE',
  'ENDED',
  'TERMINATED_EARLY',
] as const;
const ROLES = ['PRIMARY_TENANT', 'CO_TENANT', 'GUARANTOR', 'OCCUPANT'] as const;
const PARTY_KINDS = ['PERSON', 'COMPANY'] as const;
const LANGUAGES = ['he', 'ar', 'ru', 'fr', 'en'] as const;
const CONDITION = ['READY', 'RENOVATION', 'WITHHELD'] as const;

// A calendar date and nothing looser. `new Date('2026-13-01')` is a silent Invalid Date and
// `new Date('2026-2-3')` is a date with a shape no export produces, so the shape is checked first
// and the calendar second — 31 September has the right shape and is not a day.
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export interface RowError {
  column: RegisterColumn | null;
  reason: string;
}

export interface RegisterRow {
  projectCode: string | null;
  projectName: string | null;
  buildingName: string;
  addressLine: string;
  city: string;
  unitNumber: string;
  rooms: number;
  areaSqm: number | null;
  hasMamad: boolean;
  tenancyStart: string;
  tenancyEnd: string;
  tenancyStatus: (typeof TENANCY_STATUS)[number];
  termsProfile: string;
  partyKind: (typeof PARTY_KINDS)[number];
  nationalId: string;
  fullName: string;
  preferredLanguage: (typeof LANGUAGES)[number];
  role: (typeof ROLES)[number];
  isServiceContact: boolean;
  /** Already E.164. `normalisePhone` ran here so the database never sees a register's spelling. */
  phone: string;
  contactFrom: string;
  contactTo: string | null;
}

class Reader {
  readonly errors: RowError[] = [];
  private readonly values: Map<RegisterColumn, string>;

  constructor(fields: string[]) {
    this.values = new Map(
      REGISTER_COLUMNS.map((column, at) => [column, (fields[at] ?? '').trim()]),
    );
  }

  private fail(column: RegisterColumn, reason: string): void {
    this.errors.push({ column, reason });
  }

  /** What a message may say about a column. */
  private shown(column: RegisterColumn, value: string): string {
    return NEVER_ECHOED.has(column) ? '' : ` (\`${value}\`)`;
  }

  optional(column: RegisterColumn): string | null {
    const value = this.values.get(column) ?? '';
    return value === '' ? null : value;
  }

  required(column: RegisterColumn): string {
    const value = this.optional(column);
    if (value === null) this.fail(column, `${column} is required and is blank`);
    return value ?? '';
  }

  oneOf<T extends string>(
    column: RegisterColumn,
    allowed: readonly T[],
    fallback: T,
  ): T {
    const value = this.required(column);
    if (value === '') return fallback;
    if (!(allowed as readonly string[]).includes(value)) {
      this.fail(
        column,
        `${column}${this.shown(column, value)} is not one of ${allowed.join(' · ')}`,
      );
      return fallback;
    }
    return value as T;
  }

  date(column: RegisterColumn, required: boolean): string | null {
    const value = required ? this.required(column) : this.optional(column);
    if (value === null || value === '') return null;
    if (!ISO_DATE.test(value)) {
      this.fail(
        column,
        `${column}${this.shown(column, value)} is not a YYYY-MM-DD date`,
      );
      return null;
    }
    // The shape is right, so ask the calendar: 2026-02-31 parses and is not a day.
    const parsed = new Date(`${value}T00:00:00Z`);
    if (
      Number.isNaN(parsed.getTime()) ||
      !parsed.toISOString().startsWith(value)
    ) {
      this.fail(column, `${column} (\`${value}\`) is not a real date`);
      return null;
    }
    return value;
  }

  number(column: RegisterColumn, required: boolean): number | null {
    const value = required ? this.required(column) : this.optional(column);
    if (value === null || value === '') return null;
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) {
      this.fail(
        column,
        `${column}${this.shown(column, value)} is not a non-negative number`,
      );
      return null;
    }
    return parsed;
  }

  boolean(column: RegisterColumn): boolean {
    const value = this.required(column).toLowerCase();
    if (value === '') return false;
    if (['true', 'yes', 'y', '1', 'כן'].includes(value)) return true;
    if (['false', 'no', 'n', '0', 'לא'].includes(value)) return false;
    this.fail(
      column,
      `${column}${this.shown(column, value)} is not a yes/no value`,
    );
    return false;
  }

  phone(): string {
    const value = this.required('phone');
    if (value === '') return '';
    try {
      // src/scope/'s normaliser and not a second one. The number stored and the number the inbound
      // lookup asks with have to come out of the same function, or a register formatted for a
      // spreadsheet resolves to nobody — which is indistinguishable from correct isolation
      // (SPEC-scope.md, slice 2.3). A bare nine-digit number is refused rather than assumed
      // Israeli: it would pass E.164's shape as another country's subscriber.
      return normalisePhone(value);
    } catch {
      // The caught error already names the shape and never the value; the column is named here for
      // the same reason, and `phone` is on NEVER_ECHOED.
      this.fail('phone', 'phone is not a number this register can normalise');
      return '';
    }
  }
}

/**
 * Reads one record into a row, or into the reasons it is not one.
 *
 * **Every check runs.** A row with three defects is reported with three reasons rather than with the
 * first, because an administrator fixing a register one round-trip per defect is the failure mode a
 * line number was supposed to remove.
 */
export function readRow(
  fields: string[],
): { row: RegisterRow } | { errors: RowError[] } {
  if (fields.length !== REGISTER_COLUMNS.length) {
    return {
      errors: [
        {
          column: null,
          reason: `expected ${REGISTER_COLUMNS.length} columns, found ${fields.length}`,
        },
      ],
    };
  }
  const read = new Reader(fields);
  const row: RegisterRow = {
    projectCode: read.optional('project_code'),
    projectName: read.optional('project_name'),
    buildingName: read.required('building_name'),
    addressLine: read.required('address_line'),
    city: read.required('city'),
    unitNumber: read.required('unit_number'),
    rooms: read.number('rooms', true) ?? 0,
    areaSqm: read.number('area_sqm', false),
    hasMamad: read.boolean('has_mamad'),
    tenancyStart: read.date('tenancy_start', true) ?? '',
    tenancyEnd: read.date('tenancy_end', true) ?? '',
    tenancyStatus: read.oneOf('tenancy_status', TENANCY_STATUS, 'DRAFT'),
    // NOT NULL on tenancy, and never defaulted to `standard` here: which annex governs a lease is
    // what the responsibility decision keys on, so a blank is a question for the client and not a
    // value this importer may invent (SPEC-tenancy.md, SPEC-register.md).
    termsProfile: read.required('terms_profile'),
    partyKind: read.oneOf('party_kind', PARTY_KINDS, 'PERSON'),
    // Required by the file format where the column is nullable: `national_id_key` is party's
    // natural key, and a null identifier produces a null key, which a UNIQUE index ignores. No
    // identifier, no idempotence — so the row is refused rather than imported twice.
    nationalId: read.required('national_id'),
    fullName: read.required('full_name'),
    preferredLanguage: read.oneOf('preferred_language', LANGUAGES, 'he'),
    role: read.oneOf('role', ROLES, 'PRIMARY_TENANT'),
    isServiceContact: read.boolean('is_service_contact'),
    phone: read.phone(),
    contactFrom: read.date('contact_from', true) ?? '',
    contactTo: read.date('contact_to', false),
  };
  // A period the database would reject inside a daterange constructor, caught here so the reason
  // names the column rather than the constraint. The schema still holds both — this is the message,
  // not the rule.
  if (
    row.tenancyStart !== '' &&
    row.tenancyEnd !== '' &&
    row.tenancyEnd < row.tenancyStart
  ) {
    read.errors.push({
      column: 'tenancy_end',
      reason: `tenancy_end (\`${row.tenancyEnd}\`) is before tenancy_start (\`${row.tenancyStart}\`)`,
    });
  }
  if (row.contactTo !== null && row.contactTo < row.contactFrom) {
    read.errors.push({
      column: 'contact_to',
      reason: `contact_to (\`${row.contactTo}\`) is before contact_from (\`${row.contactFrom}\`)`,
    });
  }
  return read.errors.length > 0 ? { errors: read.errors } : { row };
}

/** The condition every register row implies. A register says nothing about renovation. */
export const REGISTER_CONDITION: (typeof CONDITION)[number] = 'READY';
