// #187. The sorter adapter, through a fake extractor. What is worth testing
// is the request it sends and the verdict it returns, not that OpenAI works.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { KernelError } from '../kernel/errors.ts';
import { createFakeExtractor } from '../kernel/extraction.ts';
import { createSorter, SORTER_PROMPT_VERSION } from './contract.ts';

const categories = [{ code: 'PLUMBING', label: 'אינסטלציה' }];

function sorterFor(reply: (name: string) => unknown) {
  const extractor = createFakeExtractor((request) => reply(request.name));
  return {
    extractor,
    sorter: createSorter({
      extractor,
      model: async () => 'gpt-test',
    }),
  };
}

describe('channel · the sorter', () => {
  it('sorts from the subject, the text, and the categories it was handed', async () => {
    const { extractor, sorter } = sorterFor(() => ({
      label: 'call',
      categoryCode: 'plumbing',
      summary: '  נזילה בכיור  ',
    }));

    const verdict = await sorter.sort({
      subject: 'Leak',
      body: 'The kitchen tap is dripping',
      categories,
    });

    assert.equal(verdict.label, 'call');
    assert.equal(verdict.categoryCode, 'PLUMBING');
    assert.equal(verdict.summary, 'נזילה בכיור');
    assert.equal(verdict.modelId, 'gpt-test');
    assert.equal(verdict.promptVersion, SORTER_PROMPT_VERSION);
    const request = extractor.calls[0];
    assert.equal(request?.model, 'gpt-test');
    assert.equal(request?.reasoningEffort, 'low');
    assert.equal(
      request?.input,
      'Subject: Leak\nText:\nThe kitchen tap is dripping\n\nCategories:\n- PLUMBING: אינסטלציה',
    );
    assert.equal(request?.instructions.includes('kitchen tap'), false);
    assert.equal(request?.input.includes('@'), false);
  });

  it('translates a message that is not Hebrew, and leaves a Hebrew one alone', async () => {
    const translated = sorterFor(() => ({
      alreadyHebrew: false,
      bodyHe: 'הברז במטבח מטפטף',
    }));
    const hebrew = await translated.sorter.translate({
      subject: '',
      body: 'The kitchen tap is dripping',
    });
    assert.equal(hebrew.bodyHe, 'הברז במטבח מטפטף');
    assert.equal(
      translated.extractor.calls[0]?.input.includes('kitchen tap'),
      true,
    );

    const already = sorterFor(() => ({
      alreadyHebrew: true,
      bodyHe: 'לא לשימוש',
    }));
    const same = await already.sorter.translate({
      subject: 'נזילה',
      body: 'יש נזילה במטבח',
    });
    assert.equal(same.bodyHe, null);
  });

  it('throws when the reply has no label, or the call fails', async () => {
    const broken = sorterFor(() => ({ label: 'maybe' }));
    await assert.rejects(() =>
      broken.sorter.sort({ subject: '', body: 'שלום', categories }),
    );

    const down = sorterFor(() => {
      throw new KernelError('unavailable', 'the extraction call timed out');
    });
    await assert.rejects(
      () => down.sorter.sort({ subject: '', body: 'שלום', categories }),
      /timed out/,
    );
    await assert.rejects(
      () => down.sorter.translate({ subject: '', body: 'שלום' }),
      /timed out/,
    );
  });
});
