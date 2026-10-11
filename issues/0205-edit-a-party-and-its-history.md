---
number: 205
title: Edit a party's name and language, and show its edit history
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

On the profile, an operator corrects a person's given and family name — leaving the given name empty
for someone known by one name — or a company's legal name, and changes the preferred language. Every
edit is audited with the actor, the role and the fields changed. The profile gains an edit-history
section that reads those audit rows back, newest first. It also shows a hint when other parties share
this name, linking to them; nothing is matched or merged on a name.

## Acceptance criteria

- [x] An operator can edit given name, family name and language of a person, and legal name and language of a company; the kind's CHECK still holds and a violating edit is refused with the reason.
- [x] An empty given name is accepted for a person and the display name is the family name alone.
- [x] Each edit writes one audit row with the actor, the role, the party id and the names of the fields changed.
- [x] The history section lists the party's audit rows newest first, with who, when and what changed, and never shows a `national_id` value.
- [x] A viewer cannot reach the edit route.
- [x] When other parties share the display name, the profile says how many and links to them; no write follows from it.
- [x] Route tests cover each edit, the refusal, the history and the same-name hint.
- [x] The identity edit screen is removed from the mockup; clicked on `:3000`.

## Comment — 2026-10-11

Closed. An operator corrects a person's given and family name, or a company's legal name, and the language. A blank given name leaves the display name as the family name alone. A name the kind cannot carry is refused on the profile and the row stays. The edit and its audit row commit together; the row names the actor, the role, the party and the fields that changed, never the new values. History lists that party's rows newest first and does not show a national id value. A viewer is refused the post. A shared display name is a count and a link. The identity edit paint is gone from the mockup. Clicked on `:3000` after a restart: a mononym saved, a company name and language saved, a blank family name was refused, and the history named the fields.

## Blocked by

- #202 — the tab and the profile exist.
