// The one read this module has. #107: the tenancy sheet needs a name for its title, and the name
// lives here. Who is reachable on a number is still `src/scope/`'s answer; this takes ids the
// caller already holds and returns no contact and no identifier.
import type { Queryable } from './types.ts';

export interface PartyName {
  party_id: string;
  full_name: string;
}

export async function listPartyNames(
  db: Queryable,
  partyIds: readonly string[],
): Promise<PartyName[]> {
  if (partyIds.length === 0) return [];
  const result = await db.query<PartyName>(
    `SELECT party_id, full_name
       FROM party
      WHERE party_id = ANY($1::uuid[])`,
    [partyIds],
  );
  return result.rows;
}
