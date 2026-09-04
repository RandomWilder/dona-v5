# ADR-0004 — Personal data reaches the model provider, and that is a decision rather than an accident

- **Date:** 2026-09-04 · **re-adopted from v3**, where it was raised 2026-09-01
- **Status:** **proposed** — the technical mitigation is decided, the legal basis is owed
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

Three things make v5's exposure larger than v3's, which is why this ADR is re-adopted with its status
unchanged rather than closed:

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
- **The status stays `proposed` until the DPA and the disclosure exist.** They are the owner's, they
  have the same trigger as the corpus removal date, and this ADR is not closed by an engineering change.

## Open, and owed

- A DPA with each processor that sees tenant text, and disclosure to data subjects. **Not yet recorded
  on [tasks/fuses.md](../../tasks/fuses.md)** — it belongs there, with the corpus removal date, and is
  raised in slice 1.1's evidence file rather than added silently.
- Whether redaction is its own slice in month one or rides with slice 4.2's comprehension work. It must
  precede week 10 either way.
