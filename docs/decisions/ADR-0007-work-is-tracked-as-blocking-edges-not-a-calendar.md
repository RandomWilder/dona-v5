# ADR-0007 — Work is tracked as blocking edges, not a calendar

**Status:** accepted · 15 Sep 2026
**Supersedes:** the slice/week/evidence process in `docs/pipeline.md` §8 and the whole of `tasks/`
**Does not touch:** the merge → CI → staging → prod chain, the two gates, the grep guards, the hooks

## Context

The repository was built on a sixteen-week roadmap decomposed into numbered slices, one slice per
session, each closed with an evidence file, each week closed with a demo. Seven weeks of it ran.
The process worked in one respect — week 6's demo found four defects that eleven green slices and a
full CI gate had not — and failed in another, which is what this decision is about.

The planning layer had grown to roughly 91,000 tokens across four files:

| File | Bytes | ≈ tokens |
|---|---|---|
| `tasks/roadmap.md` | 168,404 | 42,000 |
| `tasks/todo.md` | 108,340 | 27,000 |
| `docs/pipeline.md` | 31,565 | 7,900 |
| `tasks/plan.md` | 21,727 | 5,400 |
| `tasks/fuses.md` | 16,897 | 4,200 |

Every session paid some fraction of that before it wrote a line of code, and the fraction was rising:
the carry rule (`docs/pipeline.md` §8) requires that an item raised anywhere is written into the entry
of the slice that closes it, so `todo.md` accumulated the history of every decision that had ever been
deferred. The rule is correct — an item recorded only in an evidence file is an item lost, and slice
1.1 proved it by losing two of three. The rule was correct and its storage medium was prose in a file
that only grows.

The second cost is that the calendar was never load-bearing. `tasks/roadmap.md`'s own header says the
dates are never rewritten and that a week closes when its slices close, not when its Thursday
arrives. A schedule that is explicitly not a commitment, re-read every session, is overhead
pretending to be structure.

## Decision

Adopt [mattpocock/skills](https://github.com/mattpocock/skills) (`mattpocock-skills@mattpocock`,
v1.2.3, installed at user scope) as the development workflow, and take its tracking model with it.

**Work is a set of tickets on GitHub Issues, each declaring the tickets that block it.** A ticket is
a tracer bullet: a narrow but complete path through every layer, demoable on its own, sized to one
fresh context window. There is no date on it. A ticket is ready when its blockers are closed.

The flow is `/grill-with-docs` → `/to-spec` → `/to-tickets` → `/implement` per ticket, clearing
context between tickets. `/implement` drives `/tdd` and closes with `/code-review` before committing.

**The carry rule survives, in a stronger form.** What it asked for — nothing raised is left unowned —
is now a blocking edge between two issues, enforced by the tracker rather than by an agent's memory
of a convention. What it cost in prose was a paragraph per slice, re-read forever; what it costs now
is an edge.

**`tasks/` is archived to `archive/tasks-w1-7/`, not deleted.** Sixty-seven evidence files are the
record of what was proved between 6 and 15 September 2026, and several of them are cited from code
comments. They remain readable. They stop being loaded.

## What is deliberately unchanged

The deployment chain is orthogonal to this and is not touched: merge to `main` → CI green → staging
on `workflow_run` → prod on a `v*` tag. Nor are the two required gates (`test:policy`, `evals`), the
grep guards, `.claude/hooks/`, `infra/bootstrap.sh` or `infra/rollback.sh`. `/implement` runs
typecheck and the test suite and then hands to `/code-review`; it plugs into those gates rather than
replacing them.

`SPEC.md` and `SPEC-<module>.md` remain the behaviour contract, and foundation rule 11 — the spec is
updated before the code, in the same change — is unaffected. The skills' domain layer is additive:
`CONTEXT.md` is a glossary of nouns and points at the SPECs for behaviour.

The ADR home stays `docs/decisions/`. The skills' `domain.md` says `docs/adr/`; `docs/agents/domain.md`
redirects it here, because two ADR directories is the split an ADR exists to prevent.

## Consequences

**Accepted costs.**

- Work items leave the repository. State that was in the diff is now in GitHub Issues. This is the
  trade that buys the 74,000 tokens; it cannot be had both ways.
- The user-invoked skills are `disable-model-invocation: true`, so the phase is driven by the
  director typing `/to-tickets` or `/implement`. The model-invoked ones (`tdd`, `code-review`,
  `domain-modeling`, `codebase-design`, `diagnosing-bugs`) are still reached for unprompted.
- Guard four — a painted mockup may not outlive the slice that wired it — is deleted, because its
  second half was `tasks/evidence/<slice>.md` and there are no slices. The `/dev/mockups/:flow` route
  and `src/dev-mockups.ts` are kept: painting a flow before wiring it is still right, and
  `/prototype` is the skill that now asks for it.

**Not addressed here.** The eleven `SPEC*.md` files are ~82,000 tokens, which is the same order as the
planning layer this decision removes; `SPEC-evidence.md` alone is 89 KB. Halving the load does not fix
it. That is the next decision, and it is deliberately not this one.
