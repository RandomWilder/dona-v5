import type { Pool, PoolClient } from 'pg';
import { createSettings, readEmbeddingSettings } from '../src/kernel/config.ts';
import {
  createOpenAiEmbedder,
  type Embedder,
} from '../src/kernel/embeddings.ts';
import type {
  CaseInput,
  GroundedAnswer,
  Grounder,
  RankedHit,
  Retriever,
} from './case.ts';
import {
  type ClauseSource,
  specimenClauses,
} from './fixtures/specimen-clauses.ts';

// The corpus a retrieval or grounding case is graded against.
//
// **This is the one file of the harness that is not v3's**, and the reason is
// worth stating. v3 built its corpus through `occupancy` · `catalog` ·
// `channel` -- attachDocument, ingestDocument, chunkLease, searchClauses -- so
// the golden set was graded against the real ingestion path. v5 has none of
// those yet: no agent, no chunker, no document. The harness still has to exist
// from commit one (docs/pipeline.md §7), and a harness whose retrieval cases
// need neither a database nor a key is a harness where REQUIRE_POSTGRES and
// REQUIRE_EMBEDDINGS gate nothing -- which is the whole of what this slice
// claims to build.
//
// So the corpus is the smallest thing that is honestly real. Everything below
// is the real component: the model id and its width come from the config rows
// the running system reads, the embedder is the real provider client, the
// ordering is pgvector's own `<=>` over a `vector(1536)` column. What is
// authored is only the *text* -- nine passages in evals/fixtures/ -- and where
// it lives, which is a TEMP table created by this file.
//
// **A TEMP table on purpose.** Migrations are one ordered sequence and estate
// appends from 0004_ at slice 1.9; the golden set is not entitled to a table in
// it. TEMP also means the corpus dies with the connection, so no run can pass
// because of rows another run left behind -- the same discipline
// tests/policy/'s rolled-back transactions have.
//
// Replaced, not extended, the day ingestion exists: point `search` at
// `searchClauses` and this file's DDL goes away.

/** A hit, plus which corpus it came from -- what the grounder reads. */
export interface CorpusHit extends RankedHit {
  source: ClauseSource;
}

export interface Corpus {
  /** Passages indexed. Printed, so a run that indexed nothing is visible. */
  chunks: number;
  /** The embedder actually used, for the run's own boot line. */
  describe: string;
  retrieve: Retriever;
  ground: Grounder;
  /** Every hit for a question, for the measurement rather than the gate. */
  search(question: string): Promise<CorpusHit[]>;
  close(): Promise<void>;
}

/** True when a real embedder can be built -- a key is present. */
export function embeddingsConfigured(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return (env.OPENAI_API_KEY?.trim().length ?? 0) > 0;
}

// The window a rank is measured in. Wider would make today's ranks look better
// without anything having improved, so it is fixed here rather than passed in.
const searchLimit = 8;

// PLACEHOLDER, and the only invented number in the harness. `channel` owns the
// real refusal rule from week 3; until then a question whose nearest passage is
// further than this is one nothing in the corpus answers. Cosine distance, so
// 0 is identical and 1 is unrelated. Set from `npm run measure` output rather
// than by taste -- the observation lives in tasks/evidence/1.8.md.
//
// It is asserted by no case. SPEC.md: no assertion is ever on a distance,
// because provider embeddings are not bit-identical between runs.
export const groundingCutoff = 0.62;

// The embedder is injected in one place only -- corpus.test.ts, which proves
// the DDL, the insert and the `<=>` ordering against a real database with the
// kernel's deterministic fake. The seam exists so that half of this file is
// provable in `npm test`, where there is no key; the gate itself never uses it,
// because a golden set graded against a fake embedder grades nothing.
export async function buildCorpus(
  pool: Pool,
  embedderOverride?: Embedder,
): Promise<Corpus> {
  // From the config rows, never from a constant: the golden set must embed
  // under exactly the model the running system embeds under, or a ranking
  // measured here measures a different system (SPEC-kernel.md, "The dimension
  // is config *and* schema").
  const { model, dimensions } = await readEmbeddingSettings(
    createSettings(pool),
  );
  const embedder =
    embedderOverride ??
    createOpenAiEmbedder({
      apiKey: process.env.OPENAI_API_KEY ?? '',
      model,
      dimensions,
    });

  // One client for the life of the corpus, because the table is TEMP: it exists
  // in this session and nowhere else.
  const client = await pool.connect();
  await index(client, embedder, embedder.dimensions);

  async function search(question: string): Promise<CorpusHit[]> {
    const [vector] = await embedder.embed([question]);
    const found = await client.query<{
      ref: string;
      source: ClauseSource;
      distance: number;
    }>(
      `SELECT ref, source, embedding <=> $1::vector AS distance
         FROM eval_chunk
        ORDER BY embedding <=> $1::vector
        LIMIT ${searchLimit}`,
      [toVector(vector)],
    );
    return found.rows.map((row) => ({
      clauseRef: row.ref,
      source: row.source,
      distance: Number(row.distance),
    }));
  }

  async function ground(question: string): Promise<GroundedAnswer> {
    const hits = await search(question);
    const near = hits.filter((hit) => hit.distance <= groundingCutoff);
    const top = near[0];
    if (!top) {
      // The refusal, and it hands back nothing at all. A refusal that still
      // returns its near-misses is a refusal a caller can put in a prompt, and
      // a model given eight irrelevant clauses and asked to be helpful invents
      // the ninth.
      return { source: 'none', hits: [], escalate: true };
    }
    return {
      source: top.source,
      hits: near
        .filter((hit) => hit.source === top.source)
        .map((hit) => ({ ref: hit.clauseRef as string })),
      escalate: false,
    };
  }

  return {
    chunks: specimenClauses.length,
    describe: embedder.describe(),
    search,
    retrieve: (input: CaseInput) => search(input.message),
    ground: (input: CaseInput) => ground(input.message),
    close: () => {
      client.release();
      return Promise.resolve();
    },
  };
}

async function index(
  client: PoolClient,
  embedder: Embedder,
  dimensions: number,
): Promise<void> {
  // Interpolated because a type name cannot be a bound parameter. The value is
  // a config row that readEmbeddingSettings has already checked against the
  // column width, and it is checked again here rather than trusted: this is the
  // one string in the harness that reaches SQL unparameterised.
  if (!Number.isInteger(dimensions) || dimensions < 1) {
    throw new Error(`refusing to build a vector(${dimensions}) column`);
  }
  await client.query(`
    CREATE TEMP TABLE eval_chunk (
      ref       text NOT NULL,
      source    text NOT NULL,
      body      text NOT NULL,
      embedding vector(${dimensions}) NOT NULL
    ) ON COMMIT PRESERVE ROWS
  `);

  // One call for every passage, in order: Embedder.embed pairs by index, and
  // pairing a clause with another clause's vector is a silent corruption that
  // every later answer would cite through.
  const vectors = await embedder.embed(specimenClauses.map((one) => one.body));
  for (const [at, clause] of specimenClauses.entries()) {
    await client.query(
      `INSERT INTO eval_chunk (ref, source, body, embedding)
       VALUES ($1, $2, $3, $4::vector)`,
      [clause.ref, clause.source, clause.body, toVector(vectors[at])],
    );
  }
}

// pgvector's text input format. The driver has no vector type, so the value
// crosses as text and is cast by Postgres.
function toVector(vector: number[] | undefined): string {
  if (!vector) throw new Error('the embedder returned no vector');
  return `[${vector.join(',')}]`;
}
