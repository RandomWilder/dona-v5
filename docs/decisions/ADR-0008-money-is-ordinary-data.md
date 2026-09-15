# ADR-0008 — Money is ordinary data; foundation rule 2 is retired

- **Date:** 2026-09-15
- **Status:** accepted
- **Context ticket:** [#101](../../issues/0101-retire-foundation-rule-2-and-capture-amounts.md), under [#99](../../issues/0099-admin-document-upload-flow.md) — the administrator uploads a lease and approves what was read off it
- **Retires:** foundation rule 2 in [SPEC.md](../../SPEC.md), in full.
- **Does not touch:** foundation rule 3. No model participates in the responsibility decision or in the service-call state machine, and the state machine may not branch on any model-derived value — an amount included. Nothing below relaxes that, and §*What this does not decide* says so again because a reader who skims this file will otherwise assume it did.

## The decision

1. **Foundation rule 2 — *money never touches the agent; no tenant-facing price and no balance,
   ever* — is retired.** An amount printed on a document is ordinary data. It may be read,
   captured, approved, promoted, retrieved, quoted and computed on, under exactly the rules that
   govern every other value on a contract and no others.
2. **The three enforcements of the rule are deleted, and nothing replaces them.** The declaration
   vocabulary guard (`src/evidence/internal/money.ts`, its re-exports on the evidence contract and
   its one call site in `declareDocumentTypeField`); the schema assertions in
   `src/tenancy/schema.test.ts` forbidding a money-named column on `tenancy`, `tenancy_party`,
   `terms_profile`, `obligation` and `obligation_type`; and the agent-facing prohibition on prices
   and balances wherever it is stated. The policy case `tests/policy/money-field.test.ts` and the
   route-level refusal case in `src/evidence/routes.test.ts` go with them.
3. **No new value type, and no migration.** An amount is a `NUMBER` beside a `TEXT` currency, both
   of which `document_type_field.value_type` already has. `MONEY` is not added, because adding it
   would buy nothing an amount-and-a-currency pair does not already have, and would make every
   existing reader of `value_type` a reader that has to be revisited.
4. **Currency is paired per amount, not per document.** A lease may price the deposit in one
   currency and the rent in another, and a single document-level currency would make the second one
   unrepresentable while looking correct.
5. **Capture normalises.** A printed `12,500 ₪` is stored as `12500`. Separators, spaces and symbols
   are properties of the paper; the store holds the number. This is the same act `asIsoDate` already
   performs for a `DATE` field, applied to `NUMBER`.

## Why the rule is retired rather than narrowed

The rule was stated as *money never touches the agent*, and the thing it actually protected against
was the platform holding a **balance** — a running figure the ERP owns, which the platform would
have to keep in step with and would sometimes be wrong about, quoted to a tenant as though it were
authoritative. That hazard is real and it has not changed. Priority is still the system of record
for what anybody owes, and this ADR moves nothing into this platform's ledger.

But the rule as written also forbade the rent on a signed lease — a fixed figure, printed on paper,
which the document says and which does not drift. Under the rule as it stood, an administrator
uploading a lease could have every date, every name and every identifier on it captured, shown and
approved, and could not have the single most important number on the page enter the system at all.
That is not a narrow gap. It is the rule failing on the central document of the product.

Narrowing was considered and rejected. A narrowed rule — *amounts from a document, yes; balances,
no* — would have to be enforced somewhere, and the only enforcement available is the vocabulary
guard, which cannot tell a rent from a balance because both are spelled with the same eight Hebrew
words. A guard that cannot draw the line it is asked to draw is a guard that refuses the honest case
and admits the dishonest one, which is exactly what it did: `rent_amount` was refused and any field
named `extra_1` was admitted.

**Nothing replaces the guard, and that is the decision, not an omission.** A guard kept alive after
its rule has been retired is worse than no guard, because the next reader reasons from it and
concludes the rule still binds. What keeps a balance out of this platform is that no module writes
one and no schema has a column for it — which is a fact about what is built, re-decidable by a diff
a reviewer reads, rather than a vocabulary list that fires on `הדמיה`.

## What this obliges

- **The lease document type declares four fields** — `rent_amount` / `rent_currency` and
  `deposit_amount` / `deposit_currency` — as seed rows at a new `effective_from`, not as a
  migration. Each amount carries an extraction hint naming the amounts it is *not*, in the shape
  `tenant_id_number` and `guarantor_id_number` already use, because a lease prints several figures
  on one page and they are all runs of digits.
- **Foundation rule 2's slot in SPEC.md is not reused.** The rules are numbered and cited by number
  across this repository; renumbering would silently rewrite every citation. Rule 2 stays in place
  as a retired rule pointing here.
- **Every other place the rule was stated is corrected in the same change** — `SPEC-channel.md`,
  `SPEC-evidence.md`, `SPEC-tenancy.md`, `SPEC-flows.md`, `CONTEXT.md`, `docs/pipeline.md`,
  `docs/corpus/README.md` and `HANDOFF.md`. Two of them also claimed the rule was carried by "two
  standing refusal cases in the golden set"; the golden set has three cases and none of them is
  about money, so that gate never existed and the sentences said so for weeks.
- **Three applied migrations carry comments citing rule 2 as live** — `0007_tenancy.sql` ("NO RENT.
  NO DEPOSIT. NO BALANCE, here or ever"), `0011_evidence.sql` and `0026_obligation.sql`. **They are
  left exactly as they are.** An applied migration is a dated record of what was run against a
  database, not a description of what is true today, and editing one after the fact — even its
  comments — stops the file being that record. The SPEC files are where a reader learns the current
  rule, and they now say it.
- **The four published documents still promise the retired rule to the client.**
  `docs/core-journey.html` ("Money never reaches the agent"), `docs/stack-map.html` ("never quotes a
  price to a tenant"), `docs/data-model.html` ("MONEY stays in ERP") and `docs/platform-brief.html`
  each state it. They are promises made to Dona Dom and are the director's to change, not this
  ticket's. Until they are changed, the repository and the published documents disagree, and this
  bullet is the record of that.

## What this does not decide

- **Foundation rule 3 is untouched.** The responsibility decision and the service-call state machine
  remain free of any model, and the state machine still may not branch on a model-derived value.
  An amount captured off a lease is a model-derived value like any other: it may be displayed,
  approved and cited, and it may not decide who pays for a broken boiler or move a call from one
  state to the next. Retiring rule 2 widens what may be *held*; it widens nothing about what may
  *decide*.
- **Whether the platform ever holds a balance.** It does not today, no ticket asks for one, and the
  ERP boundary in `docs/stack-map.html` is unchanged. A balance is a separate decision and would be
  a separate ADR.
- **What the agent says to a tenant about money.** Rule 2 forbade the answer; retiring it does not
  supply one. The channel and calls modules do not exist yet, and the tenant-facing stance on a
  money question is theirs to decide when they are built.
- **Whether any other document type declares an amount.** `arnona` and `bank_guarantee` each carry a
  comment saying they decline one under rule 2. The comments are corrected to say the truth — that
  no ticket has asked for those fields yet — and a type that wants them declares them as rows.
