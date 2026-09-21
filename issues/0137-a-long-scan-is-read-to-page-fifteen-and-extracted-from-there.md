---
number: 137
title: "A long scan is read to page fifteen, and everything downstream extracts from there"
status: open
labels: [ready-for-agent]
assignee:
blocked_by: []
parent: 136
created: 2026-09-21
closed:
---

## What is wrong

`readForVerdict` (`src/evidence/internal/read.ts`) sends the first `onlineOcrPageLimit` pages of a
long document to OCR, and that is correct for the question it is answering: *is this a lease, and
where is it?* — which the opening pages settle. Slice 6.8 added it so that a 38-page file would be
read in part rather than not at all, and the reasoning is sound and recorded.

The defect is what happens to that partial reading afterwards. In `fileDocument`
(`src/evidence/internal/intake.ts`):

```ts
const pagesForExtract = reading.pages;
...
await extractAfterFile(deps, filed.id, pagesForExtract);
if (embedderConfigured(deps.embedder)) {
  await writeDocumentPassages(deps.db, filed.id, pagesForExtract, deps.embedder);
}
```

**The pages read for a verdict become the pages extracted from, and the pages indexed as Passages.**
For a scan with no usable text layer — which both specimen leases are — that means field extraction
and retrieval both see pages 1 to 15 of a 37- or 38-page document, and nothing anywhere says the
other twenty-three were never looked at. `ocrOutcome: 'partial'` and `pagesRead` record the truth
about the *verdict*, and nothing carries it to the two readers that inherit the same pages.

## What it costs, measured

#127's fixture keys both specimens end to end, so what is out of reach is countable rather than
estimated. Beyond page 15 sit `guarantor_name` and `guarantor_id_number` (PDF page 20 in
`pinchot-206-4`, inside ערבות אוואל on the note), `promissory_note_currency`, `index_base_month`,
`index_publication_date` and `apartment_type`. In `pinchot-206-4` that is **two of the twelve
declared field keys, both of them values the paper does contain**, reachable only by reading a page
the live path never sends.

The second specimen makes the shape of it plainer. Its guarantor fields are a credited absence — the
correct answer is nothing — and the live path would return nothing for them too, **for the wrong
reason**: not because it read page 21 and found no ערבות אוואל, but because it never opened it. A
right answer arrived at by not looking is indistinguishable from a wrong one until the day the
document changes.

#127's golden set does not see this, deliberately: `npm run specimens:capture` OCRs every page in
chunks, because the gate is measuring the mapper and a capture that stopped at fifteen would have
made a third of the fixture unreachable and scored the page limit rather than the reader. So the
baseline recorded on #127 is **better than what the live path can currently achieve**, and that gap
is this issue.

## What to build

Undecided, and the choice is the work. Three shapes, in increasing cost:

- **Say so, and nothing else.** Carry `pagesRead` onto the document row and show it on the reading
  and the field ledger, so an operator signing a reading knows it covers fifteen pages of thirty-
  eight. Cheapest, and honest; changes no number.
- **Read the whole document for extraction**, in chunks, as `specimens:capture` already does — the
  processor takes fifteen pages a call and the whole file rides in every request, so a 38-page lease
  is three calls of roughly 30 seconds each. That cannot happen on the upload request, so it is the
  work queue's, and `EXTRACT_WORK_KIND` already exists to hang it on.
- **Read the pages that answer the question.** The commercial annex is one page and the note is two,
  and which pages those are is discoverable from a cheap first pass. Least wasteful, most machinery,
  and it should not be built before the middle option has been measured.

The first is a prerequisite of either of the others and should land whichever is chosen.

## How it was found

Capturing both specimens for #127. The capture reads every page on purpose, which is what made the
difference between it and the live path visible; nothing in the suite or the gates was red.

## Related

`SPEC-evidence.md` *Reading a filed document*; slice 6.8's `onlineOcrPageLimit` reasoning in
`src/kernel/ocr.ts`; the baseline comment on #127.
