---
number: 187
title: The sorter and translation on OpenAI
status: open
labels: [ready-for-agent]
assignee:
blocked_by: [186]
parent: 181
created: 2026-10-06
closed:
---

## Parent

#181 — Service calls arrive from every channel into one קריאות tab.

## What to build

The sorter port gets its real implementation, on OpenAI, in staging and in production, with the model
id in configuration and the key in Secret Manager (ADR-0003). **sort** returns call, unsure or noise,
a Category from the active list, and a Hebrew summary. **translate** fills `body_he` when the message
is not Hebrew, for display only. The sorter sees subject and text only, and no store. The model id
and prompt version are recorded on each verdict.

Timeouts and errors fall back to "to review". The golden set of fabricated messages is written in
`evals/`, in Hebrew, English, Russian and Arabic and the mixes the office will see, covering calls,
questions, noise, unsure cases and emergency wording. Any change to the prompt, model id or the
Category list runs it in full. The returned-to-filtered labels from the previous ticket are its
future growth.

## Acceptance criteria

- [ ] Staging sorts and translates with OpenAI; tests still use the fake
- [ ] A verdict whose Category is not on the active list is stored as no Category
- [ ] Model id and prompt version are on every verdict
- [ ] A timeout or an error yields a "to review" call with no summary
- [ ] The golden set runs, its pass rate is recorded, and none of its messages is a real tenant's
- [ ] Clicked on staging: a fabricated message in Russian shows a Hebrew translation and a summary

## Blocked by

- #186 — The intake door, with the sorter faked
