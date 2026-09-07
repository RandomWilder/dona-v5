// The document-type catalogue's seed. Slice 3.1.
//
// **This is data, not a migration, and that is the whole of A8's open half made literal.** Slice
// 3.1's acceptance bar is that adding a document type with four fields of its own costs a seed row
// and a re-deploy of data — no migration. Nine types arriving in a backfill migration would make the
// tenth a migration too, and the bar would have been false the day it was written. So the catalogue
// is seeded by `npm run seed:doctypes`, which is wired into no workflow (src/seed.ts's reason).
//
// **Ten types, not eight, and the difference is deliberate.** The published Data Model names eight;
// `inspection_certificate` has been in the workbook since 3 Sep because SAFETY assets and the
// compliance tab need it. Slice 3.5 added `building_handover_protocol` as the tenth — a seed row,
// not a migration — because the unit-level protocol is operator-to-tenant and the building's
// מסירה date is developer-to-operator. The mechanism is still proved on a type that is *not* in
// the seed, added inside a test.
//
// **The fields are the extraction target list and not where answers land** (SPEC-flows.md invariant
// 3). They are declared for the types week 4's comprehension reads first — lease and lease_amendment
// are certain, given flows A2 and A3, and handover_protocol is slice 3.5's source. The others carry
// their guard terms and no fields yet: a type with no declaration is fileable and searchable, which
// is the open half working, and its fields are appended as a new `effective_from` row when the
// concept work reaches it. **Not one of them is a money field, and there is no MONEY value type.**
//
// **`verificationTerms` is the only input slice 3.3's guard has.** The terms are the fixed printed
// language of the form — the phrasing that is on every copy regardless of who signed it — taken from
// the tier-1 specimens in docs/corpus/, which are authored to the published forms' structure. A term
// that is on one household's lease and not the next one's would make the guard fail for weather.
import type {
  DocumentTypeFieldSpec,
  DocumentTypeSpec,
} from '../internal/catalogue.ts';

/** A type, plus the fields it declares. The field specs carry no `documentTypeId` until the seed
 * has the id of the type it just upserted. */
export interface SeedDocumentType {
  type: DocumentTypeSpec;
  fields: Omit<DocumentTypeFieldSpec, 'documentTypeId'>[];
}

// The version every seeded declaration opens at. It is the date the catalogue was first seeded, and
// it is a constant rather than "today" for the reason every date in this system is injected: a seed
// re-run tomorrow must produce the same rows, and `effective_from` is half the natural key. A
// corrected declaration is a new row at a new date, never an edit to this one (R18).
const SCHEMA_V1 = '2026-09-07';

function field(
  fieldKey: string,
  labelHe: string,
  valueType: DocumentTypeFieldSpec['valueType'],
  isRequired: boolean,
  extractionHint: string | null,
): Omit<DocumentTypeFieldSpec, 'documentTypeId'> {
  return {
    fieldKey,
    labelHe,
    valueType,
    isRequired,
    extractionHint,
    effectiveFrom: SCHEMA_V1,
    effectiveTo: null,
  };
}

export const seedDocumentTypes: SeedDocumentType[] = [
  {
    type: {
      typeKey: 'lease',
      labelHe: 'חוזה שכירות',
      labelEn: 'Lease',
      verificationTerms: ['חוזה שכירות', 'המושכר', 'תקופת השכירות'],
      isActive: true,
    },
    // Flow A2's proposal is built out of these: unit, dates, and the tenants named on the lease.
    // `guarantor_name` is **not required**, and that is invariant 5 written into the schema — a
    // lease commonly names no guarantor and extraction returning zero of them is a correct result,
    // not an error and not a retry.
    fields: [
      field('start_date', 'תחילת תקופת השכירות', 'DATE', true, 'תקופת השכירות'),
      field('end_date', 'סיום תקופת השכירות', 'DATE', true, 'תקופת השכירות'),
      field('apartment_number', 'מספר הדירה', 'TEXT', true, 'המושכר'),
      field('address', 'כתובת המושכר', 'TEXT', true, 'המושכר'),
      field('tenant_name', 'שם השוכר', 'TEXT', true, 'השוכר'),
      field('guarantor_name', 'שם הערב', 'TEXT', false, 'ערב'),
    ],
  },
  {
    type: {
      typeKey: 'lease_amendment',
      labelHe: 'נספח לחוזה שכירות',
      labelEn: 'Lease amendment',
      verificationTerms: ['נספח', 'לחוזה השכירות'],
      isActive: true,
    },
    // Flow A3. The same path as A2 with no special case: an addendum contributes values to the
    // tenancy, each carrying its own provenance, rather than patching the lease document.
    fields: [
      field('effective_date', 'מועד תחילת הנספח', 'DATE', true, 'תוקף'),
      field('guarantor_name', 'שם הערב', 'TEXT', false, 'ערב'),
      field('new_end_date', 'מועד סיום מעודכן', 'DATE', false, 'תקופת השכירות'),
    ],
  },
  {
    type: {
      typeKey: 'termination_notice',
      labelHe: 'הודעת סיום שכירות',
      labelEn: 'Termination notice',
      verificationTerms: ['הודעה', 'סיום'],
      isActive: true,
    },
    fields: [],
  },
  {
    type: {
      typeKey: 'arnona',
      labelHe: 'ארנונה',
      labelEn: 'Municipal tax bill',
      verificationTerms: ['ארנונה', 'המחזיק', 'הרשות המקומית'],
      isActive: true,
    },
    // No amount, deliberately, and the bill is the document where the temptation is sharpest. READ
    // ME rule 3 and foundation rule 2: an amount printed on a page is capturable in principle and is
    // never business truth and never quoted to a tenant. `value_type` has no MONEY member to
    // declare one with.
    fields: [],
  },
  {
    type: {
      typeKey: 'insurance',
      labelHe: 'אישור קיום ביטוחים',
      labelEn: 'Certificate of insurance',
      verificationTerms: ['אישור קיום ביטוחים', 'המבטח'],
      isActive: true,
    },
    // `valid_from` / `valid_to` on the document row are what answer "which certificate is the
    // current one" — the one whose window covers today. That is why E12 needs no `superseded_by`.
    fields: [],
  },
  {
    type: {
      typeKey: 'id',
      labelHe: 'תעודת זהות',
      labelEn: 'Identity document',
      verificationTerms: ['תעודת זהות'],
      isActive: true,
    },
    // **No fields, and this is the one type where that is a rule rather than a schedule.**
    // `national_id` is admin-only, unreachable by any agent tool and access-logged (SPEC.md), and a
    // declared `id_number` field would put it on the capture path, where it is citable and
    // searchable by design. If this type ever declares fields, the policy suite decides which.
    fields: [],
  },
  {
    type: {
      typeKey: 'bank_guarantee',
      labelHe: 'ערבות בנקאית',
      labelEn: 'Bank guarantee',
      // **Corrected at 3.3, for the same reason `handover_protocol`'s were.** These were
      // `['ערבות', 'אוטונומית', 'הבנק']`. The specimen never says הבנק — a guarantee is written in
      // the bank's own voice, *אנו ערבים* — and the first two are both in the lease's clause 14,
      // which requires the guarantee. The terms that separate are the ones only the instrument
      // itself carries: it *is* a כתב ערבות, and בלתי מותנית is what makes it autonomous.
      verificationTerms: ['כתב ערבות', 'אוטונומית', 'בלתי מותנית'],
      isActive: true,
    },
    // No amount here either — the specimen in docs/corpus/ says so in as many words, and for the
    // same reason: the guaranteed sum is a commercial figure and rule 2 keeps it off the substrate
    // the agent is measured against.
    fields: [],
  },
  {
    type: {
      typeKey: 'handover_protocol',
      labelHe: 'פרוטוקול מסירה',
      labelEn: 'Handover protocol',
      // **Corrected at 3.3, and the correction is the guard doing its job before it shipped.** These
      // were `['פרוטוקול מסירה', 'מצב המושכר']`, written from the form's *name* rather than from a
      // document, and neither term separates: the specimen is headed פרוטוקול מסירת דירה, so the
      // first appears nowhere in it, and the second is in the standard lease's clause 6, which
      // refers to the protocol. The lease would have been refused as a protocol for the right
      // reason and the protocol refused as itself for the wrong one. A meter reading is what a
      // handover protocol has and a lease does not.
      verificationTerms: ['פרוטוקול', 'מצב המושכר', 'מונה מים'],
      isActive: true,
    },
    // Slice 3.5 reads these. `handover_date` is the fact that dates the *flat* (R14's override on
    // `unit.warranty_end_date`). The building's מסירה date is a different act and a different
    // type — `building_handover_protocol` below — because operator-to-tenant is not
    // developer-to-operator.
    fields: [
      field('handover_date', 'מועד המסירה', 'DATE', true, 'מועד המסירה'),
      field('apartment_number', 'מספר הדירה', 'TEXT', true, 'המושכר'),
    ],
  },
  {
    type: {
      typeKey: 'building_handover_protocol',
      labelHe: 'פרוטוקול מסירת בניין',
      labelEn: 'Building handover protocol',
      // Three terms that a unit-level protocol and a lease both lack: this is the developer
      // handing the *building* to the operator, so מסירת הבניין, מהיזם and מערכות הבניין are
      // the printed language that separates it. Slice 3.3's lesson — terms from the document,
      // not from the form's name — applied on the first type added after that lesson.
      verificationTerms: ['מסירת הבניין', 'מהיזם', 'מערכות הבניין'],
      isActive: true,
    },
    // The field that discharges week 2's carried item: every register-imported building currently
    // shows a מסירה date that is one of its leases' start dates.
    fields: [
      field('handover_date', 'מועד המסירה', 'DATE', true, 'מועד המסירה'),
    ],
  },
  {
    type: {
      typeKey: 'inspection_certificate',
      labelHe: 'תעודת בדיקה',
      labelEn: 'Inspection certificate',
      verificationTerms: ['תעודת בדיקה', 'בודק מוסמך'],
      isActive: true,
    },
    // The ninth. Not in the published Data Model's eight; in the workbook since 3 Sep, because a
    // SAFETY asset's compliance regime is a question about the date of its last certificate.
    fields: [],
  },
];
