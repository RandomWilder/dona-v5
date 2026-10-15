---
number: 241
title: Icons live in one table, and every call row shows its channel
status: closed
labels: [ready-for-agent]
assignee:
blocked_by: []
parent:
created: 2026-10-14
closed: 2026-10-14
---

The approved קריאות screens put a channel icon tile on every call row: mail, phone, a speech bubble
for WhatsApp, a door for a walk-in. Staging has none. The rows show the channel only as a text chip.
The cause is structural. The design system has no icons, so every screen copies the same inline
`<svg>` wrapper by hand. `src/chrome.ts` has its own `icon()` for the rail. `src/estate/internal/views.ts`
defines `CHEV`, `PLUS`, `TO_BUILDING` and six space-kind icons. `src/calls/internal/views.ts`
defines a second copy of the chevron.

The fix is one kernel table, `src/kernel/ui/icons.ts`, with one `icon(name, { class, label })`
function. It emits inline SVG, which keeps pages self-contained (SPEC.md UI rule). That means no
sprite route, no icon font and no dependency. The drawings are copied from Lucide (ISC), and the
licence text sits beside the table. The output is byte-compatible with today's wrapper, so the
existing CSS and test selectors keep matching. Icon names are generic. The calls module owns the
map from `SourceChannel` to icon. The tile appears on both the split row and the list row. It is
decorative, and the text chip stays.

A guard test fails on any `<svg` in `src/` outside `icons.ts`. It was red on the old tree.

## Acceptance

- [x] SPEC.md and SPEC-calls.md edited before code
- [x] Guard was red on the old tree, green after
- [x] No `<svg` outside `src/kernel/ui/icons.ts`
- [x] Split and list rows show the channel tile for all four channels
- [x] Rail, estate inventory and call-page chevrons look unchanged
- [x] Clicked on `:3000`, including a narrow width and dark mode

Out of scope: the היה חירום chip and any other mockup gap that is not about icons.

## Comment — 2026-10-14

Closed. The guard failed on the rail, the inventory page and the call page, then passed once those drawings moved into the one table. A test may quote the tag it asserts; a screen may not. A call row, split and list, opens with a decorative tile: mail, phone, a speech bubble, a door. The Hebrew chip stays. On `:3000` the open list held an email and a walk-in; both tiles showed on the split row and the list row, at 390px with no sideways scroll. The rail, the inventory chevrons and space tiles, and the call-page back chevron looked as before. The product has no dark theme, so a dark colour scheme leaves the tiles on the same tokens as the rest of the page.
