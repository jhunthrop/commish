CREATE TABLE "trade_vetoes" (
	"trade_id" text NOT NULL,
	"user_id" text NOT NULL,
	"cast_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trade_vetoes_trade_id_user_id_pk" PRIMARY KEY("trade_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "trade_proposals" ADD COLUMN "review_ends_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "trade_vetoes" ADD CONSTRAINT "trade_vetoes_trade_id_trade_proposals_id_fk" FOREIGN KEY ("trade_id") REFERENCES "public"."trade_proposals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_vetoes" ADD CONSTRAINT "trade_vetoes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;