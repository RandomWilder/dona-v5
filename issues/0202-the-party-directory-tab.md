---
number: 202
title: "The אנשי קשר tab: list, search and a read-only party profile"
status: closed
labels: [ready-for-agent]
assignee:
blocked_by: [200, 201]
parent: 199
created: 2026-10-11
closed: 2026-10-11
---

## Parent

#199 — the אנשי קשר tab.

## What to build

The tracer bullet. An operator opens the אנשי קשר tab, sees every party, searches by any word of a
name, by a phone in any format or by an email in any case, and opens a party's profile, which shows
the identity fields and every contact with its dates. Nothing is editable yet and there are no labels
yet. A viewer does not see the tab.

The spec edit comes first, in this change: SPEC-parties reverses its "no read model, no screen over
this module" for the administrator stance and describes the directory read and the profile read;
SPEC-staff adds `party.read` and `party.write` to the role table; an ADR records **"A Lead is not a
Party"**.

The directory and profile are read through the parties contract. The profile page is composed at the
composition root, so later tickets can add tenancy, estate and calls sections without the parties
module depending on them.

## Acceptance criteria

- [x] `party.read` and `party.write` exist, granted to ADMIN and OPERATOR; VIEWER holds neither, the tab is not shown to a viewer and its routes refuse one.
- [x] Searching any word of a person's name, or of a company's legal name, finds the party.
- [x] Searching a phone in local, spaced, hyphenated or international form finds the party, using the same normaliser the door uses.
- [x] Searching an email matches regardless of case.
- [x] Each row shows the name, the primary phone, the primary email and the language, and links to the profile.
- [x] The profile shows given name, family name or legal name, kind, language, and every contact open and closed with its validity dates.
- [x] No `national_id` value, masked or not, appears in any directory or profile response in this ticket.
- [x] Route tests drive all of the above through the app as each role.
- [x] The ADR exists in the decisions directory and CONTEXT.md's Lead entry points to it.
- [x] The directory and profile screens are removed from the mockup; the flow is clicked on `:3000` after restarting the dev server.

## Comment — 2026-10-11

Closed. The tab lists every party, search matches a whole word of the display name, a phone through the door's normaliser, or an email in any case, and the profile is read-only. An administrator and an operator can open it; a viewer is refused and does not see the tab. No identifier is in either response. Clicked on `:3000` after a restart: a name search returned one person, and the profile showed the display name, kind, language, and no contacts for that row. A name that was never split shows a dash for the given name and the family name; the heading keeps the old display string.

## Blocked by

- #200 — the profile shows split names.
- #201 — the screens are wired as painted.
