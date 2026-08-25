import type { Db } from "@/db/client";
import { users } from "@/db/schema";
import { MOCK_CONFIG } from "@/mock-draft/config";

/**
 * The reserved email host every bot user's `users.email` resolves under — deliberately not
 * `DEV_SEED.emailDomain` (`./config.ts`), so a bot row can never collide with, or be mistaken
 * for, a seeded developer identity. Routable nowhere: nothing ever sends mail to a `bot_*`
 * account, because nothing in the product ever needs to (a bot holds no session, no
 * `user_preferences` row, no notice).
 */
const BOT_EMAIL_DOMAIN = "bots.commish.internal";

/**
 * Phase 4.5, Task 2: the ONE writer of the platform's practice-opponent roster
 * (`MOCK_CONFIG.botRoster`, `@/mock-draft/config`) into `users`, called from two places that both
 * need a fresh database to already hold every bot before they seat one — `npm run seed` (below)
 * and `createMockRoom`'s own ensure step (`@/mock-draft-service/creation`, Task 5). Neither
 * caller may assume the other already ran: a freshly deployed production database has never run
 * `npm run seed` at all, so `createMockRoom` calls this on its own, inside its own transaction,
 * exactly the way this function's `ON CONFLICT DO NOTHING` makes safe to call every time.
 *
 * `MOCK_CONFIG.botRoster`'s own `id`s ARE the deterministic `users.id`s (`bot_park`, `bot_
 * earlybird`, ...) — never a generated id, because `rngFor` (`@/mock-draft/rng`) keys a bot's
 * seeded stream off this exact id, so a bot's id is load-bearing for replay the moment a draft
 * exists that seated it. The reserved `<id>@bots.commish.internal` address satisfies `users.
 * email`'s `NOT NULL UNIQUE` constraint (`@/db/schema`) without inventing a real mailbox.
 *
 * NOT GUARDED behind `assertLocalSeedTarget()` (unlike every other seeder in this directory):
 * every one of those creates placeholder DEVELOPER identities that must never exist in
 * production, while a bot row is a real, permanent, production fixture this product needs the
 * day its first mock room is created — the guard those seeders carry would make this function
 * unusable from the one production call site (`createMockRoom`) that most needs it.
 *
 * Idempotent by construction: a second call against a database that already holds the roster
 * inserts nothing and errors on nothing, which is what lets both call sites run this
 * unconditionally rather than checking first.
 */
export async function ensureMockBotRoster(db: Db): Promise<void> {
  await db
    .insert(users)
    .values(
      MOCK_CONFIG.botRoster.map((bot) => ({
        id: bot.id,
        email: `${bot.id}@${BOT_EMAIL_DOMAIN}`,
        displayName: bot.name,
        isBot: true,
      })),
    )
    .onConflictDoNothing({ target: users.id });
}
