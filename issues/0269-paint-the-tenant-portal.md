---
number: 269
title: "Paint the tenant portal"
status: open
labels: [ready-for-agent]
assignee:
blocked_by: []
parent: 268
created: 2026-10-19
closed:
---

## Parent

#268 — Tenant portal.

## What to build

A clickable paint of the whole phase-1 portal in the live shell, so the director can click it on `:3000` and comment before anything is wired. Tenant side: phone entry, code entry (WhatsApp default, SMS choice), passkey offer, first-visit notice and acknowledgement, home, my flat (with a chooser for two tenancies), my papers, my calls with Tenant status words, a call thread with a follow-up box, report an issue (category, entry permission, emergency notice, attachments), ask the office, the "building not in the portal yet" state, the language switch, and the "we reply within X business days" line. Office side: the Building's portal switch (including the refusal while a legal text is a placeholder), and the `/settings` additions — non-working dates, handling thresholds in business days, the Reply target and "show to tenants".

## Acceptance criteria

- [x] The paint is served at `/dev/mockups/tenant-portal`, dev-only, and every screen above is reachable by clicking.
- [x] Hebrew right to left, with one screen also shown in English left to right to prove the direction switch.
- [x] Works at phone width.
- [ ] The director has clicked it and their comments are recorded as comments on this ticket.
- [ ] The paint is deleted by the last ticket that wires its final screen.

## Blocked by

None (can start immediately)

## Comment — 2026-10-19

Paint is up at `http://127.0.0.1:3000/dev/mockups/tenant-portal`, listed from the mockups index. Every screen in the ticket is a click: phone, WhatsApp code with an SMS choice, passkey, first-visit notice, home with the reply line, my flat with two tenancies, papers, calls in the tenant status words, a thread with a follow-up, report (category, entry, duty notice, attachments), ask, building not in the portal, English left to right, and a Russian screen for the language switch. Office: the building switch, the refusal while a legal text is a placeholder, and the settings additions (non-working dates, business-day thresholds, reply target, show to tenants — off). Sample text only. Waiting on the director's comments before this closes. The file stays until the last ticket that wires a screen deletes it.

## Comment — 2026-10-19 (design pass)

The tenant side of the paint is restyled to the director's design brief (`Tenant-Portal-Design-Brief.md`, screens 1a–1o and 1g′) and is waiting on a second click-through. Everything new is scoped under `.portal-frame` with `--tp-*` tokens, so the admin shell is untouched; the office screens (`switch`, `refusal`, `settings`) keep the admin style, as the brief asks. The mechanism is unchanged: hidden radios, `label[for]` and `:has()`, no script. Icons are Lucide, inlined once as an SVG sprite at the top of the file.

**State ids.** All fourteen old tenant ids are kept. Six are new and sit in the "דייר" group of the switcher: `st-tenancy` (tenancy sheet, 1f), `st-lang` (language sheet, 1g′), `st-report-2`, `st-report-3`, `st-report-sent` (report steps 1j–1l; `st-report` is step 1), and `st-thread-closed` (closed thread, whose composer becomes "פתיחת קריאה המשך"). Helper radios: `#calls-open` / `#calls-closed` for the segmented control; `#tenancy-a` / `#tenancy-b` and `#code-wa` / `#code-sms` are kept and now live at the top of the frame, so the tenancy choice scopes home, calls, flat, documents and the report summary everywhere. `st-papers` renders the merged flat-and-documents screen.

**Deviations from the brief.**

- Open-call count is 4, not 3, on home and in the tenancy sheet, because the calls list the brief specifies has four open cards (התקבלה, בטיפול, ממתין לתיאום, נקבע ביקור). A count that disagrees with the list beneath it would be the first thing a reviewer noticed.
- Back buttons (`chevron-right`) sit at the start of the top bar, before the title; close buttons (`x`) sit at the end, as §4.3 says. The brief reads either way for "back plus the title"; start is where an RTL reader expects back.
- The OTP has no button, as asked; in the paint, clicking the code cells stands in for the auto-submit and moves to the passkey offer.
- The fallback card has an SMS-side variant too ("לא הגיע במסרון?" → back to WhatsApp), so `#code-sms` is not a dead end.
- The lease of the second sample tenancy moved to 01.09.2026–31.08.2027; the old dates had already ended, which the new lease bar would have shown as a full bar on an active tenancy.
- A small battery glyph is drawn in the fake status bar beside 9:41. Paint only.
- Heebo is served from the app's own `/ui/fonts/`, which carries Hebrew and Latin subsets at weights 300–700. Russian falls back to the system face, and the brand mark's weight 800 is synthesised. Adding the Cyrillic subset and 800 is a font-file change, left for when the design is approved.

**Contrast, against the brief's own §8 check (≥ 4.5:1).** Measured on the brief's tokens, unchanged in the paint: white on `--tp-accent-600` is 4.25:1 (primary button, נקבע ביקור chip, tenant bubble); `--tp-ok` on `--tp-ok-tint` is 4.12:1 (נענתה chip); `--tp-ink-faint` on `--tp-bg` is 2.98:1 (timestamps, day separators); `--tp-accent-200` on `--tp-accent-600` is 3.48:1 (tenant bubble time). Everything else passes: accent-700 on accent-100 5.93, warn 5.76, meta 4.57, white on accent-700 6.47. The colours are the design under review, so they are reported here rather than changed; moving the primary fill to accent-700 (6.47:1) is the smallest fix if the director wants one.

**Verified.** Every one of the 23 states was rendered through `renderMockup` with the live shell's stylesheet and clicked, in Hebrew, English and Russian, at the desktop pane width and at 320px: no horizontal page scroll and nothing escaping the frame in any state. The report flow was driven by real clicks (FAB → category tile → המשך → step 2), and the switcher highlight follows clicks made inside the phone. `src/dev-mockups.tenant-portal.test.ts` is updated to the new structure (16 pass). The `:3000` click-through itself was not possible from the agent session, because staff sign-in is Google OAuth.

**Once approved.** Issue #268's user stories still describe a separate papers screen and a single-page report form. Those edits wait for the director's yes on this design, and then the `--tp-*` tokens and components become the portal's design system in the app.
