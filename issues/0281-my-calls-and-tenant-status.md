---
number: 281
title: "My calls and Tenant status"
status: closed
labels: [ready-for-agent]
assignee:
blocked_by: [278, 279]
parent: 270
created: 2026-10-19
closed: 2026-10-21
---

## Parent

#270 — Tenant portal.

## What to build

The tenant sees a list of their calls, newest first, each with its date, category, short summary and **Tenant status** word, including calls they opened on WhatsApp, email or by phone. Opening a call shows its thread: their messages and the office's replies. Office-only things — the response bands and clocks, briefs, drafts, internal states — never appear.

**Paint screens 1e, 1g and 1h** (`mockups/tenant-portal.html`). The calls page ("הקריאות") splits open and closed calls with a two-part control that carries each count (פתוחות · N / סגורות · N). Each call is a card, the whole card the tap target: its title, one line of category · date · channel (בוואטסאפ, בטלפון, בפורטל), its Tenant status chip, and a four-step progress bar (התקבלה 1, בטיפול and ממתין לתיאום 2, נקבע ביקור 3, closed 4 in grey). A ממתין לתיאום card has a warm border and the line "המשרד מחכה לתשובה מכם ←" in place of the bar. A בוטלה card shows the office's note as a second line. The thread shows the call's number, category and date in the top bar, a four-step status strip (התקבלה · בטיפול · נקבע ביקור · טופלה), the visit's date and time when the call is SCHEDULED, and the messages as bubbles: the tenant's on the start side, the office's on the end side under "המשרד". This ticket also fills the home page from #279 with the next visit as a dark card, when a call has one, and the newest two open calls with a הכול link.

## Acceptance criteria

- [x] SPEC-calls is edited first: the Tenant status table.
- [x] The status mapping is a pure function with its own small test; a state the table does not name maps to בטיפול.
- [x] The list shows calls whose requester the number resolves to and whose tenancy the number reaches today, whatever the Source channel.
- [x] Policy case, red first: no tenant page contains a band, a clock, a brief or a draft.
- [x] Another tenant's call by identifier is not found.
- [x] Every page in this ticket works at phone width with no sideways scroll, by keyboard alone and with a screen reader (IS 5568), and its strings are Hebrew rows, not literals.
- [x] Clicked on `:3000` before merge.
- [x] Each status chip uses its own `data-status` colour from the portal stylesheet; ממתין לתיאום is the only warm one, because it is the only status that asks the tenant to act.
- [x] A call card's meta line is one line, ellipsised, and never wraps into the progress bar.
- [x] The home page's next-visit card appears only when an open call has a Visit with a time, and shows that time; with none, the card is absent.

## Blocked by

- #278
- #279

## Comment — 2026-10-21

Closed. Tenant status is derived, never stored: a state the table does not name, including a closed call with no exit, is בטיפול. The list is that party's calls on a tenancy the number reaches today, any source channel, newest first. A call returned to the filtered list is absent. Opening one shows the tenant's messages and the office's replies. A brief, a draft, a band and an internal name are not on the page. Another tenant's call is not found.

A visit is two timestamps on the call, both or neither. No command writes them yet. The home card shows the earliest open visit that has not ended, and is absent otherwise. The calls page is two links, not a tab widget, so it works with no script.

The portal does not import the calls or channel modules. Those reads are passed in from the composition root, because a value import cycles through the building switch.

Clicked on the restarted `:3000`. The browser session already open belongs to a building that is not in the portal, and that session was left signed in. The portal tenancy was signed in over HTTP on the same server: home (open calls, no visit card, because that tenancy has no visit time), the calls list, the closed list, and one thread. The served stylesheet has the one-line meta, the warm waiting border, and the dark visit card. Not pushed.
