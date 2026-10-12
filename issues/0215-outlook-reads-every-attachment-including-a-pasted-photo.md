---
number: 215
title: Outlook reads every attachment, including a photo pasted into the body
status: open
labels: [ready-for-agent]
assignee:
blocked_by: []
parent: 188
created: 2026-10-13
closed:
---

## Problem

The first staging tests on the pilot mailbox (12 Oct 2026) showed two faults in how the Outlook
adapter reads files. Both come from the attachments call, which the recorded-payload tests never
exercised against Graph itself.

1. **A real attachment stops all intake.** `listAttachments` asked Graph for
   `$select=id,name,contentType,size,isInline,contentBytes`. Graph refuses it with 400 on every
   message: `contentBytes` belongs to `microsoft.graph.fileAttachment`, not the base
   `microsoft.graph.attachment` the collection is typed as. The read fails, the delta cursor is not
   saved, and the next poll retries the same page every 90 seconds, forever. No email on that
   mailbox would reach the door after the first one carrying a file.
2. **A pasted photo is dropped.** Gmail sent a 2.5 MB PNG pasted into the reply as an embedded
   file. Graph marks it `isInline: true` and reports the message `hasAttachments: false`, so the
   adapter never asked for its files, and would have skipped it as embedded if it had. A phone
   photo pasted into the body is the most common way a tenant shows a leak.

## What it should do

SPEC-channel.md, Attachments, as amended in this change: the adapter asks for a message's files on
every message, not only when Graph reports some, and keeps an embedded file of 64 KB or more. An
embedded file under 64 KB is a logo or icon and is not an attachment. The line comes from the pilot
mailbox: a signature logo at 51 KB, pasted images at 87 KB and 2.5 MB. The Gmail standby adapter
follows the same rule.

## Acceptance

- The attachments request carries no `$select`; a test whose Graph refuses a `$select` naming
  `contentBytes` on the base type was red before the fix.
- A message reporting `hasAttachments: false` still has its files read.
- An embedded file of 64 KB or more is kept with its bytes; one under 64 KB is skipped. Same in
  both adapters.
- Re-test on staging: a pasted photo and a regular attachment both show on the call.
