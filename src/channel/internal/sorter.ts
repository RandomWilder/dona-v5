// The sorter's real implementation. #187.
//
// One port, two operations, both on the extractor the kernel already has.
// This file does not take a database. The door hands it the subject, the
// text, and the active categories. A timeout or a bad reply throws, and the
// door turns that into a call marked for review.

import type { Extractor, JsonSchema } from '../../kernel/extraction.ts';
import type {
  Sorter,
  SortInput,
  SortVerdict,
  TranslateInput,
  Translation,
} from './door.ts';

/** Bump when the instructions change. A verdict records the value. */
export const SORTER_PROMPT_VERSION = 'sorter-1';

const SORT_INSTRUCTIONS = [
  'You sort one message for a residential property office in Israel.',
  "You are given the subject, the text, and the office's categories.",
  'You are given nothing else, and you decide nothing: the office decides.',
  '',
  'label is "call" when a person asks the office to do, fix, check, or',
  'explain something about a home or the building. A question is a call.',
  'label is "noise" when the message is advertising, an automatic notice,',
  'a greeting with nothing to do, or not for this office.',
  'label is "unsure" when a person could reasonably read it either way.',
  '',
  'categoryCode is one of the codes in the message, or null when none fits',
  'or the label is noise. Do not invent a code.',
  'summary is one or two sentences in Hebrew saying what the person wants,',
  'or null when the label is noise. Do not add a fact the message did not',
  'state.',
].join('\n');

const TRANSLATE_INSTRUCTIONS = [
  'You prepare one message for a Hebrew-speaking office to read.',
  'If the subject and the text are already Hebrew, set alreadyHebrew to',
  'true and bodyHe to null.',
  'Otherwise set alreadyHebrew to false and bodyHe to the whole message in',
  'Hebrew, the subject first when there is one. Do not add advice. Do not',
  'drop a sentence.',
].join('\n');

const sortSchema: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    label: { type: 'string', enum: ['call', 'unsure', 'noise'] },
    categoryCode: { type: ['string', 'null'] },
    summary: { type: ['string', 'null'] },
  },
  required: ['label', 'categoryCode', 'summary'],
};

const translateSchema: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    alreadyHebrew: { type: 'boolean' },
    bodyHe: { type: ['string', 'null'] },
  },
  required: ['alreadyHebrew', 'bodyHe'],
};

export interface SorterOptions {
  extractor: Extractor;
  /** Read per call, so a bad model id is one row and not a restart. */
  model: () => Promise<string>;
}

function textOf(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text === '' ? null : text;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

function sortMessage(input: SortInput): string {
  const categories =
    input.categories.length === 0
      ? '(none)'
      : input.categories.map((row) => `- ${row.code}: ${row.label}`).join('\n');
  const subject = input.subject.trim() === '' ? '(none)' : input.subject;
  return `Subject: ${subject}\nText:\n${input.body}\n\nCategories:\n${categories}`;
}

function translateMessage(input: TranslateInput): string {
  const subject = input.subject.trim() === '' ? '(none)' : input.subject;
  return `Subject: ${subject}\nText:\n${input.body}`;
}

function verdictOf(value: unknown, model: string): SortVerdict {
  if (!isRecord(value)) throw new Error('sorter reply was not a verdict');
  const label = value.label;
  if (label !== 'call' && label !== 'unsure' && label !== 'noise') {
    throw new Error('sorter reply had no label');
  }
  return {
    label,
    categoryCode: textOf(value.categoryCode)?.toUpperCase() ?? null,
    summary: textOf(value.summary),
    modelId: model,
    promptVersion: SORTER_PROMPT_VERSION,
  };
}

function translationOf(value: unknown): Translation {
  if (!isRecord(value) || typeof value.alreadyHebrew !== 'boolean') {
    throw new Error('translation was not a reply');
  }
  if (value.alreadyHebrew) return { bodyHe: null };
  const bodyHe = textOf(value.bodyHe);
  if (bodyHe === null) throw new Error('translation was empty');
  return { bodyHe };
}

export function createSorter(options: SorterOptions): Sorter {
  return {
    async sort(input) {
      const model = await options.model();
      const reply = await options.extractor.extract({
        model,
        name: 'sorter_verdict',
        instructions: SORT_INSTRUCTIONS,
        input: sortMessage(input),
        schema: sortSchema,
        reasoningEffort: 'low',
      });
      return verdictOf(reply, model);
    },
    async translate(input) {
      const model = await options.model();
      const reply = await options.extractor.extract({
        model,
        name: 'sorter_translation',
        instructions: TRANSLATE_INSTRUCTIONS,
        input: translateMessage(input),
        schema: translateSchema,
        reasoningEffort: 'low',
      });
      return translationOf(reply);
    },
  };
}
