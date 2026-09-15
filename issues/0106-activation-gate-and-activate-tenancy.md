---
number: 106
title: "The activation gate, and a tenancy a person activates"
status: open
labels: [ready-for-agent]
assignee:
blocked_by: []
parent: 99
created: 2026-09-15
closed:
---

## Parent

#99 — Admin document-upload flow: one reading, approve, confirm, activate.

## What to build

Nothing in this system activates a tenancy. Draft-to-active is specified and unbuilt, and the second
mandatory document — the handover protocol (פרוטוקול מסירה) — is a concept with no enforcement behind
it. This ticket builds both.

A tenancy becomes active only when a person invokes a command that says so. The command refuses
unless four things hold: the tenancy holds an approved lease; it holds an approved handover protocol;
today is not before the lease's start date; and today is not after its end date. The lease is the
only document that defines when a tenancy starts and ends.

The gate returns **all four facts, not only the failures**, so that a screen, a queue and a test all
read the same answer and a dark button can name what was checked rather than merely being dark. A
fully-approved tenancy whose lease starts in the future is not a failure state — it is a draft whose
gate reports the date it becomes activatable.

The required set is a single stated definition, written so that adding a third required document
later is one deliberate change rather than a hunt:

```
REQUIRED_FOR_ACTIVATION = ['lease', 'handover_protocol']
```

Nothing activates on a clock. Expiry remains clock-driven as it is today, and an expired tenancy is
ended rather than reopened — it never quietly acquires a new member. A document that lapses after
activation raises a flag and never moves the tenancy's status, so the status keeps meaning what it
says while the problem stays visible.

The handover protocol is per letting: it records that the tenant accepted the flat after inspecting
it. Its document type is seeded here.

The gate needs to know what documents a tenancy holds and whether they are approved — evidence-side
facts. Those readers are **injected at the composition root**, in the same shape the incomplete-tenancy
query already uses, so the tenancy module does not import the evidence module and the boundary
survives a feature spanning both.

Activation is a new deterministic constraint that nobody may decide by judgement, so it gets a policy
case written **red first**. The case builds its own rows in a rolled-back transaction and asserts each
refusal reason independently — no approved lease, no approved handover protocol, today before the
start date, today after the end date — plus the passing case. It asserts against the required-set
constant itself, never a second copy of the list.

Activation is recorded as an event: who made this tenancy live, and when.

## Acceptance criteria

- [ ] The handover protocol document type is seeded, anchored per letting
- [ ] A command activates a tenancy only when invoked by a person; no clock activates anything
- [ ] Activation refuses without an approved lease, and names that reason
- [ ] Activation refuses without an approved handover protocol, and names that reason
- [ ] Activation refuses before the lease's start date and after its end date, each with its own reason
- [ ] The gate returns every requirement it checked with its outcome, passes included
- [ ] A fully-approved future tenancy reports the date it becomes activatable
- [ ] The required set is one stated constant, and adding a document to it is a one-line change
- [ ] Activation writes an event recording who activated and when
- [ ] The tenancy module imports no evidence module; the readers are injected at the composition root
- [ ] A policy case, written red first, asserts each refusal reason independently and the passing case, importing the required-set constant
- [ ] An expired tenancy is ended and admits no new member; a document lapsing after activation raises a flag without changing status
- [ ] Tenancy and flows specs are edited in the same change

## Blocked by

None (can start immediately).
