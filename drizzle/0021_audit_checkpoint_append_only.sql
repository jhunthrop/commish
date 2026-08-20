-- HAND-WRITTEN (`drizzle-kit generate --custom`), for the same reason 0019's two triggers were:
-- drizzle has no trigger builder. There is no schema change here at all — this migration exists
-- only to put `audit_chain_checkpoints` behind the same kind of guard `audit_events` already has.
-- `src/db/index-plans.test.ts` reads pg_trigger back out of the catalog, so a future migration
-- that recreates this table and forgets these triggers fails the build rather than the audit.
--
-- WHY. The verifier reconciles three accounts of how many events a chain holds: the rows it
-- walks, `audit_chains.head_sequence`, and this table's `verified_through_sequence`. An adversary
-- who deletes the tail of `audit_events` and rewinds the anchor to match leaves the first two
-- agreeing with each other, and this frozen row is the only thing left that says otherwise. A
-- detector an adversary can delete is not a detector, and one they can rewind is worse than none
-- because it looks like agreement.
--
-- NOT the same trigger as `audit_events`': this table is verification's own mutable state, not the
-- record, and the verifier legitimately advances it on every clean walk. So UPDATE is permitted
-- exactly as far as a freeze needs it — forward, or standing still (re-verifying a chain nothing
-- has been appended to since re-freezes the same sequence, and that must keep working) — while
-- moving it BACKWARDS, or onto a different chain, is refused. DELETE is refused outright.
--
-- TRUNCATE is deliberately not blocked, exactly as in 0019 and for exactly ruling 26's reason:
-- `truncateAll` is how every integration test in this repo starts, and TRUNCATE already requires
-- the table ownership that can DROP TABLE or DISABLE TRIGGER anyway.
CREATE OR REPLACE FUNCTION audit_chain_checkpoints_forward_only() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'audit_chain_checkpoints is a detector, not scratch space: DELETE is not permitted on this table'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.scope <> OLD.scope THEN
    RAISE EXCEPTION 'audit_chain_checkpoints.scope is the chain this checkpoint verified and may not be moved (% to %)', OLD.scope, NEW.scope
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.verified_through_sequence < OLD.verified_through_sequence THEN
    RAISE EXCEPTION 'audit_chain_checkpoints only moves forward: % is behind the frozen %', NEW.verified_through_sequence, OLD.verified_through_sequence
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER audit_chain_checkpoints_no_delete BEFORE DELETE ON audit_chain_checkpoints
  FOR EACH ROW EXECUTE FUNCTION audit_chain_checkpoints_forward_only();
--> statement-breakpoint
CREATE TRIGGER audit_chain_checkpoints_forward_only BEFORE UPDATE ON audit_chain_checkpoints
  FOR EACH ROW EXECUTE FUNCTION audit_chain_checkpoints_forward_only();
