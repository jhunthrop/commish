-- A DEDICATED SQLSTATE FOR HISTORY-REWRITE REJECTIONS (job-system fix round 2, MEDIUM-B).
--
-- 0068's triggers raised `check_violation`, and the store recognised a reclaimed attempt's late
-- finish by matching the trigger's ENGLISH — a sentence edit away from silent desync, the same
-- disease the freeze classifier had. This migration replaces the two trigger FUNCTIONS (a new
-- migration, never an edit to an applied one; the triggers themselves keep pointing at the same
-- function names) so every "you may not rewrite recorded history" rejection carries SQLSTATE
-- 'JB001' — one custom code, exported beside the store as JOB_HISTORY_REWRITE_SQLSTATE, matched
-- by `isSupersededAttempt` on `.code` alone. Messages are unchanged for the humans reading logs.
--
-- What carries JB001 and what does not, exactly:
--   - job_runs UPDATE of a finished row  -> JB001 (the reclaim race's signature).
--   - job_run_steps UPDATE or DELETE     -> JB001 (rewriting a recorded checkpoint is the same
--     class of act; nothing in the system does either, so this is belt for the same suspenders).
--   - job_runs DELETE                    -> stays check_violation: deleting a run row is not a
--     "newer attempt owns this job" signal, and giving it JB001 would teach isSupersededAttempt
--     to swallow a genuinely wrong DELETE as a benign race.
CREATE OR REPLACE FUNCTION job_runs_append_only() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'job_runs is append-only history: DELETE is not permitted on this table'
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status <> 'running' THEN
    RAISE EXCEPTION 'job_runs is append-only history: a finished run (status %) may not be rewritten', OLD.status
      USING ERRCODE = 'JB001';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION job_run_steps_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'job_run_steps is an append-only checkpoint log: % is not permitted on this table', TG_OP
    USING ERRCODE = 'JB001';
END;
$$ LANGUAGE plpgsql;
