// The corpus a retrieval or grounding case is graded against, until there is a
// real one.
//
// **Authored, not lifted.** The דירה להשכיר specimen documents are slice 1.12's
// (SPEC.md, "The corpus, in three tiers"), and the ingestion path that would
// chunk them is week 3's. These nine passages exist so that the harness has
// something real to rank *today* -- real Hebrew, real legal register, clause
// references spelled the way a citation is spelled -- and they are replaced by
// the specimens the day both exist. Nothing here describes a real person, a
// real building or a real tenancy.
//
// Two deliberate properties:
//
//   - **No sum of money anywhere.** Foundation rule 2 -- no tenant-facing price
//     and no balance, ever -- and a fixture is where a habit starts. The rent
//     clause states when rent is paid, never how much.
//   - **Near neighbours on purpose.** Four of the lease passages talk about who
//     fixes what. A ranking ratchet set against a corpus with one obvious
//     answer per question measures nothing, because nothing could have won
//     instead.

export type ClauseSource = 'lease' | 'policy';

export interface SpecimenClause {
  /** The citation, spelled as an answer would cite it. */
  ref: string;
  source: ClauseSource;
  body: string;
}

export const specimenClauses: readonly SpecimenClause[] = [
  {
    ref: 'חוזה §4.1',
    source: 'lease',
    body: 'תקופת השכירות היא לשלוש שנים מיום מסירת החזקה בדירה לשוכר, ולשוכר עומדת אופציה להארכה בשנה נוספת בהודעה מוקדמת של תשעים יום.',
  },
  {
    ref: 'חוזה §7.2',
    source: 'lease',
    body: 'תיקון תקלות הנובעות מבלאי סביר במערכות הדירה, לרבות דוד המים, מערכת החימום ומערכת האינסטלציה, הוא באחריות בעל הדירה ועל חשבונו.',
  },
  {
    ref: 'חוזה §7.5',
    source: 'lease',
    body: 'נזק שנגרם לדירה או לתכולתה כתוצאה משימוש בלתי סביר של השוכר, של בני ביתו או של מי מטעמו, יתוקן על ידי השוכר ועל חשבונו.',
  },
  {
    ref: 'חוזה §7.9',
    source: 'lease',
    body: 'תיקון ליקויים ברכוש המשותף, לרבות בחדר המדרגות, בלובי ובחניון, אינו באחריות השוכר אלא באחריות מפעילת הבניין.',
  },
  {
    ref: 'חוזה §10.3',
    source: 'lease',
    body: 'דמי השכירות משולמים מדי חודש בחודשו ביום הראשון לכל חודש קלנדרי, בהוראת קבע בנקאית לטובת בעל הדירה.',
  },
  {
    ref: 'חוזה §11.3',
    source: 'lease',
    body: 'תשלומי הארנונה, החשמל, המים והגז בגין תקופת השכירות חלים על השוכר וישולמו על ידו במישרין לרשות המקומית ולספקים.',
  },
  {
    ref: 'חוזה §13.1',
    source: 'lease',
    body: 'השוכר אינו רשאי להעביר את זכויותיו לפי חוזה זה, להשכיר את הדירה בשכירות משנה או לאפשר לאחר להחזיק בה, אלא בהסכמת בעל הדירה מראש ובכתב.',
  },
  {
    ref: 'נוהל שירות §2',
    source: 'policy',
    body: 'משרדי החברה פתוחים לקהל בימים א׳ עד ה׳ בין השעות 09:00 ל-16:00, ובערבי חג עד השעה 12:00.',
  },
  {
    ref: 'נוהל שירות §3',
    source: 'policy',
    body: 'דיווח על תקלה שאינה דחופה נמסר דרך הודעה לשירות הדיירים, ונפתחת בגינו קריאת שירות שמספרה נמסר לדייר עם פתיחתה.',
  },
];

// The clause references the cases name, so a case and the fixture cannot drift
// apart silently: a rename here breaks the import, not the gate at 2am.
export const specimenRefs = {
  ownerRepairs: 'חוזה §7.2',
  tenantDamage: 'חוזה §7.5',
  commonParts: 'חוזה §7.9',
  officeHours: 'נוהל שירות §2',
  reportFault: 'נוהל שירות §3',
} as const;
