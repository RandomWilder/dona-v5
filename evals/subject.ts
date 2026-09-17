import type { PassageHit, RetrievalBound } from '../src/evidence/contract.ts';
import {
  answerOfficeHits,
  chooseOfficeTools,
} from '../src/evidence/contract.ts';
import { systemClock } from '../src/kernel/clock.ts';
import type { Extractor } from '../src/kernel/extraction.ts';
import { newId } from '../src/kernel/ids.ts';
import type { ActiveLettingInBuilding } from '../src/tenancy/contract.ts';
import type { AgentTurn, Subject } from './case.ts';
import { type Corpus, HOME_UNIT, PORTFOLIO_BOUND } from './corpus.ts';

// PLACEHOLDER. There is no WhatsApp agent yet. Behavioural cases that this
// product owns grade the office turn instead (`officeTurnSubject`). This stub
// keeps `npm test` honest without a key: the runner can still fail a wrong
// subject, and the golden files' cite/refuse/search/list expectations stay green.

const emergencyWords = ['נזילה', 'הצפה', 'שריפה', 'ריח גז'];
const responsibilityWords = ['אחראי', 'מי משלם', 'על חשבון מי'];

export const EMPTY_BUILDING = 'empty-building';
export const ROLL_BUILDING = 'roll-building';

const TABLE_ASK = /מושכרות|הדיירים/;

function fixtureLettings(bound: RetrievalBound): ActiveLettingInBuilding[] {
  if (bound.kind !== 'building') return [];
  if (bound.id === EMPTY_BUILDING) return [];
  return [
    {
      unit_name: 'דירה 12',
      start_date: '2026-01-01',
      end_date: '2027-01-01',
      party_names: ['יעל כהן'],
    },
  ];
}

export const placeholderSubject: Subject = async ({
  message,
  bound,
}): Promise<AgentTurn> => {
  if (bound?.kind === 'building' && TABLE_ASK.test(message)) {
    if (bound.id === EMPTY_BUILDING) {
      return {
        text: 'אין דירות מושכרות היום.',
        refused: false,
        citations: [],
        toolCalls: ['list'],
      };
    }
    return {
      text: 'דירה 12 — יעל כהן',
      refused: false,
      citations: [],
      toolCalls: ['list'],
    };
  }

  if (message.includes('פרוטוקול')) {
    return {
      text: 'מועד המסירה נרשם בפרוטוקול.',
      refused: false,
      citations: ['פרוטוקול §0'],
      toolCalls: ['search'],
    };
  }

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
    const tools = await chooseOfficeTools(options, bound, input.message);
    let hits: PassageHit[] = [];
    if (tools.includes('search')) {
      const searchBound: RetrievalBound =
        bound.kind === 'building' ? { kind: 'unit', id: HOME_UNIT } : bound;
      const found = await options.corpus.search(input.message, searchBound);
      hits = found.map((hit) => ({
        passageId: newId(clock),
        documentId: hit.clauseRef ?? hit.source,
        page: 1,
        text: hit.text,
        documentType: hit.source,
        unitId: null,
        distance: hit.distance,
      }));
    }
    const lettings = tools.includes('list') ? fixtureLettings(bound) : null;
    const decided = await answerOfficeHits(
      options,
      input.message,
      [],
      hits,
      lettings,
    );
    return {
      text: decided.text,
      refused: decided.refused,
      citations: decided.citations.map(
        (citation) => `${citation.documentId} עמ׳ ${citation.page}`,
      ),
      toolCalls: tools,
    };
  };
}
