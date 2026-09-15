# ADR-0006 — The extractor may read a declared identifier, and masking binds where output can reach a person

- **Date:** 2026-09-13
- **Status:** accepted
- **Context slice:** 6.4 — the slice that puts ת.ז. on the capture path, and the spec edit it proposed before its code
- **Amends:** [ADR-0004](ADR-0004-personal-data-reaches-the-model-provider.md) **decision 2**. Decisions 1, 3 and 4 are untouched and still bind.

## The decision

1. **Masking at the provider boundary binds the embedder, and any model call whose output can reach a
   tenant.** That is where ADR-0004's reasoning actually lives: a run of nine digits swept into an
   index, or into an answer a tenant reads, is exposure nobody asked for and nobody can point at.
2. **A field *declared* on the document-type catalogue is the named exception.** When
   `document_type_field` declares an identifier for a type, the extractor may read it and the system
   may store it as an `extracted_field` row. The exception is narrow by construction: the catalogue is
   governed data, a declaration is a row somebody wrote and a reviewer can list, and adding one is a
   deploy of data rather than an accident of text.
3. **The stored copy is never masked.** ADR-0004 said this and it is restated here because it is the
   half that makes masking safe to adopt: what was filed is what is held, byte for byte.
4. **A declared identifier is withheld by default on every read path**, and disclosed only to a role
   holding `party.national_id.read`. Disclosure writes an `audit_log` line naming who asked and for
   which document — never the value.
5. **`national_id` on `party` is unchanged.** It stays admin-only, absent from the isolation join's
   view, and unreachable by any agent tool. Nothing here widens the column; this ADR is about the
   value on the paper on its way in.

## Why decision 2 needed amending rather than applying

ADR-0004 decision 2 reads: *an identifier-shaped run is masked in the copy sent to the embedder **and
the extractor**, and never in the copy stored.* Applied literally, the slice that implements it —
**9.1, redaction at the provider boundary, hard-bounded by week 10** — would mask the exact value
slice 6.4 exists to capture, and the two slices would cancel. That is not a conflict discovered in
code; it is one that was visible in the text, and this is the file that resolves it before either
half is built.

The resolution is not *make an exception for our convenience*. It is that ADR-0004's two clauses were
written for one hazard and cover two different acts:

- **A run of nine digits found inside a numbered annex clause** is the hazard ADR-0004 measured:
  19 of 211 indexed chunks at v3 mentioned ת״ז, nobody declared them, nobody can enumerate them, and
  they leave with every chunk that happens to contain one. Masking is the only control that reaches
  them, and it still binds.
- **A declared field on a governed catalogue** is the opposite act in every respect that matters:
  somebody decided the type should carry it, the decision is a row, the value lands in one column on
  one table, its readers are a permission, and every disclosure is logged. It is not discovered; it
  is asked for.

Masking the second to protect against the first would not reduce exposure — the same page still goes
to the same processor under the same DPA, because OCR hands over whole page images (ADR-0002) and the
extractor is handed the same words either way. It would only destroy the value on the way back, and
leave the system unable to tell one household from another except by name — which is the privacy
decision 5.5 refused, having measured **303** identified people sharing a full name in a 2,871-party
portfolio.

## What this obliges

- **9.1 masks the embedder's copy and any tenant-facing model call, and leaves the declared extraction
  fields alone.** Its acceptance bar is unchanged otherwise: the stored bytes are byte-identical to
  what was filed, and the golden set is green at or below its existing threshold with masking on.
- **6.6 is the guard.** A policy case, red first: no identifier-shaped run in the response shape of
  anything `src/scope/` serves, and none in the copy sent to the embedder. `extracted_field` is a new
  home for an identifier and the case names the table, not only `party.national_id`.
- **F6 covers a category it did not before.** The extractor is now asked to return an identifier, so
  the OpenAI DPA and the notice to data subjects describe a processing purpose that was hypothetical
  when [docs/fuses.md](../fuses.md) was last walked. This makes F6 sharper, not looser: it
  still blocks the tier-2 corpus, and nothing in week 6 needs it, because every lease put through this
  week is invented.

## What this does not decide

- **Whether a captured identifier may be used to match a party across tenancies.** That is flow A2
  step 5, it is slice 6.5's to amend, and the distinction it turns on — an identifier is the governed
  path, a name is not — is argued there and not here.
- **Which other types may declare an identifier.** The `id` document type still declares no fields
  (`src/evidence/fixtures/document-types.ts`), and that remains a rule rather than a schedule: a type
  whose entire content is an identifier is a different question from a lease that names one.

## Amendment — 2026-09-15 (#103)

**The passage store embeds the stored copy, which is unmasked.** Decision 3 already said the stored
copy is never masked. #99 / #103 made that copy a per-page passage whose embedding is computed from
the same text: one store, one embedding run. Masking before the embedder would both hide a tenant's
own identifier from them at retrieval and corrupt the vector. Decision 1 still binds **tenant-facing
model output** and the retrieval *read* (stance); it does not bind the write into
`document_passage`. **#104 is that read:** the tenant stance masks identifier-shaped runs on the way
out; the administrator stance does not. There is still no second, masked index.
