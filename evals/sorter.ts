// The sorter's golden set. #187.
//
// The output is a pass rate. A miss on the label, on a named category, or on
// whether a non-Hebrew message came back in Hebrew fails that case. The
// wording of a summary is not graded: the model does not owe a fixed sentence.

import type { SortCategory, Sorter } from '../src/channel/contract.ts';
import type { SorterCase } from './sorter-cases.ts';
import { sorterCases } from './sorter-cases.ts';

const HEBREW = /[\u0590-\u05FF]/;

export function gradeSorterCase(
  item: SorterCase,
  verdict: {
    label: string;
    categoryCode: string | null;
    summary: string | null;
  },
  bodyHe: string | null,
): string[] {
  const failures: string[] = [];
  if (verdict.label !== item.label) {
    failures.push(`label ${verdict.label}, expected ${item.label}`);
  }
  if ('categoryCode' in item && verdict.categoryCode !== item.categoryCode) {
    failures.push(
      `category ${verdict.categoryCode ?? 'none'}, expected ${item.categoryCode ?? 'none'}`,
    );
  }
  if (item.label !== 'noise') {
    if (verdict.summary === null || !HEBREW.test(verdict.summary)) {
      failures.push('summary was not Hebrew');
    }
  }
  if (item.text === 'hebrew') {
    if (bodyHe !== null) failures.push('a Hebrew message was translated');
  } else if (bodyHe === null || !HEBREW.test(bodyHe)) {
    failures.push('the translation was not Hebrew');
  }
  return failures;
}

export interface SorterRun {
  passed: number;
  total: number;
  failures: string[];
}

export async function runSorterGoldenSet(deps: {
  sorter: Sorter;
  categories: readonly SortCategory[];
}): Promise<SorterRun> {
  const failures: string[] = [];
  let passed = 0;
  for (const item of sorterCases) {
    try {
      const verdict = await deps.sorter.sort({
        subject: item.subject,
        body: item.body,
        categories: deps.categories,
      });
      const translation = await deps.sorter.translate({
        subject: item.subject,
        body: item.body,
      });
      const why = gradeSorterCase(item, verdict, translation.bodyHe);
      if (why.length === 0) {
        passed += 1;
      } else {
        failures.push(`${item.id}: ${why.join('; ')}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown';
      failures.push(`${item.id}: ${message}`);
    }
  }
  return { passed, total: sorterCases.length, failures };
}
