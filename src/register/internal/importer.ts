// The register importer. Slice 2.4.
//
// Two properties, and everything here serves them:
//
//   1. **Running the same file twice leaves the same rows, with the same ids.** Not "does not
//      crash" — the same primary keys, so anything that later points at a unit still points at it.
//      The natural keys do all of it: `address_key` (1.11), `(unit_id, start_date)` (2.2), and
//      `national_id_key`, `(party_id, channel, value, valid_from)` and `terms_profile.name` (2.4).
//      There is no caller-supplied intent key anywhere — an idempotency key would make the *call*
//      repeatable, where what a re-run needs is for the *data* to converge.
//   2. **A malformed row is reported with its line number. The file continues.**
//
// The second is the one with a mechanism behind it. A row rejected by the database aborts the
// enclosing transaction, and every statement after it fails with 25P02 — so a report written without
// savepoints is "failing whole" wearing a report, and the first sloppy end date in a 1,500-unit
// register would cost the other 1,499. **Each row is wrapped in a SAVEPOINT**, released when it
// lands and rolled back to when it does not.
//
// This module writes no SQL against a table it does not own. Estate upserts buildings, spaces and
// units; parties upserts parties and contacts; tenancy upserts profiles, tenancies and tenancy
// parties. What lives here is the order, the transaction and the decision about what a bad row does.
import type { PoolClient } from 'pg';
import { upsertUnitRow } from '../../estate/contract.ts';
import { KernelError } from '../../kernel/errors.ts';
import { upsertParty, upsertPartyContact } from '../../parties/contract.ts';
import {
  upsertTenancy,
  upsertTenancyParty,
  upsertTermsProfile,
} from '../../tenancy/contract.ts';
import { isBlank, parseCsv } from './csv.ts';
import {
  REGISTER_COLUMNS,
  REGISTER_CONDITION,
  type RegisterRow,
  readRow,
} from './row.ts';

export const REGISTER_TABLES = [
  'project',
  'building',
  'space',
  'unit',
  'terms_profile',
  'party',
  'party_contact',
  'tenancy',
  'tenancy_party',
] as const;

export type RegisterTable = (typeof REGISTER_TABLES)[number];

export interface TableCount {
  created: number;
  updated: number;
}

export interface RegisterReject {
  /** The physical line of the file, which is the line an administrator sees in their spreadsheet. */
  line: number;
  /** `validate` never reached the database; `write` did and was refused by it. */
  stage: 'validate' | 'write';
  reason: string;
  /** Present on a `write` reject: what the database said, and which rule said it. */
  sqlstate?: string;
  constraint?: string;
}

export interface RegisterReport {
  /** Data lines read — the header and blank lines are not rows. */
  lines: number;
  accepted: number;
  rejects: RegisterReject[];
  counts: Record<RegisterTable, TableCount>;
}

function emptyCounts(): Record<RegisterTable, TableCount> {
  return Object.fromEntries(
    REGISTER_TABLES.map((table) => [table, { created: 0, updated: 0 }]),
  ) as Record<RegisterTable, TableCount>;
}

function record(
  counts: Record<RegisterTable, TableCount>,
  table: RegisterTable,
  inserted: boolean | null,
): void {
  if (inserted === null) return; // The row named no project (R15).
  const count = counts[table];
  if (inserted) count.created += 1;
  else count.updated += 1;
}

/** The header a register file must carry, checked before a single row is read. */
function assertHeader(fields: string[]): void {
  const found = fields.map((name) => name.trim().toLowerCase());
  const expected = [...REGISTER_COLUMNS];
  if (
    found.length !== expected.length ||
    found.some((n, at) => n !== expected[at])
  ) {
    // A whole-file defect and not a row's, so it is raised rather than reported: every line number
    // below it would be measured against columns that are not the ones in the file.
    throw new KernelError(
      'invalid',
      'the register header is not the expected one',
      {
        expected,
        found,
      },
    );
  }
}

/** Everything one accepted row writes, in dependency order, inside the caller's savepoint. */
async function writeRow(
  db: PoolClient,
  row: RegisterRow,
  counts: Record<RegisterTable, TableCount>,
): Promise<void> {
  const profile = await upsertTermsProfile(db, row.termsProfile);
  record(counts, 'terms_profile', profile.inserted);

  const unit = await upsertUnitRow(db, {
    project: row.projectCode
      ? {
          name: row.projectName ?? row.projectCode,
          projectCode: row.projectCode,
          tenderRef: null,
          status: 'ACTIVE',
        }
      : null,
    building: {
      name: row.buildingName,
      addressLine: row.addressLine,
      city: row.city,
      projectCode: row.projectCode,
      // A register carries no handover date. `warranty_end_date` is what תקופת הבדק ends on and is
      // the handover protocol's fact (week 3, slice 3.5), so both are the lease dates until that
      // document arrives — stated here rather than left to look like data.
      handoverDate: row.tenancyStart,
      warrantyEndDate: row.tenancyEnd,
      status: 'ACTIVE',
    },
    unit: {
      spaceName: row.unitNumber,
      unitNumber: row.unitNumber,
      rooms: row.rooms,
      areaSqm: row.areaSqm,
      hasMamad: row.hasMamad,
      warrantyEndDate: null,
      conditionStatus: REGISTER_CONDITION,
    },
    floor: null,
  });
  record(counts, 'project', unit.inserted.project);
  record(counts, 'building', unit.inserted.building);
  record(counts, 'space', unit.inserted.space);
  record(counts, 'unit', unit.inserted.unit);

  const tenancy = await upsertTenancy(db, {
    unitId: unit.unitId,
    startDate: row.tenancyStart,
    endDate: row.tenancyEnd,
    status: row.tenancyStatus,
    termsProfileId: profile.id,
    noticeDate: null,
    actualMoveOut: null,
  });
  record(counts, 'tenancy', tenancy.inserted);

  const party = await upsertParty(db, {
    kind: row.partyKind,
    fullName: row.fullName,
    nationalId: row.nationalId,
    preferredLanguage: row.preferredLanguage,
  });
  record(counts, 'party', party.inserted);

  const contact = await upsertPartyContact(db, {
    partyId: party.id,
    channel: 'PHONE',
    value: row.phone,
    isPrimary: true,
    validFrom: row.contactFrom,
    validTo: row.contactTo,
    // No clock reading. A register does not say when a number was last confirmed, and inventing one
    // is worse than leaving the column null (SPEC.md: the clock is injected, or nothing is written).
    verifiedAt: null,
  });
  record(counts, 'party_contact', contact.inserted);

  // Last, and it is the one that can be refused on a rule rather than on a typo: a GUARANTOR with
  // is_service_contact true is rejected by the database, with no import path around it.
  const onLease = await upsertTenancyParty(db, {
    tenancyId: tenancy.id,
    partyId: party.id,
    role: row.role,
    isServiceContact: row.isServiceContact,
  });
  record(counts, 'tenancy_party', onLease.inserted);
}

/**
 * Applies a register file.
 *
 * Takes a `PoolClient` and never a `Pool`, deliberately: a `SAVEPOINT` belongs to one connection and
 * one transaction, and a pool would scatter them across whichever connections happened to be free.
 * **The caller owns `BEGIN` and `COMMIT`** — which also means a caller may run the whole import
 * inside a transaction it rolls back, as the tests do.
 */
export async function importRegister(
  db: PoolClient,
  text: string,
): Promise<RegisterReport> {
  const records = parseCsv(text);
  const header = records[0];
  if (!header) {
    throw new KernelError('invalid', 'the register file is empty');
  }
  assertHeader(header.fields);

  const counts = emptyCounts();
  const rejects: RegisterReject[] = [];
  let lines = 0;
  let accepted = 0;

  for (const csvRecord of records.slice(1)) {
    if (isBlank(csvRecord)) continue;
    lines += 1;
    const read = readRow(csvRecord.fields);
    if ('errors' in read) {
      for (const error of read.errors) {
        rejects.push({
          line: csvRecord.line,
          stage: 'validate',
          reason: error.reason,
        });
      }
      continue;
    }
    // The savepoint is per row and not per statement: a row is one fact about one household, and
    // half of it landing is a worse state than none of it landing.
    await db.query('SAVEPOINT register_row');
    try {
      await writeRow(db, read.row, counts);
      await db.query('RELEASE SAVEPOINT register_row');
      accepted += 1;
    } catch (error) {
      await db.query('ROLLBACK TO SAVEPOINT register_row');
      const failure = error as {
        code?: string;
        constraint?: string;
        message?: string;
      };
      rejects.push({
        line: csvRecord.line,
        stage: 'write',
        // The constraint's name and never the database's message: a pg error message quotes the
        // offending values, which for this table set means a name and a phone number in a log.
        reason: failure.constraint
          ? `rejected by ${failure.constraint}`
          : 'rejected by the database',
        sqlstate: failure.code ?? 'unknown',
        constraint: failure.constraint,
      });
    }
  }
  return { lines, accepted, rejects, counts };
}
