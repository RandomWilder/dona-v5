---
number: 185
title: Emergency: the flag, the pin and the editable terms
status: open
labels: [ready-for-agent]
assignee:
blocked_by: [182]
parent: 181
created: 2026-10-06
closed:
---

## Parent

#181 — Service calls arrive from every channel into one קריאות tab.

## What to build

Emergencies come first. The emergency terms (one per line, like verification terms), the duty phone
number and the duty hours become rows editable at /settings without a deploy. A call whose
description matches a term is flagged an emergency deterministically at creation, with no model
involved (foundation rule 5). An office worker can also flag a call by hand, and clear a flag. The
flag records who or what set it.

An emergency-flagged call is pinned first in the list in red, and the list filters on it. This ticket
also provides the composition of the fixed duty reply from the duty contact rows, as a pure function
with its wording behind a placeholder until the director approves the text; sending it on a channel
belongs to the channel tickets.

## Acceptance criteria

- [ ] Terms, duty number and duty hours are editable at /settings and take effect without a deploy
- [ ] A manual call whose description contains a term is flagged at creation, recorded as set by the terms
- [ ] A call is flagged and cleared by hand, recorded with the staff account
- [ ] A flagged call is pinned first and marked red; the list filters on the flag
- [ ] The deterministic match has a policy case, red first, including a Hebrew term inside a longer word and a term in another language
- [ ] The duty-reply composer produces the fixed text from the rows and calls no model
- [ ] Clicked on `:3000` and on staging

## Blocked by

- #182 — Log a phone or walk-in call and see it in קריאות
