// Flow A2 (slice 4.6) and A3 (slice 4.7). Extracted fields propose a draft tenancy or an
// addendum onto an existing one; a human confirms roles.
//
// The confirm page recomputes from extracted_field plus the unit — no staging table. Capture is
// already immutable. Estate, parties and tenancy write through their contracts.
import { getUnit, type UnitHit } from '../../estate/contract.ts';
import type { AuditLog } from '../../kernel/audit.ts';
import type { Clock } from '../../kernel/clock.ts';
import { inTransaction } from '../../kernel/db.ts';
import { KernelError } from '../../kernel/errors.ts';
import { requireText, validId } from '../../kernel/validate.ts';
import {
  countDistinctIdentifiers,
  createParty,
  upsertParty,
} from '../../parties/contract.ts';
import {
  findTermsProfileByName,
  listTermsProfiles,
  type TenancyRole,
  upsertTenancy,
  upsertTenancyParty,
} from '../../tenancy/contract.ts';
import { approveExtractedField } from './approve.ts';
import { anchorOf, getFiledDocument, linkDocument } from './documents.ts';
import { type ExtractedRow, listExtractedFields } from './extract.ts';
import { promoteExtractedField } from './promote.ts';
import type { Queryable } from './types.ts';

const ROLES: ReadonlySet<string> = new Set([
  'PRIMARY_TENANT',
  'CO_TENANT',
  'GUARANTOR',
  'OCCUPANT',
]);

export interface LeaseDeps {
  db: Queryable;
  audit: AuditLog;
  clock: Clock;
}

export interface ProposedPerson {
  extractedFieldId: string;
  fieldKey: 'tenant_name' | 'guarantor_name';
  value: string;
  proposedRole: TenancyRole;
  /**
   * **Whether a declared identifier was paired to this person — never the identifier. Slice 6.5.**
   *
   * This is a screen shape, and 6.4's ruling is that the confirm page cannot leak a ת.ז. whoever is
   * looking at it. A boolean is what the operator actually needs: it says why one letting was
   * ranked above another, and it says which of `upsertParty` and `createParty` is about to run.
   */
  hasIdentifier: boolean;
}

/**
 * **One letting this lease might belong to. Slice 6.5.**
 *
 * `identifierMatches` is a count out of `countIdentifierOverlap` — how many people already on this
 * letting carry an identifier this lease declares. No value, no key and no name travels with it.
 * `dayOverlap` is computed here and never in SQL: the comparison that would express it is the
 * isolation join's tenancy-active predicate, which belongs to `src/scope/` alone (guard two).
 */
export interface TenancyCandidate {
  tenancyId: string;
  startDate: string;
  endDate: string;
  status: string;
  identifierMatches: number;
  dayOverlap: number;
}

export interface LeaseProposal {
  documentId: string;
  typeKey: 'lease' | 'lease_amendment';
  unit: UnitHit;
  startDate: string | null;
  endDate: string | null;
  apartmentNumber: string | null;
  address: string | null;
  people: ProposedPerson[];
  matchesUnit: boolean;
  /**
   * **The four facts `matchesUnit` is the conjunction of. Slice 6.9.**
   *
   * Until 6.9 the screen had one sentence for all four, and it was true of a scan that read nothing
   * and of a lease filed against the wrong flat — two different problems asking an operator for two
   * different things. `matchesUnit` is unchanged and still decides what is *written*; these decide
   * only what is *said*. **A field that was not read is not a mismatch**, which is the distinction
   * the one sentence could not draw.
   */
  crossCheck: {
    addressRead: boolean;
    apartmentRead: boolean;
    addressFits: boolean;
    apartmentFits: boolean;
  };
  alreadyEstablished: boolean;
  boundToTenancy: boolean;
  /** Present once the paper is linked to a letting. */
  linkedTenancyId?: string | null;
  /** Existing annex names. Empty means confirm cannot write — never a default insert. */
  termsProfileNames: string[];
  /** Every letting on this flat, ranked. Empty on an amendment, which is already bound. */
  candidates: TenancyCandidate[];
  /** Which one is pre-selected. `null` is *a new letting*, and it is the default. */
  proposedTenancyId: string | null;
  /** How many identifier rows the lease declared. A count, and never near a value. */
  identifiersRead: number;
  /** How many people the ordinal rule actually paired one to. */
  identifiersPaired: number;
}

/** Who is looking, for the `evidence.match_identifier` line. Slice 6.5. */
export interface ProposeLeaseSpec {
  documentId: string;
  readBy: string;
}

/** The annex a new draft takes when the lease does not print one. #110. */
export const DEFAULT_TERMS_PROFILE = 'נספח תחזוקה — תקן';

export interface ConfirmLeaseSpec {
  documentId: string;
  termsProfileName?: string;
  confirmedBy: string;
  roles: Record<string, TenancyRole>;
}

export interface ConfirmLeaseResult {
  tenancyId: string;
  alreadyEstablished: boolean;
  partiesWritten: number;
  /** Slice 6.5: whether this bound the paper to a letting that already existed. */
  attached: boolean;
}

function foldPlace(value: string): string {
  return value
    .replaceAll('דירה', '')
    .replaceAll(/[\s,.-]/g, '')
    .toLowerCase();
}

export function apartmentMatches(
  extracted: string,
  unitNumber: string,
): boolean {
  return foldPlace(extracted) === foldPlace(unitNumber);
}

export function addressMatches(
  extracted: string,
  addressLine: string,
): boolean {
  const captured = foldPlace(extracted);
  const unit = foldPlace(addressLine);
  if (captured.length === 0 || unit.length === 0) {
    return false;
  }
  return captured.includes(unit) || unit.includes(captured);
}

/**
 * **The confirm signs the reading it is about to promote. Slice 7.4.**
 *
 * From 7.4 a promotion requires an approval stamp (`promote.ts`, and the trigger in 0029). A2's and
 * A3's confirm screens promote without anybody having opened A15's ledger — and they are entitled
 * to, because those screens *show* the dates they are about to copy (`תחילת השכירות`,
 * `סיום השכירות`, `מועד סיום מעודכן`): pressing the button is a person affirming those readings.
 * So the confirm writes the stamp it has earned rather than being excused from the rule. The
 * alternative was an exemption for the path almost every promotion in this system goes through,
 * which would have made the rule true of nothing.
 *
 * A row a person already signed on the ledger is left alone — a second approval is `conflict` by
 * design, and the value they signed is the one that gets copied either way.
 *
 * **`mayReadIdentifiers: false`**, deliberately, on a path where the question cannot arise: no date
 * is an identifier and no identifier has a promotion target. If one ever did, `false` is the value
 * that refuses rather than the one that signs on somebody's behalf for a number they never saw.
 */
async function signAndPromote(
  deps: { db: Queryable; audit: AuditLog; clock: Clock },
  row: ExtractedRow,
  confirmedBy: string,
): Promise<void> {
  if (row.approvedAt === null) {
    await approveExtractedField(deps, {
      extractedFieldId: row.extractedFieldId,
      approvedBy: confirmedBy,
      mayReadIdentifiers: false,
    });
  }
  await promoteExtractedField(deps, {
    extractedFieldId: row.extractedFieldId,
    promotedBy: confirmedBy,
  });
}

/**
 * What this document says a field is — **the value a person signed when there is one**.
 *
 * **Slice 7.4, and it closes a door 7.3 could not see.** Until today this read `value` alone, so a
 * date corrected and approved on A15's ledger was ignored by everything downstream of here: the
 * proposal screen, the day arithmetic that ranks the lettings, and `upsertTenancy`, which writes
 * `tenancy.start_date` **directly** and before any promotion runs. 7.3 fixed the promotion's copy
 * and this second door stayed open. The raw reading is untouched on the evidence row, as always.
 */
function firstValue(
  rows: readonly ExtractedRow[],
  fieldKey: string,
): string | null {
  const row = rows.find((field) => field.fieldKey === fieldKey);
  if (!row) return null;
  return row.approvedValue ?? row.value;
}

/** Reading order: down the page, then across, then by id so two boxes at one point still order. */
function inDocumentOrder(a: ExtractedRow, b: ExtractedRow): number {
  return (
    a.page - b.page ||
    a.bbox.y - b.bbox.y ||
    a.bbox.x - b.bbox.x ||
    a.extractedFieldId.localeCompare(b.extractedFieldId)
  );
}

/** The two field families, each counted on its own. `[names, identifiers, first role, rest]`. */
const FAMILIES = [
  ['tenant_name', 'tenant_id_number', 'PRIMARY_TENANT', 'CO_TENANT'],
  ['guarantor_name', 'guarantor_id_number', 'GUARANTOR', 'GUARANTOR'],
] as const;

/**
 * **The household a lease names, and the identifiers it declared for them. Slice 6.5.**
 *
 * `people` is the screen shape and carries a boolean; `identifiers` is parallel to it, stays inside
 * this module, and never reaches `LeaseProposal`. That split is 6.4's ruling made structural rather
 * than remembered: there is no field on the proposal for a ת.ז. to be assigned to by accident.
 *
 * **Pairing is ordinal and all-or-nothing within a family.** The *i*-th name takes the *i*-th
 * identifier in document order, and only when those two counts are equal. Unequal pairs nobody in
 * that family — which is a real refusal and not a fallback, because the operator is not shown the
 * value and so cannot catch a ת.ז. bound to the wrong name by looking at the screen.
 *
 * **The two families are independent**, because A2 step 3 is the reason: a guarantor is frequently
 * absent, and frequently printed without an identifier when present. One unpaired ערב must not
 * discard two correctly paired tenants; there was no pairing in that family to have got wrong.
 *
 * Guarantors are sorted here where they were not before 6.5. They were filtered in database order,
 * which is `field_key` then id — fine when the order decided nothing, wrong the moment it decides
 * which identifier belongs to whom.
 */
interface Household {
  people: ProposedPerson[];
  /** Parallel to `people`. Never in a screen shape, never in a log, never in a response. */
  identifiers: Array<string | null>;
  /** Distinct declared identifiers, for the overlap probe. */
  probes: string[];
  read: number;
  paired: number;
}

function householdOf(rows: readonly ExtractedRow[]): Household {
  const people: ProposedPerson[] = [];
  const identifiers: Array<string | null> = [];
  let read = 0;
  for (const [nameKey, idKey, firstRole, restRole] of FAMILIES) {
    const names = rows
      .filter((row) => row.fieldKey === nameKey)
      .sort(inDocumentOrder);
    const ids = rows
      .filter((row) => row.fieldKey === idKey)
      .sort(inDocumentOrder);
    read += ids.length;
    const pairs = ids.length > 0 && ids.length === names.length;
    names.forEach((row, at) => {
      people.push({
        extractedFieldId: row.extractedFieldId,
        fieldKey: nameKey,
        value: row.approvedValue ?? row.value,
        proposedRole: at === 0 ? firstRole : restRole,
        hasIdentifier: pairs,
      });
      identifiers.push(pairs ? (ids[at]?.value ?? null) : null);
    });
  }
  const declared = identifiers.filter(
    (value): value is string => value !== null,
  );
  return {
    people,
    identifiers,
    probes: [...new Set(declared)],
    read,
    paired: declared.length,
  };
}

const MS_PER_DAY = 86_400_000;

function asDay(value: string): number {
  return Date.parse(`${value}T00:00:00Z`);
}

/**
 * **How many days two lease terms share. Slice 6.5, and deliberately not SQL.**
 *
 * Both endpoints count, the way the isolation window does — the last day of a lease is still a day
 * of it. A lease with no dates overlaps nothing rather than everything: extraction returning no
 * date is a correct result (A2 step 1), and it must not rank a letting to the top.
 *
 * This is arithmetic in TypeScript because the comparison that expresses it in SQL is the isolation
 * join's tenancy-active predicate, which `src/scope/` alone may write. A second copy of it here,
 * however phrased, is the way that constraint dies.
 */
export function dayOverlap(
  lease: { startDate: string | null; endDate: string | null },
  letting: { start_date: string; end_date: string },
): number {
  if (lease.startDate === null || lease.endDate === null) {
    return 0;
  }
  const from = Math.max(asDay(lease.startDate), asDay(letting.start_date));
  const to = Math.min(asDay(lease.endDate), asDay(letting.end_date));
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) {
    return 0;
  }
  return Math.round((to - from) / MS_PER_DAY) + 1;
}

/**
 * **Identifier overlap first, then days, then the newest letting. Slice 6.5.**
 *
 * Ranking orders what an operator is offered; it never decides. A household renewing on new dates
 * is a *new* letting even though it overlaps on every identifier, so the pre-selection is a
 * different question and is answered by `startDate` equality in `proposeLeaseTenancy`.
 *
 * The last tiebreak is the id, so two lettings alike in every ranked respect still come back in one
 * order — a list that reshuffles between the page load and the post is a list nobody can confirm.
 */
export function rankCandidates(
  candidates: readonly TenancyCandidate[],
): TenancyCandidate[] {
  return [...candidates].sort(
    (a, b) =>
      b.identifierMatches - a.identifierMatches ||
      b.dayOverlap - a.dayOverlap ||
      b.startDate.localeCompare(a.startDate) ||
      a.tenancyId.localeCompare(b.tenancyId),
  );
}

/**
 * **Which flat this lease is about. Slice 6.10.**
 *
 * This read was `document_link`'s `SUBJECT` rows with an unordered `LIMIT 1`, and on a document
 * carrying two of them it returned either — the week-6 demo's confirm screen, comparing a lease to a
 * flat created a week earlier and printing *the address does not match* about an apartment the
 * director had never opened. It asks `anchorOf` now: the place the bytes are filed under, written
 * once and immutable (SPEC-evidence.md, *The same bytes are one document, and one anchor*).
 */
async function unitIdOf(db: Queryable, documentId: string): Promise<string> {
  const anchor = await anchorOf(db, documentId);
  if (anchor.kind !== 'UNIT') {
    throw new KernelError('invalid', 'that document is not bound to a unit');
  }
  return anchor.id;
}

async function tenancyLinkOf(
  db: Queryable,
  documentId: string,
): Promise<string | null> {
  const link = await db.query<{ entity_id: string }>(
    `SELECT entity_id FROM document_link
      WHERE document_id = $1 AND entity_type = 'TENANCY'
      ORDER BY entity_id
      LIMIT 1`,
    [documentId],
  );
  return link.rows[0]?.entity_id ?? null;
}

async function amendmentAlreadyConfirmed(
  db: Queryable,
  documentId: string,
): Promise<boolean> {
  const done = await db.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM audit_log
      WHERE action = 'evidence.confirm_amendment'
        AND subject_id = $1
        AND outcome = 'ok'`,
    [documentId],
  );
  return (done.rows[0]?.n ?? '0') !== '0';
}

export async function proposeLeaseTenancy(
  deps: LeaseDeps,
  spec: ProposeLeaseSpec,
): Promise<LeaseProposal> {
  const db = deps.db;
  const filed = await getFiledDocument(
    db,
    validId(spec.documentId, 'document'),
  );
  if (filed.typeKey !== 'lease' && filed.typeKey !== 'lease_amendment') {
    throw new KernelError('invalid', 'that document is not a lease');
  }
  const unitId = await unitIdOf(db, filed.documentId);
  const unit = await getUnit(db, unitId);
  const rows = await listExtractedFields(db, filed.documentId);
  const household = householdOf(rows);
  const linkedTenancyId = await tenancyLinkOf(db, filed.documentId);
  const boundToTenancy = linkedTenancyId !== null;
  if (filed.typeKey === 'lease_amendment') {
    // An addendum is already bound to a letting — there is nothing to resolve, and A3 says so.
    return {
      documentId: filed.documentId,
      typeKey: 'lease_amendment',
      unit,
      startDate: firstValue(rows, 'effective_date'),
      endDate: firstValue(rows, 'new_end_date'),
      apartmentNumber: null,
      address: null,
      people: household.people,
      matchesUnit: true,
      // An addendum carries neither field — A3 chose the letting, so there is nothing to cross-check
      // and nothing for the screen to say about one (SPEC-evidence.md).
      crossCheck: {
        addressRead: true,
        apartmentRead: true,
        addressFits: true,
        apartmentFits: true,
      },
      alreadyEstablished: await amendmentAlreadyConfirmed(db, filed.documentId),
      boundToTenancy,
      linkedTenancyId,
      termsProfileNames: [],
      candidates: [],
      proposedTenancyId: null,
      identifiersRead: household.read,
      identifiersPaired: household.paired,
    };
  }
  const apartmentNumber = firstValue(rows, 'apartment_number');
  const address = firstValue(rows, 'address');
  const crossCheck = {
    addressRead: address !== null,
    apartmentRead: apartmentNumber !== null,
    addressFits: address !== null && addressMatches(address, unit.address_line),
    apartmentFits:
      apartmentNumber !== null &&
      apartmentMatches(apartmentNumber, unit.unit_number),
  };
  // Unchanged, and deliberately written as the conjunction of the four above rather than beside
  // them: one of these is the rule and the others are its explanation, and two independent
  // expressions of the same rule is how a screen and a write stop agreeing.
  const matchesUnit =
    crossCheck.addressRead &&
    crossCheck.apartmentRead &&
    crossCheck.addressFits &&
    crossCheck.apartmentFits;
  const startDate = firstValue(rows, 'start_date');
  const endDate = firstValue(rows, 'end_date');

  return {
    documentId: filed.documentId,
    typeKey: 'lease',
    unit,
    startDate,
    endDate,
    apartmentNumber,
    address,
    people: household.people,
    matchesUnit,
    crossCheck,
    alreadyEstablished: boundToTenancy,
    boundToTenancy,
    linkedTenancyId,
    termsProfileNames: await listTermsProfiles(db),
    candidates: [],
    proposedTenancyId: null,
    identifiersRead: household.read,
    identifiersPaired: household.paired,
  };
}

function asRole(value: string | undefined): TenancyRole {
  if (!value || !ROLES.has(value)) {
    throw new KernelError(
      'invalid',
      'every named person needs a confirmed role',
    );
  }
  return value as TenancyRole;
}

/**
 * **Every party this document writes, and the one place `upsertParty` and `createParty` are chosen
 * between. Slice 6.5.**
 *
 * Where the lease declared an identifier for this person, the party is written through
 * `upsertParty`, whose natural key is `national_id_key` — so the same ת.ז. on a second lease in a
 * second flat is the same party and a second tenancy, which is this slice's whole point. Where it
 * declared none, `createParty` is still the command, still always an insert, and two calls with the
 * same name are still two people: a name is never matched (A2 step 5, and 5.5's 303 shared full
 * names are why).
 *
 * **Two people resolving to one party is a refusal.** Without it the second `upsertTenancyParty`
 * would quietly overwrite the first's role through `(tenancy_id, party_id)`, and a household would
 * come out of the confirm screen with one member fewer than the paper names. The transaction
 * rolls back the upsert that found it, which is why this may be checked after the write rather than
 * before it.
 */
async function writeParties(
  db: Queryable,
  input: {
    tenancyId: string;
    documentId: string;
    household: Household;
    roles: Record<string, TenancyRole>;
    /** When set, an unstamped name writes no party. Lease create; an addendum still posts roles. */
    stamped?: ReadonlySet<string>;
  },
): Promise<number> {
  // **Checked before anything is written**, and folded by the database rather than compared as
  // strings: `312345678` and `312-345-678` are two strings and one person, which is the whole
  // reason `national_id_key` exists. Doing it here rather than after the second upsert means the
  // refusal holds whoever owns the transaction — including a caller that already had one open,
  // where `inTransaction` passes through and there is no savepoint to roll back to.
  const distinct = await countDistinctIdentifiers(db, input.household.probes);
  if (distinct < input.household.probes.length) {
    // The message names no value and no name: it is a log line the moment anything catches it,
    // and SPEC.md's rule is that PII never reaches one.
    throw new KernelError(
      'invalid',
      'two people on this lease resolve to one person',
    );
  }
  const seen = new Set<string>();
  let written = 0;
  for (const [at, person] of input.household.people.entries()) {
    if (input.stamped && !input.stamped.has(person.extractedFieldId)) {
      continue;
    }
    const role = asRole(input.roles[person.extractedFieldId]);
    const identifier = input.household.identifiers[at] ?? null;
    const party =
      identifier === null
        ? await createParty(db, {
            kind: 'PERSON',
            fullName: person.value,
            preferredLanguage: 'he',
          })
        : await upsertParty(db, {
            kind: 'PERSON',
            fullName: person.value,
            nationalId: identifier,
            preferredLanguage: 'he',
          });
    if (seen.has(party.id)) {
      // Belt and braces, and cheap: the check above reads the identifiers this lease declared, and
      // this one reads the rows that actually came back. They can only disagree if the fold and the
      // generated column disagree, which `src/parties/schema.test.ts` asserts they do not.
      throw new KernelError(
        'invalid',
        'two people on this lease resolve to one person',
      );
    }
    seen.add(party.id);
    await upsertTenancyParty(db, {
      tenancyId: input.tenancyId,
      partyId: party.id,
      role,
      isServiceContact: role !== 'GUARANTOR',
    });
    await linkDocument(db, {
      documentId: input.documentId,
      entityType: 'PARTY',
      entityId: party.id,
      linkRole: 'SIGNATORY',
    });
    written += 1;
  }
  return written;
}

async function confirmAmendment(
  deps: LeaseDeps,
  db: Queryable,
  spec: {
    documentId: string;
    confirmedBy: string;
    roles: Record<string, TenancyRole>;
    proposed: LeaseProposal;
    household: Household;
  },
): Promise<ConfirmLeaseResult> {
  const { documentId, confirmedBy, proposed } = spec;
  if (proposed.alreadyEstablished) {
    const existing = await tenancyLinkOf(db, documentId);
    if (!existing) {
      throw new KernelError(
        'invalid',
        'that document is not bound to a tenancy',
      );
    }
    return {
      tenancyId: existing,
      alreadyEstablished: true,
      partiesWritten: 0,
      attached: false,
    };
  }
  const tenancyId = await tenancyLinkOf(db, documentId);
  if (!tenancyId) {
    throw new KernelError('invalid', 'that document is not bound to a tenancy');
  }
  for (const person of proposed.people) {
    asRole(spec.roles[person.extractedFieldId]);
  }

  const rows = await listExtractedFields(db, documentId);
  const promote = {
    db,
    audit: deps.audit,
    clock: deps.clock,
  };
  const endDate = rows.find((field) => field.fieldKey === 'new_end_date');
  if (endDate) {
    await signAndPromote(promote, endDate, confirmedBy);
  }

  const partiesWritten = await writeParties(db, {
    tenancyId,
    documentId,
    household: spec.household,
    roles: spec.roles,
  });

  await deps.audit.write(
    {
      actorKind: 'staff',
      actorId: confirmedBy,
      action: 'evidence.confirm_amendment',
      subjectId: documentId,
      inputs: { tenancyId, partiesWritten },
    },
    { outcome: 'ok' },
  );

  return {
    tenancyId,
    alreadyEstablished: false,
    partiesWritten,
    attached: false,
  };
}

function stampedNameIds(rows: readonly ExtractedRow[]): Set<string> {
  return new Set(
    rows
      .filter(
        (row) =>
          (row.fieldKey === 'tenant_name' ||
            row.fieldKey === 'guarantor_name') &&
          row.approvedAt !== null,
      )
      .map((row) => row.extractedFieldId),
  );
}

function rolesFromFieldFamily(
  people: readonly ProposedPerson[],
): Record<string, TenancyRole> {
  return Object.fromEntries(
    people.map((person) => [person.extractedFieldId, person.proposedRole]),
  );
}

async function resolveTermsProfileName(
  db: Queryable,
  requested: string | undefined,
): Promise<string> {
  if (requested && requested.trim().length > 0) {
    return requireText(requested, 'terms_profile', 200);
  }
  const names = await listTermsProfiles(db);
  if (names.includes(DEFAULT_TERMS_PROFILE)) {
    return DEFAULT_TERMS_PROFILE;
  }
  if (names.length === 1 && names[0]) {
    return names[0];
  }
  throw new KernelError('invalid', 'that terms profile does not exist');
}

function readingIsReady(rows: readonly ExtractedRow[]): boolean {
  const tenants = rows.filter((row) => row.fieldKey === 'tenant_name');
  if (tenants.length === 0 || tenants.some((row) => row.approvedAt === null)) {
    return false;
  }
  const guarantors = rows.filter((row) => row.fieldKey === 'guarantor_name');
  if (guarantors.some((row) => row.approvedAt === null)) {
    return false;
  }
  for (const key of ['start_date', 'end_date'] as const) {
    const row = rows.find((field) => field.fieldKey === key);
    if (!row || row.approvedAt === null) {
      return false;
    }
  }
  return true;
}

/**
 * After the ledger is stamped, write the draft. Returns null when the reading is not ready yet.
 */
export async function establishApprovedLease(
  deps: LeaseDeps,
  spec: { documentId: string; confirmedBy: string },
): Promise<string | null> {
  const documentId = validId(spec.documentId, 'document');
  const filed = await getFiledDocument(deps.db, documentId);
  if (filed.typeKey !== 'lease') {
    return null;
  }
  if ((await tenancyLinkOf(deps.db, documentId)) !== null) {
    return null;
  }
  const rows = await listExtractedFields(deps.db, documentId);
  if (!readingIsReady(rows)) {
    return null;
  }
  const confirmed = await confirmLeaseTenancy(deps, {
    documentId,
    confirmedBy: spec.confirmedBy,
    roles: {},
  });
  return confirmed.tenancyId;
}

export async function confirmLeaseTenancy(
  deps: LeaseDeps,
  spec: ConfirmLeaseSpec,
): Promise<ConfirmLeaseResult> {
  const documentId = validId(spec.documentId, 'document');
  const confirmedBy = requireText(spec.confirmedBy, 'confirmed_by', 200);

  return inTransaction(deps.db, async (db) => {
    const proposed = await proposeLeaseTenancy(
      { ...deps, db },
      { documentId, readBy: confirmedBy },
    );
    const rows = await listExtractedFields(db, documentId);
    const household = householdOf(rows);
    if (proposed.typeKey === 'lease_amendment') {
      return confirmAmendment(deps, db, {
        documentId,
        confirmedBy,
        roles: spec.roles,
        proposed,
        household,
      });
    }
    const existing = await tenancyLinkOf(db, documentId);
    if (existing) {
      return {
        tenancyId: existing,
        alreadyEstablished: true,
        partiesWritten: 0,
        attached: false,
      };
    }
    const termsProfileName = await resolveTermsProfileName(
      db,
      spec.termsProfileName,
    );
    if (!proposed.matchesUnit) {
      throw new KernelError('invalid', 'the document does not match this unit');
    }
    if (!proposed.startDate || !proposed.endDate) {
      throw new KernelError('invalid', 'the lease is missing dates');
    }
    const stamped = stampedNameIds(rows);
    const tenants = household.people.filter(
      (person) =>
        person.fieldKey === 'tenant_name' &&
        stamped.has(person.extractedFieldId),
    );
    if (tenants.length === 0) {
      throw new KernelError('invalid', 'the lease names no tenant');
    }
    const roles = rolesFromFieldFamily(household.people);

    const profileId = await findTermsProfileByName(db, termsProfileName);
    if (!profileId) {
      throw new KernelError('invalid', 'that terms profile does not exist');
    }

    const collision = await db.query<{ tenancy_id: string }>(
      `SELECT tenancy_id FROM tenancy
        WHERE unit_id = $1 AND start_date = $2`,
      [proposed.unit.unit_id, proposed.startDate],
    );
    if (collision.rows[0]) {
      throw new KernelError(
        'conflict',
        'that unit already has a lease starting on this date',
      );
    }

    const tenancy = await upsertTenancy(db, {
      unitId: proposed.unit.unit_id,
      startDate: proposed.startDate,
      endDate: proposed.endDate,
      status: 'DRAFT',
      termsProfileId: profileId,
      noticeDate: null,
      actualMoveOut: null,
    });
    await linkDocument(db, {
      documentId,
      entityType: 'TENANCY',
      entityId: tenancy.id,
      linkRole: 'EVIDENCE',
    });

    const promote = {
      db,
      audit: deps.audit,
      clock: deps.clock,
    };
    for (const fieldKey of ['start_date', 'end_date'] as const) {
      const row = rows.find((field) => field.fieldKey === fieldKey);
      if (row) {
        await signAndPromote(promote, row, confirmedBy);
      }
    }

    const partiesWritten = await writeParties(db, {
      tenancyId: tenancy.id,
      documentId,
      household,
      roles,
      stamped,
    });

    await deps.audit.write(
      {
        actorKind: 'staff',
        actorId: confirmedBy,
        action: 'evidence.confirm_lease',
        subjectId: documentId,
        inputs: {
          tenancyId: tenancy.id,
          partiesWritten,
        },
      },
      { outcome: 'ok' },
    );

    return {
      tenancyId: tenancy.id,
      alreadyEstablished: false,
      partiesWritten,
      attached: false,
    };
  });
}
