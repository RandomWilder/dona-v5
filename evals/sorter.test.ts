// The grader, and the promise that the set is fabricated. The model is not
// called here.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { gradeSorterCase } from './sorter.ts';
import { sorterCases } from './sorter-cases.ts';

describe('sorter golden set', () => {
  it('covers calls, questions, noise, unsure cases and emergency wording, in the languages the office sees', () => {
    const labels = new Set(sorterCases.map((item) => item.label));
    assert.equal(labels.has('call'), true);
    assert.equal(labels.has('unsure'), true);
    assert.equal(labels.has('noise'), true);
    const texts = sorterCases.map((item) => `${item.subject}\n${item.body}`);
    assert.equal(
      texts.some((text) => /[\u0590-\u05FF]/.test(text)),
      true,
    );
    assert.equal(
      texts.some((text) => /[A-Za-z]{4,}/.test(text)),
      true,
    );
    assert.equal(
      texts.some((text) => /[\u0400-\u04FF]/.test(text)),
      true,
    );
    assert.equal(
      texts.some((text) => /[\u0600-\u06FF]/.test(text)),
      true,
    );
    assert.equal(
      sorterCases.some(
        (item) =>
          /[\u0590-\u05FF]/.test(item.subject) && /[A-Za-z]/.test(item.body),
      ),
      true,
    );
    assert.equal(
      sorterCases.some((item) => /עשן|smoke/i.test(item.body)),
      true,
    );
    assert.equal(
      sorterCases.some(
        (item) => item.body.includes('?') || item.body.includes('מתי'),
      ),
      true,
    );
  });

  it('is fabricated: no address and no phone number', () => {
    for (const item of sorterCases) {
      const text = `${item.subject}\n${item.body}`;
      assert.equal(text.includes('@'), false);
      assert.equal(/\d{7,}/.test(text), false);
    }
  });

  it('grades a known verdict against the case, not against itself', () => {
    const item = sorterCases.find((row) => row.id === 'ru-leak');
    if (!item) throw new Error('missing case');
    assert.deepEqual(
      gradeSorterCase(
        item,
        {
          label: 'call',
          categoryCode: 'PLUMBING',
          summary: 'ברז דולף במטבח',
        },
        'הברז במטבח דולף',
      ),
      [],
    );
    assert.deepEqual(
      gradeSorterCase(
        item,
        { label: 'noise', categoryCode: null, summary: null },
        null,
      ),
      [
        'label noise, expected call',
        'category none, expected PLUMBING',
        'summary was not Hebrew',
        'the translation was not Hebrew',
      ],
    );
  });
});
