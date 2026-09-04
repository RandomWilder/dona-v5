# The documents

Four published Claude artifacts, one field-level workbook, and the reasoning behind them. This file
is the register: what each document is, which one wins when they disagree, and how to change one
without leaving the repo and the published artifact out of step.

## Read these first

1. **[../HANDOFF.md](../HANDOFF.md)** — settled decisions *with their reasoning*, so they don't get
   relitigated. Read it before proposing anything.
2. **[from-v3.md](from-v3.md)** — what v5 inherits from the v3 codebase and what it must not. Read it
   before writing application code: some of that work already exists, and one external dependency on
   the critical path has been running since August.
3. **[pipeline.md](pipeline.md)** — how this system gets built. One developer directing agents, with
   the process doing the reviewing.

## The four

The `docs/` files are the **exact sources** the artifacts were published from — edit the local file,
then republish it to the same URL with the `Artifact` tool (pass `url` so it updates in place rather
than creating a new one).

| Document | Local source | Published |
|---|---|---|
| **Data Model** | [data-model.html](data-model.html) | https://claude.ai/code/artifact/3212edef-b3ca-4046-a03d-0de9eaf4afc7 |
| **Platform Brief** | [platform-brief.html](platform-brief.html) | https://claude.ai/code/artifact/43ffdae6-7764-4224-ac71-8b49f13179a4 |
| **Rollout Cadence** — *Sixteen Demos to Pilot* | [rollout-cadence.html](rollout-cadence.html) | https://claude.ai/code/artifact/e925452e-7916-4ce7-8ebd-294f5b323fd2 |
| **Stack Map** — vendors, costs, lock-in | [stack-map.html](stack-map.html) | https://claude.ai/code/artifact/21f24a10-24fc-4908-8d71-3d6a76270337 |

These four URLs are new as of 3 Sep 2026. The **pre-cleanup originals were not modified** and are
still live at their own URLs — see [../archive/2026-09-03-pre-cleanup/README.md](../archive/2026-09-03-pre-cleanup/README.md).

Also published, not stored locally: **Handoff (HTML)** —
https://claude.ai/code/artifact/328f8a74-b426-4a0e-bb74-2831e098f144 — now behind
[../HANDOFF.md](../HANDOFF.md); republish it before showing it to anyone.

**As of 3 Sep 2026 all four local sources are byte-identical to what is published.** If you edit one,
republish it. If you suspect drift, recover the live version with `Artifact action:"read"` and diff
before editing.

The HTML sources are artifact bodies — no `<!doctype>`, `<html>`, `<head>` or `<body>` tags, by
design. The publish step wraps them. Don't add them.

## Which document wins

The first three were reconciled deliberately on 2 Sep 2026. Preserve the hierarchy:

- **Data Model** is the authority on *what the system is* — entities, states, policy, isolation.
  Everything else follows it, `SPEC.md` included.
- **Rollout Cadence** is the authority on *schedule* — sixteen weeks, four monthly gates M1–M4, a demo
  every Thursday. Brief §05 is its four-phase summary and says so.
- **Platform Brief** is the client-facing argument. It defers to both above.
- **Stack Map** is a reference, not an authority — vendors, unit costs at pilot and at scale, lock-in
  and exit cost, and the decisions still needed from the client. It carries no schedule of its own, so
  it was not part of the reconciliation and did not need to be. Costs are from published pricing and
  are marked *verify at contract* — estimates, not quotes.

Sequence facts that must stay consistent everywhere: **16 weeks total · pilot live at week 12 · M3 is
the go/no-go · M4 is the scale decision.**

## The working model — `model/`

Not an artifact. The **building/unit entity model** as a spreadsheet, and the Python that builds it.
See [model/README.md](model/README.md) before touching either file.

| File | What it is |
|---|---|
| [dona-building-unit-model-draft.xlsx](model/dona-building-unit-model-draft.xlsx) | **English — the working copy.** "The excel file" means this one. |
| [dona-building-unit-model-draft-HE.xlsx](model/dona-building-unit-model-draft-HE.xlsx) | Hebrew, RTL. **Frozen at an older state** for stakeholder presentations — update only when asked. |
| `build_model.py` / `build_model_he.py` | The generators. **These are the source; the .xlsx are build outputs.** Edit the script, re-run it, never hand-edit the workbook. |

Six sheets: READ ME · ENTITIES (E1–E14) · RELATIONSHIPS (R1–R16) · FIELDS · ADMIN VIEWS · DECISIONS.
It sits *under* the Data Model — the Data Model says what the system is, this says which columns to
create — and it is where the schema work continues. **Relationship numbers are append-only:** R1–R14
must keep their numbers, because the frozen Hebrew file cites them. Append, don't insert. Entity
numbers may shift.

## Writing them

- The documents are dense, argued, and written to be shown to a client — match that register. Don't
  pad, don't hedge, don't restate.
- Changes to the Data Model, Brief or Cadence are checked against the other two. Three documents, one
  vocabulary: the state names, entity names and week numbers mean the same thing everywhere.
- Say what was deliberately *not* changed and why. Silent scope changes are the failure mode here —
  but say it **in chat, or in [../HANDOFF.md](../HANDOFF.md)**, never in the document itself.
- **The published documents state what the system is, not what it used to be.** No "Rev B changed X",
  no "the earlier draft got this wrong", no `NEW` flags, no diff tables, no rejected alternatives. A
  reader of these documents has not seen a previous version and never will. History, rejected
  directions and the reasoning behind a settled call live in [../HANDOFF.md](../HANDOFF.md) and
  [from-v3.md](from-v3.md), which exist for exactly that.
- A design constraint that reads as a prohibition — no `current_tenant` column, responsibility is
  never binary, a Drive path is never a key — is **not** history and stays. State it as the rule the
  system follows, with the consequence of breaking it. Never as a correction of someone's draft.
