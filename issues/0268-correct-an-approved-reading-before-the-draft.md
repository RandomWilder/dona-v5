---
number: 268
title: Any approved reading can be corrected before the draft opens
status: closed
labels: [ready-for-agent]
assignee:
blocked_by: []
parent:
created: 2026-10-19
closed: 2026-10-19
---

## Problem Statement

Once an admin approves a row on הקריאה, the approved value can no longer be changed. A second approval
of a reading is refused, and the spec says so on purpose. Some captured text will be wrong, and an
admin will sometimes miss it at the approval stage. A misread that a person waves through by mistake
then follows the lease into the draft tenancy, or can only be worked around. This holds for every row
on the reading: the address, the flat number, names, dates, contacts, money terms and identifiers.

The incident that raised it, on staging on 19 October 2026: an admin filed the lease for flat 2 at
הרב קוק 50, בית שמש through תיוק חוזה. The reader captured the address as `חרב קוק 50, בית שמש`. The
admin approved every row on הקריאה, first with `אישור כל מה שלא סומן` and then the rest one at a time,
and did not notice the misread. On פתיחת טיוטה the approved address resolved to no flat, and the only
path the screen offered was to create a building and a flat from the wrong address. The create press
then failed; that failure is #269.

## Solution

While the reading is still open, which means until the draft tenancy exists, any approved row on
הקריאה can be approved again with a different value. The row shows the value that was approved, and a
small `תיקון` control opens the same input and אישור button an unapproved row has. One press
replaces the approved value. What the reader produced is never changed, and every approval stays in
the audit log, so the accuracy measurement the approval stamp exists for is kept.

On פתיחת טיוטה, the `חזרה לקריאה` link the step already carries now leads somewhere a wrong value can
be fixed, so that any wrong value seen on the draft step is corrected at the reading rather than
built around. Where the approved address resolves to no flat and the screen offers to create one, a
line beside the read address says that an address or flat number approved by mistake is corrected
on the reading, not by creating a building, and links there.

For the lease that raised this: the admin opens הקריאה, corrects the address to
`הרב קוק 50, בית שמש`, and פתיחת טיוטה then finds the existing flat 2 without creating anything.

## User Stories

1. As an admin, I want to correct a reading I already approved, so that a misread I missed does not
   follow the lease into the tenancy.
2. As an admin, I want to be able to correct any row I could approve, including the address, the flat
   number, names, dates, contacts, money terms and identifiers, so that every misread has the same
   fix.
3. As an admin, I want an approved row on הקריאה to show the value I approved, not what the reader
   produced, so that I can see what I actually signed.
4. As an admin, I want the correction control to be small and closed by default, so that the reading
   table stays as easy to scan as it is today.
5. As an admin, I want the correction to use the same input and אישור button as a first approval,
   so that there is nothing new to learn.
6. As an admin, I want one press to save a correction, so that fixing a misread takes seconds.
7. As an admin, I want re-submitting the value already approved to change nothing and tell me it was
   already approved, so that a double click is harmless.
8. As an admin, I want a corrected phone or email checked the same way a first approval is, so that
   a correction cannot store a contact nobody could reach.
9. As an admin with the right to see identifiers, I want to correct an identifier only after it has
   been revealed to me, so that I never sign for a value I was not shown.
10. As an admin without that right, I want the correction of an identifier to be refused, so that the
    stamp means the same thing for everyone.
11. As an admin, I want the reading to stay locked once the draft tenancy exists, so that the lease
    and the tenancy cannot disagree about what was approved.
12. As an admin, I want corrections after the draft opens to stay on the tenancy page, so that there
    is one place to change a live tenancy.
13. As an admin on פתיחת טיוטה, I want a link back to הקריאה, so that I can correct any value I see
    is wrong instead of building around it.
14. As an admin, I want פתיחת טיוטה to find the existing flat once I correct the address, so that I
    do not create a duplicate building.
15. As an admin, I want the bulk approval to keep skipping rows that are already approved, so that a
    correction is never undone by a later bulk press.
16. As the director, I want every approval and every correction kept in the audit log, with whether
    the value differed from the reading and whether it replaced an earlier approval, so that reading
    accuracy and correction rates can be measured.
17. As the director, I want the reader's original value never overwritten, so that the per-field
    accuracy dataset survives corrections.
18. As the director, I want no personal data in the audit inputs or the logs for a correction, so that
    the PII rule holds.

## Implementation Decisions

- **A correction is a re-stamp, not an un-approve and not a re-read.** No new state is added. The
  approval stamp is three columns beside the reader's value, and a correction writes the stamp again
  with the new value, the person and the time. Un-approving would add a state every screen must
  handle; re-reading would not help, because the misread is already the reader's output and a person
  typing the right value is the fix.
- **Field-agnostic.** The change is in the one approve-one command and the one reading-row control
  every field uses. No field key is special-cased; the address is only the incident's example.
- **No migration.** The guard on the reading table already permits the stamp columns to change when
  the approval command sets its session flag. Only the command's refusal of a second stamp changes.
- **The approve-one command in the evidence module** changes as follows. If the row is unapproved it
  stamps as today. If it is approved and the submitted value (or the reader's value when the input is
  empty) equals the approved value, it refuses with the existing "already approved" conflict, which
  the screen shows as today's sentence. If the value differs, it re-stamps. The identifier rule and
  the contact validation run on every stamp, first or later.
- **The audit entry** for an approval gains one boolean, `restamped`, true when the row was already
  approved. It still carries the document, the field key and `edited`, and never any value.
- **Bulk approval is unchanged.** It only stamps rows that are unapproved, so it never touches a
  corrected row.
- **The closed rule is unchanged.** The approve routes refuse once the document has a tenancy link,
  exactly as today. The command itself does not learn about tenancies.
- **The reading screen.** An approved row shows the approved value. Its control column shows `אושר`
  and a closed `תיקון` disclosure containing the same value input and אישור button as an unapproved
  row, posting to the same route. A row for an identifier that has not been revealed shows no
  `תיקון`, as it shows no approve control today.
- **פתיחת טיוטה** keeps its `חזרה לקריאה` link to the reading step, and the unresolved-address
  branch gains one line linking to the reading beside the create offer. The stepper stays a status
  line, not a control.
- **A promoted row is not re-stamped.** Its value is already on a typed column; a new stamp would
  disagree with it. This is the closing rule for documents that are not leases.
- **The identifier rule runs before any comparison**, so the "already approved" answer cannot tell a
  viewer who was never shown an identifier what it says.
- **Place resolution is unchanged.** It already reads the approved value, so a corrected address
  resolves on the next load of פתיחת טיוטה.
- **Spec first.** The evidence spec's approval section ("a second approval is refused") and the flows
  spec's A16 step 2 are edited before the code to say that an approved reading can be re-approved
  with a different value until the draft opens, and that פתיחת טיוטה links back to the reading.

## Testing Decisions

- **A good test here drives the HTTP routes and asserts on what a person or the director can see**:
  the rendered screen, the stored approved value, the reader's value and the audit rows. It does not
  assert on which helper ran.
- **One seam: the filing routes in the evidence module, through the app with a real database**, the
  seam the lease-approval tests already use.
- **Cases, each red first:**
  - An approved row re-posted with a different value: approved value is the new one, the reader's
    value is unchanged, two approval audit rows, the second with `restamped` true. Proved on a
    non-address row and on the address.
  - The same value re-posted: the "already approved" sentence, one audit row.
  - A correction after the tenancy link exists: refused, stamp unchanged.
  - An unrevealed identifier: no `תיקון` on the screen.
  - A corrected contact that does not normalise: refused, stamp unchanged.
  - The approved row renders the approved value and a `תיקון` control.
  - After correcting the address to one held in the estate, פתיחת טיוטה preselects the existing flat,
    and the screen carries the `חזרה לקריאה` link.
  - The unresolved-address create offer carries the line linking to the reading.
  - A promoted row is not re-stamped; a withheld identifier is refused for any value.
  - Bulk approval after a correction leaves the corrected value.
- **Prior art:** the lease approval and lease filing route tests in the evidence module.
- The path is clicked on `:3000` after restarting the dev server: approve a wrong value, correct it,
  open the draft.

## Out of Scope

- Correcting a reading after the draft tenancy exists. That stays on the tenancy page.
- Re-running the reader on a document, or on one field.
- Withdrawing an approval without replacing it.
- Address normalisation or fuzzy matching that would have resolved `חרב קוק` to `הרב קוק` on its own.
- A history view of corrections on the screen. The audit log holds them.
- The create-flat failure and overwrite on פתיחת טיוטה: #269.

## Further Notes

- Evidence from staging, 19 October 2026, document `01a14846-54d0-770d-945e-9c9daddfa98b`: seventeen
  approvals between 05:04:26 and 05:05:05, all successful, the address stamped as read.
- The approval command's own comment says changing an approval "is not a flow this system has and it
  has no screen". That comment and the spec sentence it mirrors are what this issue reverses, within
  the open-reading window only.
