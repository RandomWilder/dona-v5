import { GoogleAuth } from 'google-auth-library';
import { KernelError } from './errors.ts';
import { fakeItems, type PdfPage, type PdfTextItem } from './pdf.ts';

// Bytes in, positioned items out. Infrastructure on the footing pdf.ts and
// objects.ts stand on: the shape of a call and no business logic. It does not
// know what a lease is.
//
// Document AI's general OCR processor, not Form Parser -- the schema is already
// declared, so Google needn't infer structure. REST over fetch; ADC via
// google-auth-library; no Document AI SDK. Same split objects.ts made for GCS.
//
// Sources:
//   https://cloud.google.com/document-ai/docs/send-request
//   https://cloud.google.com/document-ai/docs/reference/rest/v1/projects.locations.processors/process
//   https://cloud.google.com/document-ai/docs/ocr

export interface OcrPageImage {
  pageNumber: number;
  mimeType: string;
  bytes: Buffer;
}

export interface OcrResult {
  pages: PdfPage[];
  images: OcrPageImage[];
}

export interface OcrText {
  pages(
    bytes: Buffer,
    mimeType: string,
    processorVersion: string,
  ): Promise<OcrResult>;
  describe(): string;
}

export interface DocumentAiOcrOptions {
  project: string;
  location: string;
  processorId: string;
  fetchImpl?: typeof fetch;
  token?: () => Promise<string>;
  timeoutMs?: number;
  endpoint?: string;
}

export const defaultOcrTimeoutMs = 20_000;
export const defaultOcrLocation = 'eu';
export const defaultOcrProcessorVersion = 'pretrained-ocr-v2.1-2024-08-07';
export const onlineOcrPageLimit = 15;

const ocrScope = 'https://www.googleapis.com/auth/cloud-platform';

interface Vertex {
  x?: number;
  y?: number;
}

interface Layout {
  textAnchor?: {
    textSegments?: Array<{
      startIndex?: string | number;
      endIndex?: string | number;
    }>;
  };
  confidence?: number;
  boundingPoly?: { normalizedVertices?: Vertex[]; vertices?: Vertex[] };
}

interface ProcessorPage {
  pageNumber?: number;
  dimension?: { width?: number; height?: number };
  tokens?: Array<{ layout?: Layout }>;
  lines?: Array<{ layout?: Layout }>;
  image?: { content?: string; mimeType?: string };
}

interface ProcessResponse {
  document?: {
    text?: string;
    pages?: ProcessorPage[];
  };
}

export function createDocumentAiOcr(options: DocumentAiOcrOptions): OcrText {
  const { project, location, processorId } = options;
  const call = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? defaultOcrTimeoutMs;
  const host =
    options.endpoint ?? `https://${location}-documentai.googleapis.com`;
  let auth: GoogleAuth | null = null;
  const token =
    options.token ??
    (async () => {
      auth ??= new GoogleAuth({ scopes: [ocrScope] });
      const value = await auth.getAccessToken();
      if (!value) {
        throw new KernelError('unavailable', 'no access token for document ai');
      }
      return value;
    });

  return {
    async pages(bytes, mimeType, processorVersion) {
      const name = `projects/${project}/locations/${location}/processors/${processorId}/processorVersions/${processorVersion}`;
      const url = `${host}/v1/${name}:process`;
      let response: Response;
      try {
        response = await call(url, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${await token()}`,
            'content-type': 'application/json; charset=utf-8',
          },
          body: JSON.stringify({
            skipHumanReview: true,
            imagelessMode: false,
            rawDocument: {
              mimeType,
              content: bytes.toString('base64'),
            },
            processOptions: {
              ocrConfig: { hints: { languageHints: ['iw'] } },
            },
          }),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        if (error instanceof KernelError) {
          throw error;
        }
        throw new KernelError('unavailable', 'the ocr call timed out', {
          timeoutMs,
        });
      }
      if (!response.ok) {
        throw new KernelError('unavailable', 'the ocr call failed', {
          status: response.status,
        });
      }
      const body = (await response.json()) as ProcessResponse;
      return readOcrDocument(body.document);
    },
    describe: () => `documentai:${location}/${processorId}`,
  };
}

export function createUnconfiguredOcr(): OcrText {
  return {
    async pages() {
      throw new KernelError('unavailable', 'no ocr processor is configured');
    },
    describe: () => 'unconfigured',
  };
}

// A 1×1 PNG so an overlay test has a page image without a live processor.
const fakePagePng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

export function createFakeOcrText(
  pages: readonly string[],
  confidence = 1,
): OcrText {
  return {
    async pages(_bytes, _mimeType) {
      return {
        pages: pages.map((text, index) => ({
          number: index + 1,
          width: 595,
          height: 842,
          // The pdfjs fake's own fixture shape, with a score on every word — one function, because
          // a second copy is a second place a line break can be forgotten (slice 6.8).
          items: fakeItems(text, confidence),
        })),
        images: pages.map((_, index) => ({
          pageNumber: index + 1,
          mimeType: 'image/png',
          bytes: fakePagePng,
        })),
      };
    },
    describe: () => 'fake',
  };
}

export function createConfiguredOcr(
  env: Record<string, string | undefined> = process.env,
): OcrText {
  const processorId = env.DOCUMENT_AI_PROCESSOR;
  const project = env.DOCUMENT_AI_PROJECT ?? env.GOOGLE_CLOUD_PROJECT;
  const location = env.DOCUMENT_AI_LOCATION ?? defaultOcrLocation;
  if (!processorId || !project) {
    return createUnconfiguredOcr();
  }
  return createDocumentAiOcr({ project, location, processorId });
}

export function readOcrDocument(
  document: ProcessResponse['document'],
): OcrResult {
  const text = document?.text ?? '';
  const sourcePages = document?.pages ?? [];
  const pages: PdfPage[] = [];
  const images: OcrPageImage[] = [];
  for (const source of sourcePages) {
    const number = source.pageNumber ?? pages.length + 1;
    const width = source.dimension?.width ?? 1;
    const height = source.dimension?.height ?? 1;
    // **Tokens, or the lines themselves when the reply carried no tokens.** In the second case every
    // item *is* a line and ends one, which is what `tokensAreLines` says below.
    const tokensAreLines = !source.tokens?.length;
    const layouts = (tokensAreLines ? source.lines : source.tokens)?.map(
      (entry) => entry.layout,
    );
    // Where the processor says each line runs from and to. Empty when the tokens are the lines, or
    // when the reply carried none — and then nothing is claimed about where a line ends (slice 6.8).
    const lines = tokensAreLines ? [] : rangesOf(source.lines);
    const items: PdfTextItem[] = [];
    const lineOf: number[] = [];
    for (const layout of layouts ?? []) {
      if (!layout) {
        continue;
      }
      const word = textOf(text, layout);
      if (word.length === 0) {
        continue;
      }
      const box = boxOf(layout, width, height);
      lineOf.push(lineIndexOf(lines, layout));
      items.push({
        text: word,
        ...box,
        rightToLeft: true,
        endsLine: tokensAreLines,
        confidence:
          typeof layout.confidence === 'number' ? layout.confidence : null,
      });
    }
    markLineEnds(items, lineOf, lines.length > 0);
    pages.push({ number, width, height, items });
    if (source.image?.content) {
      images.push({
        pageNumber: number,
        mimeType: source.image.mimeType ?? 'image/png',
        bytes: Buffer.from(source.image.content, 'base64'),
      });
    }
  }
  return { pages, images };
}

/**
 * Where each line the processor found runs from and to, in the document's own text. Slice 6.8.
 *
 * Document AI hands back `lines` beside `tokens` and this adapter used to drop them, so every item
 * came back `endsLine: false` and the only consumer of a page's text joined it all with spaces. On a
 * form a line break is where a field ends (SPEC-evidence.md, A12's anchors), and the week-6 demo is
 * where its absence showed.
 */
function rangesOf(lines: ProcessorPage['lines']): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  for (const line of lines ?? []) {
    const span = spanOf(line.layout);
    if (span) {
      ranges.push(span);
    }
  }
  return ranges.sort((a, b) => a[0] - b[0]);
}

/**
 * Which of those lines a token belongs to, **by text-anchor range and never by geometry**.
 *
 * The processor has already decided what a line is; a second opinion taken off the bounding boxes is
 * what drifts away from the first. `-1` is a token the line list does not cover, and it ends no line
 * rather than being guessed at.
 */
function lineIndexOf(lines: Array<[number, number]>, layout: Layout): number {
  const span = spanOf(layout);
  if (!span) {
    return -1;
  }
  return lines.findIndex(([from, to]) => span[0] >= from && span[0] < to);
}

/**
 * The last token of each line ends it — decided by where the *next* token sits rather than by
 * reaching an offset, because whether a line's own segment includes its trailing newline is the
 * processor's business and not something a caller should have to know.
 */
function markLineEnds(
  items: PdfTextItem[],
  lineOf: number[],
  known: boolean,
): void {
  if (!known) {
    return;
  }
  items.forEach((item, at) => {
    const next = lineOf[at + 1];
    item.endsLine = next === undefined || next !== lineOf[at];
  });
}

function spanOf(layout: Layout | undefined): [number, number] | null {
  const segments = layout?.textAnchor?.textSegments ?? [];
  let first: number | null = null;
  let last: number | null = null;
  for (const segment of segments) {
    const from = Number(segment.startIndex ?? 0);
    const to = Number(segment.endIndex ?? Number.NaN);
    if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) {
      continue;
    }
    first = first === null || from < first ? from : first;
    last = last === null || to > last ? to : last;
  }
  return first === null || last === null ? null : [first, last];
}

function textOf(documentText: string, layout: Layout): string {
  const segments = layout.textAnchor?.textSegments ?? [];
  return segments
    .map((segment) => {
      const start = Number(segment.startIndex ?? 0);
      const end = Number(segment.endIndex ?? 0);
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
        return '';
      }
      return documentText.slice(start, end);
    })
    .join('')
    .trim();
}

function boxOf(
  layout: Layout,
  pageWidth: number,
  pageHeight: number,
): Pick<PdfTextItem, 'x' | 'y' | 'width' | 'height'> {
  const vertices =
    layout.boundingPoly?.normalizedVertices ??
    layout.boundingPoly?.vertices ??
    [];
  const xs = vertices.map((vertex) => Number(vertex.x)).filter(Number.isFinite);
  const ys = vertices.map((vertex) => Number(vertex.y)).filter(Number.isFinite);
  if (xs.length === 0 || ys.length === 0) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);
  const normalised = Boolean(layout.boundingPoly?.normalizedVertices);
  const scaleX = normalised ? pageWidth : 1;
  const scaleY = normalised ? pageHeight : 1;
  return {
    x: roundPx(minX * scaleX),
    y: roundPx(minY * scaleY),
    width: roundPx((maxX - minX) * scaleX),
    height: roundPx((maxY - minY) * scaleY),
  };
}

function roundPx(value: number): number {
  return Math.round(value * 1000) / 1000;
}
