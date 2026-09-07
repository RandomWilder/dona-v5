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
    assert.equal(ocr.describe(), 'documentai:eu/abc123');
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
          image: {
            content: Buffer.from('img').toString('base64'),
            mimeType: 'image/png',
          },
        },
      ],
    });
    assert.equal(result.pages[0]?.number, 2);
    assert.equal(result.pages[0]?.items[0]?.text, 'hello');
    assert.equal(result.images[0]?.pageNumber, 2);
    assert.equal(result.images[0]?.bytes.toString(), 'img');
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
    assert.equal(result.images[0]?.pageNumber, 1);
    assert.equal(result.images[0]?.mimeType, 'image/png');
    assert.ok((result.images[0]?.bytes.length ?? 0) > 0);
  });
});
