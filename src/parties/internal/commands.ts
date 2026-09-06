// The parties module's write commands. Slice 2.4, and the caller 2.1 predicted: "2.3 and 2.4 are
// this module's callers."
//
// Two upserts and nothing else. There is no read model here and no query on this module's contract,
// deliberately — who is reachable on a number is `src/scope/`'s answer and never this module's,
// which is foundation rule 1 expressed as a module boundary rather than as a comment.
//
// Both statements are `INSERT ... ON CONFLICT (<natural key>) DO UPDATE ... RETURNING`, which is
// the estate importer's shape at 1.11 and for its reasons: the id is *proposed*, so on a second run
// Postgres returns the id already there, and `DO UPDATE` rather than `DO NOTHING` because DO NOTHING
// returns no row and an import correcting a typo in a name should correct it.
import { KernelError } from '../../kernel/errors.ts';
import { newId } from '../../kernel/ids.ts';
import { INSERTED, type UpsertResult } from '../../kernel/upsert.ts';
import type { Queryable } from './types.ts';

export type PartyKind = 'PERSON' | 'COMPANY';
export type ContactChannel = 'PHONE' | 'EMAIL';
export type PreferredLanguage = 'he' | 'ar' | 'ru' | 'fr' | 'en';

export interface PartySpec {
  kind: PartyKind;
  /** -- pii. */
  fullName: string;
  /**
   * -- pii. **Required by this command, where the column is nullable.**
   *
   * `party`'s natural key is `national_id_key`, generated from this and `party_kind`
   * (`0009_import_natural_keys.sql`), and a null identifier produces a null key, which a UNIQUE
   * index ignores. So an upsert with no identifier is an insert wearing an upsert's name: run it
   * twice and there are two people. The schema keeps the column nullable because the lease flow
   * (A2, SPEC-flows.md) legitimately creates a party from a document that names no ת.ז.; that flow
   * needs a `createParty`, and it is week 4's to write, with the confirmation step around it.
   */
  nationalId: string;
  preferredLanguage: PreferredLanguage;
}

export interface PartyContactSpec {
  partyId: string;
  channel: ContactChannel;
  /**
   * -- pii. **Already normalised.** A `PHONE` value reaches `phone_is_e164` exactly as it is given
   * here, so the caller runs `normalisePhone` from `src/scope/`'s contract first. This command does
   * not normalise, because a normaliser in two places is one that drifts, and `src/scope/` owns the
   * one that the inbound lookup also uses — the two halves have to be the same function or the
   * number stored and the number asked for stop matching (SPEC-scope.md).
   */
  value: string;
  isPrimary: boolean;
  validFrom: string;
  /** Null = still current, which the exclusion constraint reads as unbounded. */
  validTo: string | null;
  /** Written by the injected clock or not at all — there is no `DEFAULT now()` (SPEC.md). */
  verifiedAt: Date | null;
}

/** One person or company, identified by its normalised ת.ז. / ח.פ. */
export async function upsertParty(
  db: Queryable,
  spec: PartySpec,
): Promise<UpsertResult> {
  const result = await db.query<{ party_id: string; inserted: boolean }>(
    `INSERT INTO party (party_id, party_kind, full_name, national_id, preferred_language)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (national_id_key) DO UPDATE
       SET full_name = EXCLUDED.full_name,
           national_id = EXCLUDED.national_id,
           preferred_language = EXCLUDED.preferred_language
     RETURNING party_id, ${INSERTED}`,
    [
      newId(),
      spec.kind,
      spec.fullName,
      spec.nationalId,
      spec.preferredLanguage,
    ],
  );
  const row = result.rows[0];
  if (!row) {
    // The error names no value. A message is a log line the moment anything catches it, and
    // SPEC.md's rule is that PII never reaches one.
    throw new KernelError('conflict', 'party upsert returned no row');
  }
  return { id: row.party_id, inserted: row.inserted };
}

/**
 * One channel belonging to one party over one period.
 *
 * The conflict target is `(party_id, channel, value, valid_from)`, added at 2.4 for this statement:
 * 2.1's `contact_value_resolves_to_one_party` is an EXCLUDE constraint and an EXCLUDE constraint
 * cannot be an `ON CONFLICT` arbiter. `ON CONFLICT` runs its arbiter check *before* any index
 * insertion, so the unique index resolves the re-run and the exclusion constraint is never reached —
 * measured with a probe at 2.4 rather than reasoned about, and asserted in
 * `src/parties/schema.test.ts`.
 *
 * `valid_from` is in the key rather than out of it because a contact that ends and later resumes is
 * two rows, which is the same fact the exclusion constraint states: one number, two periods, and
 * never both on one day.
 */
export async function upsertPartyContact(
  db: Queryable,
  spec: PartyContactSpec,
): Promise<UpsertResult> {
  const result = await db.query<{ contact_id: string; inserted: boolean }>(
    `INSERT INTO party_contact (contact_id, party_id, channel, value, is_primary,
                                valid_from, valid_to, verified_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (party_id, channel, value, valid_from) DO UPDATE
       SET is_primary = EXCLUDED.is_primary,
           valid_to = EXCLUDED.valid_to,
           verified_at = EXCLUDED.verified_at
     RETURNING contact_id, ${INSERTED}`,
    [
      newId(),
      spec.partyId,
      spec.channel,
      spec.value,
      spec.isPrimary,
      spec.validFrom,
      spec.validTo,
      spec.verifiedAt,
    ],
  );
  const row = result.rows[0];
  if (!row) {
    throw new KernelError('conflict', 'party contact upsert returned no row');
  }
  return { id: row.contact_id, inserted: row.inserted };
}
