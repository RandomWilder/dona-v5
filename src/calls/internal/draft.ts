// The Draft reply. #255.
//
// Asked for from the call page, once the brief's thread is ready. Grounded in
// the passages that brief cited. Never sent.

import {
  answerCallDraft,
  type DraftPassage,
  OFFICE_TURN_REFUSAL,
  passagesByIds,
} from '../../evidence/contract.ts';
import { createSettings, readBriefSettings } from '../../kernel/config.ts';
import { policyPassagesByIds } from '../../policy/contract.ts';
import {
  appendCallDraft,
  type CallTurn,
  loadCallThread,
  type OfficeCitation,
} from '../../staff/contract.ts';
import type { CallBriefRunner } from './brief.ts';
import { DESCRIPTION_MAX, getCall } from './commands.ts';

/** The frozen refusal, in English, beside the Hebrew sentence. */
export const DRAFT_REFUSAL_EN = 'The papers on file do not answer this.';

/** Hebrew when the text is Hebrew. Otherwise the language it was written in. */
export function replyLanguage(text: string): 'he' | 'other' {
  const hebrew = text.match(/\p{Script=Hebrew}/gu)?.length ?? 0;
  const latin = text.match(/\p{Script=Latin}/gu)?.length ?? 0;
  if (latin > hebrew) return 'other';
  return 'he';
}

function paperOf(
  citation: OfficeCitation,
): { documentId: string; page: number } | null {
  if (citation.kind === 'record') return null;
  if (citation.kind === 'policy') {
    return { documentId: citation.policyDocumentId, page: citation.page };
  }
  return { documentId: citation.documentId, page: citation.page };
}

function headingOf(citation: OfficeCitation): string {
  if (citation.kind === 'policy') {
    return `${citation.sectionLabel} · ${citation.title} · עמוד ${citation.page}`;
  }
  if (citation.kind === 'record') return 'כרטיס';
  return `${citation.documentType} עמוד ${citation.page}`;
}

async function citedPassages(
  db: CallBriefRunner['db'],
  turn: CallTurn,
): Promise<DraftPassage[]> {
  const [documents, policies] = await Promise.all([
    passagesByIds(db, turn.hitIds),
    policyPassagesByIds(db, turn.hitIds),
  ]);
  const byId = new Map<
    string,
    { documentId: string; page: number; text: string }
  >();
  for (const hit of documents) {
    byId.set(hit.passageId, {
      documentId: hit.documentId,
      page: hit.page,
      text: hit.text,
    });
  }
  for (const hit of policies) {
    byId.set(hit.passageId, {
      documentId: hit.policyDocumentId,
      page: hit.page,
      text: hit.text,
    });
  }
  const passages: DraftPassage[] = [];
  const seen = new Set<string>();
  for (const id of turn.hitIds) {
    const hit = byId.get(id);
    if (!hit || seen.has(id)) continue;
    const citation = turn.citations.find((item) => {
      const paper = paperOf(item);
      return paper?.documentId === hit.documentId && paper.page === hit.page;
    });
    if (!citation) continue;
    seen.add(id);
    passages.push({
      passageId: id,
      heading: headingOf(citation),
      text: hit.text,
      citation,
    });
  }
  return passages;
}

async function storeRefusal(
  runner: CallBriefRunner,
  callId: string,
  question: string,
  language: 'he' | 'other',
): Promise<void> {
  const hebrew = language === 'he';
  await appendCallDraft(runner.db, runner.clock, {
    callId,
    asker: 'copilot',
    question,
    answer: hebrew ? OFFICE_TURN_REFUSAL : DRAFT_REFUSAL_EN,
    rendering: hebrew ? null : OFFICE_TURN_REFUSAL,
    refused: true,
    citations: [],
    hitIds: [],
  });
}

/**
 * One draft on the call's thread. A call that is not ready, a guarantor, a
 * WhatsApp call, and a switch that is off write nothing and call no model.
 */
export async function writeCallDraft(
  runner: CallBriefRunner,
  callId: string,
  spoken?: string,
): Promise<void> {
  const call = await getCall(runner.db, callId);
  if (
    !call ||
    call.requester === null ||
    call.state === 'NEW' ||
    call.returned ||
    call.sourceChannel === 'WHATSAPP'
  ) {
    return;
  }
  const thread = await loadCallThread(runner.db, callId);
  if (thread?.status !== 'ready') return;
  const settings = await readBriefSettings(createSettings(runner.db));
  if (!settings.enabled) return;
  const brief = [...thread.turns]
    .reverse()
    .find((turn) => turn.kind === 'turn' && turn.asker === 'copilot');
  if (!brief) return;
  const source = (spoken?.trim() || call.description).slice(0, DESCRIPTION_MAX);
  const language = replyLanguage(source);
  const passages = await citedPassages(runner.db, brief);
  if (brief.refused || brief.citations.length === 0 || passages.length === 0) {
    await storeRefusal(runner, callId, source, language);
    return;
  }
  const decided = await answerCallDraft(
    {
      extractor: runner.extractor,
      model: settings.model,
    },
    { question: source, language, passages },
  );
  if (decided.refused) {
    await storeRefusal(runner, callId, source, language);
    return;
  }
  await appendCallDraft(runner.db, runner.clock, {
    callId,
    asker: 'copilot',
    question: source,
    answer: decided.text,
    rendering: language === 'he' ? null : decided.rendering,
    refused: false,
    citations: decided.citations,
    hitIds: decided.hitIds,
  });
}
