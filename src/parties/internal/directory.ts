// The directory and the profile. #202. The identifier, #204.
//
// Both reads name who exists. Neither answers who is reachable on a number today — that is
// still `src/scope/`'s join. The profile returns a four-character suffix of the normalised
// identifier and does not return the column. `readPartyNationalId` is the one statement that
// reads `national_id`, and only the reveal route calls it. A phone or an email arrives already
// normalised: the composition root runs the door's normalisers, and a second copy here is the
// one that would drift. A ת.ז. is not normalised here either: the search compares
// `party_national_id_key`, which is the database's fold.

import { KernelError } from '../../kernel/errors.ts';
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
  /** A phone search matched a closed contact and no open one. */
  formerNumber: boolean;
}

export type DirectoryQuery =
  | { kind: 'all' }
  | { kind: 'name'; words: readonly string[] }
  | { kind: 'phone'; value: string }
  | { kind: 'email'; value: string }
  | { kind: 'nationalId'; value: string };

export interface ProfileContact {
  contactId: string;
  channel: ContactChannel;
  value: string;
  label: string | null;
  isPrimary: boolean;
  validFrom: string;
  validTo: string | null;
}

export interface SameNameParty {
  partyId: string;
  fullName: string;
}

export interface PartyProfile {
  partyId: string;
  kind: PartyKind;
  givenName: string | null;
  familyName: string | null;
  legalName: string | null;
  fullName: string;
  language: PreferredLanguage;
  /** Last four characters of the normalised identifier. Null when the party has none. */
  nationalIdSuffix: string | null;
  /** Other parties with this display name. A count and a link, never a merge. */
  sameName: SameNameParty[];
  contacts: ProfileContact[];
}

interface DirectoryRow {
  party_id: string;
  full_name: string;
  preferred_language: string;
  primary_phone: string | null;
  primary_email: string | null;
  former_number: boolean;
}

interface ProfileRow {
  party_id: string;
  party_kind: string;
  given_name: string | null;
  family_name: string | null;
  legal_name: string | null;
  full_name: string;
  preferred_language: string;
  national_id_suffix: string | null;
}

interface ContactRow {
  contact_id: string;
  channel: string;
  value: string;
  label: string | null;
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
 * whether or not it is still open. A phone match that is only a closed contact is a former
 * number. The row's phone and email are the open primaries.
 * A ת.ז. matches `party_national_id_key` for either registry. The row still carries no identifier.
 */
export async function searchParties(
  db: Queryable,
  query: DirectoryQuery,
): Promise<DirectoryParty[]> {
  if (query.kind === 'name' && query.words.length === 0) return [];
  const phone = query.kind === 'phone' ? query.value : null;
  const email = query.kind === 'email' ? query.value : null;
  const words = query.kind === 'name' ? [...query.words] : null;
  const nationalId = query.kind === 'nationalId' ? query.value : null;
  const result = await db.query<DirectoryRow>(
    `SELECT p.party_id,
            p.full_name,
            p.preferred_language,
            phone.value AS primary_phone,
            email.value AS primary_email,
            CASE
              WHEN $1::text IS NULL THEN false
              ELSE COALESCE((
                SELECT bool_and(c.valid_to IS NOT NULL)
                  FROM party_contact c
                 WHERE c.party_id = p.party_id
                   AND c.channel = 'PHONE'
                   AND c.value = $1
              ), false)
            END AS former_number
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
        AND ($4::text IS NULL OR p.national_id_key IN (
              party_national_id_key('PERSON', $4),
              party_national_id_key('COMPANY', $4)
            ))
      ORDER BY p.full_name, p.party_id`,
    [phone, email, words, nationalId],
  );
  return result.rows.map((row) => ({
    partyId: row.party_id,
    fullName: row.full_name,
    primaryPhone: row.primary_phone,
    primaryEmail: row.primary_email,
    language: language(row.preferred_language),
    formerNumber: row.former_number,
  }));
}

/**
 * One party and every contact it held. Null when the id names nobody.
 *
 * The suffix is four characters of the normalised identifier. The column stays in the database.
 */
export async function readPartyProfile(
  db: Queryable,
  partyId: string,
): Promise<PartyProfile | null> {
  const party = await db.query<ProfileRow>(
    `SELECT party_id, party_kind, given_name, family_name, legal_name,
            full_name, preferred_language,
            CASE
              WHEN national_id_key IS NULL THEN NULL
              ELSE right(split_part(national_id_key, ':', 2), 4)
            END AS national_id_suffix
       FROM party
      WHERE party_id = $1`,
    [partyId],
  );
  const row = party.rows[0];
  if (!row) return null;
  const sameName = await db.query<{ party_id: string; full_name: string }>(
    `SELECT party_id, full_name
       FROM party
      WHERE full_name = $1
        AND party_id <> $2
      ORDER BY party_id`,
    [row.full_name, row.party_id],
  );
  const contacts = await db.query<ContactRow>(
    `SELECT contact_id, channel, value, label, is_primary,
            valid_from::text AS valid_from, valid_to::text AS valid_to
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
    nationalIdSuffix: row.national_id_suffix,
    sameName: sameName.rows.map((other) => ({
      partyId: other.party_id,
      fullName: other.full_name,
    })),
    contacts: contacts.rows.map((contact) => ({
      contactId: contact.contact_id,
      channel: channel(contact.channel),
      value: contact.value,
      label: contact.label,
      isPrimary: contact.is_primary,
      validFrom: contact.valid_from,
      validTo: contact.valid_to,
    })),
  };
}

/**
 * The stored identifier. The one read of the column.
 *
 * Null when the party has none. Throws when the id names nobody. The value is pii: the reveal
 * route is the caller, and it writes the audit line. This function does not.
 */
export async function readPartyNationalId(
  db: Queryable,
  partyId: string,
): Promise<string | null> {
  const result = await db.query<{ national_id: string | null }>(
    `SELECT national_id FROM party WHERE party_id = $1`,
    [partyId],
  );
  if (result.rows.length === 0) {
    throw new KernelError('not_found', 'party not found');
  }
  return result.rows[0]?.national_id ?? null;
}
