-- Tay v0.6 — add an index on audit_log to make the "read latest row"
-- lookup fast on every appendAudit call.
--
-- The hash-chain writer reads the most-recent row's this_hash to use as
-- the next row's prev_hash. Without an index this is O(N) every call.
-- The (occurred_at DESC, id DESC) compound index is also the order the
-- verifier walks forward (just ASC), so it serves both reads.
--
-- Idempotent: CREATE INDEX IF NOT EXISTS — re-running this migration
-- against an already-indexed DB is a no-op.

CREATE INDEX IF NOT EXISTS audit_log_occurred_at_idx
  ON audit_log (occurred_at DESC, id DESC);
