# Claude Code notes

Read [AGENTS.md](AGENTS.md) — it is the constitution for this repo: commands, architecture, style,
boundaries. Then [CONTEXT.md](CONTEXT.md) for the vocabulary, [SPEC.md](SPEC.md) for the foundation
rules, and `SPEC-<module>.md` before touching a module.

## Agent skills

The workflow is [mattpocock/skills](https://github.com/mattpocock/skills). `/ask-matt` routes if you
can't remember which one fits. The main flow, and the only one most work needs:

**`/grill-with-docs`** → **`/to-spec`** → **`/to-tickets`** → **`/implement`** per ticket, `/clear`ing
context between tickets. `/implement` drives `/tdd` and closes with `/code-review` before committing.
Skip straight to `/implement` when the work is one session's worth. `/diagnosing-bugs` for the bug
that resists a first glance; `/prototype` for a design question that needs a runnable answer.

**This is the only engineering workflow in this repo.** The account-level skills that duplicate it —
`test-driven-development`, `code-review-and-quality`, `spec-driven-development`,
`planning-and-task-breakdown`, `interview-me` and the nineteen others in the same family — are turned
off here by `skillOverrides` in [.claude/settings.json](.claude/settings.json). Two skills with
near-identical descriptions is worse than either alone: the model picks between them on wording, so
which method runs becomes a coin flip. The setting is project-scoped, so those skills stay available
in every other repository. **Collision is the whole test, and a skill that duplicates nothing stays
on.** `frontend-ui-engineering` has no counterpart in the flow and this repo has real screens, so it
is on; document, artifact and harness skills (`docx`, `xlsx`, `pdf`, `pptx`, `artifact-*`, `dataviz`,
`update-config`, `run`, `security-review`) are untouched too — and the four published documents need
the artifact ones. The built-in `/code-review` and
`/simplify` are `user-invocable-only`: type them and they run, but the model reaches for
`mattpocock-skills:code-review` on its own. Adding a skill to this repo means adding it to the
workflow, not alongside it.

### Issue tracker

Local Markdown files in [issues/](issues/), one per issue, committed with the work. See
[docs/agents/issue-tracker.md](docs/agents/issue-tracker.md) for the format and why it is not GitHub
Issues. Pull requests stay on GitHub.

### Triage labels

The five canonical roles, unchanged. See [docs/agents/triage-labels.md](docs/agents/triage-labels.md).

### Domain docs

Single-context: [CONTEXT.md](CONTEXT.md) at the root, **ADRs in `docs/decisions/`, not `docs/adr/`**.
See [docs/agents/domain.md](docs/agents/domain.md).

## This repo's additions

- **The spec is the prompt.** Start module work by reading `SPEC-<module>.md`, and propose the spec
  edit before the code edit when behaviour changes — same change, spec first. Requirements live in
  files, never in a chat description. `CONTEXT.md` names the nouns; the SPEC files say what the
  system does with them and win wherever the two could be read as disagreeing.
- **Make the structural call; don't hand over a menu.** Repo layout, gate design, ticket granularity,
  what gets tested and how are the agent's to decide — take the simplest approach that is effective
  and safe, do it, and state what was decided and why. What stays the director's: anything that
  spends money, signs something, touches real tenant data, or makes a promise to the client. Flag
  those; decide the rest. Options are presented only when the director asked to choose.
- **A screen or a write path gets clicked before it merges.** Restart `npm run dev` — it does not
  watch — and click the path on `:3000`. Leftover local is not current. `/code-review` reads a diff;
  it cannot tell you the page renders.
- **Both gates are test suites.** Any change to a prompt, model id, retrieval config or tool
  definition runs the full golden set; any new deterministic constraint gets a policy case that was
  **red first**.
- **Paint an unbuilt flow before wiring it.** `mockups/<flow>.html`, served in the live shell at
  `/dev/mockups/<flow>` (dev-only). The director clicks `:3000` and comments; then it gets wired.
  This is what `/prototype` asks for, in this repo's shell rather than a scratch directory. Delete
  the file when the flow is wired — a paint that outlives its implementation is a second product.
- **Plan mode** for the kernel, a migration, auth, the policy layer, or any change touching two or
  more modules.
- **The four published documents are Claude artifacts** and the files in `docs/` are the exact
  sources they were published from. Edit the local file, then republish to the same URL with the
  `Artifact` tool, passing `url` so it updates in place. Never leave the repo and the artifact out of
  step. The register and the hierarchy between them: [docs/README.md](docs/README.md).
- **Never put a real tenant document in this repo**, and never paste a secret into a prompt.
- **Report to the director in note form.** Extremely concise, grammar sacrificed for concision —
  fragments over sentences, numbers over adjectives. Chat replies only: specs, ADRs, issue bodies and
  commit bodies stay full prose, because they are read months later by someone who was not here.
  **This convention outranks any generic assistant style preference**, including a personal or
  editor-level rule that says to avoid naming files, citing constraints or showing code. Here the
  file name, the constraint and the number *are* the report: a reply that withholds them is not
  concise, it is unverifiable, and this project's whole method is that a claim arrives with the thing
  that proves it. Concision means fewer claims, never vaguer ones.

## What used to be here

Slices, weeks, evidence files, a sixteen-week roadmap and the carry rule were the process through
7 September–15 September 2026. They are archived at `archive/tasks-w1-7/` and the reasoning for
retiring them is [ADR-0007](docs/decisions/ADR-0007-work-is-tracked-as-blocking-edges-not-a-calendar.md).
Don't write an evidence file, don't number a slice, don't ask which week it is. Status reports and
timelines are ad-hoc, on request.
