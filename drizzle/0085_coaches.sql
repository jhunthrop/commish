CREATE TABLE "coaches" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"season" integer NOT NULL,
	"team" text NOT NULL,
	"role" text NOT NULL,
	"name" text NOT NULL,
	"start_week" integer NOT NULL,
	"end_week" integer NOT NULL,
	"source" text NOT NULL,
	"note" text NOT NULL,
	"head_coach" text,
	"head_coach_first_season" integer,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "coaches_role_ck" CHECK ("coaches"."role" IN ('HC', 'OC')),
	CONSTRAINT "coaches_source_ck" CHECK ("coaches"."source" IN ('wikipedia', 'pfr', 'both')),
	CONSTRAINT "coaches_weeks_ck" CHECK ("coaches"."start_week" >= 1 AND "coaches"."start_week" <= "coaches"."end_week"),
	CONSTRAINT "coaches_head_coach_pair_ck" CHECK (("coaches"."head_coach" IS NULL) = ("coaches"."head_coach_first_season" IS NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "coaches_tenure_idx" ON "coaches" USING btree ("season","team","role","start_week");