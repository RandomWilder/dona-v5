// The generated register. Slice 2.6.
//
// **Volume and realness are different facts, and an index decision needs only the first.** The real
// register belongs to step 4 of the method (SPEC-flows.md) and 2.5 imports it; what 2.6 needs is
// 1,500 units in the same twenty-two columns, through the same importer, so the path under
// measurement is the path that ships. Deferring the two index questions to the pilot would have
// pushed two real decisions into month two on no reasoning a measurement supports.
//
// **It is the nine-row fixture at volume, not fifteen hundred copies of one household.** Every case
// that breaks an importer is still in the file and each of them is counted in the summary: a
// recycled number, one person under two spellings of one ת.ז., a guarantor, a company whose name
// carries a quotation mark, a unit let twice, a lease that has not started, a building with no
// project. 2.4 learned what a fixture without that coverage is worth.
//
// **Zero rejects, by construction.** A generated register that loses rows measures the generator and
// nothing else. How many rows a register loses to `one_active_tenancy_per_unit` is a fact about the
// client's data, it is measured at 2.5, and inventing a number for it here would be worse than not
// having one (SPEC-register.md).
//
// **Its own phone block and its own identifier block**, `058-4xx-xxxx` and `074…` / `514…`, which no
// other fixture and no suite uses. 2.4 learned that the hard way: a fixture reusing another suite's
// number turned thirteen tests across five files into `40P01 deadlock detected`, because two
// transactions inserting the same contact value each wait on the other's speculative insertion.
//
// **`today` is a parameter and never a clock reading**, SPEC.md's rule, and here it has a second
// job: seed *and* day are what make the file reproducible. "Leases ending in the next 60 days" is
// meaningless against a fixed date, so the entry point supplies the day and prints it.
import { REGISTER_COLUMNS } from '../internal/row.ts';

export interface GeneratedRegisterOptions {
  /** Units to produce. Rows are more: one row per party on a tenancy. */
  units: number;
  /** The day the file is generated against. `YYYY-MM-DD`, injected, never read from a clock here. */
  today: string;
  /** Same seed and same day produce the same bytes. */
  seed?: number;
  cities?: readonly string[];
  /**
   * The digit that owns this file's phone numbers and identifiers — `058-Bxx-xxxx`, `07B…`, `51B…`.
   *
   * Not decoration. `node --test` runs files in parallel against one database and a generated
   * register may be sitting in the same one, so two files sharing a block would claim the same
   * contact value on overlapping days: `contact_value_resolves_to_one_party` rejects it, and two
   * transactions racing for it deadlock on each other's speculative insertion (2.4, `40P01`).
   * **`2` is 2.4's nine-row fixture, `4` is the generated register, `7` is the generator's own
   * suite.** A new caller takes a digit nothing else uses.
   */
  block?: string;
}

export interface GeneratedRegisterSummary {
  buildings: number;
  units: number;
  tenancies: number;
  parties: number;
  rows: number;
  /** Units with a tenancy that is ACTIVE and covers `today` — what the occupancy chip must show. */
  occupiedToday: number;
  /** ACTIVE leases whose end_date falls within 60 days of `today` — Q5's row count. */
  expiringWithin60: number;
  recycledNumbers: number;
  splitIdentifiers: number;
  guarantors: number;
  companies: number;
  buildingsWithoutProject: number;
}

export interface GeneratedRegister {
  csv: string;
  summary: GeneratedRegisterSummary;
}

/** The five cities of the week-2 demo. */
export const DEMO_CITIES = [
  'שוהם',
  'בית שמש',
  'אשדוד',
  'לוד',
  'אשקלון',
] as const;

const STREETS = [
  'רקפת',
  'הדקל',
  'התמר',
  'הזית',
  'האלון',
  'נרקיס',
  'כלנית',
  'הגפן',
  'השקד',
  'הברוש',
  'אשחר',
  'דולב',
  'לילך',
  'סביון',
];

const FIRST_NAMES = [
  'דנה',
  'יואב',
  'מרים',
  'איתי',
  'אבי',
  'נור',
  'שרה',
  'עומר',
  'תמר',
  'רון',
  'ליאת',
  'אמיר',
  'הילה',
  'יעל',
  'מוחמד',
  'אולגה',
  'דוד',
  'רחל',
  'ניר',
  'סמאח',
];

const LAST_NAMES = [
  'כהן',
  'לוי',
  'מזרחי',
  'פרץ',
  'ביטון',
  'דהן',
  'אברהם',
  'חדאד',
  'פרידמן',
  'שפירא',
  'אזולאי',
  'טל',
  'בן דוד',
  'סלים',
  'קפלן',
];

// A quotation mark inside a company name is the CSV rule most exports get wrong, so the file carries
// it rather than the test asserting it in isolation.
const COMPANY_NAMES = [
  'אלפא שירותים בע"מ',
  'מעונות הדר בע"מ',
  'ש.ל. אחזקות בע"מ',
];

const PROFILES = ['נספח תחזוקה — תקן', 'נספח תחזוקה — מורחב'];
const LANGUAGES = ['he', 'he', 'he', 'he', 'ar', 'ru', 'en'];
const ROOMS = ['2.5', '3', '3.5', '4', '4.5', '5'];

/** mulberry32. Written rather than installed: "one seeded generator" is not a stated reason. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DAY_MS = 86_400_000;

function shift(iso: string, days: number): string {
  return new Date(new Date(`${iso}T00:00:00Z`).getTime() + days * DAY_MS)
    .toISOString()
    .slice(0, 10);
}

/** RFC 4180, the half a spreadsheet produces: quote when the field carries a comma or a quote. */
function field(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

const pad = (n: number, width: number): string =>
  String(n).padStart(width, '0');

interface Party {
  kind: 'PERSON' | 'COMPANY';
  /** As it is written in this file, which is not always as it is written in another row. */
  nationalId: string;
  fullName: string;
  language: string;
  phone: string;
  contactFrom: string;
  contactTo: string;
}

interface Line {
  projectCode: string;
  projectName: string;
  buildingName: string;
  addressLine: string;
  city: string;
  unitNumber: string;
  rooms: string;
  areaSqm: string;
  hasMamad: string;
  start: string;
  end: string;
  status: string;
  profile: string;
  party: Party;
  role: string;
  isServiceContact: string;
}

/**
 * A register at whatever volume is asked for, in the twenty-two columns `REGISTER_COLUMNS` declares.
 *
 * The shape is the real one: **one row per party on a tenancy**, buildings and units repeating across
 * rows and converging through their natural keys, which is what the keys added at 1.11, 2.2 and 2.4
 * are for.
 */
export function generateRegister(
  options: GeneratedRegisterOptions,
): GeneratedRegister {
  const { units: wanted, today } = options;
  const cities = options.cities ?? DEMO_CITIES;
  const random = rng(options.seed ?? 2026);
  const block = options.block ?? '4';
  if (!/^[0-9]$/.test(block)) {
    throw new Error('the register block is one digit');
  }
  const pick = <T>(from: readonly T[]): T =>
    from[Math.floor(random() * from.length)] as T;
  const between = (low: number, high: number): number =>
    low + Math.floor(random() * (high - low + 1));

  const lines: Line[] = [];
  const summary: GeneratedRegisterSummary = {
    buildings: 0,
    units: 0,
    tenancies: 0,
    parties: 0,
    rows: 0,
    occupiedToday: 0,
    expiringWithin60: 0,
    recycledNumbers: 0,
    splitIdentifiers: 0,
    guarantors: 0,
    companies: 0,
    buildingsWithoutProject: 0,
  };

  // Every party this file names, in the order it named them, so a later row can re-use one: the
  // same person on a second lease, and the recycled number that outlives its first holder.
  let partySeq = 0;
  const madeParties: Party[] = [];

  function newParty(
    from: string,
    to: string,
    asCompany: boolean,
    /** A number that outlived its last holder. See `recycles`. */
    inheritedPhone?: string,
  ): Party {
    partySeq += 1;
    summary.parties += 1;
    const phoneDigits = pad(partySeq, 6);
    // Three spellings, stable per party, because a register formatted for a spreadsheet carries all
    // three and `normalisePhone` has to converge them (SPEC-scope.md).
    const national = `058-${block}${phoneDigits.slice(0, 2)}-${phoneDigits.slice(2)}`;
    const phone =
      partySeq % 3 === 0
        ? national
        : partySeq % 3 === 1
          ? `058${block}${phoneDigits}`
          : `+972 58 ${block}${phoneDigits.slice(0, 2)} ${phoneDigits.slice(2)}`;
    if (asCompany) summary.companies += 1;
    const party: Party = {
      kind: asCompany ? 'COMPANY' : 'PERSON',
      nationalId: asCompany
        ? `51${block}${pad(partySeq, 6)}`
        : `07${block}${pad(partySeq, 6)}`,
      fullName: asCompany
        ? (COMPANY_NAMES[partySeq % COMPANY_NAMES.length] as string)
        : `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`,
      language: asCompany ? 'he' : pick(LANGUAGES),
      phone: inheritedPhone ?? phone,
      contactFrom: from,
      contactTo: to,
    };
    madeParties.push(party);
    return party;
  }

  /**
   * The same person, on a second lease, written the way a second export writes them: **the leading
   * zero gone.** `074000123` and `74000123` are one party and `national_id_key` is what says so
   * (2.4). Only ever a party whose contact is still open, and their contact keeps its original
   * dates, because one number with two validity periods is what
   * `contact_value_resolves_to_one_party` exists to reject.
   */
  function sameHumanAgain(): Party | null {
    const open = madeParties.filter(
      (party) => party.kind === 'PERSON' && party.contactTo === '',
    );
    const found = open[Math.floor(random() * open.length)];
    if (!found) return null;
    summary.splitIdentifiers += 1;
    return { ...found, nationalId: found.nationalId.replace(/^0/, '') };
  }

  /**
   * Their number, after they left. Non-overlapping by construction — the new tenancy starts at least
   * twenty days after the old one ended, and '[]' is inclusive at both ends.
   *
   * The inherited number is given to `newParty` rather than pasted onto its result, so the party
   * *recorded* is the party written. A copy would leave the register's own memory holding a number
   * this file never wrote, and the next row to re-use that person would give them a second one.
   */
  function recycles(previous: Party, from: string): Party {
    summary.recycledNumbers += 1;
    return newParty(from, '', false, previous.phone);
  }

  function peopleOn(
    start: string,
    end: string,
    open: boolean,
    // The ended tenant whose number the new one inherits, when this is a re-letting.
    inherits: Party | null,
  ): Array<{ party: Party; role: string; service: string }> {
    const to = open ? '' : end;
    const returning =
      inherits === null && open && madeParties.length > 40 && random() < 0.03
        ? sameHumanAgain()
        : null;
    const primary =
      returning ??
      (inherits
        ? recycles(inherits, start)
        : newParty(start, to, random() < 0.04));
    const on = [{ party: primary, role: 'PRIMARY_TENANT', service: 'yes' }];
    if (primary.kind === 'PERSON' && random() < 0.45) {
      on.push({
        party: newParty(start, to, false),
        role: 'CO_TENANT',
        service: 'yes',
      });
    }
    if (random() < 0.2) {
      summary.guarantors += 1;
      // Foundation rule 7, and there is no import path around it: the database refuses a guarantor
      // who is a service contact, so this file never writes one and could not if it tried.
      on.push({
        party: newParty(start, to, false),
        role: 'GUARANTOR',
        service: 'no',
      });
    }
    if (random() < 0.1) {
      on.push({
        party: newParty(start, to, false),
        role: 'OCCUPANT',
        service: 'no',
      });
    }
    return on;
  }

  let unitsLeft = wanted;
  let buildingSeq = 0;
  const usedAddresses = new Set<string>();

  while (unitsLeft > 0) {
    buildingSeq += 1;
    const size = Math.min(unitsLeft, between(18, 60));
    unitsLeft -= size;
    summary.buildings += 1;

    const city = cities[buildingSeq % cities.length] as string;
    let street = pick(STREETS);
    let number = between(1, 90);
    while (usedAddresses.has(`${city}|${street} ${number}`)) {
      street = pick(STREETS);
      number = between(1, 90);
    }
    usedAddresses.add(`${city}|${street} ${number}`);
    const addressLine = `${street} ${number}`;
    const buildingName = `בניין ${addressLine}`;
    // R15 — Project is optional, and one building in seven has none, so the register exercises the
    // nullable foreign key rather than only the populated path.
    const hasProject = buildingSeq % 7 !== 0;
    if (!hasProject) summary.buildingsWithoutProject += 1;
    const projectCode = hasProject
      ? `${city.slice(0, 3)}-${pad(buildingSeq, 3)}`
      : '';
    const projectName = hasProject ? `${city} — ${street}` : '';
    const profile = pick(PROFILES);

    for (let at = 1; at <= size; at += 1) {
      summary.units += 1;
      // A split apartment. '12A' is why unit_number is text and not a number, and why the unit grid
      // orders by the digits with the text breaking the tie (1.11).
      const unitNumber = at % 37 === 0 ? `${at}A` : String(at);
      const rooms = pick(ROOMS);
      const areaSqm = random() < 0.12 ? '' : String(between(58, 132));
      const hasMamad = random() < 0.85 ? 'yes' : 'no';

      const roll = random();
      const tenancies: Array<{
        start: string;
        end: string;
        status: string;
        open: boolean;
      }> = [];

      if (roll < 0.62) {
        // Let today, on a lease with time left on it.
        const start = shift(today, -between(1, 700));
        tenancies.push({
          start,
          end: shift(start, 730),
          status: 'ACTIVE',
          open: true,
        });
      } else if (roll < 0.68) {
        // Q5's rows: ACTIVE today and ending inside sixty days.
        const end = shift(today, between(1, 59));
        tenancies.push({
          start: shift(end, -730),
          end,
          status: 'ACTIVE',
          open: true,
        });
      } else if (roll < 0.8) {
        // Let, then vacated. The unit reads as a vacancy today and its history is still there (R5).
        const previousEnd = shift(today, -between(90, 500));
        const previousStart = shift(previousEnd, -730);
        const start = shift(previousEnd, between(20, 60));
        tenancies.push({
          start: previousStart,
          end: previousEnd,
          status: 'ENDED',
          open: false,
        });
        tenancies.push({
          start,
          end: shift(start, 730),
          status: 'ACTIVE',
          open: true,
        });
      } else if (roll < 0.92) {
        // Ended and not re-let: a vacancy the occupancy chip has to show as one.
        const end = shift(today, -between(20, 600));
        tenancies.push({
          start: shift(end, -730),
          end,
          status: 'ENDED',
          open: false,
        });
      } else {
        // Signed and not started. DRAFT is not ACTIVE, so it is a vacancy today as well.
        const start = shift(today, between(15, 120));
        tenancies.push({
          start,
          end: shift(start, 730),
          status: 'DRAFT',
          open: true,
        });
      }

      let previousPrimary: Party | null = null;
      let occupied = false;
      for (const tenancy of tenancies) {
        summary.tenancies += 1;
        const inherits =
          tenancy.status === 'ACTIVE' && previousPrimary !== null
            ? previousPrimary
            : null;
        const on = peopleOn(tenancy.start, tenancy.end, tenancy.open, inherits);
        previousPrimary = on[0]?.party ?? null;
        if (tenancy.status === 'ACTIVE') {
          occupied = true;
          if (tenancy.end <= shift(today, 60)) summary.expiringWithin60 += 1;
        }
        for (const person of on) {
          const party = person.party;
          lines.push({
            projectCode,
            projectName,
            buildingName,
            addressLine,
            city,
            unitNumber,
            rooms,
            areaSqm,
            hasMamad,
            start: tenancy.start,
            end: tenancy.end,
            status: tenancy.status,
            profile,
            party,
            role: person.role,
            isServiceContact: person.service,
          });
        }
      }
      if (occupied) summary.occupiedToday += 1;
    }
  }

  summary.rows = lines.length;
  const body = lines.map((line) =>
    [
      line.projectCode,
      line.projectName,
      line.buildingName,
      line.addressLine,
      line.city,
      line.unitNumber,
      line.rooms,
      line.areaSqm,
      line.hasMamad,
      line.start,
      line.end,
      line.status,
      line.profile,
      line.party.kind,
      line.party.nationalId,
      line.party.fullName,
      line.party.language,
      line.role,
      line.isServiceContact,
      line.party.phone,
      line.party.contactFrom,
      line.party.contactTo,
    ]
      .map(field)
      .join(','),
  );
  return {
    csv: `${[REGISTER_COLUMNS.join(','), ...body].join('\n')}\n`,
    summary,
  };
}
