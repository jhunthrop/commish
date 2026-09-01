CREATE TYPE "public"."board_moment_kind" AS ENUM('replay', 'live');--> statement-breakpoint
ALTER TABLE "preseason_projections" ALTER COLUMN "moment_kind" SET DEFAULT 'replay'::"public"."board_moment_kind";--> statement-breakpoint
ALTER TABLE "preseason_projections" ALTER COLUMN "moment_kind" SET DATA TYPE "public"."board_moment_kind" USING "moment_kind"::"public"."board_moment_kind";