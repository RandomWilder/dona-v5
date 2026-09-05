# Claude Code notes

Read [AGENTS.md](AGENTS.md) — it is the constitution for this repo: commands, architecture, style,
boundaries. Then [SPEC.md](SPEC.md) for the foundation rules, and `SPEC-<module>.md` before touching
a module.

Claude-specific additions:

- **One slice per session.** Take it from [tasks/todo.md](tasks/todo.md), where it is already written
  with acceptance criteria, and finish with its **Verify** step — never self-certify. Close it with a
  `tasks/evidence/<slice>.md` file recording what was proved, with the numbers.
- **Make the structural call; don't hand over a menu.** Repo layout, gate design, slice sequencing,
  what gets tested and how are the agent's to decide — take the simplest approach that is effective
  and safe, do it, and state what was decided and why. What stays the director's: anything that
  spends money, signs something, touches real tenant data, or makes a promise to the client. Flag
  those; decide the rest. Options are presented only when the director asked to choose.
- **Carry every raised item into the slice that closes it** — `tasks/todo.md` and
  `tasks/roadmap.md`, not only the evidence file, and inside the slice that raised it. Changing the
  plan is allowed and expected; leaving the plan behind is not. A slice is closed when nothing it
  opened is unowned ([docs/pipeline.md](docs/pipeline.md) §8).
- **The spec is the prompt.** Start module work by reading `SPEC-<module>.md`, and propose the spec
  edit before the code edit when behaviour changes. Requirements live in files, never in a chat
  description.
- **Plan mode is mandatory** for the kernel, a migration, auth, the policy layer, or any change
  touching two or more modules ([docs/pipeline.md](docs/pipeline.md) §4).
- **Both gates are test suites.** Any change to a prompt, model id, retrieval config or tool
  definition runs the full golden set; any new deterministic constraint gets a policy case that was
  **red first**.
- **The four published documents are Claude artifacts** and the files in `docs/` are the exact sources
  they were published from. Edit the local file, then republish to the same URL with the `Artifact`
  tool, passing `url` so it updates in place. Never leave the repo and the artifact out of step. The
  register, the hierarchy between the documents, and how they are written: [docs/README.md](docs/README.md).
- **Never put a real tenant document in this repo**, and never paste a secret into a prompt.
- **Report to the director in note form.** Extremely concise, grammar sacrificed for concision —
  fragments over sentences, numbers over adjectives. Chat replies only: specs, evidence files and
  commit bodies stay full prose, because they are read months later by someone who was not here.
