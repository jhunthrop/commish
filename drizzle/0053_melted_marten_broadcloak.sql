ALTER TABLE "player_stat_lines" ADD COLUMN "targets" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "player_stat_lines" ADD COLUMN "carries" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "player_stat_lines" ADD COLUMN "pass_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "player_stat_lines" ADD COLUMN "pass_completions" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "player_stat_lines" ADD COLUMN "field_goals_attempted" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "player_stat_lines" ADD COLUMN "points_allowed" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "player_stat_lines" ADD COLUMN "offensive_snaps" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "player_stat_lines" ADD COLUMN "offensive_snap_share" real DEFAULT 0 NOT NULL;