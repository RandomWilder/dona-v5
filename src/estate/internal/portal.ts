// The switch that puts one Building into the portal. #277.
//
// The column is the whole of the fact. A tenant request reads it then; nothing
// copies it onto the tenant session. Turning it on asks the portal which
// current legal texts are still placeholders, and writes nothing while any are.

import { createAuditLog } from '../../kernel/audit.ts';
import type { Clock } from '../../kernel/clock.ts';
import { inTransaction, type Queryable } from '../../kernel/db.ts';
import { KernelError } from '../../kernel/errors.ts';
import {
  currentPlaceholderTexts,
  type PlaceholderText,
} from '../../portal/contract.ts';

export async function buildingInPortal(
  db: Queryable,
  buildingId: string,
): Promise<boolean> {
  const { rows } = await db.query<{ portal_enabled: boolean }>(
    `SELECT portal_enabled FROM building WHERE building_id = $1`,
    [buildingId],
  );
  const row = rows[0];
  if (row === undefined) {
    throw new KernelError('not_found', 'building not found');
  }
  return row.portal_enabled;
}

export interface PortalSwitchActor {
  staffAccountId: string;
  role: string;
}

export type PortalSwitchResult =
  | { enabled: boolean }
  | { enabled: false; blocked: readonly PlaceholderText[] };

export async function setBuildingPortal(
  db: Queryable,
  clock: Clock,
  actor: PortalSwitchActor,
  buildingId: string,
  enabled: boolean,
): Promise<PortalSwitchResult> {
  return inTransaction(db, async (tx) => {
    const { rows } = await tx.query<{ portal_enabled: boolean }>(
      `SELECT portal_enabled FROM building WHERE building_id = $1 FOR UPDATE`,
      [buildingId],
    );
    const row = rows[0];
    if (row === undefined) {
      throw new KernelError('not_found', 'building not found');
    }
    if (row.portal_enabled === enabled) {
      return { enabled };
    }
    if (enabled) {
      const blocked = await currentPlaceholderTexts(tx, clock.now());
      if (blocked.length > 0) return { enabled: false, blocked };
    }
    await tx.query(
      `UPDATE building SET portal_enabled = $2 WHERE building_id = $1`,
      [buildingId, enabled],
    );
    await createAuditLog(tx, clock).write(
      {
        actorKind: 'staff',
        actorId: actor.staffAccountId,
        actorRole: actor.role,
        action: 'estate.portal_switch',
        subjectId: buildingId,
        inputs: { enabled },
      },
      { outcome: 'ok' },
    );
    return { enabled };
  });
}
