CREATE TABLE "player_prop_observations" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"event_id" text NOT NULL,
	"commence_time" timestamp with time zone NOT NULL,
	"bookmaker" text NOT NULL,
	"market" text NOT NULL,
	"player_name" text NOT NULL,
	"point" double precision NOT NULL,
	"over_price" integer NOT NULL,
	"under_price" integer NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "player_prop_observations_event_market_idx" ON "player_prop_observations" USING btree ("event_id","market");--> statement-breakpoint
CREATE INDEX "player_prop_observations_fetched_at_idx" ON "player_prop_observations" USING btree ("fetched_at");