CREATE TYPE "public"."transfer_direction" AS ENUM('deposit', 'withdrawal');--> statement-breakpoint
CREATE TABLE "payment_transfer_intents" (
	"provider_transfer_ref" text PRIMARY KEY NOT NULL,
	"direction" "transfer_direction" NOT NULL,
	"user_id" text NOT NULL,
	"amount_cents" bigint NOT NULL,
	"method" text,
	"state_of_entry" char(2) NOT NULL,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_transfer_intents_amount_positive_ck" CHECK ("payment_transfer_intents"."amount_cents" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "payment_transfer_intents_idempotency_key_idx" ON "payment_transfer_intents" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "payment_transfer_intents_user_created_idx" ON "payment_transfer_intents" USING btree ("user_id","created_at");