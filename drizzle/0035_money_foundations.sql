CREATE TYPE "public"."kyc_status" AS ENUM('none', 'pending', 'verified', 'failed');--> statement-breakpoint
CREATE TYPE "public"."money_account_kind" AS ENUM('fbo_pool', 'provider_clearing', 'platform_receivable', 'user_available', 'league_escrow', 'held_for_review', 'platform_rake', 'platform_forfeiture');--> statement-breakpoint
CREATE TYPE "public"."money_direction" AS ENUM('debit', 'credit');--> statement-breakpoint
CREATE TYPE "public"."money_txn_kind" AS ENUM('deposit', 'deposit_return', 'withdrawal_request', 'withdrawal_complete', 'withdrawal_return', 'withdrawal_fail', 'entry_fee', 'entry_fee_refund', 'settlement', 'hold_release', 'hold_confiscation', 'receivable_settlement');--> statement-breakpoint
CREATE TABLE "money_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" "money_account_kind" NOT NULL,
	"owner_id" text,
	"balance_cents" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "money_accounts_balance_floor_ck" CHECK ("money_accounts"."balance_cents" >= 0 OR "money_accounts"."kind" IN ('fbo_pool', 'provider_clearing', 'platform_receivable'))
);
--> statement-breakpoint
CREATE TABLE "money_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"transaction_id" text NOT NULL,
	"account_id" text NOT NULL,
	"direction" "money_direction" NOT NULL,
	"amount_cents" bigint NOT NULL,
	"state_of_entry" char(2) NOT NULL,
	"tax_year" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "money_entries_amount_positive_ck" CHECK ("money_entries"."amount_cents" > 0)
);
--> statement-breakpoint
CREATE TABLE "money_transactions" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" "money_txn_kind" NOT NULL,
	"league_id" text,
	"provider_transfer_ref" text,
	"idempotency_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "leagues" ADD COLUMN "entry_fee_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "leagues" ADD COLUMN "platform_fee_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "leagues" ADD COLUMN "payout_table" jsonb;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "kyc_status" "kyc_status" DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "self_excluded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "money_entries" ADD CONSTRAINT "money_entries_transaction_id_money_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."money_transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "money_entries" ADD CONSTRAINT "money_entries_account_id_money_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."money_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "money_entries_account_created_idx" ON "money_entries" USING btree ("account_id","created_at");--> statement-breakpoint
CREATE INDEX "money_entries_tax_year_state_idx" ON "money_entries" USING btree ("tax_year","state_of_entry");--> statement-breakpoint
CREATE UNIQUE INDEX "money_transactions_idempotency_key_idx" ON "money_transactions" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "money_transactions_league_idx" ON "money_transactions" USING btree ("league_id");--> statement-breakpoint
-- HAND-WRITTEN, appended after `drizzle-kit generate --name money_foundations`, exactly as 0019
-- did for `audit_events` and 0021 for `audit_chain_checkpoints`: drizzle has no trigger builder.
-- `src/db/index-plans.test.ts` reads pg_trigger back out of the catalog, so a future migration
-- that recreates either table and forgets these triggers fails the build rather than the book.
--
-- WHY. The ledger is the book of record for a pooled FBO account (founder decision 1): a member's
-- balance is provable only because the history under it cannot be edited. The service layer
-- promising append-only (`postMoneyTransaction` exposes no update or delete) is one bug away from
-- breaking the promise; a trigger holds it against raw SQL too. BOTH tables are guarded — the
-- transaction row names what happened and its entries are the arithmetic, and history editable at
-- either level is not history. `money_accounts` is deliberately NOT guarded: it is the mutable
-- rollup (the `audit_chains` shape), advanced by every posting and reconciled against the entries.
--
-- TRUNCATE is deliberately not blocked, exactly as in 0019 and 0021 and for ruling 26's reason:
-- `truncateAll` is how every integration test in this repo starts, and TRUNCATE already requires
-- the table ownership that can DROP TABLE or DISABLE TRIGGER anyway.
CREATE OR REPLACE FUNCTION money_entries_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'money_entries is append-only: % is not permitted on this table', TG_OP
    USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER money_entries_no_update BEFORE UPDATE ON money_entries
  FOR EACH ROW EXECUTE FUNCTION money_entries_append_only();
--> statement-breakpoint
CREATE TRIGGER money_entries_no_delete BEFORE DELETE ON money_entries
  FOR EACH ROW EXECUTE FUNCTION money_entries_append_only();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION money_transactions_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'money_transactions is append-only: % is not permitted on this table', TG_OP
    USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER money_transactions_no_update BEFORE UPDATE ON money_transactions
  FOR EACH ROW EXECUTE FUNCTION money_transactions_append_only();
--> statement-breakpoint
CREATE TRIGGER money_transactions_no_delete BEFORE DELETE ON money_transactions
  FOR EACH ROW EXECUTE FUNCTION money_transactions_append_only();
