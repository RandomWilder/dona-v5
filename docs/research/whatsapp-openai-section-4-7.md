# WhatsApp message content and OpenAI's API

Research note, 17 October 2026. Prepared for #249. The question is whether the call copilot may
read WhatsApp message content and send it to OpenAI, under Meta's WhatsApp Business terms and under
the OpenAI API terms this account is on.

This is a reading of the published terms. It is not legal advice, and it signs nothing. Where the
answer turns on a contract, a paid tier, or a signature, that part is named as the director's and
is not assumed.

## Answer

**No.** On this account, the call copilot may not read WhatsApp content.

The share is what fails. OpenAI's published API rules would meet the training limit in Meta's §4.7
if the share were allowed. It is not allowed, because OpenAI is not a Solution Provider, and the
terms permit WhatsApp Business Platform Data to leave the business only to one.

#257 is therefore copy only: no brief and no draft on a WhatsApp call.

## What was read

- Meta Terms for WhatsApp Business Platform, last modified 23 September 2026, English text as served
  by `mbasic.facebook.com` (the `whatsapp.com` URL redirects there and the desktop page is a script
  shell). Sections 1.1, 1.3, 4.1 and 4.7.
- The page §4.7 links for the country list: Meta for Developers, "New pricing policy for AI
  Providers leveraging the WhatsApp Business Platform", markdown form, read 17 October 2026.
- WhatsApp Business Messaging Policy, last updated 23 September 2026, incorporated by §1.3 of the
  terms.
- OpenAI, "Data controls in the OpenAI platform", read 17 October 2026, including the per-endpoint
  table.
- This repo's own account of the call: ADR-0013 (no Business Solution Provider; Dona Dom is its own
  Tech Provider), and the two OpenAI endpoints the process actually calls.

## Meta

**Who may receive the data.** §4.1 defines WhatsApp Business Platform Data as data obtained from
using the platform, and then forbids sharing, transferring, selling, licensing or distributing it,
including anonymous, aggregate or derived forms, to any third party, except to a Solution Provider
in accordance with the terms. Message-thread content is inside that definition: §4.1(a) has to
carve it out of the separate ban on building profiles, and that carve-out does not apply to the
sharing ban in §4.1(b).

**What a Solution Provider is.** §1.1: a third party authorized to use the WhatsApp APIs on the
business's behalf. The business in that arrangement is the Client.

**What §4.7 adds.** Two rules, and they are not the same rule.

1. An AI Provider — a provider of large language models, generative platforms, general-purpose
   assistants, or similar technology, as Meta determines — may not use the WhatsApp Business
   Platform, directly or indirectly, to make that technology available where it is the primary
   rather than incidental functionality. The exception is the country list §4.7 points at. Meta's
   own pricing page for that list says the restriction is on AI Providers offering general-purpose
   assistants, and that it does not change how Meta treats all other businesses. Dona Dom's office
   copilot is not that product. This half is not the reason for the no.
2. Notwithstanding that ban, the business may retain an AI Provider as its Solution Provider. In
   that case it may not allow WhatsApp Business Platform Data, including anonymous, aggregate or
   derived forms, to be used to create, develop, train or improve any AI model. Fine-tuning a model
   for the business's exclusive use is allowed, if that does not improve any other model. §4.7
   states no retention period.

The second rule is the only sentence that lets an AI company receive the data, and it does so by
placing that company in the Solution Provider role §1.1 already defined. It does not authorize a
separate model vendor.

**This account.** ADR-0013: Dona Dom is its own Tech Provider, and there is no Business Solution
Provider. OpenAI is called at `api.openai.com`. It is not authorized to use the WhatsApp APIs on
Dona Dom's behalf. The §4.7 permission therefore does not attach, and §4.1(b) forbids the share.
Putting OpenAI into the Solution Provider role would be a new contract and would reverse ADR-0013.
OpenAI does not operate the WhatsApp APIs. That change is the director's. This note does not
assume it.

**The messaging policy**, incorporated by §1.3, does not supply a different permission. It allows
automation inside the 24-hour window only with a prompt path to a human; it forbids forwarding a
customer chat to any other customer; and it limits data obtained from Meta about a person, other
than message-thread content, to what is reasonably necessary to support messaging that person.
None of those sentences authorizes a model vendor.

## OpenAI

Read against the training half of §4.7 only. It is not a permission to send the data.

The process calls two endpoints, both on the API platform: `/v1/chat/completions` (extraction,
sorting, translation, and the shape a brief or draft would use) and `/v1/embeddings`. The chat
call does not set a `store` parameter. It does not use the Assistants, threads, files, or
fine-tuning endpoints, and it does not fine-tune.

OpenAI does not publish these API rules as numbered clauses. They are the data-controls page for
the API platform. That page states that, as of 1 March 2023, data sent to the API is not used to
train or improve OpenAI models unless the organization explicitly opts in to share it. Its table
marks both endpoints "No" for data used for training. Abuse-monitoring logs may
contain prompts and responses and are kept for up to 30 days, unless the law requires longer or
keeping them is reasonably necessary to protect the service or a third party. Both endpoints are
eligible for Zero Data Retention, which needs OpenAI's prior approval and extra requirements.
Prompt caching may keep encrypted tensors on the GPU for up to 24 hours; the page treats that as
application state, not training.

§4.7 does not set a retention cap. The 30-day abuse log is therefore not, on these published
terms, a breach of the training ban. Zero Data Retention is a sales approval and is not required
by the clause as written. Whether this organization's dashboard has the training opt-in switched
off is not visible in the repo. That confirmation is the director's, and it matters only if the
share is later allowed.

The OpenAI data-processing addendum is still unsigned. That is fuse F6 and ADR-0004 decision 3.
It is not the reason for this no, and this no does not discharge it.

## What this does not change

ADR-0004's four decisions stand. Decision 1 still forbids a spec from claiming that personal data
never reaches a model provider. Decision 4 still requires every such provider to be named, and the
table in `SPEC.md` already names OpenAI as receiving the subject and text of incoming WhatsApp
messages for the sorter and for translation (#181). That row records the design. It is not a
finding that Meta's terms allow the send. The same reading in this note covers the sorter. #249
rescoped only the copilot (#257). Stopping or keeping the sorter is the director's.

## What would make the answer yes

All of the following, and none of them is assumed:

- A contract under which the model vendor is the Solution Provider, which would also supersede
  ADR-0013, or a written confirmation from Meta that an office-side model call is not a §4.1(b)
  share.
- The OpenAI organization's data-sharing opt-in confirmed off, and kept off. No fine-tune of a
  shared model on WhatsApp content. A fine-tune for Dona Dom's exclusive use is the only training
  use §4.7 allows, and only once the share itself is allowed.
- F6's OpenAI addendum executed before any tenant WhatsApp text is sent, which ADR-0004 already
  requires for tenant text generally.

Zero Data Retention is not on that list. It is available if counsel later wants a shorter
retention than the published 30 days. Asking for it is the director's.

## Sources

- Meta Terms for WhatsApp Business Platform, last modified 23 September 2026 —
  https://www.facebook.com/legal/Meta-Terms-for-WhatsApp-Business-Platform
  (redirect from https://www.whatsapp.com/legal/business-solution-terms/). §§1.1, 1.3, 4.1, 4.7.
- Meta for Developers, New pricing policy for AI Providers, read 17 October 2026 —
  https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing/ai-providers
- WhatsApp Business Messaging Policy, last updated 23 September 2026 —
  https://www.whatsapp.com/legal/business-policy/
- OpenAI, Data controls in the OpenAI platform, read 17 October 2026 —
  https://developers.openai.com/api/docs/guides/your-data
- ADR-0013, ADR-0004, `SPEC.md` Security defaults (the OpenAI row).
