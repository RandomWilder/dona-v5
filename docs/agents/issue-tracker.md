# Issue tracker: local Markdown files

Issues and specs for this repo live as Markdown files in `issues/` at the repo root. They are
committed, reviewed and versioned like everything else here.

**Why not GitHub Issues.** The spec is the prompt, and this project's standing rule is that
requirements live in files rather than in a chat description or a web UI. A tracker that is a
directory of Markdown is readable without a network call, greppable by the same tools that read the
code, diffable in the pull request that implements it, and present in the working tree an agent is
already looking at. The cost is that there is no issue UI and no notifications; for a single-developer
repo that was never the part doing the work.

## Layout

```
issues/
├── 0099-admin-document-upload-flow.md
├── 0100-some-other-ticket.md
└── ...
```

One file per issue. The filename is the zero-padded number, a hyphen, and a short slug. Four digits so
that `ls` sorts correctly, and the number space continues from the GitHub issues that preceded this
file so that nothing already written has to be renumbered.

**The next number is one above the highest filename in `issues/`.** There is no counter file to drift.

## File format

YAML frontmatter, then the body, then any comments.

```markdown
---
number: 99
title: Admin document-upload flow: one reading, approve, confirm, activate
status: open
labels: [ready-for-agent]
assignee:
blocked_by: []
parent:
created: 2026-09-15
closed:
---

<the body — for a spec, the /to-spec template>

## Comment — 2026-09-16

<comment text>
```

Field by field:

- `number` — the integer, matching the filename. Restated inside the file so a pasted excerpt still
  identifies itself.
- `title` — one line. Quote it if it contains a colon followed by a space.
- `status` — `open` or `closed`. Nothing else.
- `labels` — a list, from `docs/agents/triage-labels.md`.
- `assignee` — a name, or empty. Empty means unclaimed.
- `blocked_by` — a list of issue numbers. Empty list means unblocked.
- `parent` — the number of a wayfinder map, or empty.
- `created` / `closed` — `YYYY-MM-DD`. `closed` is empty while the issue is open.

Comments are `## Comment — <date>` sections appended to the end of the body, oldest first. A comment
is never edited once written; a correction is a new comment. This is the same rule the rest of the
system follows for a correction — a new row, never an edit.

## Conventions

- **Create an issue**: write a new file at `issues/<NNNN>-<slug>.md` with complete frontmatter. Find
  the next number with `ls issues/`. Use the Write tool, not a shell heredoc.
- **Read an issue**: read the file. The comments are in it.
- **List issues**: `grep -l 'status: open' issues/*.md`, or `grep -H 'status:\|labels:\|title:'
  issues/*.md` for a table. To filter by label:
  `grep -l 'ready-for-agent' $(grep -l 'status: open' issues/*.md)`.
- **Comment**: append a `## Comment — <date>` section to the file.
- **Apply / remove labels**: edit the `labels` list in the frontmatter.
- **Assign**: set `assignee`.
- **Close**: set `status: closed`, set `closed:` to today's date, and append a closing comment saying
  why. **The file stays where it is.** Moving closed issues into a subdirectory breaks every link
  that ever pointed at them, and the frontmatter already answers the only question a move would.

Issue numbers are written `#99` in prose, as before. A reference resolves to the file in `issues/`
whose `number` matches.

## Commits

An issue file is committed like any other change. Creating or closing an issue may ride along in the
commit that does the work it describes, or stand alone — both are fine, and standing alone is
clearer when the issue is a spec written before any code exists.

## Pull requests as a triage surface

**PRs as a request surface: no.** _(Set to `yes` if this repo treats external PRs as feature requests;
`/triage` reads this flag.)_

This is a single-developer repo with no external contributors, so every open PR is in-flight work
rather than an incoming request. Leave the flag off until that changes.

When set to `yes`, PRs run through the same labels and states as issues, using `gh pr`:

- **Read a PR**: `gh pr view <number> --comments` and `gh pr diff <number>` for the diff.
- **List external PRs for triage**: `gh pr list --state open --json number,title,body,labels,author,authorAssociation,comments` then keep only `authorAssociation` of `CONTRIBUTOR`, `FIRST_TIME_CONTRIBUTOR`, or `NONE` (drop `OWNER`/`MEMBER`/`COLLABORATOR`).
- **Comment / close**: `gh pr comment`, `gh pr close`. Triage state for a PR lives on the PR, not in
  `issues/` — a PR is not an issue file.

Pull requests remain on GitHub. Only issues moved.

## When a skill says "publish to the issue tracker"

Write a new file in `issues/`.

## When a skill says "fetch the relevant ticket"

Read `issues/<NNNN>-*.md`.

## Wayfinding operations

Used by `/wayfinder`. The **map** is a single issue file with **child** issue files pointing at it.

- **Map**: an issue file labelled `wayfinder:map`, holding the Notes / Decisions-so-far / Fog body.
  The map body also carries a task list of its children, in map order — **that order is the
  frontier's tie-break, so it is the map's and not the filesystem's.**
- **Child ticket**: an ordinary issue file with `parent: <map number>` in its frontmatter and a
  `wayfinder:<type>` label (`research` / `prototype` / `grilling` / `task`). Add it to the map's task
  list when it is created. Once claimed, set `assignee`.
- **Blocking**: `blocked_by: [12, 15]` in the child's frontmatter. A ticket is unblocked when every
  issue it names has `status: closed`. This replaces GitHub's native issue dependencies; the list is
  the canonical record and there is no second representation to keep in step.
- **Frontier query**: take the map's children that are `status: open`, drop any with a non-empty
  `assignee` and any whose `blocked_by` names a still-open issue; first in map order wins.
- **Claim**: set `assignee` — the session's first write.
- **Resolve**: append the answer as a comment, set `status: closed` and `closed:`, then append a
  pointer to the map's Decisions-so-far. **The pointer is a relative link to the child file**, not a
  gist — the context now lives in the repo, which is the whole reason for this format.
