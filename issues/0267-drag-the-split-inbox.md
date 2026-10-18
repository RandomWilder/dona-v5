---
number: 267
title: Drag the line between the call inbox and the preview
status: closed
labels: [ready-for-agent]
assignee:
blocked_by: []
parent:
created: 2026-10-18
closed: 2026-10-18
---

## What to build

On the wide calls screen, the border between the inbox and the preview is a separator. Resting the
pointer on it shows a left-right resize cursor. Dragging it sets the inbox width, and the preview
takes the width that remains. The inbox stays at least 16rem and the preview at least 20rem. The
width is stored in that browser and restored on the next visit. The arrow keys move the same line.
The list view and the narrow screen do not show the separator.

## Acceptance criteria

- [x] The calls spec records the separator before the code
- [x] The wide split inbox has a separator between the inbox and the preview, with a left-right resize cursor
- [x] Dragging, and the arrow keys, change the inbox width and leave the preview the rest, within the two floors
- [x] The width is read back from that browser the next time the split inbox is shown
- [x] The list view has no separator, and below 64rem the split inbox is not shown

## Comment — 2026-10-18

The wide split inbox now has the separator. The width stays in the browser. The list view and the narrow screen do not use it.
