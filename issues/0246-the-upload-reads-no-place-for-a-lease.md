---
number: 246
title: The upload reads no place for a lease, and the upload-time flat step goes
status: open
labels: [ready-for-agent]
assignee:
blocked_by: [244]
parent: 243
created: 2026-10-15
closed:
---

## What

SPEC-flows A16 beat 1 and A12's lease paragraph, as rewritten at #243.

1. **No place reading at upload for a lease.** Stop running the regex place reader on a lease, and
   stop writing its reading into the object beside the lease. That object keeps the unit-page
   preselection (`doorUnitId`) only. Leases filed before this change keep their stored objects. The
   reader ignores the reading field.
2. **Remove the upload-time flat step that #232 left behind.** First establish what each of these is
   still reached by, from the views and not only from tests:
   - `GET /documents/filing?held=` and `?q=` with its `place` beat;
   - the `place` beat views;
   - the hidden `held` inputs;
   - the branch of `POST /documents/filing/place` that has no `document`.

   Remove what no current screen reaches. Keep the create-flat branch the opening screen uses. Keep
   whatever re-attach after a type-guard refusal genuinely needs, and state it in A16 beat 1 if it
   holds bytes.
3. Tests that exercised the removed beat go with it. The behaviours they protected that still exist
   move to the opening-screen tests:
   - several candidates;
   - create a building or a flat;
   - an operator sees no create control.

## Acceptance

- [ ] **Red first:** uploading a lease does not call the place reader, and writes no reading into
      the stored object.
- [ ] The opening screen still preselects the unit-page door's flat.
- [ ] A12 still files a non-lease document on an exact one, unchanged.
- [ ] Every removed route answers 404. Nothing in `src/` links to it.
- [ ] `npm test` is green.
- [ ] The tab is clicked on `:3000`: upload, הקריאה, פתיחת טיוטה, הטיוטה.
