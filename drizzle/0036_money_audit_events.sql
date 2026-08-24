-- Phase 4, ruling 2: the audit vocabulary grows by ten money events — its OWN migration, apart
-- from 0035's tables, because a value added by ALTER TYPE ... ADD VALUE must not be used inside
-- the transaction that adds it (drizzle-kit wraps each migration file in one transaction; the
-- first INSERT naming these values lands tasks later, so the split keeps that law by structure).
-- Order matters and matches @/domain/audit's AUDIT_EVENT_TYPES exactly: index-plans.test.ts
-- pins pg_enum's labels to that array, in enum sort order.
ALTER TYPE "public"."audit_event_type" ADD VALUE 'deposit_completed';--> statement-breakpoint
ALTER TYPE "public"."audit_event_type" ADD VALUE 'deposit_returned';--> statement-breakpoint
ALTER TYPE "public"."audit_event_type" ADD VALUE 'withdrawal_requested';--> statement-breakpoint
ALTER TYPE "public"."audit_event_type" ADD VALUE 'withdrawal_completed';--> statement-breakpoint
ALTER TYPE "public"."audit_event_type" ADD VALUE 'withdrawal_returned';--> statement-breakpoint
ALTER TYPE "public"."audit_event_type" ADD VALUE 'entry_fee_collected';--> statement-breakpoint
ALTER TYPE "public"."audit_event_type" ADD VALUE 'entry_fee_refunded';--> statement-breakpoint
ALTER TYPE "public"."audit_event_type" ADD VALUE 'prize_paid';--> statement-breakpoint
ALTER TYPE "public"."audit_event_type" ADD VALUE 'payout_held';--> statement-breakpoint
ALTER TYPE "public"."audit_event_type" ADD VALUE 'payout_released';