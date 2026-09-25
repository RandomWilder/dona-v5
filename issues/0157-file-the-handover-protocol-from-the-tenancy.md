---
number: 157
title: "File the handover protocol from the tenancy page"
status: closed
labels: [ready-for-agent]
assignee:
blocked_by: [153]
parent: 152
created: 2026-09-24
closed: 2026-09-24
---

## Parent

[#152](0152-tenancy-lifecycle-activation-and-turnover.md)

## What to build

The second required document gets a door where it is required. A draft's tenancy page, while the
protocol check has not passed, carries an upload for **פרוטוקול מסירה**. The type is locked, and
the document is anchored to this TENANCY by the post rather than by the operator. It runs A1's
existing commands, then lands on A6's confirm, where the person confirms the handover date.

**Approval becomes a stamp, not a link.** Today the gate counts any TENANCY-linked protocol as
approved. After this ticket, the protocol counts once A6's confirm has been signed for it; the
document reader injected into the gate reports `approved` from that signature. Existing linked
protocols — decide in the spec whether they are grandfathered or listed on A4 as unconfirmed, and
state it. Recommended: listed, because a protocol no one confirmed is the gap this closes.

A16 is unchanged: it still does not file a protocol, and its *הטיוטה* beat links to this door.

## Screen

Approved on the second look, 24 September 2026. The upload is the existing file well, inside the
protocol check row, with הגשת פרוטוקול מסירה as the small glass button. The type is locked. Confirming
the handover date stays on A6's confirm. This ticket does not invent a second confirm screen.

## Acceptance criteria

- [x] Upload on the draft page, type locked, TENANCY anchor written by the post
- [x] Protocol check passes only after A6's confirm for that document
- [x] Decision on pre-existing linked protocols stated in the spec
- [x] Policy case, red first: a linked but unconfirmed protocol does not pass
- [x] SPEC-flows.md A5, A6 and A16 edited in the same change
- [x] Clicked on `:3000` after a `dev` restart: upload, confirm, gate turns

## Comment — 2026-09-24

Closed. A linked protocol that nobody confirmed does not pass the gate; the lease link still does. Confirm writes `evidence.confirm_protocol`, and that row is the approval. Protocols already linked are not grandfathered. Dev restarted. The draft דנה פתוח-107 already held a protocol stored in another bucket, so its confirm page refused the read. A new protocol was filed from that draft, the confirm page showed 2027-02-01, and אישור וכתיבה recorded it. The protocol check then read עבר, approved 2026-09-24. The activate button stayed dark because the lease starts 2027-02-01.
