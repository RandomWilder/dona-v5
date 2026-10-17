import {
  type BuildingRecord,
  type BuildingRecordUnit,
  readBuildingRecord,
  readUnitRecord,
  type UnitRecord,
} from '../../estate/contract.ts';
import type { Clock } from '../../kernel/clock.ts';
import type { Embedder } from '../../kernel/embeddings.ts';
import { KernelError } from '../../kernel/errors.ts';
import type { Extractor, JsonSchema } from '../../kernel/extraction.ts';
import {
  appendOfficeRetrievalTurn,
  loadOfficeRetrievalThread,
  type OfficeCitation,
  type OfficeRetrievalBound,
  type OfficeRetrievalTurn,
} from '../../staff/contract.ts';
import {
  type ActiveLettingInBuilding,
  listActiveLettingsInBuilding,
} from '../../tenancy/contract.ts';
import {
  type PassageHit,
  type RetrievalBound,
  searchPassages,
} from './search.ts';
import type { Queryable } from './types.ts';

/** Frozen refusal. No citations, no Building nudge. The portfolio bound's. */
export const OFFICE_TURN_REFUSAL = 'אין במסמכים האלה תשובה לשאלה הזו.';

/** #227. Frozen refusal when a record was consulted too: neither the card nor the paper answers. */
export const OFFICE_TURN_RECORD_REFUSAL =
  'אין בכרטיס ובמסמכים תשובה לשאלה הזו.';

/** A field the account does not hold. Present, never omitted, and never a value. */
const NOT_RECORDED = 'לא רשום';

/** #228: the record says so when no letting is active today. An answer, not a gap. */
const NO_ACTIVE_LETTING = 'אין השכרה פעילה';
const ACTIVE_LETTING = 'פעילה היום';

const ROLE_WORD: Record<string, string> = {
  PRIMARY_TENANT: 'שוכר ראשי',
  CO_TENANT: 'שוכר נוסף',
  OCCUPANT: 'דייר',
  GUARANTOR: 'ערב',
};

const TENURE_WORD: Record<UnitRecord['tenure'], string> = {
  FOR_RENT: 'להשכרה',
  FOR_SALE: 'למכירה',
  SOLD: 'נמכרה',
};

// The Building page's words for the same three values.
const BUILDING_STATUS_WORD: Record<BuildingRecord['status'], string> = {
  ACTIVE: 'פעיל',
  IN_CONSTRUCTION: 'בבנייה',
  EXITED: 'הסתיים',
};

/** #230. The record this turn loaded: a Unit bound's or a Building bound's, never both. */
export type OfficeRecord = UnitRecord | BuildingRecord;

function isBuildingRecord(record: OfficeRecord): record is BuildingRecord {
  return 'units' in record;
}

/** Empty Building roll. An answer, not the documents-refusal sentence. */
export const OFFICE_TURN_EMPTY_ROLL = 'אין דירות מושכרות היום.';

export const OFFICE_TURN_INSTRUCTIONS =
  'Answer in Hebrew. Thread text may only clarify the question; it is not a source of facts. Facts are only this turn’s numbered passages, if present, this turn’s lettings list, if present, and this turn’s record — the Unit record (כרטיס הדירה) or the Building record (כרטיס הבניין) — if present. A record field marked לא רשום is not recorded: it is not a value, never infer it — answer it from the passages if they state it, otherwise do not answer. If you use a record value, set cites_record to true; otherwise false. When the record and a passage give different values for the same fact, give both: the record’s first, written as הערך הנוכחי: followed by the value, then the passage’s as printed in that document. Never pick one silently and never give only one. Cite both: set cites_record to true and put that passage’s number in hit_indexes. A bay or storage room marked מהבנייה is the one the flat was built with; one marked מהשכירות is the one the current letting assigns. They are two facts: when a question asks about the flat’s bay or storage and the two differ, give both, each with its label. When the record says אין השכרה פעילה, no letting is active today: that is an answer to who lives there or who rents it, not a refusal. A party marked ערב is a guarantor: on the lease, not living in the flat. Copy names, addresses, amounts and identifiers exactly as printed. When a passage heading names a clause, use that heading. If you answer only from the lettings list, set hit_indexes to [] — a list cites no paper. If passages answer, cite them even when the list is also present. If the lettings list is present and empty, nobody is let today: that is an answer, not a documents refusal. If neither the record nor the passages answer, set answers to false. A Unit record is this one Unit: a question about another flat is not answered from it. With a Unit record, do not mention another Unit, whatever the source. A Building record is this one Building: its own values, one line per Unit in it (number, floor, rooms, area, tenure, built bay and storage room), and how many bays and storage rooms it has and how many of each are assigned. Count and filter flats from its Unit lines. It names no tenant and no rent: who lives where is only the lettings list. In record_units list the unit numbers, as written in the record, of the Unit lines your answer drew on; otherwise []. Do not suggest a Building or a wider bound.';

export const OFFICE_TOOLS_INSTRUCTIONS =
  'Choose commands for this turn. This Building’s record — its own values, its flats by number, floor, rooms, area and tenure, and its bay and storage counts — is always given and needs no command. search retrieves numbered passages (leases, protocols, other paper). list returns who is let in this Building today (unit names, party names, dates — not rent, not identifiers). A table of apartments let today and their tenants uses list and does not rebuild the roll from passages. A question about a document, clause, protocol or printed fact uses search. You may choose both. Facts will only be what the chosen commands return this turn.';

const OFFICE_TURN_SCHEMA: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    answers: { type: 'boolean' },
    text: { type: 'string' },
    hit_indexes: { type: 'array', items: { type: 'integer' } },
    cites_record: { type: 'boolean' },
    record_units: { type: 'array', items: { type: 'string' } },
  },
  required: ['answers', 'text', 'hit_indexes', 'cites_record', 'record_units'],
};

const OFFICE_TOOLS_SCHEMA: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    search: { type: 'boolean' },
    list: { type: 'boolean' },
  },
  required: ['search', 'list'],
};

export type OfficeTool = 'search' | 'list';

export interface OfficeTurnDeps {
  db: Queryable;
  clock: Clock;
  extractor: Extractor;
  embedder: Embedder;
  model: string;
  reasoningEffort?: string;
}

export interface OfficeTurnSpec {
  staffAccountId: string;
  bound: RetrievalBound;
  question: string;
}

export interface OfficeTurnResult {
  refused: boolean;
  text: string;
  citations: OfficeCitation[];
  hitIds: string[];
  tools: OfficeTool[];
  thread: OfficeRetrievalTurn[];
}

export function offeredOfficeTools(bound: RetrievalBound): OfficeTool[] {
  if (bound.kind === 'building') return ['search', 'list'];
  return ['search'];
}

/**
 * Active lettings in this Building, for the office turn. Not a tenant tool.
 * A Unit bound or the portfolio is a command error.
 */
export async function listOfficeLettings(
  db: Queryable,
  clock: Clock,
  bound: RetrievalBound,
): Promise<ActiveLettingInBuilding[]> {
  if (bound.kind !== 'building') {
    throw new KernelError(
      'not_allowed',
      'the lettings list is only offered on a Building bound',
    );
  }
  return listActiveLettingsInBuilding(db, bound.id, clock);
}

export async function chooseOfficeTools(
  deps: {
    extractor: Extractor;
    model: string;
    reasoningEffort?: string;
  },
  bound: RetrievalBound,
  question: string,
): Promise<OfficeTool[]> {
  const offered = offeredOfficeTools(bound);
  if (!offered.includes('list')) return ['search'];
  const reply = await deps.extractor.extract({
    model: deps.model,
    name: 'office_tools',
    instructions: OFFICE_TOOLS_INSTRUCTIONS,
    input: `BOUND: building\n\nQUESTION:\n${question}`,
    schema: OFFICE_TOOLS_SCHEMA,
    reasoningEffort: deps.reasoningEffort,
  });
  return readTools(reply, offered);
}

export async function runOfficeTurn(
  deps: OfficeTurnDeps,
  spec: OfficeTurnSpec,
): Promise<OfficeTurnResult> {
  const question = spec.question.trim();
  if (question.length === 0) {
    throw new KernelError('invalid', 'a question is required');
  }
  const bound = asOfficeBound(spec.bound);
  const history = await loadOfficeRetrievalThread(
    deps.db,
    spec.staffAccountId,
    bound,
  );
  const tools = await chooseOfficeTools(deps, spec.bound, question);
  let hits: PassageHit[] = [];
  if (tools.includes('search')) {
    hits = await searchPassages(
      deps.db,
      deps.embedder,
      question,
      'administrator',
      spec.bound,
    );
  }
  let lettings: ActiveLettingInBuilding[] | null = null;
  if (tools.includes('list')) {
    lettings = await listOfficeLettings(deps.db, deps.clock, spec.bound);
  }
  // #227, #230: not a tool the chooser picks. A Unit or Building bound always carries its record.
  let record: OfficeRecord | null = null;
  if (spec.bound.kind === 'unit') {
    record = await readUnitRecord(deps.db, spec.bound.id, deps.clock, {
      actorKind: 'staff',
      actorId: spec.staffAccountId,
    });
  } else if (spec.bound.kind === 'building') {
    record = await readBuildingRecord(deps.db, spec.bound.id, deps.clock);
  }
  const hitIds = hits.map((hit) => hit.passageId);
  const decided = await answerOfficeHits(
    deps,
    question,
    history,
    hits,
    lettings,
    record,
  );

  await appendOfficeRetrievalTurn(deps.db, deps.clock, {
    staffAccountId: spec.staffAccountId,
    bound,
    question,
    answer: decided.text,
    refused: decided.refused,
    citations: decided.citations,
    hitIds,
  });

  const thread = await loadOfficeRetrievalThread(
    deps.db,
    spec.staffAccountId,
    bound,
  );
  return {
    refused: decided.refused,
    text: decided.text,
    citations: decided.citations,
    hitIds,
    tools,
    thread,
  };
}

export async function answerOfficeHits(
  deps: {
    extractor: Extractor;
    model: string;
    reasoningEffort?: string;
  },
  question: string,
  history: OfficeRetrievalTurn[],
  hits: PassageHit[],
  lettings: ActiveLettingInBuilding[] | null = null,
  record: OfficeRecord | null = null,
): Promise<{
  refused: boolean;
  text: string;
  citations: OfficeCitation[];
}> {
  // Only a turn with no facts at all skips the model: with a record there is always something.
  if (hits.length === 0 && lettings === null && record === null) {
    return refuse(OFFICE_TURN_REFUSAL);
  }
  const emptyRoll =
    lettings !== null && lettings.length === 0 && hits.length === 0;
  if (emptyRoll && record === null) {
    return { refused: false, text: OFFICE_TURN_EMPTY_ROLL, citations: [] };
  }
  const reply = await deps.extractor.extract({
    model: deps.model,
    name: 'office_turn',
    instructions: OFFICE_TURN_INSTRUCTIONS,
    input: modelInput(question, history, hits, lettings, record),
    schema: OFFICE_TURN_SCHEMA,
    reasoningEffort: deps.reasoningEffort,
  });
  const decided = readReply(reply, hits, lettings !== null, record);
  // #230: the empty roll answers only when the record did not.
  if (emptyRoll && decided.citations.length === 0) {
    return { refused: false, text: OFFICE_TURN_EMPTY_ROLL, citations: [] };
  }
  return decided;
}

function asOfficeBound(bound: RetrievalBound): OfficeRetrievalBound {
  if (bound.kind === 'portfolio') return { kind: 'portfolio' };
  // #124: a Tenancy bound is the tenant's and is refused here rather than
  // widened to its Unit. The office thread is keyed on the office's three
  // bounds, and a turn that silently became a Unit turn would persist under a
  // bound nobody asked for.
  if (bound.kind === 'tenancy') {
    throw new KernelError(
      'not_allowed',
      'the office turn does not take a Tenancy bound',
    );
  }
  if (bound.kind === 'building-paper') {
    throw new KernelError(
      'not_allowed',
      'the office turn does not take Building paper',
    );
  }
  if (bound.kind === 'policy') {
    throw new KernelError(
      'not_allowed',
      'the office turn does not search the Policy library',
    );
  }
  return { kind: bound.kind, id: bound.id };
}

function readTools(reply: unknown, offered: OfficeTool[]): OfficeTool[] {
  if (typeof reply !== 'object' || reply === null) return ['search'];
  const value = reply as { search?: unknown; list?: unknown };
  const chosen: OfficeTool[] = [];
  if (value.search === true && offered.includes('search'))
    chosen.push('search');
  if (value.list === true && offered.includes('list')) chosen.push('list');
  return chosen.length > 0 ? chosen : ['search'];
}

function modelInput(
  question: string,
  history: OfficeRetrievalTurn[],
  hits: PassageHit[],
  lettings: ActiveLettingInBuilding[] | null,
  record: OfficeRecord | null,
): string {
  const thread =
    history.length === 0
      ? '(none)'
      : history
          .map(
            (turn) =>
              `Q: ${turn.question}\nA: ${turn.answer}${turn.refused ? ' [refused]' : ''}`,
          )
          .join('\n');
  const parts = [`THREAD:\n${thread}`, `QUESTION:\n${question}`];
  if (record !== null && isBuildingRecord(record)) {
    parts.push(`RECORD (כרטיס הבניין):\n${buildingRecordLines(record)}`);
  } else if (record !== null) {
    parts.push(`RECORD (כרטיס הדירה):\n${recordLines(record)}`);
  }
  if (hits.length > 0) {
    const passages = hits
      .map(
        (hit, index) =>
          `[${index + 1}] ${hit.documentType} page ${hit.page}\n${hit.text}`,
      )
      .join('\n\n');
    parts.push(`PASSAGES:\n${passages}`);
  }
  if (lettings !== null) {
    const rows =
      lettings.length === 0
        ? '(none)'
        : lettings
            .map(
              (row) =>
                `- ${row.unit_name} · ${row.start_date}–${row.end_date} · ${row.party_names.join(', ') || '(no parties)'}`,
            )
            .join('\n');
    parts.push(`LETTINGS:\n${rows}`);
  }
  return parts.join('\n\n');
}

/** A value the account holds, or `לא רשום`. */
function held(value: string | null): string {
  return value ?? NOT_RECORDED;
}

function heldArea(areaSqm: string | null): string {
  return areaSqm === null ? NOT_RECORDED : `${areaSqm} מ״ר`;
}

/** Every field, in a fixed order; what the account does not hold says so. */
function recordLines(record: UnitRecord): string {
  return [
    `דירה: ${record.unitNumber}`,
    `בניין: ${record.buildingName}, ${record.addressLine}, ${record.city}`,
    `קומה: ${held(record.floor)}`,
    `חדרים: ${record.rooms}`,
    `שטח: ${heldArea(record.areaSqm)}`,
    `ממ״ד: ${record.hasMamad ? 'יש' : 'אין'}`,
    `סטטוס: ${TENURE_WORD[record.tenure]}`,
    `חניה (מהבנייה): ${held(record.builtParking)}`,
    `מחסן (מהבנייה): ${held(record.builtStorage)}`,
    ...lettingLines(record.letting),
  ]
    .map((line) => `- ${line}`)
    .join('\n');
}

/** #230. The Building's values, its counts, then one line per Unit. No party, no rent. */
function buildingRecordLines(record: BuildingRecord): string {
  const unitLine = (unit: BuildingRecordUnit): string =>
    [
      `דירה ${unit.unitNumber}`,
      `קומה: ${held(unit.floor)}`,
      `חדרים: ${unit.rooms}`,
      `שטח: ${heldArea(unit.areaSqm)}`,
      TENURE_WORD[unit.tenure],
      `חניה (מהבנייה): ${held(unit.builtParking)}`,
      `מחסן (מהבנייה): ${held(unit.builtStorage)}`,
    ].join(' · ');
  return [
    `בניין: ${record.name}`,
    `כתובת: ${record.addressLine}, ${record.city}`,
    `פרויקט: ${held(record.projectName)}`,
    `מועד המסירה: ${record.handoverDate}`,
    `סיום תקופת הבדק: ${record.warrantyEndDate}`,
    `סטטוס: ${BUILDING_STATUS_WORD[record.status]}`,
    `דירות: ${record.units.length}`,
    `חניות: ${record.parking.total}, מתוכן משויכות: ${record.parking.assigned}`,
    `מחסנים: ${record.storage.total}, מתוכם משויכים: ${record.storage.assigned}`,
    ...record.units.map(unitLine),
  ]
    .map((line) => `- ${line}`)
    .join('\n');
}

/** The letting active today, beside the built facts and never merged with them. */
function lettingLines(letting: UnitRecord['letting']): string[] {
  if (letting === null) return [`השכרה: ${NO_ACTIVE_LETTING}`];
  const listed = (values: string[]): string =>
    values.length === 0 ? NOT_RECORDED : values.join(', ');
  const rent =
    letting.rentAmount === null
      ? NOT_RECORDED
      : `${letting.rentAmount} ${letting.rentCurrency ?? ''}`.trim();
  const parties =
    letting.parties.length === 0
      ? NOT_RECORDED
      : letting.parties
          .map(
            (party) =>
              `${party.fullName} — ${ROLE_WORD[party.role] ?? party.role}`,
          )
          .join('; ');
  return [
    `השכרה: ${ACTIVE_LETTING}`,
    `תחילת השכירות: ${letting.startDate}`,
    `סיום השכירות: ${letting.endDate}`,
    `סיום האופציה: ${letting.optionEndDate ?? NOT_RECORDED}`,
    `דמי שכירות: ${rent}`,
    `חניה (מהשכירות): ${listed(letting.assignedParking)}`,
    `מחסן (מהשכירות): ${listed(letting.assignedStorage)}`,
    `צדדים: ${parties}`,
  ];
}

function readReply(
  reply: unknown,
  hits: PassageHit[],
  listFacts: boolean,
  record: OfficeRecord | null,
): { refused: boolean; text: string; citations: OfficeCitation[] } {
  // A turn that consulted a record says so in its refusal.
  const refusal =
    record === null ? OFFICE_TURN_REFUSAL : OFFICE_TURN_RECORD_REFUSAL;
  if (typeof reply !== 'object' || reply === null) {
    return refuse(refusal);
  }
  const value = reply as {
    answers?: unknown;
    text?: unknown;
    hit_indexes?: unknown;
    cites_record?: unknown;
    record_units?: unknown;
  };
  if (value.answers !== true) {
    return refuse(refusal);
  }
  const text = typeof value.text === 'string' ? value.text.trim() : '';
  if (text.length === 0) {
    return refuse(refusal);
  }
  const indexes = Array.isArray(value.hit_indexes) ? value.hit_indexes : [];
  const citations: OfficeCitation[] = [];
  // The id is the record loaded this turn, never one the model names. No record, no citation.
  if (value.cites_record === true && record !== null) {
    citations.push(recordCitation(record, value.record_units));
  }
  const seen = new Set<string>();
  for (const raw of indexes) {
    if (typeof raw !== 'number' || !Number.isInteger(raw)) continue;
    const hit = hits[raw - 1];
    if (!hit) continue;
    const key = `${hit.documentId}:${hit.page}`;
    if (seen.has(key)) continue;
    seen.add(key);
    citations.push({
      documentId: hit.documentId,
      page: hit.page,
      documentType: hit.documentType,
    });
  }
  if (citations.length === 0 && !listFacts) {
    return refuse(refusal);
  }
  return { refused: false, text, citations };
}

/**
 * #230. A Building record cited for exactly one of its own Unit lines links to that Unit; any other
 * record answer links to the Building. A unit number the record does not hold is dropped.
 */
function recordCitation(record: OfficeRecord, named: unknown): OfficeCitation {
  if (!isBuildingRecord(record)) {
    return { kind: 'record', record: 'unit', id: record.unitId };
  }
  const numbers = Array.isArray(named) ? named : [];
  const lines = new Set<string>();
  for (const number of numbers) {
    if (typeof number !== 'string') continue;
    const unit = record.units.find((line) => line.unitNumber === number.trim());
    if (unit) lines.add(unit.unitId);
  }
  const cite: OfficeCitation = {
    kind: 'record',
    record: 'building',
    id: record.buildingId,
  };
  const [only] = lines;
  return lines.size === 1 && only !== undefined
    ? { ...cite, unitId: only }
    : cite;
}

function refuse(text: string): {
  refused: boolean;
  text: string;
  citations: OfficeCitation[];
} {
  return { refused: true, text, citations: [] };
}
