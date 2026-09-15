import type { PassageHit } from '../src/evidence/contract.ts';
import { answerOfficeHits } from '../src/evidence/contract.ts';
import { systemClock } from '../src/kernel/clock.ts';
import type { Extractor } from '../src/kernel/extraction.ts';
import { newId } from '../src/kernel/ids.ts';
import type { AgentTurn, Subject } from './case.ts';
import { type Corpus, PORTFOLIO_BOUND } from './corpus.ts';

// PLACEHOLDER. There is no WhatsApp agent yet. Behavioural cases that this
// product owns grade the office turn instead (`officeTurnSubject`). This stub
// keeps `npm test` honest without a key: the runner can still fail a wrong
// subject, and the golden files' cite/refuse/search expectations stay green.

const emergencyWords = ['נזילה', 'הצפה', 'שריפה', 'ריח גז'];
const responsibilityWords = ['אחראי', 'מי משלם', 'על חשבון מי'];

export const placeholderSubject: Subject = async ({
  message,
}): Promise<AgentTurn> => {
  if (emergencyWords.some((word) => message.includes(word))) {
    return {
      text: 'פתחתי קריאה דחופה ואנחנו מטפלים בזה עכשיו.',
      refused: false,
      citations: [],
      toolCalls: ['case.open'],
    };
  }

  if (responsibilityWords.some((word) => message.includes(word))) {
    return {
      text: 'לפי סעיף 7.2 בחוזה, תיקוני בלאי סביר הם באחריות בעל הדירה.',
      refused: false,
      citations: ['חוזה §7.2'],
      toolCalls: ['search'],
    };
  }

  return {
    text: 'אין לי את המידע הזה, ואני לא רוצה לנחש — אעביר את זה למשרד.',
    refused: true,
    citations: [],
    toolCalls: ['search'],
  };
};

export function officeTurnSubject(options: {
  corpus: Corpus;
  extractor: Extractor;
  model: string;
  reasoningEffort?: string;
}): Subject {
  const clock = systemClock;
  return async (input): Promise<AgentTurn> => {
    const bound = input.bound ?? PORTFOLIO_BOUND;
    const found = await options.corpus.search(input.message, bound);
    const hits: PassageHit[] = found.map((hit) => ({
      passageId: newId(clock),
      documentId: hit.clauseRef ?? hit.source,
      page: 1,
      text: hit.text,
      documentType: hit.source,
      unitId: null,
      distance: hit.distance,
    }));
    const decided = await answerOfficeHits(options, input.message, [], hits);
    return {
      text: decided.text,
      refused: decided.refused,
      citations: decided.citations.map(
        (citation) => `${citation.documentId} עמ׳ ${citation.page}`,
      ),
      toolCalls: ['search'],
    };
  };
}
