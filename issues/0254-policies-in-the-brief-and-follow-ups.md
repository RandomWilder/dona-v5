---
number: 254
title: Policy documents in the brief and the follow-ups, as of a date
status: closed
labels: [ready-for-agent]
assignee:
blocked_by: [251, 253]
parent: 247
created: 2026-10-16
closed: 2026-10-18
---

## Parent

#247 — The call copilot and the Policy library.

## What to build

The brief and the follow-ups also read the Policy library.

**The bound and the date**
- A Policy bound is added to every Call thread's bound.
- Search returns only the versions in force on the as-of date, using the #251 predicate:
  - the brief uses today;
  - a follow-up may name another date ("what applied when the lease was signed?"), and that date is
    stated in the answer.

**Citations**
- Each Policy citation is labelled with its section and its version's dates. The office sees
  whether a passage is state law or company policy, and from when.

**Retrieval**
- Retrieval is capped per section, so neither section drowns out the lease or the other section.
- There is no ranking between state law and company policy. Any ranking would be a Policy rule, which
  is out of scope (ADR-0017).

**What it never does**
- The model never decides from a policy: responsibility, thresholds and emergencies stay with
  Policy rules (foundation rule 3).

## Acceptance criteria

- [x] SPEC-evidence describes the Policy bound, as-of search and the per-section cap.
- [x] A superseded version is never cited for a date after its effective-to. A test at the boundary
      date proves it.
- [x] Citations show the section and the version dates on the call page.
- [x] The full golden set runs, with new cases:
  - [x] a brief citing a law and a lease clause together;
  - [x] an as-of follow-up citing the older version;
  - [x] a question answered by neither, which returns the refusal.
- [x] Clicked on `:3000` with specimen policies in both sections.

## Comment — 2026-10-18

The library is on every call thread. Search uses the in-force predicate, eight passages per section, state law then company policy. On 2026-04-01 the ended version is absent and the new one is returned; the day before, the reverse. The call page labels דין המדינה and נוהל חברה with the version dates. A follow-up that names 2026-03-20 cited Specimen policy from 15.03.2026, replaced 01.10.2026, and stated 20.03.2026. The three new golden cases passed. One older building-protocol case missed מועד המסירה again; the brief prompt is not that turn. Clicked on call 01a14a97 after a dev restart: refresh cited חוק בדק and חוק שכירות, both דין המדינה from 01.01.2025.

## Blocked by

- #251 — closed 2026-10-17
- #253 — closed 2026-10-18
