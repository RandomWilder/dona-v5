import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { KernelError } from './errors.ts';
import {
  createConfiguredOcr,
  createDocumentAiOcr,
  createFakeOcrText,
  createUnconfiguredOcr,
  defaultOcrProcessorVersion,
  readOcrDocument,
} from './ocr.ts';

function fakeFetch(handler: (body: Record<string, unknown>) => Response): {
  calls: Array<{ url: string; body: Record<string, unknown>; auth: string }>;
  impl: typeof fetch;
} {
  const calls: Array<{
    url: string;
    body: Record<string, unknown>;
    auth: string;
  }> = [];
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    const headers = (init?.headers ?? {}) as Record<string, string>;
    calls.push({ url: String(url), body, auth: headers.authorization ?? '' });
    return handler(body);
  }) as unknown as typeof fetch;
  return { calls, impl };
}

function processReply(document: unknown): Response {
  return new Response(JSON.stringify({ document }), { status: 200 });
}

describe('ocr', () => {
  it('asks the eu OCR processor, with Hebrew as a language hint', async () => {
    const fetcher = fakeFetch(() =>
      processReply({
        text: 'שכירות',
        pages: [
          {
            pageNumber: 1,
            dimension: { width: 100, height: 200 },
            tokens: [
              {
                layout: {
                  textAnchor: {
                    textSegments: [{ startIndex: 0, endIndex: 6 }],
                  },
                  confidence: 0.91,
                  boundingPoly: {
                    normalizedVertices: [
                      { x: 0.1, y: 0.2 },
                      { x: 0.4, y: 0.2 },
                      { x: 0.4, y: 0.3 },
                      { x: 0.1, y: 0.3 },
                    ],
                  },
                },
              },
            ],
          },
        ],
      }),
    );
    const ocr = createDocumentAiOcr({
      project: 'dona-v5',
      location: 'eu',
      processorId: 'abc123',
      fetchImpl: fetcher.impl,
      token: async () => 'ya29.test',
    });

    const result = await ocr.pages(
      Buffer.from('%PDF-1.4'),
      'application/pdf',
      defaultOcrProcessorVersion,
    );

    const item = result.pages[0]?.items[0];
    assert.equal(item?.text, 'שכירות');
    assert.equal(item?.confidence, 0.91);
    assert.equal(item?.x, 10);
    assert.equal(item?.y, 40);
    assert.equal(item?.width, 30);
    assert.equal(item?.height, 20);
    const call = fetcher.calls[0];
    assert.equal(
      call?.url,
      `https://eu-documentai.googleapis.com/v1/projects/dona-v5/locations/eu/processors/abc123/processorVersions/${defaultOcrProcessorVersion}:process`,
    );
    assert.equal(call?.auth, 'Bearer ya29.test');
    const raw = call?.body.rawDocument as { mimeType: string; content: string };
    assert.equal(raw.mimeType, 'application/pdf');
    assert.equal(raw.content, Buffer.from('%PDF-1.4').toString('base64'));
    const options = call?.body.processOptions as {
      ocrConfig: { hints: { languageHints: string[] } };
    };
    assert.deepEqual(options.ocrConfig.hints.languageHints, ['iw']);
    assert.equal(call?.body.imagelessMode, true);
    assert.equal('images' in result, false);
    assert.equal(ocr.describe(), 'documentai:eu/abc123');
  });

  it('asks for only the pages it was given, and asks for all of them otherwise', async () => {
    // **Slice 6.8.** The online processor takes 15 pages per call, and until this slice a longer
    // document was simply not sent — the week-6 demo's lease is 38 pages, so it was never read at
    // all. `individualPageSelector` is the way through and it was measured before it was written:
    // the same 38-page file, pages 1-15 selected, came back 200 with 15 pages in 36.4s.
    const fetcher = fakeFetch(() => processReply({ text: '', pages: [] }));
    const ocr = createDocumentAiOcr({
      project: 'dona-v5',
      location: 'eu',
      processorId: 'abc123',
      fetchImpl: fetcher.impl,
      token: async () => 'ya29.test',
    });
    await ocr.pages(
      Buffer.from('%PDF-1.4'),
      'application/pdf',
      defaultOcrProcessorVersion,
      [1, 2, 3],
    );
    await ocr.pages(
      Buffer.from('%PDF-1.4'),
      'application/pdf',
      defaultOcrProcessorVersion,
    );
    const selected = fetcher.calls[0]?.body.processOptions as {
      individualPageSelector?: { pages: number[] };
    };
    assert.deepEqual(selected.individualPageSelector?.pages, [1, 2, 3]);
    const whole = fetcher.calls[1]?.body.processOptions as {
      individualPageSelector?: { pages: number[] };
    };
    assert.equal(
      whole.individualPageSelector,
      undefined,
      'a document within the limit is sent whole, with no selector at all',
    );
  });

  it('gives the fake reader the same page selection the real one takes', async () => {
    const result = await createFakeOcrText(['one', 'two', 'three']).pages(
      Buffer.from('x'),
      'application/pdf',
      'unused',
      [1, 3],
    );
    assert.deepEqual(
      result.pages.map((page) => page.items[0]?.text),
      ['one', 'three'],
    );
    // The page numbers are the document's own, so a citation still names the page a human would
    // count to — selecting pages does not renumber them.
    assert.deepEqual(
      result.pages.map((page) => page.number),
      [1, 3],
    );
  });

  it('gives up on a call that does not answer, naming the bound', async () => {
    const ocr = createDocumentAiOcr({
      project: 'dona-v5',
      location: 'eu',
      processorId: 'abc123',
      timeoutMs: 20,
      token: async () => 'ya29.test',
      fetchImpl: (async (_url: string, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new Error('aborted')),
          );
        })) as unknown as typeof fetch,
    });

    const error = await ocr
      .pages(Buffer.from('x'), 'image/jpeg', defaultOcrProcessorVersion)
      .then(
        () => null,
        (thrown: KernelError) => thrown,
      );
    assert.equal(error?.code, 'unavailable');
    assert.match(error?.message ?? '', /timed out/);
    assert.equal(error?.details?.timeoutMs, 20);
  });

  it('reports a failed call as unavailable, with the status and no token', async () => {
    const fetcher = fakeFetch(() => new Response('nope', { status: 429 }));
    const ocr = createDocumentAiOcr({
      project: 'dona-v5',
      location: 'eu',
      processorId: 'abc123',
      fetchImpl: fetcher.impl,
      token: async () => 'ya29.secret',
    });
    const error = await ocr
      .pages(Buffer.from('x'), 'image/png', defaultOcrProcessorVersion)
      .then(
        () => null,
        (thrown: KernelError) => thrown,
      );
    assert.equal(error?.code, 'unavailable');
    assert.equal(error?.details?.status, 429);
    assert.equal(JSON.stringify(error).includes('ya29'), false);
  });

  it('turns processor tokens into the same page shape pdfjs uses', () => {
    const result = readOcrDocument({
      text: 'hello world',
      pages: [
        {
          pageNumber: 2,
          dimension: { width: 50, height: 50 },
          tokens: [
            {
              layout: {
                textAnchor: { textSegments: [{ startIndex: 0, endIndex: 5 }] },
                confidence: 0.5,
                boundingPoly: {
                  normalizedVertices: [
                    { x: 0, y: 0 },
                    { x: 1, y: 0 },
                    { x: 1, y: 1 },
                    { x: 0, y: 1 },
                  ],
                },
              },
            },
          ],
        },
      ],
    });
    assert.equal(result.pages[0]?.number, 2);
    assert.equal(result.pages[0]?.items[0]?.text, 'hello');
    assert.equal('images' in result, false);
  });

  it('ends a line where the processor says one ends, not where a box happens to sit', () => {
    // **Slice 6.8.** Document AI returns `lines` beside `tokens` and the adapter discarded them, so
    // every token came back `endsLine: false` and `documentText` joined a whole page with spaces.
    // On a form a line break is where a field ends — A12's address reader is written against that
    // clause — and the week-6 demo is where the absence showed: an address printed without a full
    // stop read the city as everything that followed it.
    //
    // The mapping is by text-anchor range and never by geometry: the processor has already decided
    // what a line is, and a second opinion taken off the boxes is what drifts away from the first.
    const result = readOcrDocument({
      text: 'רקפת 12, שוהם\nדירה 3',
      pages: [
        {
          pageNumber: 1,
          dimension: { width: 100, height: 100 },
          tokens: [
            {
              layout: {
                textAnchor: { textSegments: [{ startIndex: 0, endIndex: 4 }] },
              },
            },
            {
              layout: {
                textAnchor: { textSegments: [{ startIndex: 5, endIndex: 8 }] },
              },
            },
            {
              layout: {
                textAnchor: {
                  textSegments: [{ startIndex: 9, endIndex: 13 }],
                },
              },
            },
            {
              layout: {
                textAnchor: {
                  textSegments: [{ startIndex: 14, endIndex: 18 }],
                },
              },
            },
            {
              layout: {
                textAnchor: {
                  textSegments: [{ startIndex: 19, endIndex: 20 }],
                },
              },
            },
          ],
          lines: [
            {
              layout: {
                textAnchor: { textSegments: [{ startIndex: 0, endIndex: 13 }] },
              },
            },
            {
              layout: {
                textAnchor: {
                  textSegments: [{ startIndex: 14, endIndex: 20 }],
                },
              },
            },
          ],
        },
      ],
    });
    assert.deepEqual(
      result.pages[0]?.items.map((item) => [item.text, item.endsLine]),
      [
        ['רקפת', false],
        ['12,', false],
        ['שוהם', true],
        ['דירה', false],
        ['3', true],
      ],
    );
  });

  it('leaves every token unbroken when the processor returned no lines at all', () => {
    // The adapter's own fallback, and it is the pre-6.8 behaviour rather than a guess: with no
    // lines to map, nothing is claimed about where one ends. A reader that invented a break here
    // would be the geometry detector this slice refused to write.
    const result = readOcrDocument({
      text: 'רקפת 12',
      pages: [
        {
          pageNumber: 1,
          dimension: { width: 100, height: 100 },
          tokens: [
            {
              layout: {
                textAnchor: { textSegments: [{ startIndex: 0, endIndex: 4 }] },
              },
            },
            {
              layout: {
                textAnchor: { textSegments: [{ startIndex: 5, endIndex: 7 }] },
              },
            },
          ],
        },
      ],
    });
    assert.deepEqual(
      result.pages[0]?.items.map((item) => item.endsLine),
      [false, false],
    );
  });

  it('throws rather than returning empty pages when nothing is configured', async () => {
    const error = await createUnconfiguredOcr()
      .pages(Buffer.from('x'), 'application/pdf', defaultOcrProcessorVersion)
      .then(
        () => null,
        (thrown: KernelError) => thrown,
      );
    assert.equal(error?.code, 'unavailable');
    assert.equal(createConfiguredOcr({}).describe(), 'unconfigured');
    assert.equal(
      createConfiguredOcr({
        DOCUMENT_AI_PROCESSOR: 'abc',
        GOOGLE_CLOUD_PROJECT: 'dona-v5',
      }).describe(),
      'documentai:eu/abc',
    );
  });

  it('splits fake pages on whitespace, with a confidence the pdfjs fake does not invent', async () => {
    const result = await createFakeOcrText(['חוזה שכירות']).pages(
      Buffer.from('x'),
      'application/pdf',
      'unused',
    );
    assert.deepEqual(
      result.pages[0]?.items.map((item) => [item.text, item.confidence]),
      [
        ['חוזה', 1],
        ['שכירות', 1],
      ],
    );
    assert.equal('images' in result, false);
  });
});
