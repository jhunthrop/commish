CREATE TYPE "public"."draft_format" AS ENUM('snake', 'auction');--> statement-breakpoint
CREATE TYPE "public"."draft_status" AS ENUM('scheduled', 'in_progress', 'complete');--> statement-breakpoint
CREATE TYPE "public"."experience_tier" AS ENUM('beginner', 'experienced');--> statement-breakpoint
CREATE TABLE "draft_actions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"draft_id" text NOT NULL,
	"action" jsonb NOT NULL,
	"timestamp" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "draft_picks" (
	"draft_id" text NOT NULL,
	"team_id" text NOT NULL,
	"player_id" text NOT NULL,
	"round" integer NOT NULL,
	"pick_number" integer NOT NULL,
	"price" integer,
	CONSTRAINT "draft_picks_draft_id_pick_number_pk" PRIMARY KEY("draft_id","pick_number")
);
--> statement-breakpoint
CREATE TABLE "drafts" (
	"id" text PRIMARY KEY NOT NULL,
	"league_id" text NOT NULL,
	"format" "draft_format" NOT NULL,
	"status" "draft_status" DEFAULT 'scheduled' NOT NULL,
	"kickoff_at" timestamp with time zone NOT NULL,
	"auction_budget" integer
);
--> statement-breakpoint
CREATE TABLE "leagues" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"format" "draft_format" NOT NULL,
	"team_count" integer NOT NULL,
	"stake_tier" integer DEFAULT 0 NOT NULL,
	"is_public_matchmade" boolean DEFAULT false NOT NULL,
	"invite_code" text NOT NULL,
	"commissioner_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "leagues_invite_code_unique" UNIQUE("invite_code")
);
--> statement-breakpoint
CREATE TABLE "matchups" (
	"league_id" text NOT NULL,
	"week_number" integer NOT NULL,
	"home_team_id" text NOT NULL,
	"away_team_id" text NOT NULL,
	"home_score" real,
	"away_score" real,
	CONSTRAINT "matchups_league_id_week_number_home_team_id_pk" PRIMARY KEY("league_id","week_number","home_team_id")
);
--> statement-breakpoint
CREATE TABLE "roster_slots" (
	"team_id" text NOT NULL,
	"slot" text NOT NULL,
	"slot_index" integer NOT NULL,
	"player_id" text,
	CONSTRAINT "roster_slots_team_id_slot_slot_index_pk" PRIMARY KEY("team_id","slot","slot_index")
);
--> statement-breakpoint
CREATE TABLE "scoring_settings" (
	"league_id" text PRIMARY KEY NOT NULL,
	"points_per_passing_yard" real NOT NULL,
	"points_per_passing_touchdown" real NOT NULL,
	"points_per_interception" real NOT NULL,
	"points_per_rushing_yard" real NOT NULL,
	"points_per_rushing_touchdown" real NOT NULL,
	"points_per_receiving_yard" real NOT NULL,
	"points_per_receiving_touchdown" real NOT NULL,
	"points_per_reception" real NOT NULL,
	"points_per_fumble_lost" real NOT NULL,
	"te_reception_bonus" real DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "teams" (
	"id" text PRIMARY KEY NOT NULL,
	"league_id" text NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"display_name" text NOT NULL,
	"experience_tier" "experience_tier" DEFAULT 'beginner' NOT NULL,
	"avatar_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "weeks" (
	"league_id" text NOT NULL,
	"week_number" integer NOT NULL,
	CONSTRAINT "weeks_league_id_week_number_pk" PRIMARY KEY("league_id","week_number")
);
--> statement-breakpoint
ALTER TABLE "draft_actions" ADD CONSTRAINT "draft_actions_draft_id_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."drafts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draft_picks" ADD CONSTRAINT "draft_picks_draft_id_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."drafts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draft_picks" ADD CONSTRAINT "draft_picks_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drafts" ADD CONSTRAINT "drafts_league_id_leagues_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leagues" ADD CONSTRAINT "leagues_commissioner_user_id_users_id_fk" FOREIGN KEY ("commissioner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matchups" ADD CONSTRAINT "matchups_league_id_leagues_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matchups" ADD CONSTRAINT "matchups_home_team_id_teams_id_fk" FOREIGN KEY ("home_team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matchups" ADD CONSTRAINT "matchups_away_team_id_teams_id_fk" FOREIGN KEY ("away_team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roster_slots" ADD CONSTRAINT "roster_slots_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scoring_settings" ADD CONSTRAINT "scoring_settings_league_id_leagues_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_league_id_leagues_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weeks" ADD CONSTRAINT "weeks_league_id_leagues_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "draft_actions_draft_id_id_idx" ON "draft_actions" USING btree ("draft_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "draft_picks_draft_player_idx" ON "draft_picks" USING btree ("draft_id","player_id");--> statement-breakpoint
CREATE INDEX "drafts_league_id_idx" ON "drafts" USING btree ("league_id");--> statement-breakpoint
CREATE INDEX "sessions_user_id_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "teams_league_id_idx" ON "teams" USING btree ("league_id");--> statement-breakpoint
CREATE INDEX "teams_user_id_idx" ON "teams" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "teams_league_user_idx" ON "teams" USING btree ("league_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_idx" ON "users" USING btree ("email");