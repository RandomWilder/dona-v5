# SPEC: kernel

Conventions inherited from [SPEC.md](SPEC.md) and not repeated here. The kernel holds **no business
logic** — it is the shared machinery every module is built on.

- **Owns:** ids · injected clock · the one error shape · edge validation · config · db · the
  migration runner and the kernel's own tables · idempotency · audit · outbox · durable work ·
  object storage · pdf · embeddings · extraction · the RTL UI token layer.
- **Entities:** none.
- **Depends on:** nothing. **It imports from no domain module**, and `src/kernel/boundary.test.ts`
  proves it on every run.
- **Built:** week 1, slice 1.4 — lifted from v3 and renaming nothing
  ([docs/from-v3.md](docs/from-v3.md) Tier 1). v3's *domain* migrations do not come with it.

## Primitives

- **Error shape** — `KernelError(code, message, details?)` and `toErrorBody()`. The five codes are
  fixed in `SPEC.md`; `toErrorBody` maps any non-kernel error to `unavailable`, so internals never
  reach the wire. `httpStatus(code)` is the single place a status code is decided.
- **Ids** — `newId(clock)` returns an RFC 9562 UUIDv7: a 48-bit millisecond timestamp then random
  bits, so ids sort by creation time and stay index-friendly as Postgres primary keys.
- **Clock** — `Clock.now()`. Business logic never calls `Date.now()` or `new Date()`; it receives a
  clock. `fixedClock(start)` is the test double and advances on demand. Time reaches SQL as a bound
  parameter, never as `NOW()`.

### Edge validation (`validate.ts`)

`requireText(value, field, max)` · `optionalText(value, field, max)` · `validId(value, field)` ·
`asText(value)`.

Everything a caller can get wrong becomes `KernelError('invalid', ...)` here, rather than a Postgres
cast error surfacing as `unavailable` three layers down. `requireText` trims first and measures
after, so a padded 200-character name is 200 characters and `'   '` is empty. `asText` never throws:
audit entries are built *before* validation runs, so an entry has to survive a caller passing a
number where a string belongs.

These live in the kernel because they are the *shape* of a value and nothing more. A validator that
knows a domain vocabulary stays in its module — `estate`'s space kinds, `parties`' contact kinds,
`tenancy`'s roles. The line is whether the kernel would have to learn a business word to hold it.

### At the HTTP edge

`buildApp` installs `setNotFoundHandler` and `setErrorHandler`, so Fastify's own bodies never reach
the wire: its 404 echoes the requested path back and its 500 carries the thrown message. Both render
as `{ code, message }` — an unknown route is `not_found`, anything unrecognised becomes
`unavailable` / "unexpected error" through `toErrorBody`.

Known gap, to close with the first route that takes a body: Fastify's schema-validation failures are
client errors and must map to `invalid` (400), not `unavailable` (503). Every route today is a GET
with no body, so nothing can reach that path yet.

## Database (`db.ts`)

`createPool(env)` reads `DATABASE_URL` and refuses to build a pool without one — `invalid`, not a
quiet fallback to a developer's laptop. `npm run dev` supplies it from `.env.example`; staging and
prod get it from Secret Manager.

**The pool carries an `'error'` listener, and that is the one line of this file that is not v3's.**
`pg` emits `'error'` on an idle client whose backend goes away — a Cloud SQL restart, a failover, a
maintenance window, `docker compose stop db` — and Node throws on an unhandled `'error'`, so a pool
without a listener takes the **process** down. `/health`'s 503 branch then never runs, because
nothing is left to serve it. Found in slice 1.3 by stopping the container while the dev server was
up; v3 has no listener and has been deployed that way. `src/kernel/db.test.ts` proves it by
terminating its own backends and asserting the process is still alive to answer.

The handler logs `error.message` and never the error object: it carries the full connection
parameters, and `SPEC.md`'s rule is that internals reach a log no more readily than the wire.

## Migrations (`migrate.ts`, `migrations/`)

One ordered sequence under `src/kernel/migrations/`, applied under a Postgres advisory lock so two
instances booting together cannot race. Each file runs in its own transaction and is recorded in
`schema_migrations` by filename. Append-only; DDL and backfill never in one file (`SPEC.md`).

**The runner is kernel machinery; the tables mostly are not.** A module's tables are described in
that module's spec, and the kernel never reads them. What the kernel *does* own, and what slice 1.4
therefore brings with it, is the durability substrate its own suites run against:

| File | What it creates |
|---|---|
| `0001_init.sql` | the `vector` extension |
| `0002_kernel_durability.sql` | `idempotency_keys` · `audit_log` · `outbox` · `scheduled_work` · `config_settings` |
| `0003_kernel_settings.sql` | the seed rows for the embedding and extraction settings |

`audit_log.actor_role` is nullable and un-CHECKed by design: tenant, agent and system actors hold no
role, and the kernel does not know any module's role vocabulary.

`now()` inside those seed rows is the one place `SPEC.md`'s no-`DEFAULT now()` rule permits it —
a seed running inside a migration is not a domain write, and there is no injected clock at
migration time.

## Settings (`config.ts`)

`SPEC.md` rule 8 keeps policy in data rather than in constants. `config_settings` is one table —
`key` text primary key, `value` jsonb, `updated_at` — behind a typed reader. A missing row falls
back; a row of the **wrong type** raises `invalid`, because somebody edited it by hand and reading
past that would apply a setting nobody intended.

No admin screen yet; that is month two's settings screen. Until then a row is changed by hand, which
is the honest state rather than a hidden one.

### The dimension is config *and* schema, and the reader says so

A `vector(n)` column has its dimension compiled into the column type, so `embedding.dimensions`
cannot be freely edited: changing it without a migration writes vectors the column rejects, or —
worse, if the column were untyped — vectors nothing can compare. The reader **asserts the row agrees
with the schema's width** and refuses to embed when it does not. Changing the dimension is a
migration plus a re-embed, and the spec says so rather than letting someone discover it.

### Two settings, read at two different times

`embedding.model` is read **at boot**: it is welded to a `vector(n)` column and to every vector
already stored, so changing it is a migration and a re-embed anyway.

`extraction.model` is read **per call**. It is welded to nothing — no stored row becomes unreadable
when it changes — and the failure it guards is different in kind: a model id the account cannot
serve makes every extraction fail, and the fix has to be one row rather than a deploy.

## Object store (`objects.ts`)

`put(path, bytes, contentType)` and `read(path)`. Infrastructure on the same footing as `db.ts`: the
shape of a transfer and no business logic at all. It does not know what a lease is; the paths it is
handed are built by the module that owns them.

`createGcsStore({ bucket })` talks to the GCS JSON API over `fetch`, with `google-auth-library` for
access tokens and nothing else — token acquisition differs between Cloud Run's metadata server and a
laptop's ADC, and hand-rolling an OAuth refresh for a bucket holding signed contracts is the wrong
economy, while the transfer itself is two HTTP calls that need no SDK. `createMemoryStore()` is what
the tests use, so no test reaches the network and none needs a bucket.

**Which one is running is reported at boot.** An absent `DOCS_BUCKET` is not an error — locally there
is no bucket and `npm run dev` must still start — so it falls back to memory and *says so*. A
deployed revision whose boot line reads `docs: memory` is wrong in the same visible way a `-dev`
version string is. A missing object is `not_found`, never empty bytes.

## PDF text (`pdf.ts`)

`pages(bytes)` → one entry per page, each carrying its size and its **positioned** text items.

**Positions, not a string.** A reader that returns page text as a paragraph is unusable for the
document this system exists to read: a lease's facts live in a two-column label/value annex, and
flattened text binds each value to the label on the line above. `getTextContent()` gives every item
an x/y transform, a width and a bidi direction, which is what makes both the column pairing and a
traceable citation possible.

`createPdfjsText()` wraps `pdfjs-dist`, imported lazily so a process that never reads a PDF never
pays for it. The input is a third-party PDF and a PDF is a program, so nothing here renders:
`useSystemFonts: false` and `disableFontFace: true`, because text extraction needs no glyph built at
runtime.

A file that is not a PDF, or one the parser cannot open, is `invalid` — never a driver stack. A page
with no text layer is **not** an error: it comes back with zero items, and saying which pages those
were is the caller's job.

## Embeddings (`embeddings.ts`)

`embed(texts)` → one vector per text, order preserved. `createOpenAiEmbedder({ apiKey, model,
dimensions })` is one HTTP call, a bearer token and a JSON body, with no SDK.
`text-embedding-3-large` at 1536 dimensions: a width pgvector can index, since hnsw caps at 2000 and
the model's native 3072 would force `halfvec`.

Texts are sent in batches, and a batch that fails is not silently partial: the call throws and the
caller's transaction rolls back, so a document is never half-indexed.

`createUnconfiguredEmbedder()` is the default when no key is configured, and it **throws** rather
than returning zeros. A process that lost its key must not index a document into vectors that match
nothing — that failure is invisible until someone asks a question and gets silence.

## Extraction (`extraction.ts`)

`extract({ model, instructions, input, schema })` → the JSON the schema describes. The second model
port and the first with a **prompt**, and it still knows nothing about leases: it is handed
instructions, text and a schema exactly as `pdf.ts` is handed bytes.

`createOpenAiExtractor({ apiKey })` calls chat completions with `response_format: { type:
'json_schema', strict: true }`. Strict, because the alternative is a caller parsing prose: a schema
the provider enforces is the difference between a malformed reply being an error and being a field
with a plausible wrong shape. A reply that is not the schema, or is not JSON at all, is
`unavailable` — never a partial object.

**The model id arrives per call**, read from `config_settings` by the caller, for the reason the two
settings differ above.

### Bounded, because the caller is a browser request

Every call carries `AbortSignal.timeout` and `max_completion_tokens`. Both are code and not config
rows: rule 8 governs tunables, and a bound that stops one request consuming a server is a safety
limit. Measured rather than assumed — v3's first staging press sent five sequential calls with no
timeout and no reasoning setting, and the request died at Cloud Run's 300-second limit with a blank
page reaching the operator.

### `reasoning_effort` is a setting, and unset is not the same as none

A model family that reasons by default treats an absent parameter as "reason as much as you like".
The effort is `extraction.reasoning_effort`, a config row beside the model, so walking `none → low`
when a field comes back wrong costs no deploy. The row also accepts **`omit`**, which is ours and
not the provider's: send no `reasoning_effort` field at all, for a model that *refuses* the
parameter rather than ignoring it.

`createUnconfiguredExtractor()` throws, on the argument the unconfigured embedder makes.
`createFakeExtractor(replies)` is what the tests use: scripted JSON, no network and no key.

**Third parties.** Both model ports reach an external provider. `SPEC.md` requires every third party
that sees tenant text to be named before it is called, and ADR-0004 owes the legal basis. Neither
port is wired to real tenant text before slice 1.12 closes that.

## Idempotency (`idempotency.ts`)

`once<T>(key, work)` — the key is the caller's business intent (job id, offer id), never a random
value.

- First call claims the key atomically and runs the work.
- A later call with the same key returns the **first result**, deep-copied so callers cannot mutate
  the stored value.
- A call arriving while the first is still running gets `conflict`.
- A command that **throws** releases its key: failures are retryable, only successes are memoized.
- A claim older than `staleAfterMs` (default 60s, on the injected clock) is reclaimable, so a
  process that dies mid-command cannot wedge a key permanently.

## Audit (`audit.ts`)

`write(entry)` records one row: actor (kind + id + role), action, subject, inputs, outcome.
`around(entry, work)` wraps a command and records `ok` or `error` with the `KernelError` code either
way, then re-throws — which is what makes "every command is audited" enforceable rather than
aspirational.

`ActorKind` is `tenant | staff | agent | system`; `actorRole` is deliberately unconstrained, because
the kernel does not know any module's role vocabulary. It answers "what permitted this", which
`actor_id` alone cannot.

`audit_log` is a **table, not a log**. `SPEC.md`'s "PII never in logs" governs log output; command
inputs are stored here deliberately, because the audit trail is the system of record for who did
what.

**Owed, and not built here.** `SPEC.md` commits to logging **every scoped read of tenant data**, not
only every command. `around()` is the hook for it; the extension lands with `src/scope/` in week 2.

## Outbox (`events.ts`)

`publish(event)` writes the row first, then attempts delivery in the same call. A handler that
throws leaves the row unhandled with `last_error` set; the event is never lost because the write
precedes delivery. `deliverPending()` replays unhandled rows in `at` order and is the recovery path
after a crash or restart.

## Durable work (`work.ts`)

`schedule({kind, runAt, payload, intentKey?})` · `cancel(id)` · `register(kind, handler)` · `tick()`
· `start()` / `stop()`.

- Scheduling twice with the same `intentKey` returns the existing id — timers are idempotent on
  intent, like commands.
- `tick()` drains everything due at the clock's current time; `start()` only calls `tick()` on an
  interval. Tests drive `tick()` directly, so no test ever sleeps.
- Claiming uses `FOR UPDATE SKIP LOCKED`: two runners can never take the same job.
- A failing handler backs off exponentially, capped at 60s, and records `last_error`.
- Work outlives the process — it lives in Postgres, so a runner started after a restart picks up
  what an earlier one scheduled.

## Shared UI surface (`ui/`)

`SPEC.md`'s one-presentation-system rule lives here: the kernel owns the token layer and the fonts,
and every screen in every module is a self-contained HTML file that links it.

- **`ui/tokens.css`** — the only place a colour, a type face, a size, a radius or a spacing step is
  named. RTL through logical properties, so one stylesheet serves both directions. A screen that
  hard-codes `#fff` or `14px` has left the system.
- **`ui/fonts/*.woff2`** — Heebo (Hebrew + Latin subsets) and IBM Plex Mono, self-hosted with their
  OFL licences beside them. No Google Fonts request: tenant screens must not leak a visit to a third
  party, and the pages must render on a slow Israeli mobile connection without a second DNS lookup.
- **`ui/assets.ts`** — `registerUiAssets(app)` serves `GET /ui/tokens.css` and `GET /ui/fonts/:file`.
  Files are read once at registration, not per request: the deployed image is immutable.
- **Font names are an allowlist, never a path.** The `:file` parameter is matched against a fixed set
  and otherwise 404s; no request-derived string is ever joined onto a filesystem path. This is the
  rule for every static route the system ever grows.
- **Caching** — fonts `public, max-age=31536000, immutable`; HTML and `tokens.css` `no-cache` until
  assets are content-hashed, so a deploy cannot leave a stale stylesheet against fresh markup.

**Owed to the first screen (slice 1.11):** v3's `ui/tokens.test.ts` enforces the invariant from the
outside — no shell may contain a hex colour, a `fonts.googleapis` URL or a physical `left:`/`right:`
— and it asserts against module HTML shells, of which v5 has none yet. It is not lifted here; it
lands with the screen it guards.

### Escaping data into HTML (`ui/html.ts`)

- **`escapeHtml(value)`** — `&`, `<`, `>`, `"`, `'` to their entities, ampersand first so an escape
  is never itself re-escaped. Non-strings are refused rather than coerced: `String(x)` on an object
  yields `[object Object]`, which hides a bug instead of surfacing it.
- **``h`...` ``** — a tagged template where the literal parts pass through untouched and **every
  interpolation is escaped**. This is the form views use. Escaping by default means forgetting a call
  is impossible, where an `escapeHtml()` you must remember to write is one edit away from an
  injection. There is deliberately **no** raw escape hatch — a view that needs to compose markup
  nests one `h` inside another.
- Numbers interpolate as numbers; `null` and `undefined` render as the empty string rather than as
  the words "null" and "undefined".

## Testing

`pg-support.ts` is the skip-vs-fail mechanism: `migratedPoolOrNull()` migrates and returns a pool, or
returns `null` locally when Postgres is unreachable. **`REQUIRE_POSTGRES=1` turns that skip back into
a failure**, and CI sets it. A green job that asserted nothing about the database is the failure this
exists to prevent.

`boundary.test.ts` reads every file under `src/kernel/` and fails on any import that leaves the
kernel — a relative path escaping the directory, or a bare specifier naming a module from `SPEC.md`'s
module map. It is the enforceable form of "the kernel imports from no domain module", and it runs on
every `npm test` rather than once into an evidence file.

## Decisions

Recorded so they are not relitigated.

1. **Postgres only, no in-memory twins.** Parallel memory and Postgres implementations drift. One
   code path; tests skip when Postgres is unreachable, and `REQUIRE_POSTGRES=1` makes that a failure
   in CI rather than an assumption.
2. **No sleeps, in code or tests.** Contention returns `conflict`; tests drive `tick()` and advance a
   `fixedClock`.
3. **The clock is a parameter, not `NOW()`.** Time in SQL comes from the injected clock, so deadline
   behaviour is provable without waiting for it.
4. **Explicit `state` on idempotency keys.** A null `result` cannot distinguish "in flight" from a
   command whose result is legitimately null.
5. **Failed commands release their key.** Memoizing failures would make a transient database blip
   permanent for that intent.
6. **The pool has an `'error'` listener** (see *Database*). The one deliberate divergence from the
   verbatim lift, because the alternative is a process that exits on every database restart.
