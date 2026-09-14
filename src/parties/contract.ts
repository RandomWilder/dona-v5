// The parties module's public surface. Other modules, the composition root and the tests import
// this file and never internal/ (AGENTS.md, and src/kernel/boundary.test.ts proves it from 2.4).
//
// Write commands, and from 6.5 one function that reads no table. Who is reachable on a number is
// still `src/scope/`'s answer, and a second way to ask it would still be a second isolation join —
// `countDistinctIdentifiers` asks what a value *would* key on, not who exists, and returns a count.

export type {
  ContactChannel,
  CreatePartySpec,
  PartyContactSpec,
  PartyKind,
  PartySpec,
  PreferredLanguage,
} from './internal/commands.ts';
export {
  countDistinctIdentifiers,
  createParty,
  upsertParty,
  upsertPartyContact,
} from './internal/commands.ts';
export type { Queryable } from './internal/types.ts';
