CREATE TABLE "seat_holds" (
  "token" text PRIMARY KEY,
  "league_id" text NOT NULL REFERENCES "leagues"("id") ON DELETE CASCADE,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "expires_at" timestamptz NOT NULL,
  "consumed_at" timestamptz
);
CREATE INDEX "seat_holds_live_idx" ON "seat_holds" ("league_id", "expires_at") WHERE "consumed_at" IS NULL;
