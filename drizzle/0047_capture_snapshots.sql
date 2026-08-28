CREATE TABLE "capture_snapshots" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"captured_at" timestamp with time zone NOT NULL,
	"digest" text NOT NULL,
	"payload" jsonb NOT NULL
);
--> statement-breakpoint
CREATE INDEX "capture_snapshots_source_captured_idx" ON "capture_snapshots" USING btree ("source","captured_at");