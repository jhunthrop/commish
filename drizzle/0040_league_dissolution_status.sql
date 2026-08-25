-- Phase 4, Task 9: the season-state fact `dissolveLeague` (@/money-service/dissolution) stamps
-- on a pre-draft league's own drafts row. Own migration, apart from any table change, on 0039's
-- own precedent -- a value ALTER TYPE ... ADD VALUE adds must not be used inside the transaction
-- that adds it. See @/domain/draft's DraftStatus docblock for what this value means and where it
-- is (and is not) read.
ALTER TYPE "public"."draft_status" ADD VALUE 'dissolved';
