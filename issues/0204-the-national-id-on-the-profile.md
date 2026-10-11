---
number: 204
title: "The ת.ז. on the profile: masked, revealed, searched and written, each logged"
status: closed
labels: [ready-for-agent]
assignee:
blocked_by: [202]
parent: 199
created: 2026-10-11
closed: 2026-10-11
---

## Parent

#199 — the אנשי קשר tab.

## What to build

`party.national_id.read` gets its first readers. On the profile the ת.ז. shows as a masked suffix;
an administrator reveals it with a click, and the reveal is audited. An administrator can search the
directory by ת.ז. in any format — hyphens, spaces, a dropped leading zero — matched through the
database's normalised key, and the search is audited with the parties it matched. An administrator
can add or correct a ת.ז.; one another party already holds is rejected with a link to that party.
An operator sees the mask and nothing more, cannot search by ת.ז. and cannot write one.

The policy case comes first and is seen red: no directory or search response contains a
`national_id`, and the profile contains it only for a caller holding the permission who asked to
reveal it.

## Acceptance criteria

- [x] The policy case is written before the code, fails first, and passes after.
- [x] The profile shows the ת.ז. masked to every role; only ADMIN sees a reveal control, and the reveal returns the value and writes an audit row naming the actor and the party.
- [x] An operator's attempt to reveal, search by or write a ת.ז. is refused by the route, not only hidden.
- [x] Searching by ת.ז. as ADMIN finds the party for `312-345-678`, `312 345 678`, `312345678` and the form with a dropped leading zero, and writes an audit row naming the matched party ids.
- [x] No audit row anywhere contains a `national_id` value — not on reveal, search or write.
- [x] Adding or correcting a ת.ז. writes through the existing key; a ת.ז. another party holds is rejected with a conflict linking to that party, and nothing is written.
- [x] The directory never shows a ת.ז., masked or not.
- [x] Route tests cover each of the above as ADMIN and as OPERATOR.
- [x] Clicked on `:3000`.

## Comment — 2026-10-11

Closed. The profile shows a masked suffix to an operator and an administrator. Only an administrator can reveal it, search by it, or write it; an operator who tries is refused by the route. A clash names the party who already holds the identifier and writes nothing. Audit rows name the actor and the parties, never the value. The policy case was red first on a search that echoed the typed value. Clicked on `:3000` after a restart: the profile showed the mask, reveal showed the value, and a hyphenated search found that one party with the digits absent from the page.

## Blocked by

- #202 — the tab and the profile exist.
