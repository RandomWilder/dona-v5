// The directory and the profile. #202.
//
// Both reads name who exists. Neither answers who is reachable on a number today — that is
// still `src/scope/`'s join — and neither statement selects `national_id`. A phone or an email
// arrives already normalised: the composition root runs the door's normalisers, and a second
// copy here is the one that would drift.
import type {
  ContactChannel,
  PartyKind,
  PreferredLanguage,
} from './commands.ts';
import type { Queryable } from './types.ts';

export interface DirectoryParty {
  partyId: string;
  fullName: string;
  primaryPhone: string | null;
  primaryEmail: string | null;
  language: PreferredLanguage;
}

export type DirectoryQuery =
  | { kind: 'all' }
  | { kind: 'name'; words: readonly string[] }
  | { kind: 'phone'; value: string }
  | { kind: 'email'; value: string };

export interface ProfileContact {
  channel: ContactChannel;
  value: string;
  isPrimary: boolean;
  validFrom: string;
  validTo: string | null;
}

export interface PartyProfile {
  partyId: string;
  kind: PartyKind;
  givenName: string | null;
  familyName: string | null;
  legalName: string | null;
  fullName: string;
  language: PreferredLanguage;
  contacts: ProfileContact[];
}

interface DirectoryRow {
  party_id: string;
  full_name: string;
  preferred_language: string;
  primary_phone: string | null;
  primary_email: string | null;
}

interface ProfileRow {
  party_id: string;
  party_kind: string;
  given_name: string | null;
  family_name: string | null;
  legal_name: string | null;
  full_name: string;
  preferred_language: string;
}

interface ContactRow {
  channel: string;
  value: string;
  is_primary: boolean;
  valid_from: string;
  valid_to: string | null;
}

const LANGUAGES = ['he', 'ar', 'ru', 'fr', 'en'] as const;

function language(value: string): PreferredLanguage {
  for (const known of LANGUAGES) {
    if (value === known) return known;
  }
  return 'he';
}

function kind(value: string): PartyKind {
  return value === 'COMPANY' ? 'COMPANY' : 'PERSON';
}

function channel(value: string): ContactChannel {
  return value === 'EMAIL' ? 'EMAIL' : 'PHONE';
}

/**
 * Every party, or the ones a name word, a normalised phone or a folded email finds.
 *
 * A name matches a whole word of the display name, which is the given and family name or the
 * legal name. A fragment of a word matches nothing. A phone or an email matches a contact
 * whether or not it is still open. The row's phone and email are the open primaries.
 */
export async function searchParties(
  db: Queryable,
  query: DirectoryQuery,
): Promise<DirectoryParty[]> {
  if (query.kind === 'name' && query.words.length === 0) return [];
  const phone = query.kind === 'phone' ? query.value : null;
  const email = query.kind === 'email' ? query.value : null;
  const words = query.kind === 'name' ? [...query.words] : null;
  const result = await db.query<DirectoryRow>(
    `SELECT p.party_id,
            p.full_name,
            p.preferred_language,
            phone.value AS primary_phone,
            email.value AS primary_email
       FROM party p
       LEFT JOIN LATERAL (
         SELECT value
           FROM party_contact
          WHERE party_id = p.party_id
            AND channel = 'PHONE'
            AND is_primary
            AND valid_to IS NULL
          ORDER BY valid_from DESC, contact_id
          LIMIT 1
       ) phone ON true
       LEFT JOIN LATERAL (
         SELECT value
           FROM party_contact
          WHERE party_id = p.party_id
            AND channel = 'EMAIL'
            AND is_primary
            AND valid_to IS NULL
          ORDER BY valid_from DESC, contact_id
          LIMIT 1
       ) email ON true
      WHERE ($1::text IS NULL OR EXISTS (
              SELECT 1 FROM party_contact c
               WHERE c.party_id = p.party_id
                 AND c.channel = 'PHONE'
                 AND c.value = $1
            ))
        AND ($2::text IS NULL OR EXISTS (
              SELECT 1 FROM party_contact c
               WHERE c.party_id = p.party_id
                 AND c.channel = 'EMAIL'
                 AND lower(c.value) = $2
            ))
        AND ($3::text[] IS NULL OR NOT EXISTS (
              SELECT 1 FROM unnest($3::text[]) AS q(word)
               WHERE NOT EXISTS (
                 SELECT 1
                   FROM unnest(string_to_array(p.full_name, ' ')) AS n(word)
                  WHERE n.word <> ''
                    AND lower(n.word) = lower(q.word)
               )
            ))
      ORDER BY p.full_name, p.party_id`,
    [phone, email, words],
  );
  return result.rows.map((row) => ({
    partyId: row.party_id,
    fullName: row.full_name,
    primaryPhone: row.primary_phone,
    primaryEmail: row.primary_email,
    language: language(row.preferred_language),
  }));
}

/** One party and every contact it held. Null when the id names nobody. No identifier. */
export async function readPartyProfile(
  db: Queryable,
  partyId: string,
): Promise<PartyProfile | null> {
  const party = await db.query<ProfileRow>(
    `SELECT party_id, party_kind, given_name, family_name, legal_name,
            full_name, preferred_language
       FROM party
      WHERE party_id = $1`,
    [partyId],
  );
  const row = party.rows[0];
  if (!row) return null;
  const contacts = await db.query<ContactRow>(
    `SELECT channel, value, is_primary, valid_from::text AS valid_from,
            valid_to::text AS valid_to
       FROM party_contact
      WHERE party_id = $1
      ORDER BY (valid_to IS NULL) DESC, valid_from DESC, channel, contact_id`,
    [partyId],
  );
  return {
    partyId: row.party_id,
    kind: kind(row.party_kind),
    givenName: row.given_name,
    familyName: row.family_name,
    legalName: row.legal_name,
    fullName: row.full_name,
    language: language(row.preferred_language),
    contacts: contacts.rows.map((contact) => ({
      channel: channel(contact.channel),
      value: contact.value,
      isPrimary: contact.is_primary,
      validFrom: contact.valid_from,
      validTo: contact.valid_to,
    })),
  };
}
