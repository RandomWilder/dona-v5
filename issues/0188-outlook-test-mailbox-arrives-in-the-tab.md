---
number: 188
title: Outlook: the staging test mailbox arrives in the tab
status: open
labels: [ready-for-human]
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
and the app registration with its Exchange role assignment, done by Dona Dom's Microsoft 365
administrator.

## Acceptance criteria

- [x] The adapter normalises recorded Graph payloads, including a reply on the same conversation and an email with an attachment
- [x] The delta cursor survives a restart: nothing read twice, nothing skipped
- [x] A failed read for an hour shows the mailbox warning; a successful read clears it
- [x] Nothing in the adapter can delete, move or mark mail as read
- [ ] Clicked on staging: an email sent to the test mailbox appears in the tab within two minutes, and a reply on its thread attaches to the same call

## Comment — 2026-10-06

The adapter is in. Recorded Graph payloads become incoming mail, a reply keeps the conversation id, and an attachment keeps its name. The delta cursor is stored after each page is handed on, so a restart neither replays nor skips, and the first read asks for a cursor as of now. An hour without a successful read warns on the קריאות list; a success clears it. The process only GETs mail. It stays off, and the tab stays quiet, until all four settings are present.

Left for the director: the staging test mailbox, the app registration with Mail.Read scoped to it, admin consent, then `./infra/set-secret.sh staging` for graph-tenant-id, graph-client-id, graph-client-secret, and graph-mailbox. The next staging deploy mounts whichever of those exist. Staging still scales to zero and throttles CPU when idle, so the poll runs when the process has CPU — opening the tab wakes it. An unattended two-minute read needs a minimum instance and CPU always allocated, which spends money. Production is not mounted.

## Comment — 2026-10-07

The staging mailbox is asafv@dona.co.il, the office inbox tenants write to. It is not a tenant address. The cursor Graph returns names that inbox by folder id, and that link is now stored. A link to another folder, another mailbox, or another host is still refused. The staging click is still open.

## Comment — 2026-10-07

Correction: asafv@dona.co.il is the pilot inbox on Dona Dom's Microsoft 365, used before the real inbox tenants write to. It is still not a tenant address. Connecting it needs an administrator of that Microsoft 365. The director is not one.

## Comment — 2026-10-07

Access is requested from Dona Dom's CIO: an app registration with no Entra mail permission, and the
Exchange role Application Mail.Read scoped to asafv@dona.co.il alone, proven by
`Test-ServicePrincipalAuthorization` (True for that mailbox, False for another). The secret is asked
for 24 months, with its expiry date (#198). The adapter no longer looks the user up in the directory
when Graph names the mailbox by id: that read needs a permission the scoped role does not give, so the
link is checked by the inbox's folder id only. The staging click waits on the administrator.

## Blocked by

- #186 — The intake door, with the sorter faked
