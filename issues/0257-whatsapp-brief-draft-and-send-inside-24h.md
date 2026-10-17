---
number: 257
title: "WhatsApp — copy and send inside the 24-hour window, no brief or draft"
status: open
labels: [ready-for-agent]
assignee:
blocked_by: [249, 256]
parent: 247
created: 2026-10-16
closed:
---

## Parent

#247 — The call copilot and the Policy library.

## What to build

#249 answered no. A WHATSAPP call gets no brief and no draft. The exclusion stays. Nothing on this
ticket sends WhatsApp content to the model.

- **Copy, and send of text the person wrote.** A staff member with `calls.reply` can send a reply
  as a WhatsApp session message, inside 24 hours of the requester's last inbound message. The text
  is what the person typed or pasted. There is no model draft behind it.
  - The send goes through the same generalised channel send as #256.
  - The server resolves the recipient from the call.
  - The send is recorded on the timeline and audit.
- **Outside the window:** the page offers copy only, and the server refuses a send. Templates
  outside the window are out of scope (ADR-0017).

## Acceptance criteria

- [x] #249 is closed. Its outcome is the scope of this ticket: copy only, no brief, no draft.
- [ ] A WHATSAPP call does not get a brief or a draft. The policy cases from #252 and #255 that
      excluded WhatsApp stay, and the reason recorded is #249.
- [ ] The 24-hour refusal has a policy case that was red first, tested at the boundary minute.
- [ ] The full golden set runs. The copilot does not send WhatsApp message text to the model.
      The sorter's existing send (#181) is outside this ticket.
- [ ] Clicked on `:3000` with the development number:
  - [ ] a send of staff-written text inside the window;
  - [ ] copy only outside the window.

## Blocked by

- #249
- #256

## Comment — 2026-10-17

#249 answered no. Scope of this ticket is copy only. A WhatsApp call gets no brief and no draft. The exclusion on the brief, follow-ups and draft stays. Nothing on this ticket sends WhatsApp content to the model.

Sending inside the 24-hour window, and copy outside it, are unchanged, and still wait on #256. There is no model condition to copy in as an acceptance criterion.
