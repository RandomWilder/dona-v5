// POLICY CASE — what a printed amount is stored as, and when it is stored as nothing.
//
// **Ticket #101 / ADR-0008.** Foundation rule 2 is retired and an amount off a lease is ordinary
// data. What is *not* ordinary is the arithmetic between the page and the row: `12,500 ₪` on paper
// and `12500` in the store are the same figure, and `12.500` and `12,500` are the same figure as
// each other while looking like opposites. Somebody has to decide which mark is the decimal point,
// and **no model decides it** — which is the sentence that puts this case in `tests/policy/` rather
// than in `evals/` (SPEC.md: never test a deterministic constraint through the agent).
//
// **It reads the contract, not the internal**, as every case in this suite does.
//
// **The fusion cases were red first.** The first implementation stripped every character that was
// not a digit or a separator and joined what was left, so a reader that returned
// `12,500 ₪ לחודש, סה"כ 150,000` — one span, two numbers, which is exactly what a model does when
// it selects one word too many — stored `12500150000` as the monthly rent. A rent that is wrong by
// four orders of magnitude is worse than a rent that is missing, and a missing required field is
// already a result rather than an error (SPEC-flows.md A2). So two numbers in one finding is a
// refusal, the way `asIsoDate` refuses a date it cannot read rather than inventing one.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { asBareNumber } from '../../src/evidence/contract.ts';

describe('policy · a printed amount is stored as a bare number', () => {
  it('drops the separators, the spaces and the currency the page carries', () => {
    // The Israeli convention, in the three ways a lease prints it.
    assert.equal(asBareNumber('12,500 ₪'), '12500');
    assert.equal(asBareNumber('₪ 12,500'), '12500');
    assert.equal(asBareNumber('12,500 ש"ח'), '12500');
    // A space as the thousands separator, which is what a typed form does.
    assert.equal(asBareNumber('₪ 12 500'), '12500');
    assert.equal(asBareNumber('1 234 567'), '1234567');
    // Already bare, and a leading zero is not a digit of the number.
    assert.equal(asBareNumber('12500'), '12500');
    assert.equal(asBareNumber('007'), '7');
  });

  it('decides which mark is the decimal point, and never guesses', () => {
    // Both marks present: the last one is the decimal point, whichever it is. Three thousand,
    // written by an Israeli office and by a European one.
    assert.equal(asBareNumber('3,000.00'), '3000');
    assert.equal(asBareNumber('3.000,00'), '3000');
    // One mark, more than once: every one of them groups thousands.
    assert.equal(asBareNumber('1.234.567'), '1234567');
    assert.equal(asBareNumber('1,234,567'), '1234567');
    // One mark, once, with three digits after it: thousands. `25.000` is twenty-five thousand and
    // not twenty-five, which is the reading that costs money if it goes the other way.
    assert.equal(asBareNumber('25.000'), '25000');
    assert.equal(asBareNumber('25,000'), '25000');
    // One mark, once, with anything else after it: the decimal point.
    assert.equal(asBareNumber('12.5'), '12.5');
    assert.equal(asBareNumber('12,5'), '12.5');
    assert.equal(asBareNumber('0.75'), '0.75');
    // A zero fraction is not a different number from no fraction.
    assert.equal(asBareNumber('3000.00'), '3000');
  });

  it('refuses a finding that carries two numbers instead of one', () => {
    // The failure this case exists for: a span that took in the summary line as well as the rent.
    assert.equal(asBareNumber('12,500 ₪ לחודש, סה"כ 150,000'), null);
    // A range is two numbers too, and picking either end would be the system deciding a term.
    assert.equal(asBareNumber('1,000-2,000'), null);
    // A clause number dragged in beside the figure.
    assert.equal(asBareNumber('סעיף 7 דמי שכירות 12,500'), null);
  });

  it('refuses a space that is not a thousands separator', () => {
    // `12 500` is twelve and a half thousand; `12 5` is not anything, and reading it as `125`
    // would be the same invention the fusion case refuses.
    assert.equal(asBareNumber('12 5'), null);
    assert.equal(asBareNumber('12 50'), null);
  });

  it('refuses a finding with no number in it at all', () => {
    // A lease that fixes the rent by reference rather than by figure. No row, the same result a
    // DATE that is not a calendar day produces.
    assert.equal(asBareNumber('לפי סיכום בעל פה'), null);
    assert.equal(asBareNumber(''), null);
    assert.equal(asBareNumber('₪'), null);
    assert.equal(asBareNumber('  '), null);
  });
});
