CREATE TABLE "model_artifacts" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"version" integer NOT NULL,
	"fit_stamp" timestamp with time zone NOT NULL,
	"fitted_on" text NOT NULL,
	"payload" jsonb NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "model_artifacts_version_ck" CHECK ("model_artifacts"."version" >= 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "model_artifacts_name_version_idx" ON "model_artifacts" USING btree ("name","version");