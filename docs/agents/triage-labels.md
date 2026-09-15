# Triage Labels

The skills speak in terms of five canonical triage roles. This file maps those roles to the actual
label strings used in this repo's issue tracker.

| Label in mattpocock/skills | Label in our tracker | Meaning                                  |
| -------------------------- | -------------------- | ---------------------------------------- |
| `needs-triage`             | `needs-triage`       | Maintainer needs to evaluate this issue  |
| `needs-info`               | `needs-info`         | Waiting on reporter for more information |
| `ready-for-agent`          | `ready-for-agent`    | Fully specified, ready for an AFK agent  |
| `ready-for-human`          | `ready-for-human`    | Requires human implementation            |
| `wontfix`                  | `wontfix`            | Will not be actioned                     |

The defaults are kept as-is: this repo had no label vocabulary of its own to collide with. A label is
a string in an issue file's `labels` list — see `docs/agents/issue-tracker.md`. There is no label
registry to create one in, so the five above are the whole vocabulary; adding a sixth means adding a
row here first.

Edit the right-hand column to match whatever vocabulary you actually use.
