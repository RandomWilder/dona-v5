import type { Extractor, JsonSchema } from '../../kernel/extraction.ts';
import type { OfficeCitation } from '../../staff/contract.ts';

/**
 * A reply the office might send. Facts are the brief's cited passages.
 * The model does not send it.
 */
export const CALL_DRAFT_INSTRUCTIONS =
  'This is a draft reply to the requester. It has not been sent. Facts are only this turn’s numbered passages. Copy names, amounts and dates exactly as printed. Do not promise an outcome the office has not decided: do not say the office is responsible, do not name a visit time, a day, or a clock time, including one the requester asked for, and do not name a sum of money the passage does not print. Do not add a fact the passages do not contain. A passage whose heading names דין המדינה or נוהל חברה is quoted; it does not decide who is responsible. Do not greet and do not sign a name. Open with one short sentence on what the requester asked about: name the subject, and do not repeat a day, a clock time, or a sum they asked for. Then write the full answer from the passages, in complete sentences. Record the passages you used in hit_indexes. Do not write passage numbers in the reply. If the passages do not answer, set answers to false and leave text and hebrew empty. When LANGUAGE is עברית, write text in Hebrew and leave hebrew empty. When LANGUAGE is English, write text in English, translate בעל הדירה as owner, and write the same reply in Hebrew in hebrew, copying printed names as they appear in the passages.';

const CALL_DRAFT_SCHEMA: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    answers: { type: 'boolean' },
    text: { type: 'string' },
    hebrew: { type: 'string' },
    hit_indexes: { type: 'array', items: { type: 'integer' } },
  },
  required: ['answers', 'text', 'hebrew', 'hit_indexes'],
};

export interface DraftPassage {
  passageId: string;
  heading: string;
  text: string;
  citation: OfficeCitation;
}

export interface CallDraftAnswer {
  refused: boolean;
  text: string;
  rendering: string | null;
  citations: OfficeCitation[];
  hitIds: string[];
}

const EMPTY: CallDraftAnswer = {
  refused: true,
  text: '',
  rendering: null,
  citations: [],
  hitIds: [],
};

function draftInput(
  question: string,
  language: 'he' | 'other',
  passages: readonly DraftPassage[],
): string {
  const languageLine = language === 'he' ? 'עברית' : 'English';
  const body = passages
    .map(
      (passage, index) => `[${index + 1}] ${passage.heading}\n${passage.text}`,
    )
    .join('\n\n');
  return `LANGUAGE: ${languageLine}\n\nQUESTION:\n${question}\n\nPASSAGES:\n${body}`;
}

function readDraft(
  reply: unknown,
  language: 'he' | 'other',
  passages: readonly DraftPassage[],
): CallDraftAnswer {
  if (typeof reply !== 'object' || reply === null) return EMPTY;
  const value = reply as {
    answers?: unknown;
    text?: unknown;
    hebrew?: unknown;
    hit_indexes?: unknown;
  };
  const text = typeof value.text === 'string' ? value.text.trim() : '';
  const hebrew = typeof value.hebrew === 'string' ? value.hebrew.trim() : '';
  if (value.answers !== true || text.length === 0) return EMPTY;
  const citations: OfficeCitation[] = [];
  const hitIds: string[] = [];
  const seen = new Set<string>();
  const indexes = Array.isArray(value.hit_indexes) ? value.hit_indexes : [];
  for (const raw of indexes) {
    if (typeof raw !== 'number' || !Number.isInteger(raw)) continue;
    const passage = passages[raw - 1];
    if (!passage || seen.has(passage.passageId)) continue;
    seen.add(passage.passageId);
    citations.push(passage.citation);
    hitIds.push(passage.passageId);
  }
  if (citations.length === 0) return EMPTY;
  if (language === 'he') {
    return { refused: false, text, rendering: null, citations, hitIds };
  }
  if (hebrew.length === 0) return EMPTY;
  return { refused: false, text, rendering: hebrew, citations, hitIds };
}

/** The draft's answer from the brief's passages. No thread is written. */
export async function answerCallDraft(
  deps: { extractor: Extractor; model: string; reasoningEffort?: string },
  spec: {
    question: string;
    language: 'he' | 'other';
    passages: readonly DraftPassage[];
  },
): Promise<CallDraftAnswer> {
  if (spec.passages.length === 0) return EMPTY;
  return readDraft(
    await deps.extractor.extract({
      model: deps.model,
      name: 'call_draft',
      instructions: CALL_DRAFT_INSTRUCTIONS,
      input: draftInput(spec.question, spec.language, spec.passages),
      schema: CALL_DRAFT_SCHEMA,
      reasoningEffort: deps.reasoningEffort,
    }),
    spec.language,
    spec.passages,
  );
}
