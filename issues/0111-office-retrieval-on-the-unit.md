---
number: 111
title: "Office retrieval on the Unit: bound search, cited answers, persisted thread"
status: closed
labels: [ready-for-agent]
assignee:
blocked_by: []
parent:
created: 2026-09-16
closed: 2026-09-16
---

## Problem Statement

The office can file Documents, keep Passages, and search them, but nobody standing on a Unit can
ask a question and get an answer drawn only from that Unit’s paper. Search today walks the whole
passage store. There is no office surface, no conversation, and no bound. Staging cannot yet prove
that an administrator, operator or viewer gets great answers from one Unit’s documentation.

## Solution

A left-side collapsible panel on the Unit estate screen. Signed-in staff (ADMIN, OPERATOR, VIEWER)
ask questions in Hebrew about that Unit’s linked Documents. Every turn searches Passages in a
required **retrieval bound** (v1: that Unit only), administrator stance, identifiers and amounts as
printed on the paper — the same information already visible when they open the Document. The answer
is cited to document and page, or refused. History is an **office retrieval thread**: one per staff
account × bound, private, kept until they clear it on that Unit screen.

The current screen only *picks* the bound. Isolation stays the occupancy join; this product is not
**the agent** and is not a **Conversation**. Building and portfolio bounds are the same command with
a wider filter, shipped after Unit quality holds.

## User Stories

1. As an operator on a Unit screen, I want a collapsible panel on the left, so that I can ask about
   this Unit’s documentation without leaving the page.
2. As a viewer, I want the same panel, so that reading paper does not require a different role from
   asking about it.
3. As an administrator, I want the same panel, so that all three staff roles share one retrieval
   product.
4. As any staff on a Unit, I want the bound to be this Unit, so that answers cannot come from
   another Unit’s Documents.
5. As any staff, I want only Documents linked to this Unit in the bag, so that Building protocols
   and other Spaces do not leak into the first staging bar.
6. As any staff, I want a question about monthly rent to retrieve the clause that prints the figure,
   so that I can trust amounts the way I trust the paper.
7. As any staff, I want a question about the deposit or bank guarantee to retrieve the clause that
   prints the figure, so that money questions are first-class.
8. As any staff, I want the answer to cite the Document and the page, so that I can open the source.
9. As any staff, I want names, addresses, amounts and identifiers in the answer exactly as they
   appear on the ingested paper, so that retrieval is not a second, poorer copy of the file.
10. As an operator or viewer, I want those identifiers unmasked in retrieval, so that I am not
    blocked from information the Document itself already shows me.
11. As any staff, I want a football question (or any question the Passages do not answer) refused,
    so that the panel does not invent facts.
12. As any staff, I want a question that retrieves eight Passages none of which answer it refused,
    so that a non-empty result set is not treated as grounding.
13. As any staff on a Unit with no Passages, I want a refusal, so that an empty bound is not
    guessed through.
14. As any staff, I want “what does the neighbour pay?” refused while I am on this Unit, so that
    the bound does not silently widen.
15. As any staff, I want no nudge to switch to the Building bound, so that widening is a deliberate
    change of screen later, not a prompt.
16. As any staff, I want follow-up questions to search again in the current bound, so that history
    cannot smuggle a fact from a previous Unit or an earlier hit that is not retrieved this turn.
17. As any staff, I want earlier messages used only to clarify the wording of this turn’s question,
    so that the model is not a second store of facts.
18. As any staff, I want a fact that does not come back as a Passage this turn absent from the
    answer, so that citation and retrieval stay aligned.
19. As any staff, I want my thread keyed to my staff account and this Unit, so that switching Units
    starts a different history.
20. As any staff, I want my thread private to my staff account, so that another operator on the same
    Unit does not read my questions.
21. As any staff, I want the thread kept until I clear it, so that I can continue a conversation
    across visits to the same Unit.
22. As any staff, I want a control on the Unit screen that clears this Unit’s thread for me, so that
    I can start over without waiting for a retention policy.
23. As any staff, I want the panel hidden on documents, settings, search, letting sheets and queues,
    so that there is no leftover bound from a previous page.
24. As any staff, I want the panel hidden on Building and all-buildings screens in this slice, so
    that we do not ship three levels before Unit quality holds.
25. As the office, I want this product not to be a Conversation, so that tenant WhatsApp history
    cannot be confused with staff retrieval.
26. As the office, I want this product not to be the WhatsApp agent, so that service-call tools and
    isolation are not implied by a panel.
27. As a future tenant-facing build, I want the Unit filter reusable, so that tenant retrieval can
    share the bound without inheriting “current page.”
28. As a future tenant-facing build, I want Building and portfolio office bags never callable with
    tenant stance, so that a neighbour’s contract cannot ride an office-wide search.
29. As a future tenant-facing build, I want the occupancy join to remain the isolation mechanism, so
    that a model never holds a wider scope than the phone resolved.
30. As a policy owner, I want a Building-bound search with tenant stance to fail closed, so that the
    forbidden combination cannot be assembled by a later caller.
31. As a golden-set owner, I want existing rent and deposit rank cases still green, so that adding a
    bound does not regress retrieval quality.
32. As a golden-set owner, I want a Unit-bound retrieval case that does not surface another Unit’s
    answering clause, so that the filter is graded, not hoped for.
33. As a golden-set owner, I want the off-lease refusal case to still refuse when a lease is in the
    bound, so that office refuse matches grounding, not empty-list.
34. As a golden-set owner, I want a behavioural case that the office turn cites a Passage and
    another that it refuses off-topic, so that the answering layer is gated like the agent will be.
35. As an implementer, I want `searchPassages` to require a bound the way it already requires a
    stance, so that no caller searches the whole store by omitting a filter.
36. As staff with `documents.read`, I want no new permission for the panel, so that asking is not a
    second access-control story beside opening the paper.
37. As staff without a session, I want the panel and its posts unreachable, so that retrieval is not
    an anonymous door.
38. As VIEWER, I want to ask and read answers but not file Documents, so that retrieval follows
    `documents.read`, not `documents.write`.
39. As any staff, I want Hebrew in and Hebrew out, so that the panel matches the rest of the console.
40. As any staff, I want a collapsed panel that I can open without losing the Unit page, so that
    retrieval is beside the estate, not a separate product.
41. As any staff, I want each answer to list the Passages it used, so that I can judge quality
    without trusting the prose.
42. As any staff, I want a refused turn stored in the thread, so that I can see what was asked and
    that it was declined.
43. As any staff, I want clearing the thread to remove only my history on this bound, so that
    another staff account’s thread on the same Unit is untouched.
44. As the director, I want staging success defined as Unit screen + Unit bag + cited answers that
    match the golden retrieval cases + a persisted Unit thread, so that Building and portfolio wait.

## Implementation Decisions

- **Modules.** Evidence owns Passage search and the bound. Staff owns the office retrieval thread
  (staff account × bound, messages, clear). Estate owns showing the panel on `GET` of one Unit and
  posting turns and clear against that Unit. Channel is not opened. Scope is not opened for this
  slice: office retrieval is not the isolation join.
- **Glossary already named.** Retrieval bound; office retrieval thread. Use those nouns. Do not say
  RAG, chat, apartment, or user. The WhatsApp-facing model remains **the agent**.
- **`searchPassages` grows a required bound**, never defaulted, same rule as stance. v1 bound is one
  Unit: only Passages of Documents linked to that Unit (UNIT link, or TENANCY link whose tenancy’s
  unit is that Unit — same anchoring already used to display `unitId` on a hit). Building and
  portfolio bound kinds may exist on the type so the wider filters are the same command later; v1
  HTTP only ever sends Unit. A Building or portfolio bound with tenant stance is refused at the
  command (fail closed). v1 HTTP always sends administrator stance.
- **Administrator stance is the paper.** For every staff role that may read Documents, returned
  Passage text is as printed: names, addresses, amounts, identifiers. This is not a fork from
  `party.national_id.read`. That permission continues to gate structured Party fields and the
  existing reveal ledger. It does not redact Passage body on an office search. Tenant stance still
  masks identifier-shaped runs for the future tenant surface; that surface is not built here.
- **Office turn command.** One command: staff account, bound, question. Loads that account’s thread
  for the bound (empty if none). Embeds and searches. If there are zero hits, refuse and persist.
  If there are hits, the answering model may use thread text only to interpret the question, and may
  use only this turn’s hit texts as facts. If none of the hits answer the question, refuse and
  persist, with no citations. If they do, answer in Hebrew, cite document and page (and existing
  clause refs where the golden set already names them), persist question, answer, citations, hit
  ids. A fact not in this turn’s hits is not in the answer.
- **Not a second agent product.** The office turn may call only the search command. No service-call
  tools, no occupancy resolver, no signed URLs minted by search. Rule 10 still holds: client, not
  brain. Personal data in Passages may reach the model provider as it already does for extraction
  (ADR-0004); office retrieval is the same class of send.
- **HTTP.** Panel markup on the Unit estate page only. POST a turn against that Unit (CSRF, session,
  `documents.read`). POST clear thread for that Unit and the signed-in staff account. No JSON public
  API beyond what the panel needs. Building page, all-buildings page, documents, letting sheet,
  settings, search, expiring and incomplete queues: no panel, no bound cookie, no last-bound.
- **Thread schema.** Staff-owned rows, not Conversation / Message. Unique on staff account plus
  bound kind plus bound id. Messages oldest-first. Clear deletes that thread’s messages (or the
  thread row) for that account and bound only. No retention job.
- **No new permission.** `documents.read` is enough to ask. `party.national_id.read` is not required
  for unmasked Passage text on administrator stance.
- **SPEC files in the same change as the code** (`SPEC-evidence.md` for bound search and the paper
  rule; `SPEC-staff.md` for the thread; `SPEC-estate.md` for the panel). Foundation rules unchanged.
  `SPEC-channel.md` stays a stub.
- **Evals subject.** The office turn replaces the placeholder subject for the cases this product
  owns (citation, refuse). Retrieval rank cases continue to grade the retriever. Grounding case
  `off-lease-refuses` continues to mean “hits may exist; none answer.” Add a Unit-bound retrieval
  case that a neighbour Unit’s answering Passage is not in the result set. Bound is retrieval
  configuration: full golden set on any prompt, model id, or search-signature change.

## Testing Decisions

**Seam 1 — `searchPassages` (existing, extend).** Highest existing seam. Contract tests: required
bound; Unit bound returns only that Unit’s Passages; a Passage from another Unit is absent even if
it is nearer in embedding space; administrator stance unmasked; tenant stance still masks; Building
or portfolio bound + tenant stance throws; no assertion on distance.

**Seam 2 — office turn command (new, one command).** Highest seam for answering. Tests through the
public command only: cited answer when the Unit bag contains the clause; refuse when the bound is
empty; refuse when hits exist but do not answer; refuse a cross-Unit question while bound to this
Unit; second turn searches again; a fact from thread history that is not in this turn’s hits does
not appear in the answer; thread is per staff account × Unit; a second staff account on the same
Unit does not see the first thread; clear removes only that account’s thread.

**Seam 3 — evals (existing harness).** Retrieval cases stay on the retriever (rent, deposit, and the
new Unit-filter case). Grounding stays on refuse-with-hits. Behavioural cases grade the office turn
as `Subject` (cite / refuse / tool = search). No distance assertions. Ratchet `rankAtMost`; do not
tighten until measured.

**Seam 4 — HTTP on the Unit page (existing estate tests).** Panel present on Unit GET for signed-in
`documents.read`; absent on Building, all-buildings, documents, letting, settings, queues; turn and
clear require session and CSRF; VIEWER may POST a turn; anonymous is closed.

Do not test isolation by hoping the model refuses another tenant: a policy case that another Unit’s
row is absent from the SQL is the filter; evals prove answering behaviour. Do not test thread
storage by inspecting internals if the command already returns history.

Prior art: `src/evidence/search.test.ts` and intake search cases for stance; `evals/golden/` for
rank and grounding; `src/estate/routes.test.ts` for Unit page chrome; `tests/policy/` for anything
no model may decide (bound required, tenant stance forbidden on Building/portfolio).

## Out of Scope

- Building retrieval bound and portfolio retrieval bound as shipped HTTP (types and fail-closed
  tenant stance may land with the command so they cannot be forgotten).
- Panel on any screen other than the Unit estate page.
- Tenant-facing UI, WhatsApp, Conversation, Message, channel tools.
- Calling the occupancy join from office retrieval.
- Building-level paper in the Unit bag (protocols, COMMON / TECHNICAL / other Spaces).
- Shared threads, retention jobs, export, search over threads.
- New staff permission, role-based redaction of Passage text, or changing who may open a Document.
- Vector index (ADR-0009).
- Mocked Documents in staging or production.
- Changing promotion, extraction, or the isolation join.

## Further Notes

Grill closed 2026-09-16. Tenant later = same Unit filter + the scope + tenant stance + global
knowledge base, as a separate build. Office Building/portfolio bags do not carry over.

`party.national_id.read` remaining ADMIN-only for structured Party reads is unchanged. Office
retrieval answers are the Document as filed.

## Comment — 2026-09-16

Closed. Children #112–#114 are closed (`9e90acf`, `a3e7f14`, `c23820f`). What landed: required
retrieval bound on every passage search; office turn with a private thread per staff account ×
bound; Unit-page panel (split pane, collapsible, composer at the bottom) for `documents.read`,
Hebrew ask and cited or refused answers, persist across reload, clear for this account only.

Building and portfolio HTTP, tenant-facing retrieval, and occupancy isolation stay out. Staging is
the click: Unit with Passages, ask, cited quality against the golden retrieval cases, history still
there, clear. Embedder must be configured there.
