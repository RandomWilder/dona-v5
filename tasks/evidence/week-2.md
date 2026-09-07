# Evidence — Week 2 close · All 1,500 units, from a register

**Closed:** 2026-09-07 · **Planned window:** Sun 13 – Thu 17 Sep 2026 · **Demo kind declared Sunday
6 Sep: Real data. Re-declared the same Sunday: Software.**

> The week's acceptance bar is the demo: the same URL as week 1, now with the portfolio behind it —
> units, tenancies, parties, searchable, at 1,500-unit volume, with the query timings that volume
> exists to produce.

## What closed

Five slices, 2.1 – 2.4 and 2.6, each with its own evidence file under this directory. All merged to
`main`; working tree clean at `e6c4375`.

| | |
|---|---|
| Slices planned | 6 |
| Slices closed | **5** — 2.5 moved out of the week on 6 Sep, before it started, not cut at the end |
| Evidence files | 5, plus this one |
| Elapsed | 6 – 7 Sep 2026, two calendar days against four planned build days |
| Tests on every merge | **346**, up from 326 — plus 30 policy cases and 3 grep guards, both gates required |

**The chain was 2.1 → 2.2 → 2.3 → 2.4 → 2.5 → 2.6 and it became 2.1 → 2.2 → 2.3 → 2.4 → 2.6.** The
cut line at the bottom of [todo.md](todo.md) — the occupancy chip, then search — was never reached.

## The one thing that changed about the week, and when

**The demo kind was re-declared on Sunday 6 Sep, in advance, not on Wednesday and not on Thursday.**
The roadmap declared week 2 *Real data*, which depended on F3 (Priority read-only keys). The cause of
the change is **not** that F3 stayed unlit. It is that the project adopted a method the same day in
which the real register belongs to a later step — concept → example documents → schema review → real
documents preparing for pilot ([SPEC-flows.md](../SPEC-flows.md),
[pipeline.md](../docs/pipeline.md) §1.5). The register is step 4. **2.5 moved there with it and F3
left month one's critical path.**

A demo kind changed in advance is a plan; one changed on Thursday is an excuse
([rollout-cadence.html](../docs/rollout-cadence.html)). This one was changed with four planned build
days still on the clock and the reason written into [todo.md](todo.md) before any code was affected.

**Volume and realness are different facts.** 2.6's two index decisions needed row count, not
provenance; deferring them to the pilot would have pushed a measurement into month two on no
reasoning at all. So 2.6 took its 1,500 units from a **generated** register through the real
importer, and the reject count — the one number that is a fact about the client's file — stayed with
2.5.

## The demo, as given

Presented **7 Sep 2026**, six days ahead of the planned Thursday 17 Sep, for the same reason week 1
was early: the week's slices were closed and holding a finished build adds nothing to show. Given off
**staging**, never a laptop, on the same URL as week 1 —
`https://dona-staging-r44j24yuaa-zf.a.run.app` — revision `dona-staging-00031` at `e6c4375`, health
checked immediately before: `{"ok":true,"version":"e6c4375","db":"up"}`.

What the room saw: five screens, an index and four under it. The buildings list across five cities, a
building's unit grid with the occupancy chip derived on every load, search, and the leases-ending
screen. 1,500 units, 37 buildings, 2,908 register rows imported with **zero rejects**, and the same
import re-run creating nothing.

**Said in these words, because it is the honest sentence and it was written before the demo rather
than improvised in the room:** every address, every unit number and every name on those screens is
ours and invented, and the file they came from is the template the data request is derived from. What
is real is the path — the importer, the schema, the isolation join, the deploy — and the timings.

**Stakeholder response:** positive on progress; they are waiting to see more of the system as it
rolls out. **Comments were overall about the UI.** Nothing raised was a correctness, isolation or
data question, and nothing raised blocks week 3. This is the expected shape of feedback on screens
built to prove queries rather than to be designed, and it is carried below rather than acted on now —
the UI pass is not week 3's, and inventing one to answer applause would displace filing.

## The numbers, at the volume they were taken at

Local, 1,500 units, medians over repeated runs (`npm run measure:scale`, the instrument beside the
gate — it gates nothing):

```
search across the portfolio            2.35 ms    against a declared bar of one second
Q5 · leases ending within 60 days      one indexed query, 2 index pages, 0.032 – 0.043 ms
Q2 · the isolation join                GiST, chosen by the planner even with a btree present
occupancy chip, batched                 0.94 ms and 1 audit row for a 60-unit page
occupancy chip, one call per card      29.68 ms and 60 audit rows for the same page
register import, 2,908 rows            6.481 s first run · 5.989 s second, creating nothing
```

End to end on staging, browser to rendered page: search 0.17 – 0.24 s, buildings list 0.23 – 0.26 s,
Q5 0.21 – 0.29 s.

**Both deferred index questions were answered and they went opposite ways.**
`0010_scale_indexes.sql` adds `tenancy (end_date) WHERE status = 'ACTIVE'` and **does not** add the
btree on `party_contact (channel, value)` — three times faster in isolation, and never chosen by the
planner when the exclusion constraint's GiST index is also present, which makes it a write cost with
a comment. A rejected index is as much a result as an added one; it is reopened at week 12, where the
row count will be different. Full workings in [2.6.md](2.6.md).

## What volume found that review would not have

Recorded because it is the week's methodological result, not an incident log:

1. **A generated register in the development database turned three suites red** on
   `terms_profile_natural_key`. 2.4 namespaced its cities, its phone block and its identifiers, and
   then named its maintenance annexes what a real register will name them.
2. **A `40P01` deadlock flaked the required policy gate about one run in three** — three suites
   shared one phone number and two policy files shared another. Every suite now owns a number block.
3. **«בעוד 1 ימים»** reached staging: grammatical Hebrew needs a three-way count. Found on the
   deployed page, fixed, and now asserted from outside in `tests/ui/tokens.test.ts` so the plural form
   fails the build.
4. **A monitor reported the previous commit's deploy as this slice's** — 2.1's exact mistake, caught
   by the `version` stamp the smoke script asserts. The stamp is the control that works.

## Carried into week 3

1. **F2, F4, F5 and F7 remain unlit; F3 is no longer month one's dependency.**
   [fuses.md](fuses.md) is the register and this file does not duplicate it. **Week 3 no longer
   depends on F4** — intake is an administrator declaring a type and uploading a file (flow A1), not
   a crawl of someone else's Drive.
2. **F6's other half — three named acts** (execute OpenAI's DPA, confirm Google Cloud's is in force,
   publish the notice to data subjects). Blocks the tier-2 corpus and nothing in week 3.
3. **The notice-delivery question** — how the notice reaches a tenant. Owed before week 9 builds a
   step for it.
4. **Open question 6** — what document types the Drive folders actually contain. Was blocked on F4;
   now answered at step 4 with the corpus, and 3.0's catalogue is designed so a ninth type is a seed
   row rather than a migration.
5. **2.5 — import the real register.** Not cut. It sits at the pilot-preparation step of the method
   with F3, and it still owns the two facts only a real file can produce: the reject count, and
   whether Priority's export carries vacant apartments as rows at all.
6. **3.4 and A10 — Drive ingestion and the bulk review queue.** Deferred the same day and for the
   same reason. 3.6 was re-pointed to 3.3 so search has something to find without any bulk path.
7. **The register-derived handover dates are placeholders and are visible.** Every building card on
   `/estate` shows a מסירה date that is one of its leases' start dates, because the last row of a
   building wins the upsert. Left uncorrected on purpose — **3.5 owns it**, with the handover
   protocol that brings the real fact. A better-shaped guess in week 2 is work week 3 deletes.
8. **The UI comments from the demo.** Real, unblocking, and unowned by any slice today. They are
   parked deliberately: the screens exist to prove queries, and month two's obligations strip and
   compliance tab are the first work with a genuine design surface. Raised again at the **M1
   checkpoint**, where the decision is whether a design pass earns a slice of its own.
9. **`environment: production` has no protection rules.** A `v*` tag is the only thing between a
   commit and prod — correct while prod is stopped, wrong from week 12, where
   [roadmap.md](roadmap.md) owns it.
10. **The demo-day discrepancy in the published documents** — [pipeline.md](../docs/pipeline.md) §7
    says Monday, the cadence and [roadmap.md](roadmap.md) say Sunday, and Sunday is right. Carried
    from week 1; no week-2 slice touched `docs/`, so it is still one line owed to whichever week-3
    slice next does, with the artifact republished alongside it.

## The schedule from here

Week 3 starts **7 Sep 2026**, the day week 2 closed, rather than on the planned 20 Sep. **The dates
in [roadmap.md](roadmap.md) are not rewritten.** The project is running roughly ten calendar days
ahead of the planned calendar after two weeks; that gap is a measurement, and it is the reason the
plan's dates stay where they are.
