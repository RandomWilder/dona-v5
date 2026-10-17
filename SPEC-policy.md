# SPEC: policy

Shared conventions live in [SPEC.md](SPEC.md) and are not repeated here. The nouns are in
[CONTEXT.md](CONTEXT.md). [ADR-0017](docs/decisions/ADR-0017-the-call-copilot-is-the-office-retrieval-model.md)
is why a law is a document and not a rule.

## Two kinds of policy

This module owns both, and they are not the same thing.

- **Policy rules** decide. The responsibility matrix, the response thresholds, the escalation
  rules and the emergency definitions are versioned rows the code applies. No model reads a rule
  into a decision (foundation rule 3). Responsibility is ternary — tenant / operator / contractor —
  because of תקופת הבדק. A rule supersedes by `effective_from` and is never overwritten. Every
  resolved call snapshots the `policy_version_id` that decided it, and re-resolving after the rule
  changes still returns what the snapshot says. The emergency bypass is a row here plus a routing
  rule. **These rows are not built yet.** What follows does not start them and does not stand in
  for them.
- **Policy documents** are read and cited. A state law or a company policy is a file in the Policy
  library. It decides nothing. A model may quote it. It is never a Policy rule, and a Policy rule
  is never stored as one of these files.

## The Policy library

The library is not tenant paper. A document here is not filed under a person, a flat or a
letting, and it is not searched as one. The upload does not scan the file for a name, a phone
number, a national id or an address. A statute or a company policy may mention any of those and
still be a general rule. What keeps a tenant's own file out of this library is what an admin
chooses to upload.

**Sections** are rows. The seed is State law (`state_law`, דין המדינה) and Company policy
(`company_policy`, נוהל חברה). A further section is another row in that seed, not a migration and
not a code path. `npm run seed` and `npm run seed:policy` both apply it, and a second run creates
nothing.

**A Policy document** has a section, a title and an effective-from date. The title is at most 80
characters, which is what one field of the shared upload parser can carry. Its bytes are stored in
the object store. Its text is read and chunked by evidence's reader (`readForVerdict`) and
evidence's page chunker (`pageText`), then embedded, so the file becomes searchable passages.
Passages are rows of this module, not rows of `document_passage`: that table is tenant paper, and
a portfolio search must not return a law as a lease. Each passage carries the document's section.

**Never updated and never deleted.** A correction is a later version (#251), which this spec does
not define. There is no edit and no withdraw. The database refuses both `UPDATE` and `DELETE` on
the document and on its passages.

**Who.** Any signed-in staff member may open מדיניות and read what is there. Uploading is
`settings.write`, which only an ADMIN holds. An OPERATOR or a VIEWER sees no upload control, and
the server refuses their upload. The tab is on the rail for every signed-in role.

**Not here.** Effective-to and supersession are #251. Searching the library from a call is #254.
The in-force rule those two share is written when #251 lands, in this file, before that code.
