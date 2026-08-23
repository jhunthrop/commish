ALTER TABLE "leagues" ALTER COLUMN "commissioner_user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "leagues" ADD COLUMN "house_rung" text;--> statement-breakpoint
ALTER TABLE "leagues" ADD CONSTRAINT "leagues_house_commissioner_ck"
  CHECK (("house_rung" IS NULL) = ("commissioner_user_id" IS NOT NULL));--> statement-breakpoint
CREATE INDEX "leagues_house_rung_idx" ON "leagues" ("house_rung", "created_at") WHERE "house_rung" IS NOT NULL;
