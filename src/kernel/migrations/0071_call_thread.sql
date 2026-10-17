-- #252. The Call thread: one history per ServiceCall, shared by every staff
-- account that works it. Not an office retrieval thread (that one is per
-- account and bound) and not a Conversation. Staff owns the store; evidence
-- owns the turn that writes to it.
--
-- Every timestamp comes from the injected clock. No DEFAULT now().

CREATE TABLE IF NOT EXISTS call_thread (
  call_thread_id uuid PRIMARY KEY,
  service_call_id uuid NOT NULL UNIQUE
    REFERENCES service_call (service_call_id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('writing', 'ready', 'skipped')),
  skip_reason text CHECK (
    skip_reason IS NULL OR skip_reason IN ('guarantor', 'whatsapp', 'off')
  ),
  created_at timestamptz NOT NULL,
  CONSTRAINT call_thread_skip_shape CHECK (
    (status = 'skipped' AND skip_reason IS NOT NULL)
    OR (status <> 'skipped' AND skip_reason IS NULL)
  )
);

CREATE TABLE IF NOT EXISTS call_turn (
  call_turn_id uuid PRIMARY KEY,
  call_thread_id uuid NOT NULL
    REFERENCES call_thread (call_thread_id) ON DELETE CASCADE,
  asked_at timestamptz NOT NULL,
  ordinal integer NOT NULL CHECK (ordinal >= 0),
  -- 'copilot' for the automatic brief. A later turn may name a staff account.
  asker text NOT NULL,
  -- pii -- the call's description, which may name a household.
  question text NOT NULL,
  -- pii -- the cited answer or the refusal sentence.
  answer text NOT NULL,
  refused boolean NOT NULL,
  citations jsonb NOT NULL,
  hit_ids uuid[] NOT NULL
);
