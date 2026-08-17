ALTER TABLE "scoring_settings" ADD COLUMN "points_per_field_goal" real NOT NULL;--> statement-breakpoint
ALTER TABLE "scoring_settings" ADD COLUMN "points_per_extra_point" real NOT NULL;--> statement-breakpoint
ALTER TABLE "scoring_settings" ADD COLUMN "points_per_sack" real NOT NULL;--> statement-breakpoint
ALTER TABLE "scoring_settings" ADD COLUMN "points_per_defensive_interception" real NOT NULL;--> statement-breakpoint
ALTER TABLE "scoring_settings" ADD COLUMN "points_per_defensive_touchdown" real NOT NULL;