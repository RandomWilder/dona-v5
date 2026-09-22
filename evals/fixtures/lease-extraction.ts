// Ground truth for lease extraction: what a perfect reader would return from two
// specimen leases, keyed by hand from the pages themselves.
//
// **This is an instrument, not a seed.** `document-types.ts` declares what the
// catalogue asks for; this file records what the paper actually says, so the two
// can be compared and a number falls out. Until it existed there was no way to
// answer "how accurate is extraction" except by looking at a screen and forming an
// impression, and an impression does not regress-test. Nothing here is written to a
// database and nothing imports it at run time.
//
// **Why hand-keyed rather than captured from a run.** A fixture built from the
// extractor's own output measures nothing: it agrees with whatever the extractor did
// on the day it was recorded, including the day it was wrong. Every value below was
// read off the page by a human-equivalent pass and cross-checked against a second
// occurrence on a different page wherever the form prints one.
//
// **No real person.** Both specimens are synthetic documents the director supplied on
// 21 Sep 2026, authored to look like the real Beit Shemesh free-market form so the
// reading work had something real-shaped to run against. The names, passport numbers,
// ת.ז., emails and phone numbers below are invented. `specimen-clauses.test.ts` makes
// that promise something CI reads for `docs/corpus/`; this file carries the same
// promise in prose because it is data rather than a loader, and if a value here ever
// turns out to name somebody real it comes out of the repository the same day.
//
// **Two documents is a sample of two.** The field list these leases support is
// provisional and stays provisional. See the header note in `document-types.ts` on
// why a declaration is a seed row: a third specimen that disagrees should cost a row
// here and a row there, never a migration.

/** Which store a value would land in, if anything deterministic read it. */
export type Declaration =
  /** `document_type_field` declares this key today (`lease`, current window). */
  | 'declared'
  /** The paper prints it, nothing declares it. A candidate, not a defect. */
  | 'undeclared';

/** How a person proved who they are. Per value, never per document — see `bloch`. */
export type IdentifierKind = 'passport' | 'national_id';

export interface GroundTruthValue {
  /** `document_type_field.field_key`, or the key a candidate would take. */
  fieldKey: string;
  /**
   * The value as the store would hold it: `NUMBER` with separators and symbol
   * stripped (ADR-0008 §5), `DATE` as ISO `YYYY-MM-DD`, everything else verbatim.
   */
  value: string;
  /**
   * The same span exactly as printed, separators and symbol included.
   *
   * **This is the column `extracted_field` does not have**, and the reason it is
   * recorded here: a text panel that highlights a citation has to find the span in
   * `document_passage.body`, and `body` says `9,300 ₪` where `value` says `9300`.
   * Nothing joins the two today. Null where the printed form and the stored form
   * are the same string.
   */
  printed: string | null;
  /** 1-based index into the PDF — what `extracted_field.page` counts. */
  pdfPage: number;
  /**
   * The number printed in the page footer — what a citation shows a human.
   *
   * These two agree in `pinchot` and are off by one in `bloch`, whose first PDF page
   * is a different document with no footer at all. A citation that shows the PDF
   * index to an operator holding the paper sends them to the wrong page.
   */
  printedPage: number | null;
  declaration: Declaration;
  /** Set on an identifier value only. */
  identifierKind?: IdentifierKind;
  /** Why this value is here at all, where the page alone does not make it obvious. */
  note?: string;
}

export interface AbsentValue {
  fieldKey: string;
  /**
   * **A correct absence, not a miss.** Scoring must credit it. `guarantor_name` is
   * not required precisely because a lease commonly names none, and in `bloch` the
   * absence is a purchased term rather than an omission — the election on PDF page 1
   * traded the guarantors for a third month of deposit.
   */
  reason: string;
}

/** An identity the paper asserts about its own numbers. Free validation. */
export interface ArithmeticCheck {
  /** Field keys, in the order the expression multiplies them. */
  operands: readonly string[];
  multiplier: number;
  /** The field key whose value the product must equal. */
  equals: string;
  product: number;
  note?: string;
}

/** Something about the file that will cost a reader accuracy. Not a field. */
export interface Hazard {
  /** Where it bites: `layout`, `routing`, `normalisation`, `scan`, `identity`. */
  kind: 'layout' | 'routing' | 'normalisation' | 'scan' | 'identity';
  pdfPage: number | null;
  what: string;
}

export interface GroundTruthDocument {
  /** Short name, used in a failure line. */
  key: string;
  /** The flat this lease lets, as the tender numbers it. */
  letting: string;
  typeKey: string;
  pdfPages: number;
  /**
   * How many PDF pages precede printed page 1. Zero for an ordinary lease; one for
   * a file that carries another document in front of the lease.
   */
  frontMatterPages: number;
  values: readonly GroundTruthValue[];
  absent: readonly AbsentValue[];
  arithmetic: readonly ArithmeticCheck[];
  /**
   * The typed building this lease is filed against. Parcel keys are scored against this
   * side, not as a promotion. Absent when the fixture has no building to check.
   */
  typedBuilding?: {
    gush: string;
    helka: string;
    building_number: string;
  };
  hazards: readonly Hazard[];
}

const beitShemesh206 = {
  gush: '80031',
  helka: '43, 46',
  building_number: '206',
} as const;

// ---------------------------------------------------------------------------
// Specimen 1 — 206-4, Pinchot. 37 pages, one document, clean flatbed scan.
// ---------------------------------------------------------------------------

const pinchot: GroundTruthDocument = {
  key: 'pinchot-206-4',
  letting: 'בית שמש · בניין 206 · דירה 4',
  typeKey: 'lease',
  pdfPages: 37,
  frontMatterPages: 0,
  typedBuilding: beitShemesh206,
  values: [
    // --- the letting itself. All of it is on נספח א', none of it in the body. ---
    {
      fieldKey: 'apartment_number',
      value: '4',
      printed: "דירה מס' 4",
      pdfPage: 13,
      printedPage: 13,
      declaration: 'declared',
    },
    {
      fieldKey: 'address',
      value: 'הרב קוק 52, בית שמש',
      printed: 'ברחוב הרב קוק 52',
      pdfPage: 13,
      printedPage: 13,
      declaration: 'declared',
      note: 'The city is on PDF page 1 and not on נספח א׳. The address is assembled from two pages, which is why a single-page read gets a street with no city.',
    },
    {
      fieldKey: 'rooms',
      value: '5',
      printed: 'בת 5 חדרים',
      pdfPage: 13,
      printedPage: 13,
      declaration: 'declared',
    },
    {
      fieldKey: 'floor',
      value: '1',
      printed: '1 בקומה',
      pdfPage: 13,
      printedPage: 13,
      declaration: 'declared',
    },
    {
      fieldKey: 'building_number',
      value: '206',
      printed: "בניין מס' 206",
      pdfPage: 13,
      printedPage: 13,
      declaration: 'declared',
      note: 'The key EXTRACT_INSTRUCTIONS spends a sentence telling the model NOT to put in apartment_number. Declaring it gives the number somewhere correct to go.',
    },
    {
      fieldKey: 'parking_space_number',
      value: '594',
      printed: 'חניה שמספרה 594',
      pdfPage: 13,
      printedPage: 13,
      declaration: 'undeclared',
      note: 'Assigned to the tenancy and reassignable by the landlord at will — permanently, per the second starred clause on this page. It is not a property of the flat.',
    },
    {
      fieldKey: 'has_storage',
      value: 'true',
      printed: 'מחסן צמוד מהמרפסת, כמסומן בתכניות',
      pdfPage: 13,
      printedPage: 13,
      declaration: 'declared',
      note: 'A storage room with NO number. `bloch` numbers its own. This pair is the whole argument for a boolean beside a nullable number rather than one number field.',
    },

    // --- the term. The body defers all of it to נספח א׳. ---
    {
      fieldKey: 'start_date',
      value: '2025-08-15',
      printed: '15/08/2025',
      pdfPage: 13,
      printedPage: 13,
      declaration: 'declared',
    },
    {
      fieldKey: 'end_date',
      value: '2030-08-14',
      printed: '14/08/2030',
      pdfPage: 13,
      printedPage: 13,
      declaration: 'declared',
      note: 'The ORIGINAL term. The option period below ends 14/08/2035 and a reader that takes the later date writes a tenancy five years too long.',
    },
    {
      fieldKey: 'option_end_date',
      value: '2035-08-14',
      printed: '14/08/2035',
      pdfPage: 13,
      printedPage: 13,
      declaration: 'declared',
      note: 'תקופת השכירות הנוספת. Not exercised — a right, not a term. Capturing it is what stops it contaminating end_date.',
    },

    // --- money. Four amounts on two pages, all runs of digits. ---
    {
      fieldKey: 'rent_amount',
      value: '9300',
      printed: '9,300 ₪',
      pdfPage: 13,
      printedPage: 13,
      declaration: 'declared',
    },
    {
      fieldKey: 'rent_currency',
      value: 'ILS',
      printed: '₪',
      pdfPage: 13,
      printedPage: 13,
      declaration: 'declared',
    },
    {
      fieldKey: 'maintenance_amount',
      value: '635',
      printed: '635 ₪',
      pdfPage: 13,
      printedPage: 13,
      declaration: 'declared',
      note: 'דמי אחזקה, VAT included per the clause. A second recurring monthly charge the tenant owes. Both specimens print one.',
    },
    {
      fieldKey: 'maintenance_currency',
      value: 'ILS',
      printed: '₪',
      pdfPage: 13,
      printedPage: 13,
      declaration: 'declared',
    },
    {
      fieldKey: 'deposit_amount',
      value: '19870',
      printed: '19,870 ₪',
      pdfPage: 14,
      printedPage: 14,
      declaration: 'declared',
    },
    {
      fieldKey: 'deposit_currency',
      value: 'ILS',
      printed: '₪',
      pdfPage: 14,
      printedPage: 14,
      declaration: 'declared',
    },
    {
      fieldKey: 'deposit_months',
      value: '2',
      printed: null,
      pdfPage: 14,
      printedPage: 14,
      declaration: 'declared',
      note: 'NOT printed anywhere in this file. Derived from 19,870 ÷ (9,300 + 635). `bloch` prints its own multiplier on a separate document. Recorded so the arithmetic check below has a parameter instead of a hard-coded 2.',
    },
    {
      fieldKey: 'promissory_note_amount',
      value: '59610',
      printed: '59,610 ₪',
      pdfPage: 14,
      printedPage: 14,
      declaration: 'declared',
      note: 'Printed twice — §12 here and again in the note itself on page 20. A second occurrence is free corroboration and nothing uses it.',
    },
    {
      fieldKey: 'promissory_note_currency',
      value: 'ILS',
      printed: 'ש"ח',
      pdfPage: 20,
      printedPage: 20,
      declaration: 'declared',
      note: 'Spelled ₪ on page 14 and ש"ח on page 20. Same currency, two glyphs.',
    },

    // --- the household. Two tenants, both on passports. ---
    {
      fieldKey: 'main_tenant_name',
      value: 'Rami Meir Pinchot',
      printed: 'Rami Meir Pinchot',
      pdfPage: 1,
      printedPage: 1,
      declaration: 'declared',
      note: 'Latin script inside an RTL document. Printed again on page 20 as a maker of the note. Named by role so the passport below cannot land on Ariella.',
    },
    {
      fieldKey: 'main_tenant_id_number',
      value: 'A36688170',
      printed: 'דרכון מספר A36688170',
      pdfPage: 1,
      printedPage: 1,
      declaration: 'declared',
      identifierKind: 'passport',
      note: 'Leading letter. Any check shaped like a nine-digit ת.ז. rejects it.',
    },
    {
      fieldKey: 'second_tenant_name',
      value: 'Ariella Atkin',
      printed: 'Ariella Atkin',
      pdfPage: 1,
      printedPage: 1,
      declaration: 'declared',
      note: 'Paired with her identifier by the declaration, not by proximity.',
    },
    {
      fieldKey: 'second_tenant_id_number',
      value: '531081473',
      printed: 'דרכון מספר 531081473',
      pdfPage: 1,
      printedPage: 1,
      declaration: 'declared',
      identifierKind: 'passport',
      note: 'Nine digits, and still a passport. The digits do not tell you the kind; the Hebrew label beside them does.',
    },
    {
      fieldKey: 'guarantor_name',
      value: 'יונתן עטקין',
      printed: 'יונתן עטקין',
      pdfPage: 20,
      printedPage: 20,
      declaration: 'declared',
      note: 'Seven pages after the household, inside ערבות אוואל on the note. Nothing in the body names a guarantor at all.',
    },
    {
      fieldKey: 'guarantor_id_number',
      value: '332401959',
      printed: '332401959',
      pdfPage: 20,
      printedPage: 20,
      declaration: 'declared',
      identifierKind: 'national_id',
      note: 'ת.ז. — a third identifier kind in a document whose tenants both hold passports.',
    },

    // --- provenance of the paper itself. ---
    {
      fieldKey: 'signed_date',
      value: '2025-05-12',
      printed: '12 לחודש 5 שנת 2025',
      pdfPage: 1,
      printedPage: 1,
      declaration: 'declared',
      note: 'Handwritten into printed blanks, day and month in separate boxes. Not a date string anywhere on the page.',
    },
    {
      fieldKey: 'index_base_month',
      value: '2025-03',
      printed: 'מדד חודש מרץ 2025',
      pdfPage: 20,
      printedPage: 20,
      declaration: 'undeclared',
      note: 'Hebrew month name, no day. The one place ISO_DATE_HINT would be actively wrong.',
    },
    {
      fieldKey: 'index_publication_date',
      value: '2025-04-15',
      printed: 'פורסם ב-15 לחודש אפריל שנת 2025',
      pdfPage: 20,
      printedPage: 20,
      declaration: 'undeclared',
    },
    {
      fieldKey: 'gush',
      value: '80031',
      printed: 'גוש 80031',
      pdfPage: 13,
      printedPage: 13,
      declaration: 'declared',
    },
    {
      fieldKey: 'helka',
      value: '43,46',
      printed: 'חלקות 43, 46',
      pdfPage: 13,
      printedPage: 13,
      declaration: 'declared',
      note: 'Two parcels, one field. Printed as a list, and the list is not ordered the same way on every page.',
    },
    {
      fieldKey: 'apartment_type',
      value: 'BG',
      printed: "BG 5 חד'",
      pdfPage: 21,
      printedPage: 21,
      declaration: 'declared',
      note: 'From the title block of the plan drawing. `bloch` is type B1. This is a drawing, not prose — no text layer worth reading, and the words sit in table cells.',
    },
  ],
  absent: [
    {
      fieldKey: 'storage_space_number',
      reason:
        'A storage room with no number. The clause names a מחסן and does not number it.',
    },
  ],
  arithmetic: [
    {
      operands: ['rent_amount', 'maintenance_amount'],
      multiplier: 2,
      equals: 'deposit_amount',
      product: 19870,
      note: '(9300 + 635) × 2. Holds exactly.',
    },
    {
      operands: ['rent_amount', 'maintenance_amount'],
      multiplier: 6,
      equals: 'promissory_note_amount',
      product: 59610,
      note: '(9300 + 635) × 6. Holds exactly, and ×6 is the one multiplier both specimens share.',
    },
  ],
  hazards: [
    {
      kind: 'routing',
      pdfPage: 3,
      what: 'The body clause on the term carries a worked example with its own dates. It is an illustration, and it is the first thing on the page matching תקופת השכירות. נספח א׳ on page 13 is what governs.',
    },
    {
      kind: 'layout',
      pdfPage: 13,
      what: 'נספח א׳ is a two-column table: clause label on the right, value block on the left. The label→value pairing is positional and survives only if the reader gets geometry. Serialised as a flat word list, every value on this page loses the label that names it.',
    },
    {
      kind: 'identity',
      pdfPage: 1,
      what: 'Latin-script names and a Latin-script address inside an RTL document. Reading order flips mid-line.',
    },
    {
      kind: 'normalisation',
      pdfPage: 13,
      what: 'Every amount is printed twice on its own line — once in digits, once spelled out in Hebrew words (תשעת אלפים שלוש מאות). Two spans, one value.',
    },
  ],
};

// ---------------------------------------------------------------------------
// Specimen 2 — 206-7, Bloch. 38 pages, TWO documents, phone scan.
// ---------------------------------------------------------------------------

const bloch: GroundTruthDocument = {
  key: 'bloch-206-7',
  letting: 'בית שמש · בניין 206 · דירה 7',
  typeKey: 'lease',
  pdfPages: 38,
  frontMatterPages: 1,
  typedBuilding: beitShemesh206,
  values: [
    // --- PDF page 1: not the lease. A signed election, and the only page that
    //     explains why this letting's deposit is what it is. ---
    {
      fieldKey: 'security_structure',
      value: 'enlarged_deposit_no_guarantors',
      printed:
        'פיקדון מזומן בסכום השווה לשלושה חודשי דמי שכירות, בתוספת שלושה חודשי דמי אחזקה ... על שטר חוב ללא ערבים',
      pdfPage: 1,
      printedPage: null,
      declaration: 'undeclared',
      note: 'Option (1) of two, elected and signed. This is a `security_election` document bound into the same PDF as the lease — a different document_type, sharing one file_hash, which `document` cannot represent.',
    },
    {
      fieldKey: 'deposit_months',
      value: '3',
      printed: 'לשלושה חודשי דמי שכירות',
      pdfPage: 1,
      printedPage: null,
      declaration: 'declared',
      note: 'THE reason this fixture exists. `pinchot` is 2 and this is 3, and the multiplier is printed on a page that is not the lease. A deposit check hard-coded at 2 flags this correct lease as wrong.',
    },
    {
      fieldKey: 'signed_date',
      value: '2025-05-19',
      printed: '19/5/2025',
      pdfPage: 1,
      printedPage: null,
      declaration: 'declared',
      note: 'The election form is dated the same day as the lease. Handwritten, slashed, no leading zeros.',
    },

    // --- the letting. Printed page 13, PDF page 14. ---
    {
      fieldKey: 'apartment_number',
      value: '7',
      printed: "דירה מס' 7",
      pdfPage: 14,
      printedPage: 13,
      declaration: 'declared',
    },
    {
      fieldKey: 'address',
      value: 'הרב קוק 52, בית שמש',
      printed: 'ברחוב הרב קוק 52',
      pdfPage: 14,
      printedPage: 13,
      declaration: 'declared',
    },
    {
      fieldKey: 'rooms',
      value: '5',
      printed: 'בת 5 חדרים',
      pdfPage: 14,
      printedPage: 13,
      declaration: 'declared',
    },
    {
      fieldKey: 'floor',
      value: '2',
      printed: '2 בקומה',
      pdfPage: 14,
      printedPage: 13,
      declaration: 'declared',
    },
    {
      fieldKey: 'building_number',
      value: '206',
      printed: "בניין מס' 206",
      pdfPage: 14,
      printedPage: 13,
      declaration: 'declared',
    },
    {
      fieldKey: 'parking_space_number',
      value: '574',
      printed: 'חניה שמספרה 574',
      pdfPage: 14,
      printedPage: 13,
      declaration: 'undeclared',
    },
    {
      fieldKey: 'has_storage',
      value: 'true',
      printed: 'מחסן שמספרו 601',
      pdfPage: 14,
      printedPage: 13,
      declaration: 'declared',
    },
    {
      fieldKey: 'storage_space_number',
      value: '601',
      printed: 'מחסן שמספרו 601',
      pdfPage: 14,
      printedPage: 13,
      declaration: 'declared',
      note: 'Numbered here, unnumbered in `pinchot`. Same form, same building, same month. The field is nullable or it is wrong half the time.',
    },
    {
      fieldKey: 'gush',
      value: '80031',
      printed: 'גוש 80031',
      pdfPage: 14,
      printedPage: 13,
      declaration: 'declared',
    },
    {
      fieldKey: 'helka',
      value: '43,46',
      printed: 'חלקות 43, 46',
      pdfPage: 14,
      printedPage: 13,
      declaration: 'declared',
      note: 'Same two parcels as `pinchot`. Printed order varies by page; the scorer compares sets.',
    },
    {
      fieldKey: 'apartment_type',
      value: 'B1',
      printed: 'B1',
      pdfPage: 22,
      printedPage: 21,
      declaration: 'declared',
      note: 'Title block of the plan drawing, as on `pinchot`. A drawing, not prose.',
    },

    // --- the term. Identical to `pinchot` — it is a tender-level constant. ---
    {
      fieldKey: 'start_date',
      value: '2025-08-15',
      printed: '15/08/2025',
      pdfPage: 14,
      printedPage: 13,
      declaration: 'declared',
    },
    {
      fieldKey: 'end_date',
      value: '2030-08-14',
      printed: '14/08/2030',
      pdfPage: 14,
      printedPage: 13,
      declaration: 'declared',
    },
    {
      fieldKey: 'option_end_date',
      value: '2035-08-14',
      printed: '14/08/2035',
      pdfPage: 14,
      printedPage: 13,
      declaration: 'declared',
    },

    // --- money. Different figures, same structure. ---
    {
      fieldKey: 'rent_amount',
      value: '8000',
      printed: '8,000 ₪',
      pdfPage: 14,
      printedPage: 13,
      declaration: 'declared',
    },
    {
      fieldKey: 'rent_currency',
      value: 'ILS',
      printed: '₪',
      pdfPage: 14,
      printedPage: 13,
      declaration: 'declared',
    },
    {
      fieldKey: 'maintenance_amount',
      value: '628',
      printed: '628 ₪',
      pdfPage: 14,
      printedPage: 13,
      declaration: 'declared',
    },
    {
      fieldKey: 'maintenance_currency',
      value: 'ILS',
      printed: '₪',
      pdfPage: 14,
      printedPage: 13,
      declaration: 'declared',
    },
    {
      fieldKey: 'deposit_amount',
      value: '25884',
      printed: '25,884 ₪',
      pdfPage: 15,
      printedPage: 14,
      declaration: 'declared',
    },
    {
      fieldKey: 'deposit_currency',
      value: 'ILS',
      printed: '₪',
      pdfPage: 15,
      printedPage: 14,
      declaration: 'declared',
    },
    {
      fieldKey: 'promissory_note_amount',
      value: '51768',
      printed: '51,768 ₪',
      pdfPage: 15,
      printedPage: 14,
      declaration: 'declared',
    },
    {
      fieldKey: 'promissory_note_currency',
      value: 'ILS',
      printed: 'ש"ח',
      pdfPage: 21,
      printedPage: 20,
      declaration: 'declared',
    },

    // --- the household. Two tenants, TWO DIFFERENT identifier kinds. ---
    {
      fieldKey: 'main_tenant_name',
      value: 'Yitzchok Shmuel Bloch',
      printed: 'Yitzchok Shmuel Bloch',
      pdfPage: 2,
      printedPage: 1,
      declaration: 'declared',
    },
    {
      fieldKey: 'main_tenant_id_number',
      value: '571643211',
      printed: 'דרכון מספר 571643211',
      pdfPage: 2,
      printedPage: 1,
      declaration: 'declared',
      identifierKind: 'passport',
    },
    {
      fieldKey: 'second_tenant_name',
      value: 'דבורה בלאך (בן זקרי)',
      printed: 'דבורה בלאך (בן זקרי)',
      pdfPage: 2,
      printedPage: 1,
      declaration: 'declared',
      note: 'A maiden name in parentheses, inside the name. Not a second party, not an annotation — part of the printed name, and it must survive into `party.full_name` intact or the two spellings stop matching.',
    },
    {
      fieldKey: 'second_tenant_id_number',
      value: '204893143',
      printed: 'ת.ז. 204893143',
      pdfPage: 2,
      printedPage: 1,
      declaration: 'declared',
      identifierKind: 'national_id',
      note: 'THE finding. A ת.ז. and a passport on one letting, one line apart. `identifierKind` is a property of the value and cannot be a property of the document or of the tenancy.',
    },
  ],
  absent: [
    {
      fieldKey: 'guarantor_name',
      reason:
        'No guarantor exists. The note on PDF page 21 ends at חתימת עושה השטר with no ערבות אוואל section at all, because the election on PDF page 1 bought the guarantors out with a third month of deposit. Zero guarantors is the correct answer AND the tenancy is complete — a completeness flag raised here would be a false alarm with its own evidence sitting on page 1.',
    },
    {
      fieldKey: 'guarantor_id_number',
      reason: 'Same. No guarantor, so no identifier.',
    },
  ],
  arithmetic: [
    {
      operands: ['rent_amount', 'maintenance_amount'],
      multiplier: 3,
      equals: 'deposit_amount',
      product: 25884,
      note: '(8000 + 628) × 3. Holds exactly — and the 3 comes from PDF page 1, not from this page.',
    },
    {
      operands: ['rent_amount', 'maintenance_amount'],
      multiplier: 6,
      equals: 'promissory_note_amount',
      product: 51768,
      note: '(8000 + 628) × 6. Holds exactly. ×6 held in both specimens with no election involved, so the note multiplier is a form constant and the deposit multiplier is not.',
    },
  ],
  hazards: [
    {
      kind: 'routing',
      pdfPage: 1,
      what: 'The first page is a different document type. A reader told "this is a lease" and handed all 38 pages will read an election form as lease prose, and the type guard on `verificationTerms` passes anyway because pages 2-38 carry every marker term.',
    },
    {
      kind: 'routing',
      pdfPage: null,
      what: 'PDF index and printed page number differ by one throughout. `extracted_field.page` counts the first; a citation an operator can follow needs the second.',
    },
    {
      kind: 'scan',
      pdfPage: null,
      what: 'Photographed with CamScanner, not scanned flat: skew, black borders, a watermark strip on every page, and page 21 rotated. `pinchot` is a clean flatbed scan of the same form in the same month, so OCR confidence is not uniform across one building let alone the portfolio.',
    },
    {
      kind: 'normalisation',
      pdfPage: 2,
      what: 'The signing date is handwritten with an ENGLISH month name (19 / May / 2025) into a Hebrew form. `pinchot` has a digit in the same blank.',
    },
    {
      kind: 'normalisation',
      pdfPage: 21,
      what: "The note's own date blanks are left empty — only the preprinted 2025 is there. An unfilled blank is not a missing read.",
    },
    {
      kind: 'layout',
      pdfPage: 14,
      what: 'Same two-column נספח א׳ as `pinchot`, and the same loss when geometry is stripped.',
    },
  ],
};

/**
 * A disagreement the paper has with itself, in BOTH specimens identically.
 *
 * The body names מגרש 212 א and the plan's title block names מגרש 215/A. Two
 * specimens from two households agree on the disagreement, so it is a property of
 * the form rather than a typo, and a reader that "resolves" it is inventing.
 * Recorded here and deliberately not given a `fieldKey`: there is no right answer
 * to score against.
 */
export const knownConflicts = [
  {
    subject: 'plot',
    inBody: '212 א',
    inPlan: '215/A',
    documents: ['pinchot-206-4', 'bloch-206-7'],
  },
] as const;

export const leaseGroundTruth: readonly GroundTruthDocument[] = [
  pinchot,
  bloch,
];

/**
 * Field keys the paper prints in at least one specimen and the catalogue does not
 * declare. **This is the candidate list**, derived rather than typed, so it cannot
 * drift from the values above.
 *
 * Every one of these costs a seed row at a new `effective_from`, not a migration
 * (A8, R18). `field_promotion` is the separate and governed question of whether
 * anything deterministic may then read one. Place facts declared at #144 have no mapping.
 */
export const undeclaredFieldKeys: readonly string[] = [
  ...new Set(
    leaseGroundTruth.flatMap((doc) =>
      doc.values
        .filter((value) => value.declaration === 'undeclared')
        .map((value) => value.fieldKey),
    ),
  ),
].sort();
