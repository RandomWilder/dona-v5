import { INSERTED, type UpsertResult } from '../../kernel/upsert.ts';
import type { PolicySectionSeed } from '../fixtures/sections.ts';
import type { Queryable } from './types.ts';

export interface SectionSeedReport {
  created: number;
  updated: number;
}

export async function applyPolicySections(
  db: Queryable,
  sections: readonly PolicySectionSeed[],
): Promise<SectionSeedReport> {
  const report: SectionSeedReport = { created: 0, updated: 0 };
  for (const section of sections) {
    const result = await db.query<UpsertResult>(
      `INSERT INTO policy_section (
         policy_section_id, section_key, label_he, sort_order
       ) VALUES ($1, $2, $3, $4)
       ON CONFLICT (section_key) DO UPDATE
         SET label_he = EXCLUDED.label_he,
             sort_order = EXCLUDED.sort_order
       WHERE policy_section.label_he IS DISTINCT FROM EXCLUDED.label_he
          OR policy_section.sort_order IS DISTINCT FROM EXCLUDED.sort_order
       RETURNING policy_section_id AS id, ${INSERTED}`,
      [
        section.policySectionId,
        section.sectionKey,
        section.labelHe,
        section.sortOrder,
      ],
    );
    const row = result.rows[0];
    if (!row) continue;
    if (row.inserted) report.created += 1;
    else report.updated += 1;
  }
  return report;
}
