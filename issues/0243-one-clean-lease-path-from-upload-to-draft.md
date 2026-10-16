---
number: 243
title: One clean lease path from upload to draft
status: closed
labels: [ready-for-agent]
assignee:
blocked_by: []
parent:
created: 2026-10-15
closed: 2026-10-16
---

## Why

On 15 Oct 2026 two real leases on staging could not become drafts.

- **Lease `01a13956`:** fully approved and with its flat. Every press of פתיחת טיוטה answered 409
  and re-rendered the screen with "נסו שוב" and no reason, and nothing was logged. A dry run of the
  press, rolled back, found the cause. Copying `start_date` onto the tenancy needs a row in
  `field_promotion`, and the 12 Oct staging reset had emptied that table.
- **Lease `01a13e3f`:** preselected no flat. The regex place reader took a phrase after the
  address's comma as the town. The extractor read the same address correctly, and a person approved
  it: `<street> 50, <town>`, flat 6, building 205.

Both failures are symptoms of the same shape:
- the path from upload to draft carries two mechanisms that predate #232, and they now duplicate
  what the press does;
- one of them depends on seeded data.

The decision is
[ADR-0016](../docs/decisions/ADR-0016-approval-is-the-only-act-the-press-writes-the-columns.md).
The current-state statement of the lease path is SPEC-flows A16, with A2 for the press. Both were
rewritten in this change. SPEC-evidence, *The column map* and *Resolution*, state the two mechanisms.

## The goal

On staging, with no seeding beyond what staging holds today (the terms profile, the document-type
catalogue, the estate):

1. An operator uploads a lease.
2. They approve its reading on הקריאה.
3. They see on פתיחת טיוטה:
   - the right flat, preselected from the approved address;
   - what the press will and will not write onto the letting;
   - every refusal.
4. One press writes the `DRAFT` with everything the approved reading supports.
5. On the tenancy page, they file or waive the handover protocol and press הפעלה.
6. The letting is `ACTIVE`.

Any step that refuses says why, on the screen and in the log.

## Tickets

- [#244](0244-the-flat-is-preselected-from-the-approved-address.md): the flat is preselected from the
  approved address.
- [#245](0245-the-press-writes-the-columns-through-a-map-in-code.md): the press writes the columns
  through a map in code, shows what will not land, and drops `field_promotion` and `קדם`.
- [#246](0246-the-upload-reads-no-place-for-a-lease.md): the upload reads no place for a lease, and the
  upload-time flat step goes. Blocked by #244.

Plan mode applies: #245 is a migration and touches evidence, tenancy and estate.

## Done when

- [x] #244, #245 and #246 are closed.
- [ ] A dry run of the press, rolled back, succeeds for both staging leases against the deployed
      code.
- [x] The flow is clicked locally on `:3000`.
- [x] After deploy, the director runs `01a13956` and `01a13e3f` through to `ACTIVE` on staging.
      Each one's protocol is filed or waived.

## Comment — 2026-10-16

On staging revision `09fc482`, both leases were pressed for real rather than in a rolled-back dry run. `01a13e3f` posted פתיחת טיוטה at 20:16:31Z and got 302, then tenancy `01a1465b` waived and activated, both 302. `01a13956` posted at 20:18:20Z and got 302, then tenancy `01a1465d` waived and activated, both 302. No `lease open failed` line, and no 4xx or 5xx on those requests. The separate rolled-back dry run was not repeated.

## Not in this issue

- A12's regex reader for non-lease types, and its file-on-exact-one.
- #177 (the annex and the tail read).
- A reassign command for the second assigned bay and the second assigned storage. With this issue, a
  second number that is not a Space is fixed before the press by adding the Space, and the screen
  says so.
