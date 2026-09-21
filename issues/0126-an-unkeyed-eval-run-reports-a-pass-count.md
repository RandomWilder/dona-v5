---
number: 126
title: "An unkeyed eval run reports a pass count for cases it did not grade"
status: open
labels: [ready-for-agent]
assignee:
blocked_by: []
parent:
created: 2026-09-21
closed:
---

## What is wrong

`npm run evals` without an `OPENAI_API_KEY` prints:

```
golden set: 5/10 passed, 0 failed, 5 skipped
```

That line is misleading in both halves, and it was believed during #124 — the closing comment on
that issue reported it as five cases graded and five skipped, which is not what happened.

All ten cases in `evals/golden/` need the corpus: four carry `retrieval`, one `grounding`, five
`expect`. Without a key, `embeddingsConfigured()` (`evals/corpus.ts:73`) is false, so no pool is
opened, `retrieve` and `ground` are undefined, and those five skip — correctly and visibly. The other
five do not skip. `evals/run.ts` substitutes `placeholderSubject` (`evals/subject.ts:39`) for the
office turn, and that stub returns fixed Hebrew strings. **The five that "pass" are graded against
hardcoded answers.** The honest summary of an unkeyed run is that nothing was measured.

CI already solved exactly this shape of problem, and said why. `.github/workflows/ci.yml` sets
`REQUIRE_POSTGRES=1` and `REQUIRE_EMBEDDINGS=1`, with a comment that a skip is *"right on a clean
clone and a lie in CI — the job would go green having ranked nothing."* That reasoning is correct and
this issue does not extend it to the local runner, because the local runner is the clean clone: a
keyless run must keep working. The failure here is not that the run is permissive. It is that the run
is **quiet about what it did**, and then reports a number that reads like a grade.

The keyed run, for contrast, is loud and honest — it prints its boot line:

```
corpus: 86 passages indexed · embedder openai:text-embedding-3-large@1536
golden set: 10/10 passed, 0 failed, 0 skipped
```

The unkeyed run prints no boot line at all, because `run.ts` only prints one when a corpus was built.
The one run that needs to explain itself is the one that says nothing.

## What to build

**Not** a failure on a missing key. `.env.example` is explicit that the key is exported in a shell
and that absent one the cases skip, and a clean clone must stay runnable.

- A boot line on **every** run, naming the subject and the embedder actually in use — so an unkeyed
  run says it is running the placeholder subject with no embedder, in the same place the keyed run
  names `openai:text-embedding-3-large@1536`.
- A summary line that does not present stub-graded cases as passes. A case answered by
  `placeholderSubject` is not a pass; whether it is reported as a third category or folded into
  `skipped` is the implementer's call, but `5/10 passed` must not be what a keyless run prints.
- The same applies to `npm run measure`, if it shares the path.

## Acceptance criteria

- [ ] An unkeyed `npm run evals` prints a boot line naming the subject and embedder in use
- [ ] An unkeyed `npm run evals` does not report a stub-graded case as passed
- [ ] A keyed run's output is unchanged
- [ ] A keyless run still exits 0 on a clean clone — no new required environment variable
- [ ] CI's `REQUIRE_EMBEDDINGS=1` behaviour is unchanged

## Blocked by

None.

## How it was found

While discharging the golden-set caveat on #124. The keyed run came back 10/10, 0 failed, 0 skipped,
which is recorded in that issue's second comment along with the correction to what the unkeyed run
had been reported as.
