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

/**
 * **Parties whose given name and family name are these, exactly. #236.**
 *
 * פתיחת טיוטה lists them beside a person nobody matched by ת.ז., phone or email, and the operator
 * decides. The system does not. A name search (`findPartiesByName`) is a fragment match for the
 * directory; this one is equality, because a fragment of a name is how two people become one.
 * Nothing but the id and the display name leaves.
 */
export async function partiesWithName(
  db: Queryable,
  spec: { givenName: string | null; familyName: string },
): Promise<PartyName[]> {
  const familyName = spec.familyName.trim();
  if (familyName.length === 0) return [];
  const givenName =
    spec.givenName === null || spec.givenName.trim() === ''
      ? null
      : spec.givenName.trim();
  const result = await db.query<PartyName>(
    `SELECT party_id, full_name
       FROM party
      WHERE party_kind = 'PERSON'
        AND family_name = $1
        AND given_name IS NOT DISTINCT FROM $2
      ORDER BY full_name, party_id`,
    [familyName, givenName],
  );
  return result.rows;
}

/**
 * **The party a ת.ז. would key on, if it exists. #235.** פתיחת טיוטה shows before the press
 * whether a lease's approved phone already belongs to the person it is about to write, and for a
 * person printed with an identifier that person is this row. The identifier goes in and an id
 * comes out: nothing about the value leaves.
 */
export async function partyIdByNationalId(
  db: Queryable,
  spec: { kind: 'PERSON' | 'COMPANY'; nationalId: string },
): Promise<string | null> {
  const result = await db.query<{ party_id: string }>(
    `SELECT party_id FROM party
      WHERE national_id_key = party_national_id_key($1, $2)`,
    [spec.kind, spec.nationalId],
  );
  return result.rows[0]?.party_id ?? null;
}

/**
 * Whether a party has an open primary contact on a channel. #235: a contact written from a lease
 * is primary only when the party has none, so a lease never demotes the number someone chose.
 */
export async function hasOpenPrimaryContact(
  db: Queryable,
  spec: { partyId: string; channel: 'PHONE' | 'EMAIL' },
): Promise<boolean> {
  const result = await db.query(
    `SELECT 1 FROM party_contact
      WHERE party_id = $1 AND channel = $2 AND is_primary AND valid_to IS NULL
      LIMIT 1`,
    [spec.partyId, spec.channel],
  );
  return (result.rowCount ?? 0) > 0;
}
