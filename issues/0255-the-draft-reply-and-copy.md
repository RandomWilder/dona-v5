---
number: 255
title: The Draft reply, and copy
status: closed
labels: [ready-for-agent]
assignee:
blocked_by: [252]
parent: 247
created: 2026-10-16
closed: 2026-10-18
---

## Parent

#247 — The call copilot and the Policy library.

## What to build

With the brief, the copilot writes a Draft reply to the requester. It is written in the language the
tenant wrote or spoke in, with a Hebrew rendering beside it so the office can read what it would send.

**Writing the draft**
- The draft is a turn on the Call thread, grounded in the same cited passages as the brief.
- It never promises:
  - an outcome the code has not decided (responsibility, a visit time, money);
  - anything not in the cited paper.
- A staff member can edit the draft on the page.

**Copy**
- A copy control copies the draft, or the edited text, to the clipboard. Copy works on every channel,
  including PHONE and WALK_IN, where there is nothing to send.
- Sending is #256 and #257.

**Exclusions**
- No draft for a guarantor-only requester, and none for a WHATSAPP call until #257. These are the
  same exclusions as the brief.

## Acceptance criteria

- [x] SPEC-calls describes the Draft reply, its language rule and what it may never promise.
- [x] A specimen English-language call gets an English draft with a Hebrew rendering. A Hebrew call
      gets one Hebrew text.
- [x] The exclusions have red-first policy cases.
- [x] The full golden set runs, with new cases:
  - [x] a draft that must not promise responsibility;
  - [x] a draft in a non-Hebrew language.
- [x] Copy is clicked on `:3000`, and the copied text matches what is on the page, edits included.

## Blocked by

- #252 — closed 2026-10-17

## Comment — 2026-10-18

Start here in a new session. #252 and #254 are closed. The staging walk-in that confirmed #254 is `01a14c15`: a WALK_IN about kitchen-ceiling damp, identified, brief already on the thread. This ticket adds the Draft reply and copy on that same thread. Copy only — sending stays #256 and #257.

## Comment — 2026-10-18

Closed. Draft is a turn on the call thread, written on request once the brief is ready, grounded in the passages that brief cited. Hebrew stays one text; more Latin than Hebrew gets the other language plus a Hebrew rendering. Guarantor-only, WhatsApp, and the brief switch off write nothing, and those three were red first. The two new golden cases passed (`draft-reply-english`, `draft-reply-no-promise`); the set was 25/26, and the miss was an extraction timeout on `building-lettings-list`, not the draft. On `:3000`, call `01a14a97` (Hebrew, phone), the draft field was edited and העתקה copied that edited text. Sending stays #256 and #257.

## Comment — 2026-10-18

The draft now opens as a reply. The code writes the greeting from the first word of the requester's name. The model writes one short sentence on the subject, then the full answer, and it does not write the greeting or passage numbers into the text. A refusal is the greeting and the frozen sentence only.
