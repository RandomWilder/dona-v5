---
number: 139
title: "A golden case asserts a phrase the model is free not to use"
status: open
labels: [ready-for-agent]
assignee:
blocked_by: []
parent:
created: 2026-09-22
closed:
---

## What is wrong

`building-protocol-search` failed CI on a **documentation-only commit**
([run 35667778400](https://github.com/RandomWilder/dona-v5/actions/runs/35667778400), `7d05336`,
one added Markdown file), and passed on a rerun of the identical commit minutes later. Nothing in the
repository changed between the two runs.

The case asks the office turn, on a Building bound, `מה נרשם בפרוטוקול המסירה על מועד המסירה?` and
asserts:

```json
"expect": { "refuses": false, "citesClause": true, "tool": "search", "contains": ["מועד המסירה"] }
```

Three of the four are structural and cannot flake: whether the turn refused, whether it cited a
clause, which tool it reached for. **`contains` is not.** It requires a free-text Hebrew answer to
reproduce one exact four-word phrase, and a correct answer is under no obligation to use the
questioner's wording. `נמסר ב-` with the date, or a direct quotation of the protocol's line without
the label, would be right and would fail.

So the case asserts two different things at once — *the turn searched paper and cited it*, which is
what its own title says it is for, and *the answer used this phrasing*, which is nobody's
requirement. Only the second one is unstable, and it is the one that went red.

## This is the second of the three building cases to flake, and the first has already been fixed

`building-empty-roll` failed on `7489db4` with `expected refuses=false, got true` and was fixed the
next commit by `19ea649`, *Answer an empty Building roll without asking the model* — the path was made
deterministic because `SPEC-evidence.md` already said nobody let today is an answer rather than the
documents-refusal sentence. The model was removed from a decision it was never needed for.

Two of the three cases added with the Building bound have now each failed once on unmodified code.
That is the same class of defect the #127 correction is about — an assertion set from a small sample
of a non-deterministic reader, which the next sample walks through — and it carries the same cost. A
gate that goes red on ordinary jitter is a gate somebody switches off, and this one has now spent a
CI failure on a commit that added a Markdown file and nothing else.

**`19ea649`'s fix does not transfer.** The empty roll had a right answer the spec already stated, so
the model could be taken out of the path. This case genuinely needs the model: it must search
Passages and answer from what it found. The fix here is to the assertion, not to the path.

## What to build

Decide what this case is actually for and assert only that. The title says it: *A Building-bound
protocol question searches paper and does not list the household.* That is `tool: "search"`,
`citesClause: true`, `refuses: false` — all three already asserted, all three stable, and together
they are the whole of the behaviour #120 and #123 built.

The phrase assertion should either go, or be replaced by something a correct answer cannot avoid.
Options, and the ticket should choose one with a reason rather than take the first:

- **Drop `contains` to `[]`.** Cheapest and honest. The structural three carry the case. The risk is
  that a turn citing the right clause while answering about something else would pass — judge how
  real that is against what `citesClause` already proves.
- **Assert the cited passage rather than the answer text.** The protocol's own page is deterministic
  once retrieval has found it, and *which paper was cited* is the thing the case cares about. This is
  likely the right answer and is closest to what `RetrievalExpectation` already does for the
  retrieval cases.
- **Assert the date rather than the label.** `handover_date` is the fact under the question, is a
  value rather than a phrasing, and a correct answer that omits it has not answered. Weaker than the
  passage assertion, stronger than the label.

Then **sweep the other nine cases for the same shape**. Any `contains` holding a phrase from the
question rather than a fact from the corpus is the same latent failure waiting for its run, and
finding them costs one read of `evals/golden/`.

## Acceptance criteria

- [ ] `building-protocol-search` no longer asserts a phrase a correct answer may legitimately not use
- [ ] The replacement is chosen with a stated reason, recorded on this issue
- [ ] The case still fails if the turn refuses, does not cite, or reaches for `list` instead of
      `search` — the three things it exists to prove
- [ ] The other nine golden cases are read for the same shape and what was found is recorded here,
      including *nothing* if that is the answer
- [ ] `npm run evals` green on at least **three** consecutive keyed runs before this closes — one
      green run is what produced the bug

## Related

`evals/golden/009-building-protocol-search.json`, `evals/case.ts` (`contains`, and
`RetrievalExpectation`'s ratchet doctrine), `19ea649`. The measurement argument is the correction
comment on #127.
