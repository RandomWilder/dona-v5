---
number: 188
title: Outlook: the staging test mailbox arrives in the tab
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

The Outlook adapter, through Microsoft Graph. An app registration in Dona Dom's Microsoft 365 tenant
holds `Mail.Read` and `Mail.Send`, both scoped to one mailbox by Exchange Online's RBAC for
Applications; this ticket uses only `Mail.Read`. The adapter polls with a delta query every one to two
minutes, stores the cursor so a restart neither re-reads nor skips, normalises each email (the
conversation id is the thread), and hands it to the door. It reads from the cursor it starts at and
imports nothing earlier.

Staging reads a test mailbox; production is a later ticket. A mailbox not read successfully for an
hour raises a warning in the tab. The adapter is tested on recorded Graph payloads; no test calls
Microsoft.

Needs from outside the repo before it can be clicked: the staging test mailbox in Dona Dom's tenant,
and admin consent, which is the director's act.

## Acceptance criteria

- [ ] The adapter normalises recorded Graph payloads, including a reply on the same conversation and an email with an attachment
- [ ] The delta cursor survives a restart: nothing read twice, nothing skipped
- [ ] A failed read for an hour shows the mailbox warning; a successful read clears it
- [ ] Nothing in the adapter can delete, move or mark mail as read
- [ ] Clicked on staging: an email sent to the test mailbox appears in the tab within two minutes, and a reply on its thread attaches to the same call

## Blocked by

- #186 — The intake door, with the sorter faked
