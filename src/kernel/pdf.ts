import { createRequire } from 'node:module';
import path from 'node:path';
import { KernelError } from './errors.ts';

// PDF text, on the same footing as objects.ts: the shape of a document and no
// business logic at all. It does not know what a lease or a clause is -- the
// module that does is `src/evidence/`, and SPEC-evidence.md is where what is
// done with this text is specified. (This cited SPEC-occupancy.md until slice
// 3.3, a v3 filename that has never existed in this repository; slice 3.2 fixed
// the identical lifted citation in objects.ts and this was the second copy of
// it. `verify.ts` is the first reader, and chunking for retrieval is week 4's.)
//
// Positions and not a string, deliberately. A reader that hands back a page as
// one paragraph is unusable for the document this system exists to read: the
// lease's facts live in a two-column label/value annex, and flattened text
// binds every value to the label on the line above it
// (docs/reference/lease-template-donadom.md). Positions are also what makes a
// citation traceable to a place rather than merely attributed to a document.

export interface PdfTextItem {
  text: string;
  // Top-down page coordinates, not PDF's bottom-up ones: y grows downward, so
  // reading order is ascending y and a caller never has to remember which way
  // up the page is. x is the item's left edge and `width` its advance, so its
  // right edge is x + width -- the edge a right-to-left line starts at.
  x: number;
  y: number;
  width: number;
  height: number;
  // What the extractor believed about direction. Hebrew arrives as `rtl` with
  // `text` already in logical order.
  rightToLeft: boolean;
  endsLine: boolean;
  // pdfjs has no per-word score, so the native-text adapter writes null. The
  // OCR adapter writes the processor's. A caller that needs a number must not
  // invent one.
  confidence: number | null;
}

export interface PdfPage {
  // 1-based, and it is the number a citation shows a human.
  number: number;
  width: number;
  height: number;
  // Empty for a page with no text layer. That is not an error: four pages of
  // the sample lease are images, and saying *which* is the caller's job
  // (ROADMAP week 3's OCR cut line).
  items: PdfTextItem[];
}

export interface PdfText {
  pages(bytes: Buffer): Promise<PdfPage[]>;
  // For the boot line and for tests, as ObjectStore.describe() is.
  describe(): string;
}

export interface PdfTextOptions {
  // Code, not a config row: a bound that stops one request consuming a server
  // is a safety limit. Eight seconds because the week-3 staging hang lasted a
  // minute and became a 503; OCR is the next reader, and an empty result here
  // files as unverified rather than as unavailable.
  timeoutMs?: number;
}

export const defaultPdfTimeoutMs = 8_000;

/**
 * Resolves with empty pages when `read` has not settled in time.
 *
 * A later rejection from `read` is swallowed: the caller already moved on, and
 * an unhandled rejection would take the process down the way an unbounded
 * parse took the request down.
 */
export function boundPages(
  read: () => Promise<PdfPage[]>,
  timeoutMs: number,
): Promise<PdfPage[]> {
  let settled = false;
  const pending = read();
  pending.catch(() => {});
  return new Promise((resolve, reject) => {
    const id = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      resolve([]);
    }, timeoutMs);
    pending.then(
      (pages) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(id);
        resolve(pages);
      },
      (error: unknown) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(id);
        reject(error);
      },
    );
  });
}

// pdfjs's own item shape, narrowed to what is used. A text content stream also
// carries marked-content markers with no `str` at all, which is why every item
// is checked rather than cast.
interface PdfjsItem {
  str?: unknown;
  dir?: unknown;
  width?: unknown;
  height?: unknown;
  transform?: unknown;
  hasEOL?: unknown;
}

// The standard-font data ships inside the package. Resolved from the package's
// own location rather than a path relative to this file, so it survives being
// hoisted or nested by npm; without it pdfjs warns on every document that uses
// a base-14 font.
function standardFontDataUrl(): string {
  const require = createRequire(import.meta.url);
  const pkg = require.resolve('pdfjs-dist/package.json');
  return `${path.join(path.dirname(pkg), 'standard_fonts')}${path.sep}`;
}

export function createPdfjsText(options: PdfTextOptions = {}): PdfText {
  const timeoutMs = options.timeoutMs ?? defaultPdfTimeoutMs;
  return {
    async pages(bytes) {
      return boundPages(() => readPdfjsPages(bytes), timeoutMs);
    },
    describe: () => 'pdfjs',
  };
}

async function readPdfjsPages(bytes: Buffer): Promise<PdfPage[]> {
  // Lazily, and once per call: a process that never reads a PDF never pays
  // for loading it, exactly as objects.ts defers reading ADC.
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = getDocument({
    // A copy, because pdfjs transfers the buffer it is given and the caller
    // still holds these bytes -- they are on their way into a row.
    data: new Uint8Array(bytes),
    // The input is a third-party PDF, and a PDF is a program. Nothing here
    // renders, so nothing here needs a glyph: no system fonts, no font
    // faces built at runtime. (pdfjs's old `isEvalSupported` switch is
    // gone in v6 -- eval-based font compilation was removed outright, so
    // there is no longer a lever to turn off.)
    useSystemFonts: false,
    disableFontFace: true,
    standardFontDataUrl: standardFontDataUrl(),
  });
  let document: Awaited<typeof task.promise>;
  try {
    document = await task.promise;
  } catch (cause) {
    // An unopenable file is `invalid` and never a driver stack: the caller
    // is a staff screen, and the sentence it shows should be about the
    // file rather than about pdfjs.
    await task.destroy().catch(() => {});
    throw new KernelError('invalid', 'the file could not be read as a PDF', {
      reason: cause instanceof Error ? cause.message : 'unknown',
    });
  }
  try {
    const pages: PdfPage[] = [];
    for (let number = 1; number <= document.numPages; number += 1) {
      const page = await document.getPage(number);
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      pages.push({
        number,
        width: viewport.width,
        height: viewport.height,
        items: readItems(content.items as PdfjsItem[], viewport.height),
      });
    }
    return pages;
  } finally {
    await task.destroy().catch(() => {});
  }
}

// What the tests use, so a suite about what is *done* with a document's text needs neither pdfjs nor
// a Hebrew font in a fixture PDF (slice 3.3). `createFakeExtractor` in extraction.ts is the
// precedent, and this one has a second job: **it splits each page on whitespace, one item per word**,
// because that is what a real text layer hands back and a caller that only ever saw whole pages
// would be tested against a document shape that does not occur. A term that wraps across a line is
// the case slice 3.3's guard exists to survive.
export function createFakePdfText(pages: readonly string[]): PdfText {
  return {
    async pages(_bytes) {
      return pages.map((text, index) => ({
        number: index + 1,
        width: 595,
        height: 842,
        items: text
          .split(/\s+/)
          .filter((word) => word.length > 0)
          .map((word, at) => ({
            text: word,
            x: 0,
            y: at,
            width: word.length,
            height: 12,
            rightToLeft: true,
            endsLine: false,
            confidence: null,
          })),
      }));
    },
    describe: () => 'fake',
  };
}

function readItems(items: PdfjsItem[], pageHeight: number): PdfTextItem[] {
  const read: PdfTextItem[] = [];
  for (const item of items) {
    if (typeof item?.str !== 'string' || !Array.isArray(item.transform)) {
      // A marked-content marker rather than text.
      continue;
    }
    const transform = item.transform as number[];
    const x = Number(transform[4]);
    const baseline = Number(transform[5]);
    if (!Number.isFinite(x) || !Number.isFinite(baseline)) {
      continue;
    }
    const endsLine = item.hasEOL === true;
    if (item.str.trim().length === 0) {
      // pdfjs emits an empty run to carry a line break. It is the *previous*
      // item's line that ends, and dropping the run while keeping the fact is
      // what stops every such break becoming a blank chunk downstream.
      const previous = read.at(-1);
      if (endsLine && previous) {
        previous.endsLine = true;
      }
      continue;
    }
    read.push({
      text: item.str,
      x,
      // PDF's origin is the bottom-left corner. Flipped here, once, so that
      // every reader downstream can sort by y and get reading order.
      y: pageHeight - baseline,
      width: Number(item.width) || 0,
      height: Number(item.height) || 0,
      rightToLeft: item.dir === 'rtl',
      endsLine,
      confidence: null,
    });
  }
  return read;
}
