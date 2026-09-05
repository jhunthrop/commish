CREATE TABLE "adp_snapshots" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"player_id" text NOT NULL,
	"source" text NOT NULL,
	"format" text NOT NULL,
	"adp" real NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sim_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"league_id" text,
	"config" jsonb NOT NULL,
	"config_hash" text NOT NULL,
	"board_generation" text NOT NULL,
	"status" "job_status" DEFAULT 'pending' NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"summary" jsonb,
	"error" text
);
--> statement-breakpoint
ALTER TABLE "adp_snapshots" ADD CONSTRAINT "adp_snapshots_player_id_nfl_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."nfl_players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sim_runs" ADD CONSTRAINT "sim_runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sim_runs" ADD CONSTRAINT "sim_runs_league_id_leagues_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "adp_snapshots_player_idx" ON "adp_snapshots" USING btree ("player_id","captured_at");--> statement-breakpoint
CREATE UNIQUE INDEX "adp_snapshots_player_source_captured_idx" ON "adp_snapshots" USING btree ("player_id","source","captured_at");--> statement-breakpoint
CREATE INDEX "sim_runs_user_idx" ON "sim_runs" USING btree ("user_id","requested_at");--> statement-breakpoint
CREATE INDEX "sim_runs_cache_idx" ON "sim_runs" USING btree ("user_id","config_hash","board_generation");