import type { UnitRecord } from '../src/estate/contract.ts';
import type { PassageHit, RetrievalBound } from '../src/evidence/contract.ts';
import {
  answerOfficeHits,
  chooseOfficeTools,
  OFFICE_TURN_RECORD_REFUSAL,
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

// #227. Two flats with no Documents, so the record is the only fact a Unit-bound turn has. The area
// of the second is not held, which is the case a model must refuse rather than guess.
export const RECORD_UNIT = 'record-unit';
export const BARE_RECORD_UNIT = 'bare-record-unit';
const RECORD_CITATION = 'כרטיס הדירה';

const fixtureRecords: Record<string, UnitRecord> = {
  [RECORD_UNIT]: {
    unitId: RECORD_UNIT,
    unitNumber: '12',
    buildingName: 'בניין הזית',
    addressLine: 'רחוב הזית 4',
    city: 'רמלה',
    floor: '3',
    rooms: '4',
    areaSqm: '82',
    hasMamad: true,
    tenure: 'FOR_RENT',
    builtParking: '14',
    builtStorage: '7',
  },
  [BARE_RECORD_UNIT]: {
    unitId: BARE_RECORD_UNIT,
    unitNumber: '5',
    buildingName: 'בניין הזית',
    addressLine: 'רחוב הזית 4',
    city: 'רמלה',
    floor: null,
    rooms: '3',
    areaSqm: null,
    hasMamad: false,
    tenure: 'FOR_RENT',
    builtParking: null,
    builtStorage: null,
  },
};

function fixtureRecord(bound: RetrievalBound): UnitRecord | null {
  if (bound.kind !== 'unit') return null;
  const record = fixtureRecords[bound.id];
  // Production always loads a Unit bound's record; a case without one would grade the old turn.
  if (!record) throw new Error(`no fixture Unit record for ${bound.id}`);
  return record;
}

/** The placeholder's stand-in for reading the record: a size question about this flat only. */
function placeholderRecordTurn(record: UnitRecord, message: string): AgentTurn {
  const otherFlat = /דירה\s*(\d+)/.exec(message)?.[1];
  if (
    /שטח|גודל/.test(message) &&
    record.areaSqm !== null &&
    (otherFlat === undefined || otherFlat === record.unitNumber)
  ) {
    return {
      text: `שטח הדירה ${record.areaSqm} מ״ר.`,
      refused: false,
      citations: [RECORD_CITATION],
      toolCalls: ['search'],
    };
  }
  return {
    text: OFFICE_TURN_RECORD_REFUSAL,
    refused: true,
    citations: [],
    toolCalls: ['search'],
  };
}

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
  if (bound?.kind === 'unit') {
    return placeholderRecordTurn(fixtureRecord(bound) as UnitRecord, message);
  }

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
      fixtureRecord(bound),
    );
    return {
      text: decided.text,
      refused: decided.refused,
      citations: decided.citations.map((citation) =>
        citation.kind === 'record'
          ? RECORD_CITATION
          : `${citation.documentId} עמ׳ ${citation.page}`,
      ),
      toolCalls: tools,
    };
  };
}
