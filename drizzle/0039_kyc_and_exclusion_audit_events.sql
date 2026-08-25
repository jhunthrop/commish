-- Task 7's fix round: the audit vocabulary's second growth (ruling 2, applied again) — its OWN
-- migration, apart from any table change, for the same reason 0036 is: a value added by
-- ALTER TYPE ... ADD VALUE must not be used inside the transaction that adds it.
-- Order matters and matches @/domain/audit's AUDIT_EVENT_TYPES exactly: index-plans.test.ts pins
-- pg_enum's labels to that array, in enum sort order.
ALTER TYPE "public"."audit_event_type" ADD VALUE 'self_exclusion_set';--> statement-breakpoint
ALTER TYPE "public"."audit_event_type" ADD VALUE 'self_exclusion_cleared';--> statement-breakpoint
ALTER TYPE "public"."audit_event_type" ADD VALUE 'kyc_status_changed';