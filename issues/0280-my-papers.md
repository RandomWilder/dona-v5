---
number: 280
title: "My papers"
status: open
labels: [ready-for-agent]
assignee:
blocked_by: [279]
parent: 270
created: 2026-10-19
closed:
---

## Parent

#270 — Tenant portal.

## What to build

The tenant sees the documents filed to their chosen tenancy on the flat page, opens them and downloads them. Only documents bound to the tenancy are shown; office-only records of the Unit or the Building never are.

**Paint screens 1m** (`mockups/tenant-portal.html`). **There is no separate papers page.** The documents are the "מסמכים" section of the flat page from #279, one row each: a file mark, the document's name, its type, and a download mark, the whole row the tap target. The home tile המסמכים שלי opens the flat page at that section.

## Acceptance criteria

- [ ] SPEC-scope (or the documents module's spec) is edited first: the tenant may read tenancy-bound documents only.
- [ ] Policy case, red first: a document of another tenancy, or of the Unit or Building, is not found by its identifier.
- [ ] Opening and downloading are audit rows.
- [ ] Every page in this ticket works at phone width with no sideways scroll, by keyboard alone and with a screen reader (IS 5568), and its strings are Hebrew rows, not literals.
- [ ] Clicked on `:3000` before merge.

## Blocked by

- #279
