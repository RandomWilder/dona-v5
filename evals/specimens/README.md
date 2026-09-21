# The specimen captures

**Nothing in this directory but this file is ever committed.** A capture holds every word of a
signed lease, which is the one thing this repository may not hold (`SPEC.md`, "Security defaults";
`.gitignore`'s note on real tenant documents). The hand reading in
[../fixtures/lease-extraction.ts](../fixtures/lease-extraction.ts) exists precisely so the words
themselves need not be.

## What these are

`<key>.words.json` is one specimen lease measured into a `MeasuredWord[]` — `{id, page, text, x, y,
width, height, confidence}`, the same array the work queue already carries as an extraction payload.
The extraction golden set (`evals/extraction.ts`, ticket #127) reads them and scores what the mapper
makes of them against the fixture.

Two keys, and they are the fixture's own:

| Key | Specimen |
|---|---|
| `pinchot-206-4` | 37 pages, one document, clean flatbed scan |
| `bloch-206-7` | 38 pages, two documents in one file, phone scan |

## Why a capture rather than the PDF

Neither specimen has a text layer worth the name — the first has no text at all across 37 pages and
the second's only item per page is the scanner's own watermark. The words therefore come from
Document AI, which means the alternative to a capture is an OCR call per specimen per gate run: 75
pages of a 15 MB file, twice, every time anybody runs `npm run evals`.

It also puts the cut where the measurement wants it. The gate scores **the mapper** — what the model
does with words it was given — and holding the words fixed is what makes two runs comparable at all.
An OCR that read differently on Tuesday would move the number for a reason that has nothing to do
with the change being judged.

## Making one

```
npm run specimens:capture -- <key> <path-to-pdf>
```

It needs `DOCUMENT_AI_PROCESSOR` and `GOOGLE_CLOUD_PROJECT` and application-default credentials, and
it costs one OCR call per specimen. Absent a capture the extraction cases skip and name the file they
wanted, on `ocr:sweep`'s argument: an unread specimen is not a measured zero.
