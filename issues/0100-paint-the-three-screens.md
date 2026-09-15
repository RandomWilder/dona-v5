---
number: 100
title: "Paint the three screens of the document-upload flow"
status: open
labels: [ready-for-agent]
assignee:
blocked_by: []
parent: 99
created: 2026-09-15
closed:
---

## Parent

#99 — Admin document-upload flow: one reading, approve, confirm, activate.

## What to build

An administrator can click through the whole new flow before any of it is wired, and say what is
wrong while saying so is still cheap.

Three static mockups are painted and served in the live shell under the dev-only mockup path:

- **The approval ledger.** The extracted values as a scannable table: one row per field, the value,
  the page it was read from, an edit affordance and an approve affordance. Amounts appear as ordinary
  rows. The explanatory prose that dominates the screen today is present but collapsed. The reading's
  quality verdict is visible without being the headline.
- **The confirm screen.** Reduced to three decisions: which flat, which letting, and each party's
  role. Nothing else competes for attention.
- **The tenancy page.** Title (tenant name plus address and apartment number), status, the lease's
  dates, the documents the tenancy holds, what it is still missing, what was checked and passed, and
  the activate button — dark, with its reasons stated beside it, and the date it arms when the only
  thing missing is time.

All three are Hebrew and right-to-left, server-rendered markup with no client-side scripting, and use
the existing design tokens rather than hard-coded colours or physical sides. They are paint: no
routes, no schema, no commands, no tests beyond the shell serving them.

The director clicks them on the running local server and comments. Iterate until the comments are
answered. The mockups are deleted by the tickets that wire each flow, not by this one.

## Acceptance criteria

- [x] Three mockup files exist and each is reachable at the dev-only mockup path on a running local server
- [x] Every mockup is Hebrew, right-to-left, uses design tokens, and contains no client-side script
- [x] The approval ledger leads with a table and collapses its prose; every value row shows a page number
- [x] The approval ledger shows amount rows alongside the other fields
- [x] The confirm screen shows flat, letting and roles, and nothing more
- [x] The tenancy page shows title, status, dates, documents held, what is missing, what passed, and a dark activate button with stated reasons
- [x] The tenancy page shows the date the button arms for a tenancy whose only blocker is its start date
- [ ] The director has clicked all three and their comments are answered
- [x] No route, schema, command or production screen is changed by this ticket

## Blocked by

None (can start immediately).

## Comment — 2026-09-15

Painted. Three files, three flows:

- `mockups/approval-ledger.html` → `/dev/mockups/approval-ledger`
- `mockups/confirm-tenancy.html` → `/dev/mockups/confirm-tenancy`
- `mockups/tenancy-page.html` → `/dev/mockups/tenancy-page`

Clicked on a running local server at 1280 and at 375. No horizontal body scroll at either width on any
of the three; the ledger's table is wider than a phone and scrolls inside its own `.table-wrap`,
which is the behaviour the token sheet already gives it. No `<script>`, no hard-coded colour, no
physical side in any of the three files. Nothing outside `mockups/` changed.

Three things the paint decided rather than copied, each marked in an amber block on the screen it
belongs to, and each of them the director's to overrule:

1. **The confirm screen drops the maintenance annex select.** It is the only control the wired
   `/documents/:id/tenancy` writes that this paint removes. The annex is a term of a new letting, not
   an answer to "which paper is this", and the ticket says three decisions and nothing competing. The
   paint assumes a default annex from the register; the alternatives are a fourth question on this
   screen or a field on the tenancy page. This needs an answer before #110 wires it.
2. **The tenancy page shows the arming date on the page only**, not in the incomplete-tenancy queue.
   The queue reports what is missing, and a date is not missing. #108 inherits this if it stands.
3. **The ledger's edit box flexes so `אישור` sits beside it** rather than below. The token sheet gives
   every input `width: 100%`, so the wired ledger spends two rows of furniture per value on a table
   whose whole argument is that it is scannable. This is a change to carry into the wired screen at
   #109, not a paint-only flourish.

The amount rows on the ledger are paint and nothing more — foundation rule 2 still stands until #101
retires it. They are drawn here because the point of painting is to see the screen the retirement
produces before the retirement.

Open: the director's click. The three criteria this ticket holds open until then are the review
comments and their answers; the mockups are deleted by #107, #109 and #110 as each flow is wired,
never by this ticket.

## Comment — 2026-09-15

`/code-review` on the paint, both axes, and seven findings were real. What changed since the comment
above, so that a reader of the file is not reading the first draft:

**Spec axis.**

- **The ledger had lost slice 7.4's promotion path.** The first paint drew no `קדם` control while its
  own collapsed prose still explained one — a screen pointing at a button it does not have. Redrawn
  with the promote row intact. #100 redraws the table and folds the prose; it does not touch
  promotion, and a paint that dropped it silently would have handed that loss to #109 as approved.
- **The approve-all button had one state where #109 needs two.** A second section now paints the
  screen as it reads when the confidence signal will not carry a bulk approval — a document read from
  the text layer arrives with no score at all, so there is no "unflagged" to approve. The button is
  *not drawn* in that state rather than drawn and refusing: a control whose press is never legal is
  furniture whose whole job is to fail.
- **The tenancy page's armed-on-a-date state showed only its gate.** It now shows the documents held
  and what is missing, like the other two states. The state that is most about waiting was the one
  saying least about what it holds.
- **The gate printed two words for one fact** — `נכשל` in one state and `טרם` in another, for the same
  check. #106 returns one outcome per requirement; a screen picking its noun from surrounding context
  is re-deriving the rule the gate exists to state once. One vocabulary now: `עבר` / `לא עבר`, with
  the date carried in the reason beside it.

**Standards axis.**

- **Six hints on the confirm screen rendered unstyled.** The rule was copied from the wired screen as
  `.form-row .hint`, and this paint has no `.form-row` — the decisions are fieldsets — so the
  selector matched nothing and every hint printed at body size and body colour. This is precisely
  what clicking a screen catches and reading a diff does not.
- **The mono face was typed into two paints.** `.page-ref` was a byte-for-byte copy of the token
  sheet's `.grid-table .key` in the same table that already uses `key`, and `.seq` and `.masked` each
  named the face again. All three now take it from the sheet. A face named inside a screen is exactly
  what `tests/ui/tokens.test.ts` refuses on the wired screens, and a paint that teaches the opposite
  is a paint that gets copied.
- **An `<h1>` sat under an `<h2>` three times on the tenancy page.** Headings are the structure a
  screen reader navigates by. One `<h1>` per page — the paint's own — and a painted screen's title is
  a heading inside it wearing the `<h1>` size.

Not changed, and deliberately: the paint furniture (`.paint`, `.paint-note` and their descendants) is
copied into all three files, which review flagged as duplication. It is, and the alternative is a
shared stylesheet — which means a route change in `src/dev-mockups.ts`, and #100 says no route is
changed by this ticket. Three copies of twenty lines for three files that are deleted as each flow is
wired is the cheaper of the two mistakes.

`assignee` stays empty. The claim rule in `docs/agents/issue-tracker.md` is a wayfinder-frontier rule
and this is not a frontier claim; the work is done and what the ticket waits on is the director.
