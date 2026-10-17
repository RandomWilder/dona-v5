// The Call brief. #252.
//
// One turn when a call reaches IDENTIFIED, after the emergency path, and never
// instead of it. The model call is scheduled; this function returns once the
// thread row exists. A refresh awaits the model and appends a turn.

import { listProvidersForParties } from '../../estate/contract.ts';
import type { RetrievalBound } from '../../evidence/contract.ts';
import {
  followUpNamesOtherUnit,
  OFFICE_TURN_RECORD_REFUSAL,
  runCallBrief,
} from '../../evidence/contract.ts';
import { type Clock, today } from '../../kernel/clock.ts';
import { createSettings, readBriefSettings } from '../../kernel/config.ts';
import type { Embedder } from '../../kernel/embeddings.ts';
import type { Extractor } from '../../kernel/extraction.ts';
import {
  accountsByIds,
  appendCallTurn,
  beginCallThread,
  type CallThread,
  loadCallThread,
  type OfficeCitation,
} from '../../staff/contract.ts';
import type { PartyTenancyRole } from '../../tenancy/contract.ts';
import { listRolesForParties } from '../../tenancy/contract.ts';
import { getCall } from './commands.ts';
import type { Queryable } from './types.ts';

const ROLE_RANK: Record<string, number> = {
  PRIMARY_TENANT: 0,
  CO_TENANT: 1,
  OCCUPANT: 2,
};

const PROVIDER_HE: Record<string, string> = {
  IN_HOUSE_CREW: 'צוות פנימי',
  CONTRACTOR: 'קבלן',
  DEVELOPER_WARRANTY: 'אחריות יזם',
};

export interface CallBriefFacts {
  requester: string;
  place: string | null;
  letting: string | null;
  related: string[];
}

export interface CallBriefPanel {
  kind: 'writing' | 'ready' | 'guarantor';
  facts: CallBriefFacts | null;
  turns: {
    asker: string;
    question: string;
    askedAt: Date;
    answer: string;
    refused: boolean;
    citations: OfficeCitation[];
  }[];
}

export interface CallBriefRunner {
  db: Queryable;
  clock: Clock;
  extractor: Extractor;
  embedder: Embedder;
  /** Runs the model after the caller has returned. Absent, it is deferred. */
  schedule?: (work: () => Promise<void>) => void;
}

function live(role: PartyTenancyRole, day: string): boolean {
  return (
    role.role !== 'GUARANTOR' &&
    role.status === 'ACTIVE' &&
    role.start_date <= day &&
    role.end_date >= day
  );
}

function lettingLine(role: PartyTenancyRole): string {
  return `${role.start_date}–${role.end_date}`;
}

async function relatedCalls(
  db: Queryable,
  callId: string,
  partyId: string,
): Promise<string[]> {
  const { rows } = await db.query<{ description: string }>(
    `SELECT description
       FROM service_call
      WHERE requester_party_id = $1
        AND service_call_id <> $2
      ORDER BY opened_at DESC
      LIMIT 5`,
    [partyId, callId],
  );
  return rows.map((row) => row.description);
}

interface ResolvedBrief {
  bounds: RetrievalBound[];
  context: string;
  providerOnly: boolean;
  facts: CallBriefFacts;
  partyId: string;
  unitNumber: string | null;
  tenancyId: string | null;
}

const QUESTION_MAX = 2000;

async function resolveBrief(
  db: Queryable,
  clock: Clock,
  callId: string,
  partyId: string,
  requester: string,
): Promise<ResolvedBrief | 'guarantor'> {
  const related = await relatedCalls(db, callId, partyId);
  const providers = await listProvidersForParties(db, [partyId]);
  const provider = providers[0];
  if (provider) {
    const kind = PROVIDER_HE[provider.kind] ?? provider.kind;
    const facts = {
      requester,
      place: kind,
      letting: null,
      related,
    };
    return {
      bounds: [],
      providerOnly: true,
      partyId,
      unitNumber: null,
      tenancyId: null,
      facts,
      context: `ספק שירות: ${requester}\nסוג: ${kind}\nזו הרשומה של הספק ורק היא.`,
    };
  }

  const roles = await listRolesForParties(db, [partyId]);
  const guarantorOnly =
    roles.length > 0 && roles.every((role) => role.role === 'GUARANTOR');
  if (guarantorOnly) return 'guarantor';

  const day = today(clock);
  const current = roles
    .filter((role) => live(role, day))
    .sort((a, b) => (ROLE_RANK[a.role] ?? 9) - (ROLE_RANK[b.role] ?? 9));
  const letting = current[0];
  if (letting) {
    const facts = {
      requester,
      place: `דירה ${letting.unit_number}`,
      letting: lettingLine(letting),
      related,
    };
    return {
      bounds: [
        { kind: 'tenancy', id: letting.tenancy_id },
        { kind: 'building-paper', id: letting.building_id },
      ],
      providerOnly: false,
      partyId,
      unitNumber: letting.unit_number,
      tenancyId: letting.tenancy_id,
      facts,
      context: [
        `פונה: ${requester}`,
        `דירה: ${letting.unit_number}`,
        `שכירות: ${lettingLine(letting)}`,
      ].join('\n'),
    };
  }

  const past = roles
    .filter((role) => role.role !== 'GUARANTOR')
    .sort((a, b) => (a.end_date < b.end_date ? 1 : -1));
  const unit = past[0];
  const facts = {
    requester,
    place: unit ? `דירה ${unit.unit_number}` : null,
    letting: null,
    related,
  };
  return {
    bounds: unit ? [{ kind: 'unit', id: unit.unit_id }] : [],
    providerOnly: false,
    partyId,
    unitNumber: unit?.unit_number ?? null,
    tenancyId: null,
    facts,
    context: unit
      ? `פונה: ${requester}\nדירה: ${unit.unit_number}\nאין השכרה פעילה`
      : `פונה: ${requester}`,
  };
}

export async function loadCallBriefPanel(
  db: Queryable,
  clock: Clock,
  callId: string,
): Promise<CallBriefPanel | null> {
  const thread = await loadCallThread(db, callId);
  if (!thread) return null;
  if (thread.status === 'skipped' && thread.skipReason === 'guarantor') {
    return { kind: 'guarantor', facts: null, turns: [] };
  }
  if (thread.status === 'skipped') return null;
  if (thread.status === 'writing' && thread.turns.length === 0) {
    return { kind: 'writing', facts: null, turns: [] };
  }
  const call = await getCall(db, callId);
  const partyId = call?.requester?.id ?? null;
  const name = call?.requester?.name ?? '';
  const resolved =
    partyId === null
      ? null
      : await resolveBrief(db, clock, callId, partyId, name);
  const facts =
    resolved === null || resolved === 'guarantor' ? null : resolved.facts;
  return {
    kind: 'ready',
    facts,
    turns: thread.turns.map((turn) => ({
      asker: turn.asker,
      question: turn.question,
      askedAt: turn.askedAt,
      answer: turn.answer,
      refused: turn.refused,
      citations: turn.citations,
    })),
  };
}

async function resolvedFor(
  db: Queryable,
  clock: Clock,
  callId: string,
): Promise<ResolvedBrief | null> {
  const call = await getCall(db, callId);
  const partyId = call?.requester?.id;
  if (!call || partyId === undefined) return null;
  const resolved = await resolveBrief(
    db,
    clock,
    callId,
    partyId,
    call.requester?.name ?? '',
  );
  if (resolved === 'guarantor') return null;
  return resolved;
}

function defer(work: () => Promise<void>): void {
  setImmediate(() => {
    void work().catch((error: unknown) => {
      console.error(
        'call brief failed',
        error instanceof Error ? error.message : 'unknown',
      );
    });
  });
}

/**
 * Opens the brief after identification. Returns before the model runs.
 * A call that is not identified, a second call, and every exclusion write
 * nothing to the model.
 */
export async function startCallBrief(
  runner: CallBriefRunner,
  callId: string,
): Promise<void> {
  const call = await getCall(runner.db, callId);
  if (
    !call ||
    call.requester === null ||
    call.state === 'NEW' ||
    call.returned
  ) {
    return;
  }
  const settings = await readBriefSettings(createSettings(runner.db));
  const roles = await listRolesForParties(runner.db, [call.requester.id]);
  const guarantorOnly =
    roles.length > 0 && roles.every((role) => role.role === 'GUARANTOR');
  const skip = guarantorOnly
    ? 'guarantor'
    : !settings.enabled
      ? 'off'
      : call.sourceChannel === 'WHATSAPP'
        ? 'whatsapp'
        : null;
  const opened = await beginCallThread(runner.db, runner.clock, {
    callId,
    status: skip === null ? 'writing' : 'skipped',
    skipReason: skip,
  });
  if (!opened || skip !== null) return;

  const run = () => writeCallBrief(runner, callId, false);
  if (runner.schedule) runner.schedule(run);
  else defer(run);
}

/** The model's turn. A refresh appends once a turn exists; before that it writes the first. */
export async function writeCallBrief(
  runner: CallBriefRunner,
  callId: string,
  refresh: boolean,
): Promise<void> {
  const thread: CallThread | null = await loadCallThread(runner.db, callId);
  if (!thread || thread.status === 'skipped') return;
  const first = thread.turns.length === 0;
  if (refresh && !first && thread.status !== 'ready') return;
  if (!refresh && !first) return;
  const call = await getCall(runner.db, callId);
  if (!call) return;
  const settings = await readBriefSettings(createSettings(runner.db));
  if (!settings.enabled) return;
  const resolved = await resolvedFor(runner.db, runner.clock, callId);
  if (!resolved) return;
  await runCallBrief(
    {
      db: runner.db,
      clock: runner.clock,
      extractor: runner.extractor,
      embedder: runner.embedder,
      model: settings.model,
    },
    {
      callId,
      question: call.description,
      bounds: resolved.bounds,
      context: resolved.context,
      providerOnly: resolved.providerOnly,
      refresh: refresh && !first,
    },
  );
}

export async function refreshCallBrief(
  runner: CallBriefRunner,
  callId: string,
): Promise<void> {
  await writeCallBrief(runner, callId, true);
}

function nameStandsIn(question: string, name: string): boolean {
  const trimmed = name.trim();
  if (trimmed.length < 2) return false;
  const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(
    `(?:^|[^\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`,
    'u',
  ).test(question);
}

async function askerLabel(
  db: Queryable,
  staffAccountId: string,
): Promise<string> {
  const [account] = await accountsByIds(db, [staffAccountId]);
  const name = account?.displayName?.trim() ?? '';
  if (name.length > 0) return name;
  if (account?.email) return account.email;
  return staffAccountId;
}

async function otherUnitNumbers(
  db: Queryable,
  own: string | null,
): Promise<string[]> {
  const { rows } = await db.query<{ unit_number: string }>(
    `SELECT unit_number FROM unit
      WHERE $1::text IS NULL OR unit_number <> $1`,
    [own],
  );
  return rows.map((row) => row.unit_number);
}

/** A party who is not the requester and not on the bound tenancy, named in the question. */
async function namesAnotherParty(
  db: Queryable,
  question: string,
  partyId: string,
  ownName: string,
  tenancyId: string | null,
): Promise<boolean> {
  const own = ownName.trim();
  const remainder = own.length >= 2 ? question.split(own).join(' ') : question;
  const { rows } = await db.query<{ full_name: string }>(
    `SELECT full_name
       FROM party
      WHERE party_id <> $1
        AND length(btrim(full_name)) >= 2
        AND strpos($2, full_name) > 0
        AND (
          $3::uuid IS NULL
          OR NOT EXISTS (
            SELECT 1 FROM tenancy_party tp
             WHERE tp.party_id = party.party_id
               AND tp.tenancy_id = $3
          )
        )
      LIMIT 20`,
    [partyId, remainder, tenancyId],
  );
  const ownTokens = new Set(
    own.split(/\s+/).filter((token) => token.length >= 2),
  );
  return rows.some((row) => {
    const name = row.full_name.trim();
    if (ownTokens.has(name)) return false;
    return nameStandsIn(remainder, name);
  });
}

/**
 * One follow-up on the call's thread. Same bound and exclusions as the brief.
 * A question outside that bound is the record refusal, and the model is not called.
 */
export async function askCallFollowUp(
  runner: CallBriefRunner,
  callId: string,
  spec: { staffAccountId: string; question: string },
): Promise<void> {
  const question = spec.question.trim();
  if (question.length === 0 || question.length > QUESTION_MAX) return;
  const thread = await loadCallThread(runner.db, callId);
  if (thread?.status !== 'ready') return;
  const settings = await readBriefSettings(createSettings(runner.db));
  if (!settings.enabled) return;
  const resolved = await resolvedFor(runner.db, runner.clock, callId);
  if (!resolved) return;
  const asker = await askerLabel(runner.db, spec.staffAccountId);
  const outside =
    followUpNamesOtherUnit(
      question,
      resolved.unitNumber,
      await otherUnitNumbers(runner.db, resolved.unitNumber),
    ) ||
    (await namesAnotherParty(
      runner.db,
      question,
      resolved.partyId,
      resolved.facts.requester,
      resolved.tenancyId,
    ));
  if (outside) {
    await appendCallTurn(runner.db, runner.clock, {
      callId,
      asker,
      question,
      answer: OFFICE_TURN_RECORD_REFUSAL,
      refused: true,
      citations: [],
      hitIds: [],
    });
    return;
  }
  await runCallBrief(
    {
      db: runner.db,
      clock: runner.clock,
      extractor: runner.extractor,
      embedder: runner.embedder,
      model: settings.model,
    },
    {
      callId,
      question,
      bounds: resolved.bounds,
      context: resolved.context,
      providerOnly: resolved.providerOnly,
      refresh: false,
      followUp: true,
      asker,
    },
  );
}
