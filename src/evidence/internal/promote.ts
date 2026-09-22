// Slice 4.3. Copy an extracted value onto a typed column, or refuse.
//
// Capture stays a row. Becoming business truth requires a FieldPromotion mapping, a link of the
// right kind, a named promoter, and — from slice 7.4 — an approval stamp on the reading itself. The
// database refuses a stamp written without dona.promoting, and refuses one written on a reading
// nobody approved.
//
// **Why 7.4 added the fourth requirement.** 4.3 governed which declarations may reach a typed
// column and left ungoverned what value arrives there: an unsigned reading could be copied onto
// `tenancy.start_date` with an operator's name in `promoted_by`, so the name signed a button rather
// than a value. Those columns are what the isolation join and the obligation state machine are
// computed from. 7.3 made the copy *prefer* `approved_value`; this requires it.
//
// **#132.** Rent is a pair. An amount may be approved without its currency; it may not be promoted
// without it. The two copies land in one transaction, or neither does.
//
// **#141.** A `unit.*` or `space.floor` target resolves a UNIT link and writes through estate's
// applyPromotedField. Occupancy is the column itself (#145). Evidence issues no estate SQL.
import {
  applyPromotedField as applyEstatePromotedField,
  type EstatePromotionColumn,
  occupantOfEstateColumn,
  type PromotedEstateField,
} from '../../estate/contract.ts';
import type { AuditLog } from '../../kernel/audit.ts';
import type { Clock } from '../../kernel/clock.ts';
import { inTransaction } from '../../kernel/db.ts';
import { KernelError } from '../../kernel/errors.ts';
import { requireText, validId } from '../../kernel/validate.ts';
import {
  applyPromotedField as applyTenancyPromotedField,
  type PromotedTenancyField,
} from '../../tenancy/contract.ts';
import type { Queryable } from './types.ts';

export interface PromoteDeps {
  db: Queryable;
  audit: AuditLog;
  clock: Clock;
}

export interface PromoteSpec {
  extractedFieldId: string;
  promotedBy: string;
  /** Replace a value already promoted from a different field. Without this, a differing write is `conflict`. */
  supersede?: boolean;
}

export interface PromoteResult {
  tenancyId: string | null;
  unitId: string | null;
  target: string;
  value: string;
}

const TENANCY_FIELD: Record<string, PromotedTenancyField> = {
  'tenancy.start_date': 'start_date',
  'tenancy.end_date': 'end_date',
  'tenancy.rent_amount': 'rent_amount',
  'tenancy.rent_currency': 'rent_currency',
  'tenancy.option_end_date': 'option_end_date',
};

const ESTATE_FIELD: Record<string, PromotedEstateField> = {
  'unit.rooms': 'rooms',
  'space.floor': 'floor',
};

const RENT_SIBLING: Record<string, { fieldKey: string; target: string }> = {
  'tenancy.rent_amount': {
    fieldKey: 'rent_currency',
    target: 'tenancy.rent_currency',
  },
  'tenancy.rent_currency': {
    fieldKey: 'rent_amount',
    target: 'tenancy.rent_amount',
  },
};

function linkKindOf(target: string): 'TENANCY' | 'UNIT' | 'BUILDING' {
  if (target.startsWith('tenancy.')) return 'TENANCY';
  if (target.startsWith('building.')) return 'BUILDING';
  return 'UNIT';
}

function isEstateTarget(target: string): target is EstatePromotionColumn {
  return target === 'unit.rooms' || target === 'space.floor';
}

function sameEstateValue(
  target: EstatePromotionColumn,
  held: string,
  incoming: string,
): boolean {
  if (target === 'unit.rooms') return Number(held) === Number(incoming);
  return held === incoming;
}

function boundMessage(kind: 'TENANCY' | 'UNIT' | 'BUILDING'): string {
  if (kind === 'TENANCY') return 'that document is not bound to a tenancy';
  if (kind === 'BUILDING') return 'that document is not bound to a building';
  return 'that document is not bound to a unit';
}

export async function promoteExtractedField(
  deps: PromoteDeps,
  spec: PromoteSpec,
): Promise<PromoteResult> {
  const extractedFieldId = validId(spec.extractedFieldId, 'extracted field');
  const promotedBy = requireText(spec.promotedBy, 'promoted_by', 200);
  const supersede = spec.supersede === true;

  return inTransaction(deps.db, async (db) => {
    const captured = await db.query<{
      extracted_field_id: string;
      document_id: string;
      value: string | null;
      approved_at: Date | null;
      promoted_to: string | null;
      target: string | null;
    }>(
      `SELECT e.extracted_field_id, e.document_id,
              -- **Slice 7.4.** The value a person signed, and nothing else. 7.3 wrote this as
              -- COALESCE(e.approved_value, e.value) with the approval still optional; with the
              -- approval required, a fallback that can no longer be taken is a claim about what
              -- this command can do that stopped being true.
              e.approved_value AS value,
              e.approved_at, e.promoted_to, p.target
         FROM extracted_field e
         LEFT JOIN field_promotion p
           ON p.document_type_field_id = e.document_type_field_id
        WHERE e.extracted_field_id = $1`,
      [extractedFieldId],
    );
    const row = captured.rows[0];
    if (!row) {
      throw new KernelError('not_found', 'extracted field not found');
    }
    if (!row.target) {
      throw new KernelError(
        'invalid',
        'that field cannot become business truth',
      );
    }
    const tenancyField = TENANCY_FIELD[row.target];
    const estateField = ESTATE_FIELD[row.target];
    if (!tenancyField && !estateField) {
      throw new KernelError(
        'invalid',
        'that field cannot become business truth',
      );
    }

    const linkKind = linkKindOf(row.target);
    const link = await db.query<{ entity_id: string }>(
      `SELECT entity_id FROM document_link
        WHERE document_id = $1 AND entity_type = $2
        ORDER BY entity_id
        LIMIT 1`,
      [row.document_id, linkKind],
    );
    const entityId = link.rows[0]?.entity_id;
    if (!entityId) {
      throw new KernelError('invalid', boundMessage(linkKind));
    }
    const tenancyId = linkKind === 'TENANCY' ? entityId : null;
    const unitId = linkKind === 'UNIT' ? entityId : null;

    // Already on the column, and this runs **before** the approval requirement on purpose: a row
    // promoted before 7.4 must keep answering, not start failing on a rule that did not exist when
    // it was signed. The same reason the trigger looks only at a row that is gaining the stamp.
    if (row.promoted_to === row.target) {
      return {
        tenancyId,
        unitId,
        target: row.target,
        value: row.value ?? '',
      };
    }

    // **Slice 7.4.** `conflict`, as `'that reading is already approved'` is: both are the row's
    // state refusing the request rather than the request being malformed. The screen draws no
    // `קדם` button on an unsigned row, and A2's and A3's confirm sign the dates they promote — so
    // this is the caller the module does not have yet, and the trigger behind it is every caller
    // after that.
    if (row.approved_at === null || row.value === null) {
      throw new KernelError(
        'conflict',
        'that reading has not been approved, and only an approved reading is promoted',
      );
    }

    if (estateField && isEstateTarget(row.target)) {
      const occupant = await occupantOfEstateColumn(db, {
        target: row.target,
        entityId: entityId,
      });
      if (
        occupant !== null &&
        !sameEstateValue(row.target, occupant, row.value) &&
        !supersede
      ) {
        throw new KernelError(
          'conflict',
          `that column already carries ${occupant}`,
          { existingValue: occupant },
        );
      }
      const sameValueAlreadyHeld =
        occupant !== null && sameEstateValue(row.target, occupant, row.value);
      await db.query("SELECT set_config('dona.promoting', 'on', true)");
      if (!sameValueAlreadyHeld) {
        await applyEstatePromotedField(db, {
          entityType: 'UNIT',
          unitId: entityId,
          field: estateField,
          value: row.value,
          actor: promotedBy,
          at: deps.clock.now(),
          sourceDocumentId: row.document_id,
          extractedFieldId,
        });
        await deps.audit.write(
          {
            actorKind: 'staff',
            actorId: promotedBy,
            action: 'evidence.promote_field',
            subjectId: extractedFieldId,
            inputs: {
              documentId: row.document_id,
              unitId: entityId,
              target: row.target,
            },
          },
          { outcome: 'ok' },
        );
      }
      await db.query(
        `UPDATE extracted_field
            SET promoted_to = $2, promoted_by = $3, promoted_at = $4
          WHERE extracted_field_id = $1`,
        [extractedFieldId, row.target, promotedBy, deps.clock.now()],
      );
      return { tenancyId, unitId, target: row.target, value: row.value };
    }

    if (!tenancyField || tenancyId === null) {
      throw new KernelError(
        'invalid',
        'that field cannot become business truth',
      );
    }

    const copies: Array<{
      extractedFieldId: string;
      target: string;
      field: PromotedTenancyField;
      value: string;
      alreadyStamped: boolean;
    }> = [
      {
        extractedFieldId,
        target: row.target,
        field: tenancyField,
        value: row.value,
        alreadyStamped: false,
      },
    ];

    // **#132.** Rent is one price. Capture may hold an amount with no currency; the typed
    // columns may not. The sibling is the other declared half on this document, and the two
    // copies land in this transaction or neither does.
    const siblingSpec = RENT_SIBLING[row.target];
    if (siblingSpec) {
      const sibling = await db.query<{
        extracted_field_id: string;
        value: string | null;
        approved_at: Date | null;
        promoted_to: string | null;
        target: string | null;
      }>(
        `SELECT e.extracted_field_id, e.approved_value AS value, e.approved_at,
                e.promoted_to, p.target
           FROM extracted_field e
           JOIN document_type_field f
             ON f.document_type_field_id = e.document_type_field_id
           LEFT JOIN field_promotion p
             ON p.document_type_field_id = e.document_type_field_id
          WHERE e.document_id = $1 AND f.field_key = $2
          ORDER BY e.extracted_at DESC, e.extracted_field_id
          LIMIT 1`,
        [row.document_id, siblingSpec.fieldKey],
      );
      const other = sibling.rows[0];
      const siblingField = TENANCY_FIELD[siblingSpec.target];
      if (
        !other ||
        other.approved_at === null ||
        other.value === null ||
        other.target !== siblingSpec.target ||
        !siblingField
      ) {
        throw new KernelError(
          'conflict',
          'that rent is missing its other half, and only a priced pair is promoted',
        );
      }
      copies.push({
        extractedFieldId: other.extracted_field_id,
        target: siblingSpec.target,
        field: siblingField,
        value: other.value,
        alreadyStamped: other.promoted_to === siblingSpec.target,
      });
    }

    const skipIds = copies.map((copy) => copy.extractedFieldId);
    let moved = false;
    await db.query("SELECT set_config('dona.promoting', 'on', true)");
    for (const copy of copies) {
      // **#130.** Occupancy is a stamp from a *different* extracted field on this letting, not a
      // register date. Identical values succeed without rewriting the column. A differing value is
      // `conflict` unless the caller said `supersede` — confirming an amendment is that act.
      const occupant = await db.query<{
        document_id: string;
        value: string | null;
      }>(
        `SELECT e.document_id, e.approved_value AS value
           FROM extracted_field e
           JOIN document_link l
             ON l.document_id = e.document_id AND l.entity_type = 'TENANCY'
          WHERE l.entity_id = $1
            AND e.promoted_to = $2
            AND e.extracted_field_id <> ALL($3::uuid[])
          ORDER BY e.promoted_at DESC NULLS LAST, e.extracted_field_id
          LIMIT 1`,
        [tenancyId, copy.target, skipIds],
      );
      const held = occupant.rows[0];
      if (held && held.value !== copy.value && !supersede) {
        throw new KernelError(
          'conflict',
          `that column already carries ${held.value} from document ${held.document_id}`,
          {
            existingValue: held.value,
            sourceDocumentId: held.document_id,
          },
        );
      }
      const sameValueAlreadyHeld =
        held !== undefined && held.value === copy.value;
      if (!sameValueAlreadyHeld) {
        await applyTenancyPromotedField(db, {
          tenancyId,
          field: copy.field,
          value: copy.value,
          actor: promotedBy,
          at: deps.clock.now(),
          sourceDocumentId: row.document_id,
          extractedFieldId: copy.extractedFieldId,
        });
        moved = true;
      }
      if (!copy.alreadyStamped) {
        await db.query(
          `UPDATE extracted_field
              SET promoted_to = $2, promoted_by = $3, promoted_at = $4
            WHERE extracted_field_id = $1`,
          [copy.extractedFieldId, copy.target, promotedBy, deps.clock.now()],
        );
      }
    }
    if (moved) {
      await deps.audit.write(
        {
          actorKind: 'staff',
          actorId: promotedBy,
          action: 'evidence.promote_field',
          subjectId: extractedFieldId,
          inputs: {
            documentId: row.document_id,
            tenancyId,
            target: row.target,
          },
        },
        { outcome: 'ok' },
      );
    }

    return { tenancyId, unitId, target: row.target, value: row.value };
  });
}
