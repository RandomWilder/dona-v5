# The tier-1 corpus

The specimen documents the gates run against. `SPEC.md`, "The corpus, in three tiers", is the rule;
this file is what is actually here and how to change it.

## What these are

Hebrew text **authored to the published forms' structure** — clause numbering, headings and legal
register — and **not** copies of the published PDFs. Each file's front matter names the form it
follows and where that form is published, so what is ours and what is the state's stays legible.

| File | Form it follows | `clause_source` |
|---|---|---|
| [lease-standard.md](lease-standard.md) | חוזה שכירות אחיד — דירה להשכיר | `lease` |
| [handover-protocol.md](handover-protocol.md) | פרוטוקול מסירה | `lease` |
| [bank-guarantee.md](bank-guarantee.md) | ערבות בנקאית אוטונומית | `lease` |
| [arnona-bill.md](arnona-bill.md) | הודעת חיוב ארנונה | `lease` |
| [insurance-certificate.md](insurance-certificate.md) | אישור קיום ביטוחים | `lease` |
| [service-policy.md](service-policy.md) | **none — it is the operator's own** | `policy` |

`clause_source` is what a question may be answered *from*: `lease` is the tenant's own paper,
`policy` is the operator's procedure and the global knowledge base. `evals/case.ts`'s grounding kind
reads it, and `expectSource: 'none'` is the refusal case — a question neither source answers.

## Why authored rather than copied

Two reasons, and the second decided it (slice 1.12):

1. **The gate needs text it can chunk, embed and rank.** The path that turns a PDF into text is week
   3's ingestion work. A PDF committed today would sit in the repo being unusable by the one thing
   tier 1 exists for.
2. **Republishing a third party's document wholesale is a licensing decision**, and it belongs to the
   director rather than to an engineer.

`plan.md` A7's actual worry — *no gate is ever green because it was measured against a document we
authored to pass it* — binds at the **week-4 accuracy number**, and A7 already assigns that to tier
2: real documents measure accuracy, they do not do development. The published PDFs arrive with the
Drive fuse (**F4**) at week 3 and are welcome beside these; they do not change what tier 1 is for.

## The format, which a parser reads

Front matter (`form`, `follows`, `source`, `authored`, `clause_source`), then one clause per `###`
heading. **The heading is the citation, spelled exactly as an answer would cite it** — `חוזה §7.2` —
and the body is everything until the next heading. `evals/fixtures/specimen-clauses.ts` loads these
files, so the corpus and the golden set cannot drift: renaming a clause here breaks the import rather
than the gate at 2am.

Refs are unique across the whole corpus. Prose outside a `###` heading is commentary and is not
indexed.

## What a file here may never contain

Asserted by `evals/fixtures/specimen-clauses.test.ts`, not promised in a comment:

- **No sum of money.** Foundation rule 2 — no tenant-facing price and no balance, ever — and a
  fixture is where a habit starts. The rent clause says *when* rent is paid; the guarantee says what
  it secures. Neither says how much.
- **No real person.** No identifier-shaped run, no Israeli mobile-shaped number, no email address, no
  real party or address.
- **Near neighbours on purpose.** Several clauses answer "who fixes what" (§7.2 owner wear-and-tear,
  §7.3 the contractor in warranty, §7.5 tenant damage, §7.6 consumables, §7.9 common parts, §11.3
  utilities). A ranking ratchet set against a corpus with one obvious answer per question measures
  nothing, because nothing could have won instead.

## What is *not* here

**Tier 2 — the real documents from Dona Dom — never enter this repository.** They live in a dated
bucket of their own with a lifecycle rule, a proved deletion path and a removal date on
`tasks/fuses.md`: `infra/corpus-bucket.sh` provisions it, `infra/corpus-delete.sh` removes from it.
`.gitignore` refuses PDFs and images outside this directory, which is a safety net against a stray
`git add -A` and not a policy in itself — the policy is that they never arrive here at all.
