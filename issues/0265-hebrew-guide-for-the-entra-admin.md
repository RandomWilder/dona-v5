---
number: 265
title: Hebrew guide for Dona Dom's Entra admin
status: open
labels: [ready-for-agent]
assignee:
blocked_by: [263, 264]
parent: 258
created: 2026-10-18
closed:
---

## Parent

#258 — Sign in with Microsoft beside Google.

## What to build

A Hebrew section in the published Outlook admin guide telling Dona Dom's Entra administrator exactly
what to create and what to hand over: a new single-tenant app registration "Dona Sign-in - Staging"
in the existing tenant, separate from the mailbox app; its two redirect URIs (staging and local dev);
delegated `openid email` only, no mail or calendar permission; a client secret and its expiry date;
and the three values to hand over (client id, tenant id, secret) through a channel that is not chat.
The local file is edited and the artifact republished to the same URL.

**Starts only after the director approves the implementation** (#262–#264), per the director's
instruction of 18 Oct 2026.

## Acceptance criteria

- [x] The director has approved the implementation, recorded on this issue.
- [x] The section is in Hebrew, RTL, and matches the existing guide's style.
- [x] It names every value the deploy (#264) expects, with no secret or real tenant value in the repo.
- [ ] The published artifact is republished in place and matches the local file.

## Blocked by

- #263 — Login screen offers Microsoft
- #264 — Staging config and the secret-expiry warning
- The director's approval of the implementation

## Comment — 2026-10-18

The director instructed this issue on 18 Oct 2026, after #263 and #264 closed the same day. That is the approval the guide was waiting on.

The Hebrew guide now has its own section for a second app in the same tenant: single-tenant `Dona Sign-in - Staging`, separate from the mailbox app, both redirect URIs, delegated `openid` and `email` only, a client secret and its expiry date, and the handover of client id, tenant id and secret outside chat. The domain `dona.co.il` is named as already set by the deploy. No tenant id and no secret are in the file. Renewal of this secret is named apart from the mailbox secret.

The published page was not updated. This session has no way to republish the artifact in place, so the live URL is still the previous guide. The issue stays open until that republish. The short guide was left as it was.
