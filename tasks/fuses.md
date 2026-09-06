# Fuses — external dependencies with a burn time we do not control

> A fuse is someone else's approval, someone else's export, someone else's decision. **Light it in
> week 1, before the code that consumes it is written.** A fuse lit late does not cost its own burn
> time — it costs the burn time *plus* every day of work that was ready and waiting on it.
>
> **Walked once a week.** Anything unlit or overdue goes on the standing asks slide at Thursday's
> demo — visible to Dona Dom's management as *their* dependency, not as our delay.
> Definition and rationale: [pipeline.md](../docs/pipeline.md) §2.

| # | Fuse | Lit | Expected burn | Status | What stalls if it does not land |
|---|---|---|---|---|---|
| **F1** | Meta business verification | **2026-08-21** | 4–6 weeks, uncompressible | **In progress**, correct legal entity — confirmed 4 Sep 2026 | The whole agent half. Burn window 18 Sep – 2 Oct, roughly five weeks ahead of the week-9 need. Fallback: build W9–11 against a message simulator and swap the live number in; a BSP stays in reserve. |
| **F2** | WhatsApp number under Dona Dom's legal entity | — | Days, once the entity is decided | Not lit | F1 itself. The number must belong to the company, **never a personal mobile** — a wrong number here means refiling, not editing. |
| **F3** | Priority ERP read-only keys | — | Client IT's calendar | Not lit | **Week 2 and the whole 1,500-unit claim.** A clean export exists; these keys are what reach it. Also the ERP foreign keys and every financial reference. |
| **F4** | Google Drive access to the document folders | — | Days | Not lit | Weeks 3 and 4 — document ingestion and the OCR accuracy number. Drive is the known source, so this converts a backfill expedition into an import. |
| **F5** | The client's GCP organisation decision (see also **F7** — the interim organisation, ours) | — | Weeks — a management decision | Not lit | Nothing immediately; everything eventually. The project is created under an organisation now and migrated later. Two things must be true before the move: an `@donadom.co.il` identity exists (most organisations block IAM grants to external addresses outright — the likeliest way to get locked out of your own project), and **no real tenant data has landed**, so the transfer is an admin task and not a data-custody event. If the GitHub repository moves too, the `assertion.repository` condition and both deploy workflows change with it. |
| **F6** | **ADR-0004 — personal data reaching a model provider.** The legal basis, and every third party that sees tenant text, named before it is called | **2026-09-06** | A decision, not a queue — days once asked | **Lit, half discharged.** The naming is done: [SPEC.md](../SPEC.md), Security defaults, now carries the table of every third party that sees text from this system — OpenAI · Google Cloud · Meta · Twilio · **Anthropic (development-time only)**. What is still owed is the owner's and not an engineer's: **a DPA with each processor, and disclosure to data subjects** | **Slice 1.12 and everything after it.** ADR-0004 was re-adopted at 1.1; its obligation is a disclosure, not a code change, and a third party discovered later is a data-custody incident rather than a config edit. Owed before the tier-2 corpus arrives — and 1.12 built the controls without taking delivery precisely so this fuse is not overtaken by the data. Added 4 Sep 2026 — 1.1's evidence said this row belonged here and nothing carried it, which is why the rule in [pipeline.md](../docs/pipeline.md) §8 now exists. Half-discharged 6 Sep 2026 by slice 1.12. |
| **F7** | **An organisation to hold the GCP project until Dona Dom's exists.** A Cloud Identity Free tenancy on a domain we control | — | Days — a domain plus a DNS verification, then `gcloud beta projects move` | **Not lit.** Slice 1.5 provisioned `dona-v5` **org-less**: `gcloud organizations list` returns 0 items for the owning account, and `roseberry.media` is a different company's tenancy and not a candidate | Nothing this week — R8 is the only thing unsatisfied, and a project move preserves project id, resources, data and IAM whenever it happens. What is **not** deferrable is the ordering: an identity on the destination domain must exist **before** the move (`constraints/iam.allowedPolicyMemberDomains` otherwise locks the `gmail.com` owner out of the project), and the move must happen **before real tenant data lands**. **Decided at slice 1.12, 6 Sep 2026: the move does not go first.** Creating an organisation is a Cloud Identity signup on a domain — the director's, not a script's — and week 1 cannot wait on it. Instead the tier-2 corpus gets a **bucket of its own with a proved deletion path** (`infra/corpus-bucket.sh`, `infra/corpus-delete.sh`), so the constraint becomes *the move happens before tier 2 lands **or** after it is removed*, and the second branch is one `corpus-delete.sh --all` rather than a search of a project. `bootstrap.sh` prints the warning on every run rather than leaving it in this file alone. Added 5 Sep 2026 by slice 1.5. |

## Carried forward from v3

- **Twilio OTP — closed 2026-08-22, working.** Israeli deliverability confirmed end to end. Two
  findings that stay relevant: Verify returned error 21608 for 15+ minutes after the account read as
  Full, closed by registering the number as a Verified Caller ID over the **voice** channel (console
  caller-ID verification by SMS is geo-blocked for Israel); and **Hebrew is missing from Verify's
  default message locales**, so tenant-facing OTP copy defaults to English — needs custom templates
  or an Israeli fallback provider. Bites week 9, where OTP goes over WhatsApp first and SMS is only
  the fallback.
- **The mock-data reframe, 2026-08-25.** Development runs on fixtures we define, chosen for coverage
  of the cases that break things. Real tenant data enters at sign-off, and the data request sent to
  Dona Dom is *derived from* our templates. **v5 policy from commit one** — no slice ever stalls on
  someone else's inbox.

## Not a fuse, but on the same clock

**F5 interacts with week 1, not week 4.** The GCP project should move into Dona Dom's organisation
*before* real tenant data lands — and the real document corpus was expected in **week 1**. Handled
rather than deferred: the corpus goes into a **dated bucket of its own** with a tested deletion path,
so the organisation move stays an admin task and does not become a data-custody event.

**The controls landed at slice 1.12 on 2026-09-06; the corpus itself has not.** That order is the
whole point of the slice — `tasks/plan.md` **R4**, controls before data — and taking delivery is the
director's act, owed **after F6's other half**, not before it.

| | |
|---|---|
| **Bucket** | `gs://dona-v5-corpus-2026-09-06` — versioning off, soft-delete window 0, public access prevention enforced, uniform bucket-level access, **no service account granted anything on it** |
| **Retention** | Lifecycle rule: objects deleted at **90 days**, whether or not anyone remembers |
| **Deletion path** | `./infra/corpus-delete.sh <object>` or `--all`. It refuses any bucket that is not a corpus bucket, and it verifies afterwards against **both** the live and the soft-deleted listings — the proof is its exit code |
| **Access logging** | Cloud Audit Logs `DATA_READ` + `DATA_WRITE` on `storage.googleapis.com`, applied by `infra/corpus-bucket.sh` |
| **Real corpus received** | _(date)_ |
| **Removal owed by** | _(received + 90 days, and the lifecycle rule enforces it)_ |

Fill the last two rows the day it lands, and run the deletion path on the removal date rather than
trusting the lifecycle rule alone — the rule is the backstop, not the record.
