CREATE TABLE "trade_proposals" (
	"id" text PRIMARY KEY NOT NULL,
	"league_id" text NOT NULL,
	"proposer_team_id" text NOT NULL,
	"counterparty_team_id" text NOT NULL,
	"week_number" integer NOT NULL,
	"proposer_assets" jsonb NOT NULL,
	"counterparty_assets" jsonb NOT NULL,
	"fingerprint" text NOT NULL,
	"note" text,
	"status" text NOT NULL,
	"proposed_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"settled_at" timestamp with time zone,
	"settled_by_user_id" text,
	"reversed_at" timestamp with time zone,
	"reversed_by_flag_id" text
);
--> statement-breakpoint
ALTER TABLE "trade_proposals" ADD CONSTRAINT "trade_proposals_league_id_leagues_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_proposals" ADD CONSTRAINT "trade_proposals_proposer_team_id_teams_id_fk" FOREIGN KEY ("proposer_team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_proposals" ADD CONSTRAINT "trade_proposals_counterparty_team_id_teams_id_fk" FOREIGN KEY ("counterparty_team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_proposals" ADD CONSTRAINT "trade_proposals_settled_by_user_id_users_id_fk" FOREIGN KEY ("settled_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "trade_proposals_open_fingerprint_idx" ON "trade_proposals" USING btree ("fingerprint") WHERE "trade_proposals"."status" = 'open';--> statement-breakpoint
CREATE INDEX "trade_proposals_inbox_idx" ON "trade_proposals" USING btree ("counterparty_team_id","proposed_at") WHERE "trade_proposals"."status" = 'open';--> statement-breakpoint
CREATE INDEX "trade_proposals_outbox_idx" ON "trade_proposals" USING btree ("proposer_team_id","proposed_at") WHERE "trade_proposals"."status" = 'open';--> statement-breakpoint
CREATE INDEX "trade_proposals_league_idx" ON "trade_proposals" USING btree ("league_id","proposed_at");