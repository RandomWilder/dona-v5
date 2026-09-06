// The parties module's public surface. Other modules, the composition root and the tests import
// this file and never internal/ (AGENTS.md, and src/kernel/boundary.test.ts proves it from 2.4).
//
// Write commands only. There is no query here on purpose: who is reachable on a number is
// `src/scope/`'s answer, and a second way to ask it would be a second isolation join.

export type {
  ContactChannel,
  PartyContactSpec,
  PartyKind,
  PartySpec,
  PreferredLanguage,
} from './internal/commands.ts';
export { upsertParty, upsertPartyContact } from './internal/commands.ts';
export type { Queryable } from './internal/types.ts';
