// The narrow name read. #107: the tenancy sheet needs a name for its title, and the name
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

const NAME_LIMIT = 20;

/**
 * Parties whose name matches, for a person picking one. Returns the name and
 * the id and nothing else — no contact and no identifier, same as
 * `listPartyNames`. The match is the name only.
 */
export async function findPartiesByName(
  db: Queryable,
  query: string,
): Promise<PartyName[]> {
  const trimmed = query.trim();
  if (trimmed.length === 0 || trimmed.length > 80) return [];
  const pattern = `%${trimmed.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
  const result = await db.query<PartyName>(
    `SELECT party_id, full_name
       FROM party
      WHERE full_name ILIKE $1 ESCAPE '\\'
      ORDER BY full_name, party_id
      LIMIT $2`,
    [pattern, NAME_LIMIT],
  );
  return result.rows;
}
