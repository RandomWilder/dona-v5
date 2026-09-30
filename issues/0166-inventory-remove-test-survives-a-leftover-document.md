---
number: 166
title: The inventory remove test survives a document a previous run left behind
status: closed
labels: [ready-for-agent]
assignee:
blocked_by: []
parent:
created: 2026-09-29
closed: 2026-09-29
---

## What is wrong

`src/estate/inventory.test.ts:1139`, *removes an unreferenced Space and refuses a referenced one by
name*, fails on a database that an earlier, interrupted run of the same test touched:

```
update or delete on table "document_type" violates foreign key constraint
"document_document_type_id_fkey" on table "document"
Key (document_type_id)=(…) is still referenced from table "document".
```

The test upserts a `document_type` keyed `inventory-remove-${DOMAIN}` with `ON CONFLICT (type_key)
DO UPDATE … RETURNING`, so a second run gets the first run's type id back. It then deletes only the
one `document` it inserted itself before deleting the type. A `document` row a crashed earlier run
left under the same type is still there, and the type delete is refused. The suite is 863 of 864
green on 2026-09-29 and this is the one.

The product code is not at fault: the refusal is the schema doing its job. The test's cleanup
assumes it is the only writer that ever used its type key.

## What to build

The test's cleanup removes every `document` (and its `document_link` rows) of its own type before
deleting the type, so a leftover from any earlier run cannot fail it. It keeps asserting exactly
what it asserts today: the lift with a document is refused with a message naming the document, and
is removed once the document is gone.

## Acceptance criteria

- [x] With a stray `document` row of type `inventory-remove-${DOMAIN}` inserted before the test
      runs, the test passes (reproduce by hand once, then remove the stray)
- [x] The test's assertions are unchanged
- [x] `npm test` is fully green

## Comment — 2026-09-29

Closed. The remove test now deletes every document of its type, and the links on those documents, before it deletes the type. A stray document of that type was planted, the test failed on the type foreign key, and after the cleanup change the same test passed and left no document and no type behind. `npm test` is 864 pass, 0 fail.
