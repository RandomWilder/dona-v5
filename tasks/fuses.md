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
| **F6** | **ADR-0004 — personal data reaching a model provider.** The legal basis, and every third party that sees tenant text, named before it is called | — | A decision, not a queue — days once asked | Not lit | **Slice 1.12 and everything after it.** ADR-0004 was re-adopted at 1.1; its obligation is a disclosure, not a code change, and a third party discovered later is a data-custody incident rather than a config edit. Owed before the tier-2 corpus arrives. Added 4 Sep 2026 — 1.1's evidence said this row belonged here and nothing carried it, which is why the rule in [pipeline.md](../docs/pipeline.md) §8 now exists. |
| **F7** | **An organisation to hold the GCP project until Dona Dom's exists.** A Cloud Identity Free tenancy on a domain we control | — | Days — a domain plus a DNS verification, then `gcloud beta projects move` | **Not lit.** Slice 1.5 provisioned `dona-v5` **org-less**: `gcloud organizations list` returns 0 items for the owning account, and `roseberry.media` is a different company's tenancy and not a candidate | Nothing this week — R8 is the only thing unsatisfied, and a project move preserves project id, resources, data and IAM whenever it happens. What is **not** deferrable is the ordering: an identity on the destination domain must exist **before** the move (`constraints/iam.allowedPolicyMemberDomains` otherwise locks the `gmail.com` owner out of the project), and the move must happen **before real tenant data lands** — which is **slice 1.12, this week**. `bootstrap.sh` prints the warning on every run rather than leaving it in this file alone. Added 5 Sep 2026 by slice 1.5. |

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
*before* real tenant data lands — and the real document corpus arrives in **week 1**. Handled rather
than deferred: the corpus goes into a **dated bucket of its own** with a tested deletion path (slice
1.12), so the organisation move stays an admin task and does not become a data-custody event. Record
the corpus removal date here the day it lands.

- **Real corpus received:** _(date)_ · **Removal owed by:** _(date)_ · **Bucket:** _(name)_
