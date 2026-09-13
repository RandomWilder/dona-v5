// The obligation-type catalogue's seed. Slice 5.7.
//
// **This is data, not a migration.** D5 / foundation rule 8: a new type costs a seed row, not a
// release. Five codes arriving in 0026 would make the sixth a migration too. Applied by
// `npm run seed:obligation-types`, wired into no workflow.
import type { ObligationTypeSpec } from '../internal/obligations.ts';

export const seedObligationTypes: ObligationTypeSpec[] = [
  {
    code: 'ARNONA',
    labelHe: 'ארנונה',
    labelEn: 'Municipal tax',
    defaultResponsibleParty: 'TENANT',
    requiresEvidence: true,
    isActive: true,
  },
  {
    code: 'CONTENTS_INSURANCE',
    labelHe: 'ביטוח תכולה',
    labelEn: 'Contents insurance',
    defaultResponsibleParty: 'TENANT',
    requiresEvidence: true,
    isActive: true,
  },
  {
    code: 'BANK_GUARANTEE',
    labelHe: 'ערבות בנקאית',
    labelEn: 'Bank guarantee',
    defaultResponsibleParty: 'TENANT',
    requiresEvidence: true,
    isActive: true,
  },
  {
    code: 'UTILITY_ACCOUNT',
    labelHe: 'חשבון שירות',
    labelEn: 'Utility account',
    defaultResponsibleParty: 'TENANT',
    requiresEvidence: false,
    isActive: true,
  },
  {
    code: 'HOUSE_COMMITTEE',
    labelHe: 'ועד בית',
    labelEn: 'House committee',
    defaultResponsibleParty: 'TENANT',
    requiresEvidence: false,
    isActive: true,
  },
];
