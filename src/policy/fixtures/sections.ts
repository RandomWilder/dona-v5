// The Policy library's sections. #250.
//
// Data, not a migration, for the same reason as the document-type catalogue: a
// further section is a row in this list and a re-deploy of data. Two sections
// inserted by 0069 would make the third a migration, and the acceptance bar
// would be false the day it was written.

export interface PolicySectionSeed {
  policySectionId: string;
  sectionKey: string;
  labelHe: string;
  sortOrder: number;
}

export const policySections: readonly PolicySectionSeed[] = [
  {
    policySectionId: '019a0000-0000-7000-8000-0000000000a1',
    sectionKey: 'state_law',
    labelHe: 'דין המדינה',
    sortOrder: 1,
  },
  {
    policySectionId: '019a0000-0000-7000-8000-0000000000a2',
    sectionKey: 'company_policy',
    labelHe: 'נוהל חברה',
    sortOrder: 2,
  },
];
