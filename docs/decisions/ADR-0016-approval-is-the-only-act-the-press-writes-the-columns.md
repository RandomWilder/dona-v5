# ADR-0016 — Approval is the only act; פתיחת טיוטה writes the columns

- **Date:** 2026-10-15
- **Status:** accepted
- **Supersedes:** `field_promotion` as seeded data (slice 4.3, SPEC-evidence *FieldPromotion*);
  promotion as a separate human act (`POST /documents/:id/promote`, `קדם`, the *מאושר, לא הועבר
  להשכרה* mark, #175/#176); the lease's flat read off the regex place reader (A16 as amended at #232)
- **Amends:** SPEC.md rule 8 (the cost of a mapping), ADR-0015 (where the preselected flat comes from)
- **Context:** staging, 15 Oct 2026. Lease `01a13956`, fully approved and with its flat, could not
  open its draft. Every press of פתיחת טיוטה answered 409 with no reason. Lease `01a13e3f` resolved
  no flat, because the regex reader took a phrase after the address's comma as the town.
  Issue [#243](../../issues/0243-one-clean-lease-path-from-upload-to-draft.md).

## The decision

**A person approving a reading on הקריאה is the only human act between upload and draft.** The
press of פתיחת טיוטה then writes everything that reading supports, in one transaction:
- the flat link and the `DRAFT` tenancy;
- the parties, their contacts, `tenancy_party` rows and `SIGNATORY` links;
- every approved value that has a typed column, onto that column.

There is no second act that copies a value later.

Three changes follow.

1. **The field → column map is code, not seeded rows.** One constant in evidence names, per document
   type, which declared field lands on which column. It covers the twelve lease targets of today's
   CHECK and `lease_amendment.new_end_date`. The `field_promotion` table, its seed rows and its CHECK
   are dropped. The copy itself is unchanged:
   - it still requires an approval stamp;
   - it still writes through tenancy's and estate's `applyPromotedField`, which append the event log;
   - it still stamps `promoted_to` / `promoted_by` / `promoted_at` on the evidence row, under the
     0018 and 0029 triggers;
   - it still refuses a half-priced pair and an occupied column.

   Only the place the map lives changes.
2. **What will not land is shown before the press, not discovered after it.** The opening screen
   lists every approved mapped value and where it will land. It also lists each one that will not,
   with the reason, from the same function the press uses. The reasons are the ones #175 computes
   today:
   - the other rent half is not approved;
   - the number is not a parking or storage Space in the Building;
   - the Unit already holds a different rooms or floor.

   The press writes the values that land and skips exactly the ones listed. Nothing is caught and
   swallowed. Any failure the screen did not predict is a defect: it is logged with its code and
   message and shown with its reason.
3. **The preselected flat comes from the approved reading, not from a second reader.** On both
   staging leases the extractor read `address` as street, number and town, and a person approved it.
   The regex place reader, run at upload, read the same paper and got the town wrong on one of them.
   Resolution now takes the approved `address` and `apartment_number` and runs the same
   `resolvePlace` as before: exact key, else candidates narrowed by street and apartment (#242),
   else search. An `address` not yet approved preselects nothing. The regex reader stays for A12's
   non-lease filing, and no longer runs for a lease.

## Why

**Promotion was built for a flow that no longer exists.** Slice 4.3 made copying a reading onto a
column a deliberate act on the A15 ledger, at a time when nothing else carried a value. Since #232
the press is that act. It shows the operator the flat, the people and the dates, and they press
once. A second, per-field copy button asks the same person to affirm the same reading twice. In
practice it was never used on a lease, because the press already ran the copy internally.

**Mapping-as-data bought no freedom and cost a seeding dependency.** A row in `field_promotion`
could only name a target the CHECK already allowed. Each target also had to be hard-coded in
`promote.ts` (`TENANCY_FIELD`, `ESTATE_FIELD`). So a new mapping was always a code change and a
migration, and the rows added nothing but a way to be missing. They went missing: the 12 Oct staging
reset emptied the table, and every draft after it failed. That is the same failure #232 found with
`terms_profile`, and fixing one table per incident is not a fix.

**Silent skips hid the problem.** The carry ran each field under a savepoint and swallowed `invalid`
and `conflict`. That suited "carry what you can". It also meant a missing mapping, and the
date-promotion failure behind the 409, surfaced nowhere until someone dry-ran the press against the
database.

**Two readers of one fact will disagree.** The regex reader exists because A12 had to place a
document before it was extracted. Since ADR-0015 a lease is extracted before its flat is chosen, and
its address is approved by a person before פתיחת טיוטה. Reading the address a second time,
differently, was the source of the wrong preselection.

## Rule 8 survives

*Capture is open; promotion is governed* still holds, and is now cheaper to keep true:
- a value reaches a typed column only through a reviewed map in code, after a person approved it;
- nothing deterministic reads an `ExtractedField` except that copy;
- the contract test stays as it is.

What changes is the stated cost. A new mapping is a reviewed code change, plus a migration only when
the target column itself is new. It is no longer a migration to widen a CHECK plus a seed run to
insert a row.

## Considered and refused

- **Re-seeding `field_promotion` and adding it to the reset keep list.** That restores today's flow
  and keeps the dependency that broke it, and every new catalogue would need the same guard.
- **Keeping `קדם` for values that could not land.** The cases are a missing rent half, a missing
  Space, and a Unit fact an ADMIN typed differently. The first two are fixable before the press once
  the screen names them. The third is the Unit's to decide, not the lease's. After the press, a bay
  is corrected through the tenancy page's existing parking and storage commands, with the paper's
  value shown beside the record (#229).
- **Writing the columns without the stamp.** The stamp is the record of which reading set the
  column, and the event log cites it. It costs nothing to keep.
- **Using `building_number` to place the flat.** SPEC-estate rules it an identifier, not a key. The
  address and apartment number already resolve both staging leases exactly.

## Consequences

- One migration drops `field_promotion`. `promoteExtractedField` reads its target from the map. Its
  two callers are the press and A3's confirm, so the addendum keeps working with no change of
  behaviour.
- `POST /documents/:id/promote`, the ledger's `קדם` and `החלף`, and the *לא הועבר* mark go. The
  tenancy card still shows an approved paper value beside a column that differs, as a fact and not
  as pending work.
- The second assigned bay and the second assigned storage have no reassign command. A second number
  that is not a Space must be fixed before the press, by adding the Space. The screen says so.
- Staging needs no seed beyond `terms_profile`, the document-type catalogue and the estate, all of
  which it has.
- For a lease, the upload no longer runs the regex place reader or keeps a place reading. The object
  beside the lease keeps the unit-page preselection only. The upload-time flat step left from before
  #232 is removed.
