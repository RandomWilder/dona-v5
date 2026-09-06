# ADR-0004 — Personal data reaches the model provider, and that is a decision rather than an accident

- **Date:** 2026-09-04 · **re-adopted from v3**, where it was raised 2026-09-01 · **status changed 2026-09-06**
- **Status:** **accepted** — all four decisions bind. Decision 3's *deliverable* is outstanding and
  is tracked as fuse **F6**, which is where an outstanding deliverable belongs; it is not a reason to
  leave the decision unadopted
- **Context slice:** 1.1 — re-adopted by reference, not re-argued
- **Original:** `docs/decisions/ADR-0004-personal-data-reaches-the-model-provider.md` in `RandomWilder/dona-v3`

## The decision

1. **No spec ever claims that personal data does not reach the model provider.** v3's spec claimed it
   in two places; measured on a real contract, it was false — parties' names, addresses and 9-digit
   ID numbers reappear inside numbered annex clauses, which are indexed, embedded and therefore sent.
   19 of 211 indexed chunks mentioned ת״ז. Excluding the cover page removes the densest *chunk*, not
   the *category*.
2. **Redaction at the provider boundary is the mitigation**, and it is a slice rather than a patch: an
   identifier-shaped run is masked in the copy sent to the embedder and the extractor, and never in the
   copy stored. It needs its own golden cases — masking must not change which clause answers a question.
3. **The legal basis is owed and it is the owner's to obtain**, not an engineer's to assert: a data
   processing agreement with each provider, and disclosure to data subjects.
4. **Every third party that sees tenant text is named in `SPEC.md` before it is called**, not
   discovered later.

## Why it carries into v5, and why it matters more here

The three things the v3 question bundled separate the same way. **The documentation defect is not
arguable** — this repo's premise is that the spec is the prompt, and a spec asserting an absolute
privacy property that does not hold is worse than one that says nothing, because every later reader
designs on it. **Sending the data is probably lawful and is not self-evidently fine**: the business
API is a processor relationship rather than publication, but what makes it lawful is contractual and
disclosed, not technical. Israeli law treats a national identifier as high-sensitivity, the 2024
amendment tightened obligations materially, and cross-border transfer has its own rules. "A closed
system" is the part that does not survive contact: the key is scoped, but the *data* leaves our
infrastructure.

Three things make v5's exposure larger than v3's, which is why this ADR was re-adopted rather than
closed:

- **The corpus is 1,500 units, not one contract.** v3's real document belonged to a party who was not
  a pilot tenant. v5's are Dona Dom's actual tenants, and they arrive in **week 1** (R4).
- **OCR hands over whole page images** (ADR-0002), including the front page that clause-reference
  selection deliberately withheld. That is a step change in what leaves, not another line.
- **Week 10 puts a tenant on the other end of a model call** — their own question plus their own
  lease. **Redaction must land before that.**

## What changes for v5

- **`SPEC.md` carries the rule from commit one**, in Security defaults, rather than acquiring it after
  a measurement contradicted it.
- **`national_id` is structurally out of reach**, not merely unlikely to be sent: admin-only,
  unreachable by any agent tool, access-logged, and asserted by a policy case — a mechanism v3 had no
  equivalent of.
- **The real corpus never enters the repo** and lives in a dated bucket with a tested deletion path and
  a recorded removal date (slice 1.12), so the exposure has an end date from the day it starts.
- **The status was `proposed` until the DPA and the disclosure existed.** That was wrong and it was
  corrected on 6 Sep 2026 — see *Why the status moved*, below. The obligation did not go away; it moved
  to the register that tracks obligations.

## What slice 1.12 discharged, and what it did not

**Decision 4 is done.** [SPEC.md](../../SPEC.md), Security defaults, now carries the table of every
third party that sees text from this system — OpenAI, Google Cloud, Meta, Twilio, and **Anthropic,
development-time only**. That last row is the one nobody had written down: Claude Code reads this
repository as it is built, and the reason it never sees tenant text is not an assurance but a
mechanism — tier 2 never enters the repo, and `.gitignore`, the corpus bucket and the tier-1 tests
are what hold it there.

**Decision 3 is not.** The DPA with each processor and the disclosure to data subjects are the
owner's, they are **fuse F6** on [tasks/fuses.md](../../tasks/fuses.md), and they are owed **before
the tier-2 corpus lands** — which is why 1.12 built every control and deliberately did not take
delivery. It is still outstanding — but it is a deliverable on a fuse, not an unadopted decision;
the status moved to `accepted` on 6 Sep 2026 for the reason set out below, and F6 now names the
instrument for each processor.

**Decision 2 — redaction at the provider boundary — is untouched and still owed before week 10.**
Nothing in 1.12 sends personal data anywhere: the tier-1 corpus is authored text with no real person
in it, asserted by a test rather than promised.

## Why the status moved, 6 Sep 2026

`proposed` meant "nobody is bound by this yet", and that had stopped being true. Decisions 1, 2 and 4
were already being executed: `SPEC.md` carries the rule from commit one and names every third party,
`national_id` is structurally out of reach, the tier-1 corpus is asserted to contain no real person,
and redaction is scheduled before week 10. Only decision 3's deliverable was outstanding. Holding the
whole ADR at `proposed` on account of it made the status field useless — it hid that three of the four
decisions bind **today**, and it invited a later reader to treat the entire ADR as still arguable.

The rule this sets, and it applies to every ADR here: **a decision is `accepted` when it has been
taken and is being followed. An outstanding deliverable of an accepted decision belongs on
[tasks/fuses.md](../../tasks/fuses.md), not in a status field.** A fuse has an owner, a burn time and
a weekly walk; a status field has none of those, so parking an obligation there is how it gets lost.

Nothing about the obligation changed. What changed is where it is tracked, and how precisely: F6 now
names the instrument for each of the five processors, and the answer is that **only two of them block
the tier-2 corpus** — OpenAI's DPA, which is a form, and Google Cloud's, which is incorporated by
reference and needs confirming rather than signing. Meta's and Twilio's arrive with week 9's channel
work. Anthropic needs none, because Claude Code processes no tenant personal data — a mechanism with
tests behind it rather than an assurance, and the row changes before the data moves if it ever stops
being true.

## Open, and owed

- **The two DPAs and the notice.** Recorded on [tasks/fuses.md](../../tasks/fuses.md) as **F6**, with
  the instrument named per processor. The notice is drafted at
  [docs/data-subject-notice.draft.md](../data-subject-notice.draft.md) — every element PPL §11 requires,
  filled in where the system determines the answer and marked `⟨…⟩` where only the owner can. Reviewing
  it is the owner's, with counsel; writing it was not, and leaving it unwritten was what made the fuse
  look unbounded.
- **One question in that draft has a deadline that is not the corpus's:** how the notice reaches a
  tenant. If the answer is "on first contact through the agent channel", week 9 builds a step for it.
- Whether redaction is its own slice in month one or rides with slice 4.2's comprehension work. It must
  precede week 10 either way. **Decision 2 is accepted; only its scheduling is open.**
