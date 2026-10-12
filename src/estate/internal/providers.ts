// A service provider is a company party. #208.
//
// The profile marks one through this file. The importer creates the party when it
// creates a provider. Parties does not import estate; the composition root asks
// this read and paints the label.
import { createAuditLog } from '../../kernel/audit.ts';
import type { Clock } from '../../kernel/clock.ts';
import { inTransaction } from '../../kernel/db.ts';
import { KernelError } from '../../kernel/errors.ts';
import { newId } from '../../kernel/ids.ts';
import { validId } from '../../kernel/validate.ts';
import type { ProviderKind, Queryable } from './plan.ts';

const KINDS: readonly ProviderKind[] = [
  'IN_HOUSE_CREW',
  'CONTRACTOR',
  'DEVELOPER_WARRANTY',
];

const UNIQUE_VIOLATION = '23505';

export interface LinkedProvider {
  providerId: string;
  partyId: string;
  kind: ProviderKind;
}

export interface ProviderForParty {
  partyId: string;
  kind: ProviderKind;
}

function providerKind(value: string): ProviderKind {
  for (const kind of KINDS) {
    if (value === kind) return kind;
  }
  throw new KernelError('invalid', 'kind is not a provider kind');
}

function pgCode(error: unknown): string | undefined {
  if (error !== null && typeof error === 'object' && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    return typeof code === 'string' ? code : undefined;
  }
  return undefined;
}

/**
 * Marks a company a service provider, or changes the kind on the provider it
 * already is. A person is refused and nothing is written. The audit row names
 * the party and the kind, not the company's name.
 */
export async function linkProvider(
  db: Queryable,
  clock: Clock,
  spec: {
    partyId: string;
    kind: string;
    actorId: string;
    actorRole?: string;
  },
): Promise<LinkedProvider> {
  const partyId = validId(spec.partyId, 'party');
  const kind = providerKind(spec.kind);
  const actorId = validId(spec.actorId, 'actor');
  return inTransaction(db, async (tx) => {
    const party = await tx.query<{
      party_kind: string;
      legal_name: string | null;
    }>(`SELECT party_kind, legal_name FROM party WHERE party_id = $1`, [
      partyId,
    ]);
    const row = party.rows[0];
    if (!row) throw new KernelError('not_found', 'party not found');
    if (row.party_kind !== 'COMPANY') {
      throw new KernelError('invalid', 'a person is not a service provider');
    }
    if (row.legal_name === null || row.legal_name === '') {
      throw new KernelError('invalid', 'a company needs a legal name');
    }
    const existing = await tx.query<{ provider_id: string }>(
      `SELECT provider_id FROM provider WHERE party_id = $1`,
      [partyId],
    );
    let providerId = existing.rows[0]?.provider_id;
    if (providerId === undefined) {
      providerId = newId();
      try {
        await tx.query('SAVEPOINT link_provider');
        await tx.query(
          `INSERT INTO provider
             (provider_id, name, provider_kind, party_id, party_kind)
           VALUES ($1, $2, $3, $4, 'COMPANY')`,
          [providerId, row.legal_name, kind, partyId],
        );
        await tx.query('RELEASE SAVEPOINT link_provider');
      } catch (error) {
        await tx.query('ROLLBACK TO SAVEPOINT link_provider');
        if (pgCode(error) === UNIQUE_VIOLATION) {
          throw new KernelError('conflict', 'a provider already has that name');
        }
        throw error;
      }
    } else {
      await tx.query(
        `UPDATE provider SET provider_kind = $2 WHERE provider_id = $1`,
        [providerId, kind],
      );
    }
    await createAuditLog(tx, clock).write(
      {
        actorKind: 'staff',
        actorId,
        actorRole: spec.actorRole,
        action: 'estate.provider.link',
        subjectId: partyId,
        inputs: { partyId, providerId, kind },
      },
      { outcome: 'ok' },
    );
    return { providerId, partyId, kind };
  });
}

/** The provider kind each of these parties plays, if it plays one. */
export async function listProvidersForParties(
  db: Queryable,
  partyIds: readonly string[],
): Promise<ProviderForParty[]> {
  if (partyIds.length === 0) return [];
  const result = await db.query<{ party_id: string; provider_kind: string }>(
    `SELECT party_id, provider_kind
       FROM provider
      WHERE party_id = ANY($1::uuid[])`,
    [partyIds],
  );
  return result.rows.flatMap((row) => {
    const kind = KINDS.find((known) => known === row.provider_kind);
    if (kind === undefined) return [];
    return [{ partyId: row.party_id, kind }];
  });
}
