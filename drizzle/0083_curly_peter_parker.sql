CREATE TABLE "player_peek_documents" (
	"player_id" text NOT NULL,
	"season" integer NOT NULL,
	"scoring_hash" text NOT NULL,
	"document" jsonb NOT NULL,
	"basis" jsonb NOT NULL,
	"as_of" timestamp with time zone NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "player_peek_documents" ADD CONSTRAINT "player_peek_documents_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "player_peek_documents_document_idx" ON "player_peek_documents" USING btree ("season","scoring_hash","player_id","as_of");