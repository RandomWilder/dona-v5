# Claude Code notes

Read [AGENTS.md](AGENTS.md) — it is the constitution for this repo: commands, architecture, style,
boundaries. Then [SPEC.md](SPEC.md) for the foundation rules, and `SPEC-<module>.md` before touching
a module.

Claude-specific additions:

- **One slice per session.** Take it from [tasks/todo.md](tasks/todo.md), where it is already written
  with acceptance criteria, and finish with its **Verify** step — never self-certify. Close it with a
  `tasks/evidence/<slice>.md` file recording what was proved, with the numbers.
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
