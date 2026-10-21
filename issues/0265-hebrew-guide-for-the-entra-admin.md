---
number: 265
title: Hebrew guide for Dona Dom's Entra admin
status: closed
labels: [ready-for-agent]
assignee:
blocked_by: [263, 264]
parent: 258
created: 2026-10-18
closed: 2026-10-18
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
- [x] The published artifact is republished in place and matches the local file.

## Blocked by

- #263 — Login screen offers Microsoft
- #264 — Staging config and the secret-expiry warning
- The director's approval of the implementation

## Comment — 2026-10-18

The director instructed this issue on 18 Oct 2026, after #263 and #264 closed the same day. That is the approval the guide was waiting on.

The Hebrew guide now has its own section for a second app in the same tenant: single-tenant `Dona Sign-in - Staging`, separate from the mailbox app, both redirect URIs, delegated `openid` and `email` only, a client secret and its expiry date, and the handover of client id, tenant id and secret outside chat. The domain `dona.co.il` is named as already set by the deploy. No tenant id and no secret are in the file. Renewal of this secret is named apart from the mailbox secret.

The published page was not updated. This session has no way to republish the artifact in place, so the live URL is still the previous guide. The issue stays open until that republish. The short guide was left as it was.

## Comment — 2026-10-18, review

A review against the code and Microsoft's redirect-URI rules found one step that would have failed. The Entra portal's redirect-URI box refuses an `http` URI on `127.0.0.1`; Microsoft documents that such a URI can only be added through the application manifest. Local development has no `STAFF_BASE_URL`, so the callback is built from the Host header, and Google's local registration already uses `127.0.0.1:3000`. Switching the Microsoft URI to `localhost` would have split the two providers across two local origins, so the guide keeps `127.0.0.1` and tells the admin to add it under `web.redirectUris` in the Manifest, then confirm both URIs on the Authentication screen. `infra/bootstrap.sh` says the same, and #266 now tests on `127.0.0.1:3000` rather than `localhost:3000`.

Two smaller changes: the admin-consent step is now a definite instruction to grant consent for `openid` and `email`, so sign-in works even where the tenant blocks user consent; and the header names the second part of the guide with a link to it. The staging redirect URI was checked against the live Cloud Run service URL.

The artifact was republished in place on 18 Oct 2026 (version 2) from `docs/outlook-admin-guide-HE.html`. The short guide is unchanged; it covers the mailbox only.
