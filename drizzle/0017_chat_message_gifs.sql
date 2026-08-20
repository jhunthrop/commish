CREATE TYPE "public"."chat_message_kind" AS ENUM('text', 'gif');--> statement-breakpoint
ALTER TABLE "chat_messages" ADD COLUMN "kind" "chat_message_kind" DEFAULT 'text' NOT NULL;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD COLUMN "gif_url" text;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD COLUMN "gif_preview_url" text;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD COLUMN "gif_alt" text;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD COLUMN "gif_width" integer;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD COLUMN "gif_height" integer;