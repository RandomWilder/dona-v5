import { readFileSync, writeFileSync } from 'node:fs';
import { specimenWordsPath } from '../evals/extraction.ts';
import { numberWords } from '../src/evidence/contract.ts';
import {
  createConfiguredOcr,
  onlineOcrByteLimit,
  onlineOcrPageLimit,
} from '../src/kernel/ocr.ts';
import {
  createPdfjsText,
  type PdfPage,
  slicePdf,
  stampOriginalPages,
} from '../src/kernel/pdf.ts';

// Measure one specimen lease into the word list the extraction golden set scores against.
//
//   npm run specimens:capture -- <key> <path-to-pdf>
//
// In no workflow, on purpose, and the same standing as `seed:doctypes` and `ocr:sweep`: it is run by
// hand, once per specimen, and what it writes is deliberately not in the repository — a capture
// holds every word of a signed lease (see evals/specimens/README.md).
//
// **Why it exists at all.** Neither specimen has a usable text layer: the first carries no text
// across 37 pages and the second's only item per page is the scanner's watermark. So the words the
// mapper is given come from Document AI, and the choice is between one call per specimen ever and
// two calls every time anybody runs `npm run evals`. Holding the words fixed is also what makes two
// runs of the gate comparable: an OCR that read differently on Tuesday would move the score for a
// reason that has nothing to do with the change being judged.
//
// **The same slice-then-OCR shape as the live path (#137).** `readForVerdict` still answers "is this
// a lease and where is it" from the first fifteen pages. Capture reads every slice, because the
// fixture's values are spread across pages 1 to 21.

const [key, file] = process.argv.slice(2);
if (!key || !file) {
  console.error('usage: npm run specimens:capture -- <key> <path-to-pdf>');
  process.exit(1);
}

const ocr = createConfiguredOcr();
console.log(`specimens:capture — ocr ${ocr.describe()}`);
if (ocr.describe() === 'unconfigured') {
  console.error(
    '  NOT RUN — no DOCUMENT_AI_PROCESSOR. Neither specimen has a text layer, so an unconfigured',
  );
  console.error(
    '        reader would write an empty capture, which scores as a reader that read nothing.',
  );
  process.exit(1);
}

const bytes = readFileSync(file);

// pdfjs for the page count only. It is the one thing a scan without a text layer still tells you.
const native = await createPdfjsText({ timeoutMs: 120_000 }).pages(bytes);
console.log(`  ${file}`);
console.log(
  `  ${native.length} pages, read in slices of ${onlineOcrPageLimit}`,
);

const pages: PdfPage[] = [];
for (let from = 1; from <= native.length; from += onlineOcrPageLimit) {
  const selected = Array.from(
    { length: Math.min(onlineOcrPageLimit, native.length - from + 1) },
    (_, at) => from + at,
  );
  const slice = await slicePdf(bytes, selected);
  if (slice.byteLength > onlineOcrByteLimit) {
    console.error(
      `  NOT RUN — slice ${selected[0]}-${selected[selected.length - 1]} is ${(slice.byteLength / 1_048_576).toFixed(1)} MiB, beyond the online call.`,
    );
    process.exit(1);
  }
  const started = Date.now();
  const result = await ocr.pages(slice, 'application/pdf', 'stable', selected);
  const stamped = stampOriginalPages(result.pages, selected);
  pages.push(...stamped);
  console.log(
    `    pages ${selected[0]}-${selected[selected.length - 1]}: ${stamped.length} back in ${((Date.now() - started) / 1000).toFixed(1)}s (${(slice.byteLength / 1_048_576).toFixed(1)} MiB)`,
  );
}

pages.sort((one, two) => one.number - two.number);
const words = numberWords(pages);
const out = specimenWordsPath(key);
writeFileSync(out, JSON.stringify(words));
console.log(
  `  ${words.length} words across ${pages.length} pages → ${out} (not committed)`,
);
