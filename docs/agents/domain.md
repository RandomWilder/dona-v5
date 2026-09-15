# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the
codebase.

## Layout: single-context, with an existing ADR home

This repo is **single-context**: one `CONTEXT.md` at the root, one ADR directory.

**The ADR directory is `docs/decisions/`, not `docs/adr/`.** It has held one file per decision since
week 1 (`ADR-NNNN-<slug>.md`, with a status table in `docs/decisions/README.md`), and six decisions
already live there. Wherever a skill says `docs/adr/`, read and write `docs/decisions/` instead, and
follow the naming and the register that file already sets out. A second ADR home would split the
record, which is the one thing an ADR exists to prevent.

## Before exploring, read these

- **`CONTEXT.md`** at the repo root — the glossary. One screen. It defines the terms; it does not
  define behaviour.
- **`docs/decisions/`** — read the ADRs that touch the area you're about to work in.
- **`SPEC.md`, then `SPEC-<module>.md`** — the behaviour contract for the module you're touching.
  `CONTEXT.md` names the nouns; the SPEC files say what the system does with them, and they are
  normative where the two ever disagree. Read the module's SPEC before its code, and update it in
  the same change when behaviour changes.

If a file doesn't exist, **proceed silently**. Don't flag its absence; don't suggest creating it
upfront. `/domain-modeling` (reached via `/grill-with-docs` and `/improve-codebase-architecture`)
creates them lazily when terms or decisions actually get resolved.

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a
test name), use the term as defined in `CONTEXT.md`. Don't drift to synonyms the glossary explicitly
avoids — this project is bilingual and several of its nouns have a Hebrew form that is the term of
record.

If the concept you need isn't in the glossary yet, that's a signal: either you're inventing language
the project doesn't use (reconsider) or there's a real gap (note it for `/domain-modeling`).

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding:

> _Contradicts ADR-0006 (the extractor may read a declared identifier), but worth reopening because…_
