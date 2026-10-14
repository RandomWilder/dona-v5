// Flow A2 (slice 4.6) and A3 (slice 4.7). Extracted fields propose a draft tenancy or an
// addendum onto an existing one; a human confirms roles.
//
// The confirm page recomputes from extracted_field plus the unit — no staging table. Capture is
// already immutable. Estate, parties and tenancy write through their contracts.
import { getUnit, type UnitHit } from '../../estate/contract.ts';
import type { AuditLog } from '../../kernel/audit.ts';
import { type Clock, today } from '../../kernel/clock.ts';
import { inTransaction } from '../../kernel/db.ts';
import { KernelError } from '../../kernel/errors.ts';
import { requireText, validId } from '../../kernel/validate.ts';
import {
  addPartyContact,
  countDistinctIdentifiers,
  createParty,
  hasOpenPrimaryContact,
  listPartyNames,
  partyIdByNationalId,
  setPrimaryPartyContact,
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
import { displayConfirmedName, readConfirmedName } from './confirmed-name.ts';
import {
  CONTACT_FIELDS,
  type ContactChannel,
  type ContactRules,
} from './contacts.ts';
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
  /** #235. Absent, a lease with an approved phone or email cannot open. */
  contacts?: ContactRules;
}

export interface ProposedPerson {
  extractedFieldId: string;
  fieldKey:
    | 'tenant_name'
    | 'main_tenant_name'
    | 'second_tenant_name'
    | 'guarantor_name';
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
  /**
   * Given and family name posted from the confirmation screen, keyed by extracted field.
   * Absent when the split was already stored on the approved value.
   */
  names?: Readonly<
    Record<string, { givenName: string | null; familyName: string }>
  >;
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
  options: { supersede?: boolean } = {},
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
    supersede: options.supersede,
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

/** Name/identifier families. `[names, identifiers, first role, rest]`. */
const FAMILIES = [
  [
    'main_tenant_name',
    'main_tenant_id_number',
    'PRIMARY_TENANT',
    'PRIMARY_TENANT',
  ],
  ['second_tenant_name', 'second_tenant_id_number', 'CO_TENANT', 'CO_TENANT'],
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
  /**
   * Parallel to `people`: each person's approved phones and emails, as signed. #235. Paired with
   * the name by the identifiers' rule, per contact field: the *i*-th name takes the *i*-th value,
   * and only when the counts are equal. A row nobody approved is paired and then left out.
   */
  contacts: Array<Array<{ channel: ContactChannel; value: string }>>;
  /** Approved phones and emails the ordinal rule paired to nobody, and so will not be written. */
  unpairedContacts: number;
  /** Distinct declared identifiers, for the overlap probe. */
  probes: string[];
  read: number;
  paired: number;
}

function householdOf(rows: readonly ExtractedRow[]): Household {
  const people: ProposedPerson[] = [];
  const identifiers: Array<string | null> = [];
  const contacts: Household['contacts'] = [];
  let unpairedContacts = 0;
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
    const contactFamilies = Object.entries(CONTACT_FIELDS)
      .filter(([, field]) => field.nameKey === nameKey)
      .map(([contactKey, field]) => ({
        channel: field.channel,
        read: rows
          .filter((row) => row.fieldKey === contactKey)
          .sort(inDocumentOrder),
      }));
    const pairedContactFamilies = contactFamilies.filter(
      (family) => family.read.length === names.length,
    );
    for (const family of contactFamilies) {
      if (family.read.length !== names.length) {
        unpairedContacts += family.read.filter(
          (row) => row.approvedAt !== null,
        ).length;
      }
    }
    names.forEach((row, at) => {
      contacts.push(
        pairedContactFamilies.flatMap((family) => {
          const paired = family.read[at];
          return paired && paired.approvedAt !== null
            ? [
                {
                  channel: family.channel,
                  value: paired.approvedValue ?? paired.value,
                },
              ]
            : [];
        }),
      );
      people.push({
        extractedFieldId: row.extractedFieldId,
        fieldKey: nameKey,
        value: row.approvedValue ?? row.value,
        proposedRole: at === 0 ? firstRole : restRole,
        hasIdentifier: pairs,
      });
      const id = ids[at];
      identifiers.push(pairs && id ? (id.approvedValue ?? id.value) : null);
    });
  }
  const declared = identifiers.filter(
    (value): value is string => value !== null,
  );
  return {
    people,
    identifiers,
    contacts,
    unpairedContacts,
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

/** One approved contact, stored form, and the party holding it as an open contact today. */
interface ResolvedContact {
  channel: ContactChannel;
  value: string;
  holder: string | null;
}

/** Who a person on the lease will be before anything is written. #235. */
interface ResolvedPerson {
  /** The existing party this person is, or null when the press creates one. */
  partyId: string | null;
  contacts: ResolvedContact[];
}

/**
 * **Who each person becomes, read before anything is written. #235 (SPEC-parties "Contacts from a
 * lease").** In order: a printed ת.ז. is the party it keys on; otherwise an approved phone or
 * email held as an open contact by exactly one party is that party; otherwise a new party. A name
 * never matches. Read once and used twice: the screen states the refusals from it, and the press
 * writes from it, so the two cannot disagree about who a phone belongs to.
 */
async function resolvePeople(
  db: Queryable,
  rules: ContactRules | undefined,
  household: Household,
  day: string,
): Promise<ResolvedPerson[]> {
  const resolved: ResolvedPerson[] = [];
  for (const [at, approved] of household.contacts.entries()) {
    if (approved.length > 0 && !rules) {
      throw new KernelError('invalid', 'a contact cannot be written here');
    }
    const contacts: ResolvedContact[] = [];
    for (const contact of approved) {
      const value = (rules as ContactRules).normalise(
        contact.channel,
        contact.value,
      );
      contacts.push({
        channel: contact.channel,
        value,
        holder: await (rules as ContactRules).holder(db, {
          channel: contact.channel,
          value,
          day,
        }),
      });
    }
    const identifier = household.identifiers[at] ?? null;
    const holders = new Set(
      contacts.flatMap((contact) => (contact.holder ? [contact.holder] : [])),
    );
    const partyId =
      identifier !== null
        ? await partyIdByNationalId(db, {
            kind: 'PERSON',
            nationalId: identifier,
          })
        : holders.size === 1
          ? ([...holders][0] ?? null)
          : null;
    resolved.push({ partyId, contacts });
  }
  return resolved;
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
    /**
     * The split the confirmation screen posted, keyed by extracted field. When absent, the
     * stored confirmation (or the extraction, proposed as first word / remainder) is used.
     */
    names?: Readonly<
      Record<string, { givenName: string | null; familyName: string }>
    >;
    /**
     * #235. Who each person resolved to, parallel to `people`, and the day their contacts open.
     * Absent on an addendum, which writes no contact.
     */
    resolved?: { people: readonly ResolvedPerson[]; day: string };
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
    const posted = input.names?.[person.extractedFieldId];
    const name = posted ?? readConfirmedName(person.value);
    const resolved = input.resolved?.people[at];
    const contactsFrom = input.resolved?.day;
    const matched = identifier === null ? (resolved?.partyId ?? null) : null;
    const party =
      matched !== null
        ? { id: matched }
        : identifier === null
          ? await createParty(db, {
              kind: 'PERSON',
              givenName: name.givenName,
              familyName: name.familyName,
              preferredLanguage: 'he',
            })
          : await upsertParty(db, {
              kind: 'PERSON',
              givenName: name.givenName,
              familyName: name.familyName,
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
    for (const contact of contactsFrom ? (resolved?.contacts ?? []) : []) {
      if (contact.holder === party.id) continue;
      // The overlap refusal of #206: a value another party holds today raises `conflict` naming
      // that party, and the transaction takes the whole draft with it.
      const added = await addPartyContact(db, {
        partyId: party.id,
        channel: contact.channel,
        value: contact.value,
        label: null,
        validFrom: contactsFrom as string,
      });
      if (
        !(await hasOpenPrimaryContact(db, {
          partyId: party.id,
          channel: contact.channel,
        }))
      ) {
        await setPrimaryPartyContact(db, {
          partyId: party.id,
          contactId: added.contactId,
        });
      }
    }
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
    names?: ConfirmLeaseSpec['names'];
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
    await signAndPromote(promote, endDate, confirmedBy, { supersede: true });
  }

  const partiesWritten = await writeParties(db, {
    tenancyId,
    documentId,
    household: spec.household,
    roles: spec.roles,
    names: spec.names,
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

const NAME_KEYS = new Set([
  'main_tenant_name',
  'second_tenant_name',
  'tenant_name',
  'guarantor_name',
]);

function stampedNameIds(rows: readonly ExtractedRow[]): Set<string> {
  return new Set(
    rows
      .filter((row) => NAME_KEYS.has(row.fieldKey) && row.approvedAt !== null)
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

/** A row הקריאה still needs before פתיחת טיוטה. `value` is null when the reader found none. #234. */
export interface ReadingGap {
  fieldKey: string;
  labelHe: string;
  value: string | null;
}

/** What a required field is called when the reader found no row to borrow a label from. */
const UNREAD_LABELS: Readonly<Record<string, string>> = {
  main_tenant_name: 'שם השוכר הראשי',
  start_date: 'תחילת תקופת השכירות',
  end_date: 'סיום תקופת השכירות',
};

/**
 * **What is missing before the draft can open. #234 (SPEC-flows A16 as amended at #232).**
 *
 * Ready means an approved main tenant name, an approved start date and end date, and every name
 * row of every role approved. Live filings name the household by role (`main_tenant_name`); a
 * September reading still names `tenant_name`, which stands in for the main tenant when no
 * role-named row was read, and then every one of them is a tenant and a gap until signed.
 *
 * **Two exceptions, both captures of one fact read twice.** A date read twice is one date, and a
 * `main_tenant_name` read twice is one main tenant: the reader capped that role at one person, so a
 * second capture is the same name again and not a second household member. One approved capture
 * is enough for either, and the unsigned twin stays on the ledger and writes no party. Without
 * this, the only way to open the draft would be to sign the twin, which writes two primary
 * tenants for one person, and there is no control that dismisses a row.
 */
export function leaseReadingGaps(rows: readonly ExtractedRow[]): ReadingGap[] {
  const gaps: ReadingGap[] = [];
  const unread = (fieldKey: string) =>
    gaps.push({
      fieldKey,
      labelHe: UNREAD_LABELS[fieldKey] ?? fieldKey,
      value: null,
    });
  const unsigned = (row: ExtractedRow) =>
    gaps.push({
      fieldKey: row.fieldKey,
      labelHe: row.labelHe,
      value: row.value,
    });
  const tenants = rows.some((row) => row.fieldKey === 'main_tenant_name')
    ? rows.filter((row) => row.fieldKey === 'main_tenant_name')
    : rows.filter((row) => row.fieldKey === 'tenant_name');
  if (tenants.length === 0) {
    unread('main_tenant_name');
  }
  for (const key of ['start_date', 'end_date'] as const) {
    const read = rows.filter((row) => row.fieldKey === key);
    const first = read.sort(inDocumentOrder)[0];
    if (!first) {
      unread(key);
    } else if (!read.some((row) => row.approvedAt !== null)) {
      unsigned(first);
    }
  }
  const mainSigned = rows.some(
    (row) => row.fieldKey === 'main_tenant_name' && row.approvedAt !== null,
  );
  for (const row of [...rows].sort(inDocumentOrder)) {
    if (!NAME_KEYS.has(row.fieldKey) || row.approvedAt !== null) continue;
    if (row.fieldKey === 'main_tenant_name' && mainSigned) continue;
    unsigned(row);
  }
  return gaps;
}

/** The signed capture of a date when there is one, so a second unapproved read never wins. */
function signedRow(
  rows: readonly ExtractedRow[],
  fieldKey: string,
): ExtractedRow | undefined {
  const read = rows
    .filter((row) => row.fieldKey === fieldKey)
    .sort(inDocumentOrder);
  return read.find((row) => row.approvedAt !== null) ?? read[0];
}

/**
 * Carry every approved, mapped, still-uncarried row on a lease.
 *
 * Each row is its own promotion. A `conflict` or `invalid` from one row — the
 * other rent half, a bay that is not a Space, a column that already holds
 * something else — leaves that row uncarried and does not fail the press that
 * asked for the carry. `lease_amendment` never reaches here.
 *
 * **Each row under its own savepoint. #234.** The carry now runs inside פתיחת טיוטה's
 * transaction, and a promotion may refuse after one of its statements ran. Without the
 * savepoint a refused row would abort the transaction and take the draft with it.
 */
async function carryApprovedLease(
  deps: LeaseDeps,
  spec: { documentId: string; promotedBy: string },
): Promise<void> {
  await inTransaction(deps.db, async (db) => {
    const rows = await listExtractedFields(db, spec.documentId);
    for (const row of rows) {
      if (row.approvedAt === null || row.promotionTarget === null) continue;
      if (row.promotedTo !== null) continue;
      await db.query('SAVEPOINT carry_field');
      try {
        await promoteExtractedField(
          { db, audit: deps.audit, clock: deps.clock },
          {
            extractedFieldId: row.extractedFieldId,
            promotedBy: spec.promotedBy,
          },
        );
        await db.query('RELEASE SAVEPOINT carry_field');
      } catch (error) {
        await db.query('ROLLBACK TO SAVEPOINT carry_field');
        if (
          error instanceof KernelError &&
          (error.code === 'conflict' || error.code === 'invalid')
        ) {
          continue;
        }
        throw error;
      }
    }
  });
}

/**
 * **An approval on a lease that already has a draft still carries. #234.**
 *
 * Approving only stamps (SPEC-flows A2 as amended at #232). The one consequence an approval keeps
 * is the carry onto a letting that already exists, which cannot refuse: every refusal is per row
 * and leaves the row uncarried. A lease with no draft carries nothing here; פתיחת טיוטה carries
 * every approved mapped row when it opens the draft. Anything that is not a lease is left alone.
 */
export async function carryBoundLease(
  deps: LeaseDeps,
  spec: { documentId: string; promotedBy: string },
): Promise<void> {
  const documentId = validId(spec.documentId, 'document');
  const filed = await getFiledDocument(deps.db, documentId);
  if (filed.typeKey !== 'lease') return;
  if ((await tenancyLinkOf(deps.db, documentId)) === null) return;
  await carryApprovedLease(deps, {
    documentId,
    promotedBy: spec.promotedBy,
  });
}

/** One person פתיחת טיוטה will write, and the role they will hold. A screen shape: no identifier. */
export interface OpeningPerson {
  extractedFieldId: string;
  fieldKey: ProposedPerson['fieldKey'];
  name: string;
  role: TenancyRole;
  hasIdentifier: boolean;
  /** #235. No ת.ז., and an approved phone or email names the one existing party this person is. */
  matchedByContact: boolean;
  /** #235. How many approved phones and emails the press writes for this person. */
  contacts: number;
}

/** Every reason the press would be refused. The screen words each one; the command throws on it. */
export type OpeningRefusal =
  | { kind: 'not_ready'; gaps: ReadingGap[] }
  | { kind: 'no_terms_profile' }
  | { kind: 'unit_taken'; tenancyId: string }
  | { kind: 'same_person' }
  /** #235. An approved phone or email another party holds today. Names that party, never the value. */
  | {
      kind: 'contact_held';
      channel: ContactChannel;
      person: string;
      partyId: string;
      holderName: string;
    }
  /** #235. One approved phone or email on two people of this lease. */
  | { kind: 'contact_shared'; channel: ContactChannel };

export interface LeaseOpening {
  documentId: string;
  unit: UnitHit;
  startDate: string | null;
  endDate: string | null;
  /** The address and flat number as read, shown beside the unit's. Not a refusal (#232). */
  address: string | null;
  apartmentNumber: string | null;
  matchesUnit: boolean;
  people: OpeningPerson[];
  termsProfiles: string[];
  /** The existing rule's choice: `DEFAULT_TERMS_PROFILE`, else the sole profile, else none. */
  termsProfile: string | null;
  refusals: OpeningRefusal[];
  /** Set once the draft is open; the screen then has nothing to press. */
  tenancyId: string | null;
  /** #235. Approved phones and emails that pair with no person, and so are not written. */
  unpairedContacts: number;
}

function preselectedProfile(names: readonly string[]): string | null {
  if (names.includes(DEFAULT_TERMS_PROFILE)) return DEFAULT_TERMS_PROFILE;
  if (names.length === 1 && names[0]) return names[0];
  return null;
}

/** What פתיחת טיוטה reads: the connection, the day, and #235's contact rules. */
export interface OpeningDeps {
  db: Queryable;
  clock: Clock;
  contacts?: ContactRules;
}

/**
 * **A phone or an email that would be written onto the wrong person. #235.** A value held today by
 * a party other than the one this person becomes refuses the press, because a number shared by two
 * people is exactly the case the isolation join cannot answer. One value on two people of the same
 * lease is the same case, inside one document.
 */
async function contactRefusals(
  db: Queryable,
  household: Household,
  resolved: readonly ResolvedPerson[],
  stamped: ReadonlySet<string>,
): Promise<OpeningRefusal[]> {
  const refusals: OpeningRefusal[] = [];
  const seen = new Map<string, number>();
  const held: Array<{
    channel: ContactChannel;
    person: string;
    partyId: string;
  }> = [];
  for (const [at, person] of household.people.entries()) {
    if (!stamped.has(person.extractedFieldId)) continue;
    for (const contact of resolved[at]?.contacts ?? []) {
      const key = `${contact.channel}:${contact.value}`;
      const first = seen.get(key);
      if (first !== undefined && first !== at) {
        refusals.push({ kind: 'contact_shared', channel: contact.channel });
      }
      seen.set(key, at);
      if (contact.holder !== null && contact.holder !== resolved[at]?.partyId) {
        held.push({
          channel: contact.channel,
          person: displayConfirmedName(person.value),
          partyId: contact.holder,
        });
      }
    }
  }
  const names = new Map(
    (
      await listPartyNames(db, [...new Set(held.map((one) => one.partyId))])
    ).map((row) => [row.party_id, row.full_name]),
  );
  for (const one of held) {
    refusals.push({
      kind: 'contact_held',
      ...one,
      holderName: names.get(one.partyId) ?? '',
    });
  }
  return refusals;
}

/**
 * **What פתיחת טיוטה shows before anything is written. #234.**
 *
 * The refusals are computed here and nowhere else, and `openLeaseDraft` reads them from this same
 * function inside its transaction: one rule, so the screen and the write cannot disagree about
 * whether the press would go through.
 */
export async function proposeLeaseOpening(
  deps: OpeningDeps,
  documentIdRaw: string,
): Promise<LeaseOpening> {
  const opened = await openingAndPeople(deps, documentIdRaw);
  return opened.opening;
}

async function openingAndPeople(
  deps: OpeningDeps,
  documentIdRaw: string,
): Promise<{ opening: LeaseOpening; resolved: ResolvedPerson[]; day: string }> {
  const db = deps.db;
  const documentId = validId(documentIdRaw, 'document');
  const filed = await getFiledDocument(db, documentId);
  if (filed.typeKey !== 'lease') {
    throw new KernelError('invalid', 'that document is not a lease');
  }
  const unit = await getUnit(db, await unitIdOf(db, documentId));
  const rows = await listExtractedFields(db, documentId);
  const household = householdOf(rows);
  const startRow = signedRow(rows, 'start_date');
  const endRow = signedRow(rows, 'end_date');
  const startDate = startRow
    ? (startRow.approvedValue ?? startRow.value)
    : null;
  const endDate = endRow ? (endRow.approvedValue ?? endRow.value) : null;
  const address = firstValue(rows, 'address');
  const apartmentNumber = firstValue(rows, 'apartment_number');
  const termsProfiles = await listTermsProfiles(db);

  const refusals: OpeningRefusal[] = [];
  const gaps = leaseReadingGaps(rows);
  if (gaps.length > 0) {
    refusals.push({ kind: 'not_ready', gaps });
  }
  if (termsProfiles.length === 0) {
    refusals.push({ kind: 'no_terms_profile' });
  }
  if (startDate !== null) {
    const taken = await db.query<{ tenancy_id: string }>(
      `SELECT tenancy_id FROM tenancy WHERE unit_id = $1 AND start_date = $2`,
      [unit.unit_id, startDate],
    );
    const tenancyId = taken.rows[0]?.tenancy_id;
    if (tenancyId) {
      refusals.push({ kind: 'unit_taken', tenancyId });
    }
  }
  // Every paired identifier, not the distinct ones: two people printed with one ת.ז. is exactly
  // the case a de-duplicated list would hide.
  const declared = household.identifiers.filter(
    (value): value is string => value !== null,
  );
  if ((await countDistinctIdentifiers(db, declared)) < declared.length) {
    refusals.push({ kind: 'same_person' });
  }
  const day = today(deps.clock);
  const resolved = await resolvePeople(db, deps.contacts, household, day);
  const stamped = stampedNameIds(rows);
  const matched = household.people.flatMap((person, at) => {
    const partyId = resolved[at]?.partyId;
    return stamped.has(person.extractedFieldId) && partyId ? [partyId] : [];
  });
  if (
    new Set(matched).size < matched.length &&
    !refusals.some((one) => one.kind === 'same_person')
  ) {
    refusals.push({ kind: 'same_person' });
  }
  refusals.push(...(await contactRefusals(db, household, resolved, stamped)));

  const opening: LeaseOpening = {
    documentId,
    unit,
    startDate,
    endDate,
    address,
    apartmentNumber,
    matchesUnit:
      address !== null &&
      apartmentNumber !== null &&
      addressMatches(address, unit.address_line) &&
      apartmentMatches(apartmentNumber, unit.unit_number),
    people: household.people.map((person, at) => ({
      extractedFieldId: person.extractedFieldId,
      fieldKey: person.fieldKey,
      name: displayConfirmedName(person.value),
      role: person.proposedRole,
      hasIdentifier: household.identifiers[at] !== null,
      matchedByContact:
        household.identifiers[at] === null && Boolean(resolved[at]?.partyId),
      contacts: resolved[at]?.contacts.length ?? 0,
    })),
    termsProfiles,
    termsProfile: preselectedProfile(termsProfiles),
    refusals,
    tenancyId: await tenancyLinkOf(db, documentId),
    unpairedContacts: household.unpairedContacts,
  };
  return { opening, resolved, day };
}

const REFUSAL_ERRORS: Readonly<
  Record<OpeningRefusal['kind'], [KernelError['code'], string]>
> = {
  not_ready: ['invalid', 'the reading is not ready'],
  no_terms_profile: ['invalid', 'no terms profile exists'],
  unit_taken: [
    'conflict',
    'that unit already has a lease starting on this date',
  ],
  same_person: ['invalid', 'two people on this lease resolve to one person'],
  contact_held: ['conflict', 'that number is already held'],
  contact_shared: ['invalid', 'two people on this lease share one contact'],
};

export interface OpenLeaseDraftSpec {
  documentId: string;
  /** Empty or absent takes the preselected profile. */
  termsProfileName?: string;
  openedBy: string;
  /** A2's confirm screen may still post a split; הקריאה stores it on the approved value. */
  names?: ConfirmLeaseSpec['names'];
}

/**
 * **פתיחת טיוטה: one post, one transaction. #234 (SPEC-flows A2 as amended at #232).**
 *
 * Writes the `DRAFT` tenancy, the document's `TENANCY` link, the signed dates, every approved
 * mapped field, the parties, their `tenancy_party` rows and the `SIGNATORY` links, or none of them.
 * The draft no longer follows a committed approval, which is what left the 14 Oct lease fully
 * approved with no draft and nothing to press.
 *
 * The read address is not compared here. A flat that disagrees with the paper is shown on the
 * screen and does not refuse (#232); the activation gate raises it again.
 */
export async function openLeaseDraft(
  deps: LeaseDeps,
  spec: OpenLeaseDraftSpec,
): Promise<ConfirmLeaseResult> {
  const documentId = validId(spec.documentId, 'document');
  const openedBy = requireText(spec.openedBy, 'opened_by', 200);

  return inTransaction(deps.db, async (db) => {
    const { opening, resolved, day } = await openingAndPeople(
      { db, clock: deps.clock, contacts: deps.contacts },
      documentId,
    );
    if (opening.tenancyId !== null) {
      return {
        tenancyId: opening.tenancyId,
        alreadyEstablished: true,
        partiesWritten: 0,
        attached: false,
      };
    }
    const refused = opening.refusals[0];
    if (refused) {
      const [code, message] = REFUSAL_ERRORS[refused.kind];
      throw new KernelError(code, message);
    }
    const asked = spec.termsProfileName?.trim() ?? '';
    const termsProfileName =
      asked === ''
        ? opening.termsProfile
        : requireText(asked, 'terms_profile', 200);
    const profileId = termsProfileName
      ? await findTermsProfileByName(db, termsProfileName)
      : null;
    if (!profileId) {
      throw new KernelError('invalid', 'that terms profile does not exist');
    }
    if (!opening.startDate || !opening.endDate) {
      // Unreachable once the reading is ready; kept so the types say what the write needs.
      throw new KernelError('invalid', 'the lease is missing dates');
    }

    const tenancy = await upsertTenancy(db, {
      unitId: opening.unit.unit_id,
      startDate: opening.startDate,
      endDate: opening.endDate,
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

    const rows = await listExtractedFields(db, documentId);
    const promote = { db, audit: deps.audit, clock: deps.clock };
    for (const fieldKey of ['start_date', 'end_date'] as const) {
      const row = signedRow(rows, fieldKey);
      if (row) {
        await signAndPromote(promote, row, openedBy);
      }
    }

    const household = householdOf(rows);
    const partiesWritten = await writeParties(db, {
      tenancyId: tenancy.id,
      documentId,
      household,
      roles: rolesFromFieldFamily(household.people),
      stamped: stampedNameIds(rows),
      names: spec.names,
      resolved: { people: resolved, day },
    });

    await carryApprovedLease(
      { db, audit: deps.audit, clock: deps.clock },
      { documentId, promotedBy: openedBy },
    );

    await deps.audit.write(
      {
        actorKind: 'staff',
        actorId: openedBy,
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
        names: spec.names,
      });
    }
    // A lease opens through פתיחת טיוטה's command, whichever screen posted it (#234).
    return openLeaseDraft(
      { ...deps, db },
      {
        documentId,
        termsProfileName: spec.termsProfileName,
        openedBy: confirmedBy,
        names: spec.names,
      },
    );
  });
}
