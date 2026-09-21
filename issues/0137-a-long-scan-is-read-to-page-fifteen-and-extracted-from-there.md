---
number: 137
title: "A long scan is read to page fifteen, and everything downstream extracts from there"
status: closed
labels: [ready-for-agent]
assignee: cursor
blocked_by: []
parent: 136
created: 2026-09-21
closed: 2026-09-22
---

## What is wrong

`readForVerdict` sends the first `onlineOcrPageLimit` pages of a long document to OCR, and that is
correct for the question it is answering: *is this a lease, and where is it?* — which the opening
pages settle. Slice 6.8 added it so that a 38-page file would be read in part rather than not at all,
and the reasoning is sound and recorded.

The defect is what happens to that partial reading afterwards. In `fileDocument`, the pages read for
a verdict become the pages extracted from, and the pages indexed as Passages. For a scan with no
usable text layer — which both specimen leases are — that means field extraction and retrieval both
see pages 1 to 15 of a 37- or 38-page document, and nothing anywhere says the other twenty-three were
never looked at. `ocrOutcome: 'partial'` and `pagesRead` record the truth about the *verdict*, and
nothing carries it to the two readers that inherit the same pages.

A second defect sits under the first. Slice 6.8 sends the **whole file** on every OCR call and asks
for fifteen pages with `individualPageSelector`. Document AI bounds the *request* at 20 MiB, and the
file is base64-encoded, so a scan above `onlineOcrByteLimit` (~15 MiB) cannot be read at any page
count. Selecting pages 16–30 does not shrink the request. Remainder OCR in that shape is three
uploads of the same blob, and the next fat scan never reaches “the rest.” These are scans; 15 MiB is
already the lip of the demo lease.

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

Decided. One path, not a menu.

**Each OCR call is a slice of at most fifteen pages, cut from the PDF before the processor sees it.**
The port receives that thin file, not the original scan with a page list. Original page numbers are
preserved on the words. The first slice is the verdict (unchanged question: is this a lease, and
where). After the row is filed, remaining slices run on the work queue — never on the upload
request. Extraction and passages wait until those slices have been read; they must not run on the
verdict's fifteen pages and then pretend the document is done.

**Coverage is a fact on the row.** `document.page_count` and `document.pages_read` (nullable together
for archive rows filed before this knew the count). Beat 3 and the field ledger say so when the two
differ. The operator may open הקריאה while it is still 15 of 38; that sitting is not gated on
completion. Unread pages are not an absence in the paper: a missing guarantor is only a missing
guarantor once page 21 has been read.

**A scan may be filed up to 100 MB.** That is the upload bound (`LIMITS.fileSize`). It is a bound on
a runaway, chosen for scans, not a claim that Document AI will swallow 100 MB. `too_large` is a
refusal when a *slice* still will not fit the processor request, and writes nothing for that file if
the first slice cannot be sent. There is no unlimited size.

**Not built here:** Document AI batch, picking the annex from a cheap first pass, and any store
ceiling above 100 MB. Batch and annex-picking wait until this path has been measured.

## Acceptance criteria

- [x] OCR is called with a PDF of at most fifteen pages, not the original file plus a page selector
- [x] The verdict is taken on the first slice only
- [x] Remaining slices run on the work queue; the upload returns on the first slice
- [x] Extraction and passages run over the pages that have been read once the remainder has run, not
      over the verdict slice alone
- [x] `document.page_count` and `document.pages_read` record coverage; the reading screen and the
      field ledger say so when they differ; a shortfall is not treated as an absence in the paper
- [x] A file up to 100 MB is accepted at the upload edge; a first slice that still exceeds the
      processor request is `too_large` and writes nothing
- [x] Capture (`specimens:capture`) uses the same slice-then-OCR shape as the live path
- [x] Policy or contract case was red first: a long scan's later page is absent from extract/passages
      until the remainder has run, and present after

## How it was found

Capturing both specimens for #127. The capture reads every page on purpose, which is what made the
difference between it and the live path visible; nothing in the suite or the gates was red.

## Related

`SPEC-evidence.md` *Reading a filed document* and the 6.8 byte-bound paragraph, both amended in this
change. Slice 6.8's `onlineOcrPageLimit` in `src/kernel/ocr.ts`. The baseline comment on #127.

## Comment — 2026-09-22

Decided: remainder OCR by **slicing** the PDF, not by sending the whole file with
`individualPageSelector`. Upload ceiling **100 MB** for scans. No batch processor, no unbounded
size, no annex-picking. Beat 3 is not gated on 38 of 38. Spec files in the same change.
