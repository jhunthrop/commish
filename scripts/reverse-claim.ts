// Reverse one free-agency claim, by its audit event id — the operator's compensating action,
// `sweep-trade-fairness`'s sibling in idiom. Usage:
//
//   dotenv -e .env.local -- tsx scripts/reverse-claim.ts <auditEventId> <operatorUserId>
//
// The event names the team, the added player and the drop; the reversal re-derives its own
// safety from CURRENT state (the added player must still be on that roster, the dropped one
// must still be free), so running this twice refuses in words the second time rather than
// double-moving anybody. See `reverseClaimInTx`'s docblock for the whole account.
import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { auditEvents } from "@/db/schema";
import { reverseClaimInTx } from "@/league-service/claims";

function usage(): never {
  console.error("usage: tsx scripts/reverse-claim.ts <auditEventId> <operatorUserId>");
  process.exit(1);
}

async function main(): Promise<void> {
  const [eventId, operatorUserId] = process.argv.slice(2);
  if (eventId === undefined || operatorUserId === undefined) usage();

  const db = getDb();
  const [event] = await db.select().from(auditEvents).where(eq(auditEvents.eventId, eventId));
  if (event === undefined) {
    console.error(`No audit event ${eventId}.`);
    process.exit(1);
  }
  const payload = event.payload as { reason?: string; teamId?: string; addedPlayerId?: string; droppedPlayerId?: string | null };
  if (event.eventType !== "roster_move" || payload.reason !== "claim" || event.leagueId === null || payload.teamId === undefined || payload.addedPlayerId === undefined) {
    console.error(`Event ${eventId} is not a claim (${event.eventType}, reason ${payload.reason ?? "none"}).`);
    process.exit(1);
  }

  const result = await db.transaction((tx) =>
    reverseClaimInTx(tx, {
      leagueId: event.leagueId!,
      teamId: payload.teamId!,
      addedPlayerId: payload.addedPlayerId!,
      droppedPlayerId: payload.droppedPlayerId ?? null,
      reversesEventId: eventId,
      operatorUserId,
      clock: { now: () => new Date().toISOString() },
    }),
  );
  if (!result.ok) {
    console.error(`Refused: ${result.reason}`);
    process.exit(1);
  }
  console.log(`Reversed claim ${eventId}: ${payload.addedPlayerId} off ${payload.teamId}${payload.droppedPlayerId ? `, ${payload.droppedPlayerId} restored` : ""}.`);
  process.exit(0);
}

void main();
