# Evidence — Week 6 · The two core journeys

**Closed:** 2026-09-14 · **Planned window:** Sun 11 – Thu 15 Oct 2026 · **Started:** 13 Sep 2026,
the day week 5 closed. The planned dates are never rewritten; this gap is the measurement. The
project leaves week 6 roughly **four calendar weeks ahead of its plan**, having spent two calendar
days on a week sized for five.

**This is not the week the roadmap decomposed.** The roadmap's week 6 is `src/policy/` and the
responsibility matrix. The director paused the rollout on 13 Sep to check the foundation was on its
way to the flows that matter and found it was not: nobody could create a building, and the upload
flow demanded a unit before it would accept a document. Both became this week. `src/policy/` and
everything behind it were displaced and renumbered with their **week numbers removed** — which week
each runs in is the director's, and the consequence for **M2** is flagged in
[roadmap.md](roadmap.md) § "What week 6 displaces" and still undecided.

**Demo kind, as declared: SOFTWARE.** Every lease put through this week was invented to look like a
real one, which was the point — the flow is proved against paper shaped like the real thing while F6
still gates the real thing. One exception, and it is the week's most valuable hour: 6.8 and 6.11 were
written against **one real project lease**, which entered as bytes and was never committed.

## What closed

Eleven slices, one session each, **fifteen PRs (#74–#88)**, tip `b6b8605`.

| Slice | What it left behind |
|---|---|
| 6.1 | `estate.write`; an admin creates a building — A11. The GET carries the permission |
| 6.2 | An apartment, its spaces, and the bays it implies — A13 |
| 6.3 | **A12** — a document finds its own place. The upload screen that asks for no unit |
| 6.4 | ת.ז. on the capture path; withheld by default; every disclosure writes `evidence.read_identifier`. ADR-0006 |
| 6.5 | Propose, confirm, write — A2. `party_national_id_key()`, the fold made callable |
| 6.6 | Two guards, and the ruling: **captured is governed; printed is the document** |
| 6.7 | The whole journey clicked on staging — the first real extraction in the project's life |
| 6.8 | The reader reads a scan. Line-aware text, one OCR decision point, 20 s → 90 s |
| 6.11 | The anchors meet a real form. Two tiers, `(?<![א-ת])`, and the annex ruled not patched |
| 6.9 | A12 gets a door in the rail, and four refusals that each offer the create |
| 6.10 | A dedupe names its anchor — a document is anchored to the place its `storage_uri` names |

**Sequence note:** 6.11 was created by 6.8's verify step and the director sequenced it **ahead of
6.9**, because it is the one defect that files a lease against a flat nobody chose. 6.10 was numbered
after 6.11 and ran last.

**At close:** **617** code + **60** policy + **41** hooks, **0 failed** (518 / 54 / 41 at week 5's
close — **+99 code, +6 policy**). 4 grep guards, 0 violations. `typecheck` · `lint` (184 files) ·
`test` · `test:policy` · `guards` green. `evals` 1/3 locally with no key, 3/3 in CI.

**Migrations:** `0027_party_national_id_key.sql` — one, and it creates a function, not a table. **28
tables, unchanged from week 5.** A week that added two flows, a permission, a ruling and four
refusals and changed the shape of nothing.

## The sentence that survived, a sixth time

*Every screen shows a state and a count and never a tenant's name.* **This was the week entitled to
lift it** — 6.4 put a ת.ז. on the capture path and 6.5 put a household's names on a confirm screen —
and 6.6 drew the boundary instead of lifting the rule: **four document-shaped screens may transcribe
a name; the console's own screens still may not.** The two write receipts came off that list when the
case was first run, because `partiesWritten` is a count and not a who.

The identifier half is asserted rather than asked: `IDENTIFIER_RUN` is boundary-anchored, and its own
test is the argument — 2,000 UUIDs, 2,000 sha256 digests, 200 base64 page images, **0** false hits.
An unanchored `\d{9}` fires on a hex digest about four times in five. Week 5 made that mistake and
6.5 made it again in a query; it is one constant now.

## The demo, as given

Given off **staging**, never a laptop, on the same URL as the last four weeks —
`https://dona-staging-r44j24yuaa-zf.a.run.app`.

**The walk (6.7), on `dona-staging-00078-rk4`:** building `נרקיס 45, כפר סבא` created from A11; flats
3, 7, 11 added from A13, each arriving with its implied parking and storage bay; four invented leases
filed from the no-unit screen, each resolved by the address printed on it. Estate half of staging:
**39 buildings, 1,572 units.** Extraction confidences as served — address 90%, apartment 91%, both
dates 96%, tenant name 92%, **ת.ז. 77%** — and zero `guarantor_id_number`, the correct result for
paper naming no guarantor. `evidence.read_identifier` grepped at both stances on a page staging
served: ADMIN 162 word boxes and 3 runs in raw HTML, OPERATOR **8 boxes, 0 runs, identifier absent**.

**The demo's sentence was demonstrated and is not visible.** "One party, two tenancies" is true in the
database and shown on no screen — there is no party route. The nearest observable proof is 6.5's
attach branch, `התאמה לפי ת.ז.: 1`, which is why L4 exists.

**The demo found four defects, and all four were closed the same day** — 14 Sep, four sessions:

| # | What the demo did | Slice |
|---|---|---|
| 1 | A real scan refused four times; a phone scanner's text layer outranked the real reader | 6.8 |
| 2 | The reader read a **party's** street as the property, through `רחוב` inside `מרחוב` — 302, filed against a flat nobody chose | 6.11 |
| 3 | Six posts through A1's unit-first screen and **none through A12** — the tab did not exist | 6.9 |
| 4 | One file filed twice; `ON CONFLICT (file_hash)` plus an unordered `LIMIT 1` put the sentence on the wrong apartment | 6.10 |

**Staging at close:** commit `b6b8605`, revision **`dona-staging-00083-rp9`**, deployed off CI on
merge as `deploy.yml` specifies, health verified at the close itself:

```
./infra/smoke.sh https://dona-staging-r44j24yuaa-zf.a.run.app
smoke ok — .../health → {"ok":true,"version":"b6b8605","db":"up"}
```

**`b6b8605` is the last commit that changed `src/`, and it is the number this week is measured at.**
Merging this file redeployed staging as `0a1e05b` / `dona-staging-00084-g97`, smoke green — a
docs-only revision serving byte-identical application code. Every week close does this to itself,
which is why the code tip is the figure recorded and the close deploy is the footnote.

**Staging keeps the walk's rows deliberately.** A cleaned staging means demoing an empty console.

## What this week says to the client, and what it must not imply

The system now takes a building, an apartment and a lease with nobody typing a unit number, reads the
address off the paper, finds the flat, pulls the dates, the names and the ת.ז., and proposes a
tenancy. **Where the paper does not say plainly, it refuses and says which of four reasons** — and
one of those refusals is an annex it has ruled it will not read rather than guess at. That refusal is
the week's real product: a confident wrong anchor is the dangerous failure and a refusal is the safe
one, written into `SPEC-evidence.md` twice, at 6.11 and again at 6.10.

**How well it reads *their* leases is still not known and must not be implied.** One real form is one
form. The second needs the corpus, which needs F6.

## Carried forward, each with an owner

- **Nothing can move a document's anchor** — 6.10's ruling stated out loud. A document filed against
  the wrong flat stays there; the operator is told which and can open it. **The day something needs
  it is a slice, not an edit**, and the director places it.
- **`cap.test.ts` deletes another suite's rows.** Two suites, one test bucket, `node --test`
  concurrent. Seen twice in one session and **both passed on a re-run, which is the problem**. A
  test-harness slice, and small.
- **The rail's other six destinations are ungated.** 6.9 gated the seventh. Whether the rail hides
  what a role cannot reach or shows everything and lets the route refuse is **a ruling and the
  director's**.
- **A document's *tenancy* link is stable but arbitrary.** 6.10 ruled the place; the letting is a
  different question and A3 is where it is asked.
- **The 5.6 clock-end click is not a click.** 6.7 proved no route writes `status: 'ACTIVE'` — A5 is a
  flow with no screen. Re-owned by whichever slice gives A5 a screen, not carried forward again.
- **`.form-grid` / `.form-row` / `.hint` / `.form-actions` are two files each.** Carried 6.9 → 6.10
  and not tripped a second time. A third occurrence moves them to `tokens.css`. Rides into week 7.
- **The bash guard reads the command that is typed, not what it runs.** Bit for the first time at 6.7,
  in the other direction. Both too broad and too narrow, which is the argument for deciding it.
- **`.env` still points at the staging OCR processor** (`.env.bak-6.8` is the backup). Every local
  upload spends a Document AI call until it is removed.
- **6.5's `extracted_field` residue in the developer database.** The promotion guard refuses both the
  delete and the unstamp. Unchanged, still the director's.
- **Director's, unchanged:** does week 6 displacing `src/policy/` move **M2**? The three success
  numbers, the open M1 box, blocking M3. Whether the published Data Model's `Document` card is
  republished. **F6 — four questions, not three acts**, still blocking tier 2 and sharper after 6.4:
  the extractor now returns an identifier, so the DPA covers a category it did not before.
- **Walk [fuses.md](fuses.md)**, and **ask F1 on 18 Sep**.
