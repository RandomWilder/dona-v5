-- #113. The office retrieval thread: one history per staff account × retrieval
-- bound. Not a Conversation. Staff owns the store; evidence owns the turn that
-- writes to it. Clear deletes the thread row and its turns for that account
-- and bound only. No retention job.
--
-- Every timestamp comes from the injected clock. No DEFAULT now().

CREATE TABLE IF NOT EXISTS office_retrieval_thread (
  office_retrieval_thread_id uuid PRIMARY KEY,
  staff_account_id uuid NOT NULL REFERENCES staff_account (staff_account_id),
  bound_kind text NOT NULL CHECK (bound_kind IN ('unit', 'building', 'portfolio')),
  -- Null only when the bound is the whole portfolio, which has no id.
  bound_id uuid,
  created_at timestamptz NOT NULL,
  CONSTRAINT office_retrieval_thread_bound_shape CHECK (
    (bound_kind = 'portfolio' AND bound_id IS NULL)
    OR (bound_kind IN ('unit', 'building') AND bound_id IS NOT NULL)
  ),
  -- Two null bound_ids (two portfolio threads for one operator) would otherwise
  -- both be allowed: ordinary UNIQUE treats null as distinct.
  CONSTRAINT office_retrieval_thread_account_bound
    UNIQUE NULLS NOT DISTINCT (staff_account_id, bound_kind, bound_id)
);

CREATE TABLE IF NOT EXISTS office_retrieval_turn (
  office_retrieval_turn_id uuid PRIMARY KEY,
  office_retrieval_thread_id uuid NOT NULL
    REFERENCES office_retrieval_thread (office_retrieval_thread_id)
    ON DELETE CASCADE,
  asked_at timestamptz NOT NULL,
  -- Oldest-first order on a thread. asked_at comes from the injected clock and
  -- can repeat when tests freeze time; ordinal cannot.
  ordinal integer NOT NULL CHECK (ordinal >= 0),
  -- pii -- the operator's question, which may name a household.
  question text NOT NULL,
  -- pii -- the cited answer or the refusal sentence.
  answer text NOT NULL,
  refused boolean NOT NULL,
  citations jsonb NOT NULL,
  hit_ids uuid[] NOT NULL
);
