# Evidence — Week 1 close · A URL, a schema, and a filed application

**Closed:** 2026-09-06 · **Planned window:** Sun 6 – Thu 10 Sep 2026 · **Demo kind:** Software

> The week's acceptance bar is the demo, not the slice count: a live link stakeholders open on their
> own phones, showing Shoham's building and its units, plus the timestamped Meta submission.

## What closed

Twelve slices, 1.1 – 1.12, each with its own evidence file under this directory. All merged to
`main`; working tree clean at `c01b166`.

| | |
|---|---|
| Slices planned | 12 |
| Slices closed | **12** — none cut, the cut line was never exercised |
| Evidence files | 12, plus this one |
| Elapsed | 4 – 6 Sep 2026, three calendar days against four planned build days |

## The demo, as presented

Presented **6 Sep 2026**, ahead of the planned Thursday, because the week's work was finished and
holding a completed build for four days would have delayed week 2 without adding anything to show.
The cadence's demo *day* is unchanged for every later week — this is a week-1 exception recorded here
rather than a renegotiation of the schedule.

**The deck:** <https://claude.ai/code/artifact/5d5e9967-2ca4-43e6-a4d0-77c8842f8896> — three slides,
the third of them asks, exactly as [pipeline.md](../../docs/pipeline.md) §7 specifies. It is a
published Claude artifact, not a file in this repository, because it is a client-facing document with
a burn date on it.

**Demoed off staging**, never a laptop, on the same URL the later weeks use:
`https://dona-staging-r44j24yuaa-zf.a.run.app/estate`, revision `00014-vtx`. Health checked
immediately before presenting: `{"ok":true,"version":"c01b166","db":"up"}`.

What the room saw, and what was said in those words: **nothing in the fixture is real, by decision.**
The building is רקפת 12, שוהם, and the 72 units under it are ours. Functionality is established
against a fixture chosen for coverage; real data is applied to it afterwards, behind the controls
that landed at 1.12 (`tasks/plan.md` **R4**, [pipeline.md](../../docs/pipeline.md) §1 principle 5).

## The numbers on the second slide

```
tests on every merge                 238    gate + evals, both required, admin-enforced
deploy to staging                  < 2 min   migrations run before the revision serves
production round trip            3 releases  deployed, rolled back, rolled forward, 100% each step
isolation policy cases                14     written red before the tables existed
build-blocking grep guards             3     pii columns, and two shortcuts around the join
indexed Hebrew clauses                71     six tier-1 specimens
tier-2 documents in the system         0     deliberately — the controls exist, the data does not
```

## Asks put to the room

F3 Priority read-only keys · F4 Drive access · F6's three acts (execute OpenAI's DPA, confirm Google
Cloud's is in force, publish the notice to data subjects) · F2 the WhatsApp number under the company
entity · and agreement on the three success numbers with their two stop conditions.

**F3 is the one with a date on it.** Slices 2.1 – 2.4 do not need it; **2.5 and 2.6 do**, and week 2's
declared demo kind is *Real data*. Unlit, week 2 ends with the schema and the importer proved against
a fixture and the register still outside the system.

## Carried into week 2

1. **F3, F4, F2, F5, F7 remain unlit** — walked at the demo, on the asks slide, owned by the director.
   Recorded in [fuses.md](../fuses.md), which is the register; this file does not duplicate it.
2. **F6's other half** — three named acts, blocking the tier-2 corpus and nothing in week 2.
3. **The notice-delivery question** — *how* the notice reaches a tenant. Answer needed before week 9
   builds a step for it, not during it.
4. **Open question 6** — what document types the Drive folders actually contain. Blocked on F4.
5. **`GET /` is still a 302 to `/estate`** — becomes an index the week a second screen exists, which
   is week 2. Carried at 1.11 and already written into the week-2 preamble in
   [roadmap.md](../roadmap.md).
6. **`environment: production` has no protection rules.** A `v*` tag is currently the only thing
   between a commit and prod — correct while prod is empty and stopped, wrong from week 12. Carried
   at 1.10 and owned there.
7. **The demo-day discrepancy in the published documents**: [pipeline.md](../../docs/pipeline.md) §7
   says the demo kind is declared **Monday**; [roadmap.md](../roadmap.md) and the cadence say
   **Sunday**, and the working week is Sun–Thu. Sunday is right. One line, in whichever week-2 slice
   next touches `docs/`, and the artifact republished with it.

## The schedule from here

Week 2 starts **6 Sep 2026**, the day week 1 closed, rather than on the planned 13 Sep. **The dates
in [roadmap.md](../roadmap.md) are not rewritten** — they are the plan, and the gap between them and
the evidence files' dates is the measurement of how the project actually ran. Every evidence file
carries the date its slice closed; the roadmap carries the date it was promised. Neither moves to
meet the other.
