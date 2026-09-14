// **No declaration in this system may name money.** Slice 7.2.
//
// Foundation rule 2: no tenant-facing price and no balance, ever — not just v1. It has been enforced
// by the schema since 3.1, where `value_type`'s CHECK has no MONEY member, and by something softer
// that mattered more: the field list was **source code**, so declaring `rent_amount` meant a commit
// somebody read. `src/evidence/fixtures/document-types.ts` says "not one of them is a money field"
// three separate times, and it could say it.
//
// Slice 7.2 opens the declaration to an ADMIN at run time. `NUMBER` is still not `MONEY`, but
// `rent_amount NUMBER` is an amount with no currency and no rounding policy, and rule 2 does not
// care which CHECK it got in under. So the protection moves from the source file to a guard, and
// this is the gate on the guard.
//
// **Why it is in tests/policy/ and not beside the module.** docs/pipeline.md §6 is the gate for
// everything no model may decide, and money is the first of the three things the client called
// non-negotiable. It is also deterministic and checkable without a model, which is the whole test
// for whether a constraint belongs here.
//
// **Red first, and it stays red-able.** docs/pipeline.md §6 requires a policy case to have been red
// before it was green. A case asserting only "the live catalogue is clean" is green the day it is
// written and green forever after somebody deletes the guard — so this file does what
// `staff-session.test.ts` and `guards.test.ts` do: it **builds the violation itself**, in a
// transaction that is rolled back, and asserts the refusal. The vocabulary it asserts against is the
// guard's own constant, never a second copy, because a test carrying its own list goes green after
// somebody shortens the real one.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  declareDocumentTypeField,
  documentTypeFields,
  MONEY_KEY_TOKENS,
  MONEY_LABEL_TERMS,
  namesMoney,
  upsertDocumentType,
} from '../../src/evidence/contract.ts';
import { KernelError } from '../../src/kernel/errors.ts';
import { newId } from '../../src/kernel/ids.ts';
import { inRolledBackTransaction, policyPool, skipReason } from './support.ts';

const ON = '2026-09-20';

/** Declarations an administrator could plausibly type, each of which is a money field. */
const VIOLATIONS: { fieldKey: string; labelHe: string; why: string }[] = [
  {
    fieldKey: 'rent_amount',
    labelHe: 'שכר דירה חודשי',
    why: 'the obvious one',
  },
  { fieldKey: 'security_deposit', labelHe: 'ערבון', why: 'the paint named it' },
  {
    fieldKey: 'extra_1',
    labelHe: 'סכום הפיקדון',
    why: 'an innocent key and a label that says the quiet part',
  },
  {
    fieldKey: 'monthly_fee',
    labelHe: 'נתון נוסף',
    why: 'the other way round — a money key behind a label that hides it',
  },
  {
    fieldKey: 'total_payment',
    labelHe: 'תשלום כולל',
    why: 'both halves',
  },
];

describe('policy · no declaration in this system may name money', () => {
  it('catches every violation an administrator could type, which is what makes the rest mean something', () => {
    for (const violation of VIOLATIONS) {
      const match = namesMoney(violation);
      assert.notEqual(
        match,
        null,
        `${violation.fieldKey} / ${violation.labelHe} — ${violation.why}`,
      );
    }
  });

  it('carries every term the guard carries, so a shortened vocabulary fails here', () => {
    // Asserted against the guard's own constants rather than a copy: this case exists so that
    // deleting a term from MONEY_KEY_TOKENS or MONEY_LABEL_TERMS is a red build and not a quiet
    // widening. The counts are the part that catches a deletion; the two spot terms are the part
    // that catches a rename.
    assert.ok(
      MONEY_KEY_TOKENS.length >= 8,
      'the Latin vocabulary was shortened',
    );
    assert.ok(
      MONEY_LABEL_TERMS.length >= 8,
      'the Hebrew vocabulary was shortened',
    );
    assert.ok((MONEY_KEY_TOKENS as readonly string[]).includes('rent'));
    assert.ok((MONEY_LABEL_TERMS as readonly string[]).includes('פיקדון'));
  });

  it('passes a declaration that is not about money, so the guard is a guard and not a wall', () => {
    assert.equal(namesMoney({ fieldKey: 'city', labelHe: 'עיר' }), null);
    assert.equal(
      namesMoney({ fieldKey: 'notice_period_days', labelHe: 'ימי הודעה' }),
      null,
    );
    assert.equal(
      namesMoney({ fieldKey: 'tenant_name', labelHe: 'שם השוכר' }),
      null,
    );
  });

  it('refuses a money declaration at the run-time command, and writes nothing', async (t) => {
    const pool = await policyPool();
    if (pool === null) return t.skip(skipReason);
    await inRolledBackTransaction(pool, async (db) => {
      const typeKey = `money-policy-${newId().slice(-12)}`;
      await upsertDocumentType(db, {
        typeKey,
        labelHe: 'סוג לבדיקה',
        labelEn: null,
        verificationTerms: null,
        isActive: true,
      });
      for (const violation of VIOLATIONS) {
        await assert.rejects(
          () =>
            declareDocumentTypeField(db, {
              typeKey,
              fieldKey: violation.fieldKey,
              labelHe: violation.labelHe,
              valueType: 'NUMBER',
              isRequired: false,
              extractionHint: null,
              on: ON,
            }),
          (error: unknown) => {
            assert.ok(error instanceof KernelError, `${violation.fieldKey}`);
            assert.equal(error.code, 'invalid');
            assert.match(error.message, /money/);
            return true;
          },
          `${violation.fieldKey} — ${violation.why}`,
        );
      }
      // The refusal is a refusal and not a rollback of half a write: nothing was declared.
      assert.deepEqual(await documentTypeFields(db, typeKey, ON), []);
    });
  });

  it('finds no money field declared anywhere in this database', async (t) => {
    const pool = await policyPool();
    if (pool === null) return t.skip(skipReason);
    const { rows } = await pool.query<{
      field_key: string;
      label_he: string;
      value_type: string;
    }>(
      `SELECT field_key, label_he, value_type FROM document_type_field
        ORDER BY field_key, effective_from`,
    );
    const named = rows
      .filter((row) =>
        namesMoney({ fieldKey: row.field_key, labelHe: row.label_he }),
      )
      .map((row) => `${row.field_key} / ${row.label_he}`);
    assert.deepEqual(named, [], 'a money field is declared in this database');
    // And the CHECK that has held since 3.1 still has no member to declare one with.
    assert.deepEqual(
      [...new Set(rows.map((row) => row.value_type))].filter(
        (type) => !['TEXT', 'NUMBER', 'DATE', 'BOOLEAN', 'ENUM'].includes(type),
      ),
      [],
    );
  });
});
