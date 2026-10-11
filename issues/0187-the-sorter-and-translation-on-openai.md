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

- [x] Staging sorts and translates with OpenAI; tests still use the fake
- [x] A verdict whose Category is not on the active list is stored as no Category
- [x] Model id and prompt version are on every verdict
- [x] A timeout or an error yields a "to review" call with no summary
- [x] The golden set runs, its pass rate is recorded, and none of its messages is a real tenant's
- [ ] Clicked on staging: a fabricated message in Russian shows a Hebrew translation and a summary

## Blocked by

- #186 — The intake door, with the sorter faked

## Comment — 2026-10-06

The sorter is OpenAI when a key is configured, and a fake in tests. Sort returns call, unsure, or noise, a category from the active list, and a Hebrew summary. A category that is not on that list is stored as none. Translate fills the Hebrew text when the message is not Hebrew, and a failure there does not change the verdict. A timeout or any error from sort opens a call to review with no summary. The model id is the sorter.model row, read per call. The prompt version is sorter-1, stored with the model id on the call and on the message.

The golden set is fourteen fabricated messages, in Hebrew, English, Russian, Arabic, and one mix. Run against the configured model it passed 14/14. The dev form still lets a person pick the verdict when no key is configured. When a key is configured, that form sends the message through the sorter. A stamped revision does not serve the form, so the staging click is still open.

## Comment — 2026-10-11

CI on gpt-5.6-luna with sorter-1 passed 12/14. A hedge about a possible fault was labelled a call, and a message that never said what it wanted was labelled noise. The instructions now say a guess with no request is unsure, and unsure is never noise. The prompt version is sorter-2. The same fourteen messages passed 14/14, and the retrieval golden set passed 10/10. The staging click is still open.
