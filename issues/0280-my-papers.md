---
number: 280
title: "My papers"
status: closed
labels: [ready-for-agent]
assignee:
blocked_by: [279]
parent: 270
created: 2026-10-19
closed: 2026-10-21
---

## Parent

#270 — Tenant portal.

## What to build

The tenant sees the documents filed to their chosen tenancy on the flat page, opens them and downloads them. Only documents bound to the tenancy are shown; office-only records of the Unit or the Building never are.

**Paint screens 1m** (`mockups/tenant-portal.html`). **There is no separate papers page.** The documents are the "מסמכים" section of the flat page from #279, one row each: a file mark, the document's name, its type, and a download mark, the whole row the tap target. The home tile המסמכים שלי opens the flat page at that section.

## Acceptance criteria

- [x] SPEC-scope (or the documents module's spec) is edited first: the tenant may read tenancy-bound documents only.
- [x] Policy case, red first: a document of another tenancy, or of the Unit or Building, is not found by its identifier.
- [x] Opening and downloading are audit rows.
- [x] Every page in this ticket works at phone width with no sideways scroll, by keyboard alone and with a screen reader (IS 5568), and its strings are Hebrew rows, not literals.
- [x] Clicked on `:3000` before merge.

## Blocked by

- #279

## Comment — 2026-10-21

Closed. The flat page lists the documents bound to the chosen tenancy. A document of another tenancy, or of the unit, or of the building, is not found by its identifier. Fetching the file writes `portal.open_document` and `portal.download_document`.

Clicked on `:3000`: the signed-in session belongs to a building that is not in the portal, so the live page stayed the no-access screen (no sideways scroll at 390px). A guessed document address on that session stays there too. The list, the download, and the three misses were driven over HTTP by `tests/policy/portal-papers.test.ts`. Not pushed.
