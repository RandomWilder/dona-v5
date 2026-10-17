---
number: 249
title: Record whether OpenAI's API data terms meet Meta's WhatsApp §4.7
status: closed
labels: [ready-for-agent]
assignee:
blocked_by: []
parent: 247
created: 2026-10-16
closed: 2026-10-17
---

## Parent

#247 — The call copilot and the Policy library.

## What to build

Under #247, a WHATSAPP call gets no brief and no draft until this check is recorded. The question is
whether sending WhatsApp message content to the model provider fits Meta's WhatsApp Business terms.
§4.7 limits what a business may do with message data, including use by third-party AI providers.

1. Read the primary sources:
   - the current WhatsApp Business Solution Terms and the Meta business policies they incorporate;
   - OpenAI's API data-usage and retention terms, as they apply to this account's API use.
2. Write the answer as a research note in the repo's research folder, citing the clause behind each
   claim.
3. End with a yes or a no:
   - whether the call copilot may read WhatsApp content under the terms this account is on;
   - if yes, under what conditions (for example, no training use, and a retention limit).

Two outcomes follow:
- **No:** #257 is rescoped to copy only, with no brief or draft on WhatsApp. That rescope is a comment
  on #257.
- **Yes with conditions:** each condition becomes an acceptance criterion on #257.

This is reading, not signing. If the answer depends on a contract change or a paid tier, that part
is the director's, and the note says so rather than assuming it.

## Acceptance criteria

- [x] A research note exists that cites the clauses from both sources and states a yes or no.
- [x] Any condition or open question that needs the director (a contract, a paid tier, a signature)
      is flagged in the note and in the closing comment.
- [x] #257 carries a comment with the outcome, as its scope or as conditions.
- [x] ADR-0004 (personal data reaches the model provider) is cross-referenced if the answer changes
      or adds to what it decided.

## Blocked by

- None (can start immediately).

## Comment — 2026-10-17

No. The note is [docs/research/whatsapp-openai-section-4-7.md](../docs/research/whatsapp-openai-section-4-7.md). #257 is copy only on WhatsApp: no brief, no draft.

The share is what fails. Meta's terms (last modified 23 Sep 2026) let WhatsApp data go to a third party only if that party is a Solution Provider, meaning it uses the WhatsApp APIs on the business's behalf. OpenAI does not. §4.7's permission to retain an AI provider applies only in that role, which would also reverse ADR-0013. That contract is the director's, and it is not assumed.

OpenAI's API terms would meet the training half if the share were later allowed: no training unless the organization opts in, on the two endpoints this system calls. Confirming the dashboard opt-in is off is the director's, and it matters only then. Zero Data Retention is a sales approval §4.7 does not require. The OpenAI addendum on F6 is still unsigned; this no does not discharge it.

ADR-0004's four decisions are unchanged. The note adds a limit they did not contain, and the ADR points at it. The sorter already sends WhatsApp text to OpenAI (#181). The same reading covers it. Stopping or keeping the sorter is the director's; this ticket rescoped only #257.
