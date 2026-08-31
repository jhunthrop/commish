ALTER TABLE "player_stat_lines" ADD COLUMN "two_point_conversions" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "player_stat_lines" ADD COLUMN "field_goals_missed" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "player_stat_lines" ADD COLUMN "extra_points_missed" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "player_stat_lines" ADD COLUMN "kick_return_touchdowns" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "player_stat_lines" ADD COLUMN "punt_return_touchdowns" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "player_stat_lines" ADD COLUMN "yards_allowed" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "player_stat_lines" ADD COLUMN "defensive_fumbles_recovered" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "player_stat_lines" ADD COLUMN "safeties" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "scoring_settings" ADD COLUMN "points_per_two_point_conversion" real DEFAULT 2 NOT NULL;--> statement-breakpoint
ALTER TABLE "scoring_settings" ADD COLUMN "points_per_field_goal_missed" real DEFAULT -1 NOT NULL;--> statement-breakpoint
ALTER TABLE "scoring_settings" ADD COLUMN "points_per_extra_point_missed" real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "scoring_settings" ADD COLUMN "points_per_return_touchdown" real DEFAULT 6 NOT NULL;--> statement-breakpoint
ALTER TABLE "scoring_settings" ADD COLUMN "points_per_defensive_fumble_recovery" real DEFAULT 2 NOT NULL;--> statement-breakpoint
ALTER TABLE "scoring_settings" ADD COLUMN "points_per_safety" real DEFAULT 2 NOT NULL;