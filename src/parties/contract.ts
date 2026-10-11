// The parties module's public surface. Other modules, the composition root and the tests import
// this file and never internal/ (AGENTS.md, and src/kernel/boundary.test.ts proves it from 2.4).
//
// Write commands, the directory and the profile (#202), and from 6.5 one function that reads no
// table. Who is reachable on a number today is still `src/scope/`'s answer. The directory names
// who exists; it is not a second isolation join. `countDistinctIdentifiers` asks what a value
// *would* key on, not who exists, and returns a count.

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
  setPartyNationalId,
  upsertParty,
  upsertPartyContact,
} from './internal/commands.ts';
export type {
  DirectoryParty,
  DirectoryQuery,
  PartyProfile,
  ProfileContact,
} from './internal/directory.ts';
export {
  readPartyNationalId,
  readPartyProfile,
  searchParties,
} from './internal/directory.ts';
export type { PartyName } from './internal/lookup.ts';
export { findPartiesByName, listPartyNames } from './internal/lookup.ts';
export type { Queryable } from './internal/types.ts';
