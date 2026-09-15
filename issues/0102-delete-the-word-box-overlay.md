---
number: 102
title: "Delete the word-box overlay; the page number replaces it"
status: closed
labels: [ready-for-agent]
assignee: cursor
blocked_by: []
parent: 99
created: 2026-09-15
closed: 2026-09-15
---

## Parent

#99 — Admin document-upload flow: one reading, approve, confirm, activate.

## What to build

An administrator who has just uploaded a document and wants to check what the system read sees the
per-page text, the quality verdict, and — beside every extracted value — the page it was read from.
They no longer see a rendered page image with boxes drawn over the words.

The overlay's job was validating an extracted field against the paper. The page number does that job
more cheaply: the administrator uploaded the document moments ago and has it in front of them. The
overlay's cost is out of proportion to that — it forces page images to exist, which forces the OCR
request to return them, and which a natively-readable PDF cannot supply at all, since that path
produces no page images. Removing it removes the last reason to fetch or render page images anywhere
in the system.

So the geometry goes: out of the read screen, out of the reader's return shape, and out of the OCR
client, whose request switches to its imageless mode. That shrinks every OCR response and moves the
system further inside its request size cap. Extraction continues to anchor a field to the words it
was read from while extracting — that is how a page number is known — but the geometry is no longer
persisted and no longer drawn.

This is a subtraction. The read screen must still render, and must be clicked on a running local
server before the change merges. There is a recorded defect in the overlay's history — a withheld
identifier once leaked through a word box's title attribute — so deleting it also deletes that class
of leak; check nothing else in the removed markup was the only thing withholding something.

## Acceptance criteria

- [x] The read screen renders per-page text and the quality verdict, with no page image and no word or field boxes
- [x] Every extracted value on the read screen is labelled with the page it was read from
- [x] The page-image geometry is removed from the read screen, the reader's return shape and the OCR client
- [x] The OCR request runs in imageless mode
- [x] No code path in the system fetches, stores or renders a page image; no rasterising dependency is added
- [x] Extraction still knows the page a field was read from
- [x] The read screen is clicked on a running local server before merge
- [x] Evidence specs are edited in the same change

## Blocked by

None (can start immediately).

## Comment — 2026-09-15

Done. Overlay, page images and imageless OCR. Per-page text withheld below `party.national_id.read`
(the old `title` leak has no markup left). Extraction still stores the union box so household pairing
keeps document order; that box is never drawn. Clicked `GET /documents/:id/read` on `:3000` after
restart — 200, no `word-box`, no `<img`.
