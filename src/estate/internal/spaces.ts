// Taking a bay off a building. Issue 140.
//
// This is the only route in the system that deletes a `space` outside the operator purge
// (`purge.ts`), and it exists because of what 4.6 wrote rather than because anybody asked for an
// editor. `upsertUnitRow` invented a `PARKING` space `חניה {unit_number}` and a `STORAGE` space
// `מחסן {unit_number}` for every flat A13 made, in a numbering scheme no developer's plan uses. The
// import stopped doing that in the same change, but the rows it already wrote stay: which of two
// bays is the real one is an operator's judgement about a piece of paper, not something a migration
// can decide.
//
// **It is keyed on the Space and not on a Unit.** The ticket asks for both halves and they are one
// operation: an operator deleting `חניה 7` after the real bay 574 arrived is deleting a space the
// flat still points at *or* one it stopped pointing at when 574 was written, and which of those it
// is depends only on the order they happened to do it in. Keying on the unit made the second case —
// the orphan, which is the case the ticket names — unreachable forever. So: detach whatever single
// unit points at it, then delete; a space nothing points at is simply deleted.
//
// **Refuse rather than cascade.** Anything else still holding the space stops the whole thing and is
// named, because what the operator does next depends on which: an asset is moved first (R3 — an
// asset sits in exactly one Space, so the delete would take its location with it), two units
// pointing at one bay is a question about which is real that this route may not answer.
import { KernelError } from '../../kernel/errors.ts';
import type { Queryable, SpaceKind } from './plan.ts';

/**
 * The two kinds this route may remove.
 *
 * A `UNIT` space is the unit's own row (R2) and deleting it is deleting the apartment; `COMMON`,
 * `TECHNICAL` and `EXTERIOR` belong to the building and were never A13's to write. Typed on
 * `SpaceKind` so renaming a kind is a typecheck failure rather than a route that silently refuses
 * everything.
 */
const REMOVABLE: ReadonlySet<SpaceKind> = new Set<SpaceKind>([
  'PARKING',
  'STORAGE',
]);

export interface RemoveSpaceResult {
  /** Where to send the operator back to — the screen the removed row was on. */
  buildingId: string;
  /** Whether a unit had to be detached first, or the space was already an orphan. */
  detached: boolean;
}

/**
 * Deletes a `PARKING` or `STORAGE` space, detaching the one unit that points at it first.
 *
 * The caller owns the transaction: handed a `Pool`, the `UPDATE` and the `DELETE` would be two of
 * them, and a failure between them leaves a Space nothing points at — exactly the orphan this route
 * was written to remove.
 */
export async function removeSpace(
  db: Queryable,
  spaceId: string,
): Promise<RemoveSpaceResult> {
  const found = await db.query<{ space_kind: SpaceKind; building_id: string }>(
    'SELECT space_kind, building_id FROM space WHERE space_id = $1',
    [spaceId],
  );
  const space = found.rows[0];
  if (!space) {
    // `getBuilding`'s rule: an id that is not there and an id that is somebody else's are
    // indistinguishable from outside.
    throw new KernelError('not_found', 'not_found');
  }
  if (!REMOVABLE.has(space.space_kind)) {
    throw new KernelError(
      'invalid',
      'only a parking or storage space may be removed',
      { spaceKind: space.space_kind },
    );
  }

  // **Every holder, counted before anything is written.** One query, because the refusal has to name
  // which one, and a second round trip could see a different answer.
  //
  // Service calls are the third holder the ticket names and there is no table for them yet:
  // `src/calls/` is unbuilt (AGENTS.md lists it, and no migration declares a `service_call`). When it
  // lands it is one more count here and one more case below, and nothing else moves.
  const held = await db.query<{ units: string; assets: string }>(
    `SELECT (SELECT count(*)::text FROM unit u
              WHERE u.parking_space_id = $1 OR u.storage_space_id = $1) AS units,
            (SELECT count(*)::text FROM asset a WHERE a.space_id = $1) AS assets`,
    [spaceId],
  );
  const blocked = held.rows[0];
  if (!blocked) {
    // `count(*)` always returns a row, so this is unreachable — and it is written anyway because the
    // alternative is a guard that *fails open*: the two refusals below are the whole of what stops
    // this route cascading, and skipping them on a missing row would delete the space instead.
    throw new KernelError('conflict', 'space holders could not be counted', {
      spaceId,
    });
  }
  if (Number(blocked.assets) > 0) {
    throw new KernelError('conflict', 'an asset sits in this space', {
      assets: Number(blocked.assets),
    });
  }
  if (Number(blocked.units) > 1) {
    throw new KernelError(
      'conflict',
      'more than one unit is assigned to this space',
      { units: Number(blocked.units) },
    );
  }

  // Two statements and not one interpolated column name (AGENTS.md: parameterised queries). At most
  // one unit matches either, by the count above; a space cannot be one unit's bay and another's
  // store, because both foreign keys carry the kind (`0004_estate.sql`, D3).
  await db.query(
    'UPDATE unit SET parking_space_id = NULL WHERE parking_space_id = $1',
    [spaceId],
  );
  await db.query(
    'UPDATE unit SET storage_space_id = NULL WHERE storage_space_id = $1',
    [spaceId],
  );
  await db.query('DELETE FROM space WHERE space_id = $1', [spaceId]);
  return {
    buildingId: space.building_id,
    detached: Number(blocked.units) === 1,
  };
}
