CREATE TYPE "public"."mock_mode" AS ENUM('solo', 'lobby', 'link');--> statement-breakpoint
CREATE TABLE "mock_rooms" (
	"league_id" text PRIMARY KEY NOT NULL,
	"host_user_id" text NOT NULL,
	"mode" "mock_mode" NOT NULL,
	"pick_seconds" integer NOT NULL,
	"bot_seed" integer NOT NULL,
	"share_code" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mock_rooms_pick_seconds_positive_ck" CHECK ("mock_rooms"."pick_seconds" > 0)
);
--> statement-breakpoint
ALTER TABLE "leagues" ADD COLUMN "is_mock" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "is_bot" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "mock_rooms" ADD CONSTRAINT "mock_rooms_league_id_leagues_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mock_rooms" ADD CONSTRAINT "mock_rooms_host_user_id_users_id_fk" FOREIGN KEY ("host_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mock_rooms_share_code_idx" ON "mock_rooms" USING btree ("share_code");--> statement-breakpoint
CREATE INDEX "mock_rooms_starts_at_idx" ON "mock_rooms" USING btree ("starts_at");