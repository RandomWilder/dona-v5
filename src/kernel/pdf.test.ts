import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { KernelError } from './errors.ts';
import {
  boundPages,
  createFakePdfText,
  createPdfjsText,
  type PdfTextItem,
  pageLines,
} from './pdf.ts';
import { type SampleRun, samplePdf } from './pdf-sample.ts';

// The adapter is exercised against a PDF built by `samplePdf`, byte by byte,
// rather than against a committed sample: the only real lease this project has
// is a signed contract that must never enter the repo (tasks/fuses.md), and a
// document written by the test can state its own coordinates -- which is the
// property being asserted. The Hebrew document is proved on staging by the
// slice's verify step, where the real one is.

// One text run at a known point on a 595x842 page, in PDF's own bottom-up
// coordinates -- so the flip the adapter performs is visible in the assertion.
function textAt(x: number, bottomUpY: number, text: string): SampleRun {
  return { x, y: bottomUpY, text };
}

// One item of a page that was never a PDF, for the line fold below. Positions are zero on purpose:
// a line is decided by `endsLine` and by nothing else, and a fixture carrying plausible coordinates
// would let a geometry-based fold pass this suite.
function item(text: string, endsLine: boolean): PdfTextItem {
  return {
    text,
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    rightToLeft: true,
    endsLine,
    confidence: null,
  };
}

describe('pdf text', () => {
  it('reads every page, with each item positioned top-down', async () => {
    const pdf = createPdfjsText();
    const pages = await pdf.pages(
      samplePdf([
        [textAt(400, 700, 'Rent'), textAt(120, 700, '4200')],
        [textAt(400, 660, 'Clause 1.')],
      ]),
    );

    assert.equal(pages.length, 2);
    assert.equal(pages[0]?.number, 1);
    assert.equal(pages[0]?.width, 595);
    assert.equal(pages[0]?.height, 842);

    const first = pages[0]?.items ?? [];
    assert.deepEqual(
      first.map((item) => item.text),
      ['Rent', '4200'],
    );
    // PDF puts the origin at the bottom-left. The adapter flips it once, here,
    // so that every reader downstream sorts by y and gets reading order.
    assert.equal(first[0]?.y, 842 - 700);
    assert.equal(first[0]?.x, 400);
    assert.equal(first[1]?.x, 120);
    // Both runs sit on one baseline: this is the shape a two-column
    // label/value row arrives in, and the reason positions are kept at all.
    assert.equal(first[0]?.y, first[1]?.y);
    assert.ok((first[0]?.width ?? 0) > 0);
    assert.equal(first[0]?.confidence, null);

    assert.equal(pages[1]?.items[0]?.text, 'Clause 1.');
    assert.equal(pages[1]?.number, 2);
  });

  it('reports a page with no text layer as empty rather than as an error', async () => {
    // Four pages of the sample lease are images (the floor plan, a spec cover,
    // a placeholder and one page of tables). Ingestion has to be able to say
    // which pages those were -- ROADMAP week 3's OCR cut line -- and it cannot
    // if the reader throws on the first one.
    // The second page is not blank -- `samplePdf` gives a page with no runs a
    // grey rectangle, which is what a scan or a floor plan looks like to a
    // reader: content, carrying no text layer.
    const pages = await createPdfjsText().pages(
      samplePdf([[textAt(100, 700, 'Page one')], []]),
    );
    assert.equal(pages.length, 2);
    assert.equal(pages[1]?.items.length, 0);
  });

  it('calls a file it cannot open invalid, not a driver stack', async () => {
    const error = await createPdfjsText()
      .pages(Buffer.from('this is not a pdf'))
      .then(
        () => null,
        (thrown: KernelError) => thrown,
      );
    assert.equal(error?.code, 'invalid');
    assert.match(error?.message ?? '', /PDF/);
  });

  it('says which reader is running', () => {
    assert.equal(createPdfjsText().describe(), 'pdfjs');
  });

  it('folds a page into the lines the reader already marked', () => {
    // **Slice 6.8.** `endsLine` has been on every item since week 3 and nothing read it, so
    // `documentText` joined a whole page with spaces and A12's address reader — written against
    // text where a line break ends a field — never saw one. This is the fold, and it is the only
    // place a line is decided: the flag comes from the reader, never from the boxes.
    const items = [
      item('רקפת', false),
      item('12,', false),
      item('שוהם', true),
      item('דירה', false),
      item('3', true),
    ];
    assert.deepEqual(
      pageLines({ number: 1, width: 595, height: 842, items }).map((line) =>
        line.map((one) => one.text),
      ),
      [
        ['רקפת', '12,', 'שוהם'],
        ['דירה', '3'],
      ],
    );
  });

  it('keeps a page whose reader marked no line at all as one line', () => {
    // An image-only OCR reply, or a text layer with no EOL runs in it. One line is what a page with
    // no line structure is, and it is exactly the string the pre-6.8 join produced — so a reader
    // that knows nothing about lines loses nothing.
    const items = [item('רקפת', false), item('12', false)];
    assert.deepEqual(
      pageLines({ number: 1, width: 595, height: 842, items }).length,
      1,
    );
    assert.deepEqual(
      pageLines({ number: 1, width: 1, height: 1, items: [] }),
      [],
    );
  });

  it('gives the fake reader the line breaks a caller writes into a page', async () => {
    // The fake splits on whitespace because that is what a real text layer hands back (week 3). It
    // now honours a newline as a line end for the same reason: a suite that could not express a
    // line break would be testing the reader against a document shape that does not occur, which
    // is precisely how 6.8's defect survived three slices that read documents.
    const pages = await createFakePdfText(['רקפת 12, שוהם\nדירה 3']).pages(
      Buffer.from('x'),
    );
    assert.deepEqual(
      (pages[0]?.items ?? []).map((one) => [one.text, one.endsLine]),
      [
        ['רקפת', false],
        ['12,', false],
        ['שוהם', true],
        ['דירה', false],
        ['3', true],
      ],
    );
  });

  it('returns no pages when the reader has not finished in time, rather than hanging', async () => {
    // The week-3 staging 503: a heavy signed PDF occupied the request until the
    // platform cut it off. Empty pages file as unverified; unavailable does not.
    const pages = await boundPages(() => new Promise(() => {}), 20);
    assert.deepEqual(pages, []);
  });

  it('still calls an unopenable file invalid when it fails inside the bound', async () => {
    const error = await createPdfjsText({ timeoutMs: 8_000 })
      .pages(Buffer.from('this is not a pdf'))
      .then(
        () => null,
        (thrown: KernelError) => thrown,
      );
    assert.equal(error?.code, 'invalid');
  });
});
