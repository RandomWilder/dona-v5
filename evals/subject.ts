import type {
  BuildingRecord,
  BuildingRecordUnit,
  UnitRecord,
} from '../src/estate/contract.ts';
import type { PassageHit, RetrievalBound } from '../src/evidence/contract.ts';
import {
  answerCallBrief,
  answerOfficeHits,
  chooseOfficeTools,
  followUpNamesOtherUnit,
  OFFICE_TURN_RECORD_REFUSAL,
  OFFICE_TURN_REFUSAL,
} from '../src/evidence/contract.ts';
import { systemClock } from '../src/kernel/clock.ts';
import type { Extractor } from '../src/kernel/extraction.ts';
import { newId } from '../src/kernel/ids.ts';
import type { ActiveLettingInBuilding } from '../src/tenancy/contract.ts';
import {
  type AgentTurn,
  BUILDING_RECORD_CITATION,
  RECORD_CITATION,
  type Subject,
} from './case.ts';
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

// #229. A flat whose record says 82 m² and whose lease prints 85 m².
export const DISAGREE_UNIT = 'disagree-unit';

// #230. A freshly seeded Building with no paper and no active letting: its record is all it has.
export const RECORD_BUILDING = 'record-building';

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
    // #228: the letting assigns a different bay from the one the flat was built with.
    letting: {
      tenancyId: 'record-unit-letting',
      startDate: '2026-01-01',
      endDate: '2027-01-01',
      optionEndDate: '2028-01-01',
      rentAmount: '5400',
      rentCurrency: 'ILS',
      assignedParking: ['22'],
      assignedStorage: ['7'],
      parties: [{ fullName: 'יעל כהן', role: 'PRIMARY_TENANT' }],
    },
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
    letting: null,
  },
  [DISAGREE_UNIT]: {
    unitId: DISAGREE_UNIT,
    unitNumber: '9',
    buildingName: 'בניין הזית',
    addressLine: 'רחוב הזית 4',
    city: 'רמלה',
    floor: '2',
    rooms: '4',
    areaSqm: '82',
    hasMamad: true,
    tenure: 'FOR_RENT',
    builtParking: null,
    builtStorage: null,
    letting: null,
  },
};

// #229. Paper a fixture Unit holds, beside its record. A fixture of this subject rather than a corpus
// row, so no portfolio-bound ranking or grounding case sees it.
const fixturePages: Record<string, PassageHit> = {
  [DISAGREE_UNIT]: {
    passageId: `${DISAGREE_UNIT}-page`,
    documentId: 'חוזה דירה 9',
    page: 1,
    text: 'שטח הדירה המושכרת הוא 85 מ״ר, כולל ממ״ד.',
    documentType: 'lease',
    unitId: DISAGREE_UNIT,
    distance: 0.3,
  },
};

function fixturePassages(bound: RetrievalBound): PassageHit[] {
  const page = bound.kind === 'unit' ? fixturePages[bound.id] : undefined;
  return page ? [page] : [];
}

/** How both subjects spell a Document-and-page citation. */
function paperCitation(documentId: string, page: number): string {
  return `${documentId} עמ׳ ${page}`;
}

function recordUnit(
  unitNumber: string,
  rooms: string,
  floor: string | null,
  areaSqm: string | null,
): BuildingRecordUnit {
  return {
    unitId: `${RECORD_BUILDING}-${unitNumber}`,
    unitNumber,
    floor,
    rooms,
    areaSqm,
    tenure: 'FOR_RENT',
    builtParking: null,
    builtStorage: null,
  };
}

/** #230. Every Building bound carries a record; the two older Buildings carry the one flat they let. */
function buildingRecord(
  buildingId: string,
  units: BuildingRecordUnit[],
): BuildingRecord {
  return {
    buildingId,
    name: 'בניין הזית',
    addressLine: 'רחוב הזית 4',
    city: 'רמלה',
    projectName: null,
    handoverDate: '2025-06-01',
    warrantyEndDate: '2026-06-01',
    status: 'ACTIVE',
    units,
    parking: { total: 4, assigned: 1 },
    storage: { total: 2, assigned: 0 },
  };
}

const fixtureBuildings: Record<string, BuildingRecord> = {
  [ROLL_BUILDING]: buildingRecord(ROLL_BUILDING, [
    recordUnit('12', '4', '3', '82'),
  ]),
  [EMPTY_BUILDING]: buildingRecord(EMPTY_BUILDING, [
    recordUnit('12', '4', '3', '82'),
  ]),
  // Two four-room flats among four; the count is the case.
  [RECORD_BUILDING]: buildingRecord(RECORD_BUILDING, [
    recordUnit('1', '3', '0', '70'),
    recordUnit('2', '4', '1', '92'),
    recordUnit('3', '5', '1', '110'),
    recordUnit('4', '4', '2', '92'),
  ]),
};

function fixtureRecord(
  bound: RetrievalBound,
): UnitRecord | BuildingRecord | null {
  if (bound.kind === 'building') {
    const record = fixtureBuildings[bound.id];
    if (!record) throw new Error(`no fixture Building record for ${bound.id}`);
    return record;
  }
  if (bound.kind !== 'unit') return null;
  const record = fixtureRecords[bound.id];
  // Production always loads a Unit bound's record; a case without one would grade the old turn.
  if (!record) throw new Error(`no fixture Unit record for ${bound.id}`);
  return record;
}

/** The placeholder's stand-in for counting flats by rooms from a Building record's Unit lines. */
function placeholderBuildingRecordTurn(
  record: BuildingRecord,
  message: string,
): AgentTurn | null {
  const rooms = /(\d+|ארבעה|שלושה|חמישה)\s*חדרים/.exec(message)?.[1];
  if (rooms === undefined || !/כמה/.test(message)) return null;
  const asNumber: Record<string, string> = {
    ארבעה: '4',
    שלושה: '3',
    חמישה: '5',
  };
  const wanted = asNumber[rooms] ?? rooms;
  const count = record.units.filter((unit) => unit.rooms === wanted).length;
  return {
    text: `בבניין ${count} דירות בנות ${wanted} חדרים.`,
    refused: false,
    citations: [BUILDING_RECORD_CITATION],
    toolCalls: ['search'],
  };
}

/** The placeholder's stand-in for reading the record: a size question about this flat only. */
function placeholderRecordTurn(record: UnitRecord, message: string): AgentTurn {
  const otherFlat = /דירה\s*(\d+)/.exec(message)?.[1];
  if (
    /שטח|גודל/.test(message) &&
    record.areaSqm !== null &&
    (otherFlat === undefined || otherFlat === record.unitNumber)
  ) {
    // #229: when the flat's paper disagrees, both values, the record's first and named current.
    const page = fixturePages[record.unitId];
    if (page) {
      return {
        text: `הערך הנוכחי: ${record.areaSqm} מ״ר. בחוזה: ${page.text}`,
        refused: false,
        citations: [RECORD_CITATION, paperCitation(page.documentId, page.page)],
        toolCalls: ['search'],
      };
    }
    return {
      text: `שטח הדירה ${record.areaSqm} מ״ר.`,
      refused: false,
      citations: [RECORD_CITATION],
      toolCalls: ['search'],
    };
  }
  // #228: built and assigned bay are two facts, and a parking question names both.
  const assigned = record.letting?.assignedParking ?? [];
  if (/חניה/.test(message) && record.builtParking !== null) {
    const letting =
      assigned.length === 0 ? '' : ` חניה מהשכירות: ${assigned.join(', ')}.`;
    return {
      text: `חניה מהבנייה: ${record.builtParking}.${letting}`,
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
  brief,
}): Promise<AgentTurn> => {
  if (brief === 'lease') {
    return {
      text: 'לפי סעיף 7.2 בחוזה, תיקוני בלאי סביר הם באחריות בעל הדירה.',
      refused: false,
      citations: ['חוזה §7.2'],
      toolCalls: ['search'],
    };
  }
  if (brief === 'building') {
    return {
      text: 'הבניין נמסר ב-2024-03-01.',
      refused: false,
      citations: ['בניין §0'],
      toolCalls: ['search'],
    };
  }
  if (brief === 'refuse') {
    return {
      text: OFFICE_TURN_REFUSAL,
      refused: true,
      citations: [],
      toolCalls: ['search'],
    };
  }
  if (brief === 'follow-up') {
    return {
      text: 'הערבות הבנקאית היא 13,560 ש״ח.',
      refused: false,
      citations: ['חוזה §12.1'],
      toolCalls: ['search'],
    };
  }
  if (
    brief === 'out-of-bound' &&
    followUpNamesOtherUnit(message, '12', ['7'])
  ) {
    return {
      text: OFFICE_TURN_RECORD_REFUSAL,
      refused: true,
      citations: [],
      toolCalls: [],
    };
  }

  if (bound?.kind === 'unit') {
    return placeholderRecordTurn(fixtureRecord(bound) as UnitRecord, message);
  }

  if (bound?.kind === 'building') {
    const counted = placeholderBuildingRecordTurn(
      fixtureRecord(bound) as BuildingRecord,
      message,
    );
    if (counted) return counted;
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
    // #230: the record Building has no paper, so its search returns nothing.
    const paperless = bound.kind === 'building' && bound.id === RECORD_BUILDING;
    if (tools.includes('search') && !paperless) {
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
      hits = [...fixturePassages(bound), ...hits];
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
        citation.kind !== 'record'
          ? paperCitation(citation.documentId, citation.page)
          : citation.record === 'unit'
            ? RECORD_CITATION
            : BUILDING_RECORD_CITATION,
      ),
      toolCalls: tools,
    };
  };
}

/** #252. The call brief, graded on the same corpus. Lease and building paper are separate bags. */
export function callBriefSubject(options: {
  corpus: Corpus;
  extractor: Extractor;
  model: string;
  reasoningEffort?: string;
}): Subject {
  const clock = systemClock;
  return async (input): Promise<AgentTurn> => {
    const found = await options.corpus.search(input.message, {
      kind: 'unit',
      id: HOME_UNIT,
    });
    if (
      input.brief === 'out-of-bound' &&
      followUpNamesOtherUnit(input.message, '12', ['7'])
    ) {
      return {
        text: OFFICE_TURN_RECORD_REFUSAL,
        refused: true,
        citations: [],
        toolCalls: [],
      };
    }
    const prefix =
      input.brief === 'lease' || input.brief === 'follow-up'
        ? 'חוזה'
        : input.brief === 'building'
          ? 'בניין'
          : null;
    const kept =
      prefix === null
        ? found
        : found.filter((hit) => (hit.clauseRef ?? '').startsWith(prefix));
    const hits: PassageHit[] = kept.slice(0, 8).map((hit) => ({
      passageId: newId(clock),
      documentId: hit.clauseRef ?? hit.source,
      page: 1,
      text: hit.text,
      documentType:
        input.brief === 'building' ? 'building_handover_protocol' : 'lease',
      unitId: null,
      distance: hit.distance,
    }));
    const decided = await answerCallBrief(
      options,
      input.message,
      hits,
      'פונה: דייר לדוגמה',
      false,
    );
    return {
      text: decided.text,
      refused: decided.refused,
      citations: decided.citations.map((citation) =>
        citation.kind === 'record'
          ? RECORD_CITATION
          : paperCitation(citation.documentId, citation.page),
      ),
      toolCalls: ['search'],
    };
  };
}
