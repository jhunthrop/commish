// Dev-only: drives the seeded snake draft to round 3 and parks it with team_01 on the clock.
// Run: ALLOW_DESTRUCTIVE_SEED=1 dotenv -e .env.local -- tsx scripts/drive-dev-draft.ts
//
// "Never in production" is enforced, not asserted: `assertLocalSeedTarget` refuses unless the
// operator opted in AND `DATABASE_URL` is loopback. This script applies up to 200 real
// `MAKE_PICK` actions to a real draft — the hardcoded ids are not a guard.
import { getDb } from "@/db/client";
import { assertLocalSeedTarget } from "@/data/seed/guard";
import { createDraftStore } from "@/draft-service/store";
import { getPublisher } from "@/lib/realtime/publisher";
import { teamOnClock, bestAvailableFor } from "@/draft-engine";

const MY_TEAM = "dev_league_snake_team_01";
const DRAFT = "dev_draft_snake";

async function main() {
  assertLocalSeedTarget();
  const db = getDb();
  const publisher = getPublisher();
  const clock = { now: () => new Date().toISOString() };
  const store = createDraftStore({ db, clock, publish: (i) => publisher.publish(i) });

  let state = await store.getDraftState(DRAFT);
  if (!state) throw new Error("draft not found");
  if (state.phase === "scheduled") {
    const started = await store.startDraft(DRAFT);
    if (!started.ok) throw new Error("start failed: " + started.reason);
    state = started.state;
    console.log("draft started");
  }
  for (let i = 0; i < 200; i++) {
    if (state.phase !== "in_progress") break;
    const onClock = teamOnClock(state);
    if (!onClock) break;
    if (onClock === MY_TEAM && state.pickNumber >= 25) {
      console.log(`parked: pick ${state.pickNumber}, YOUR turn`);
      break;
    }
    const best = bestAvailableFor(state, onClock);
    if (!best) break;
    const r = await store.applyAction(DRAFT, {
      v: 1, type: "MAKE_PICK", teamId: onClock, playerId: best.playerId,
      timestamp: clock.now(),
    });
    if (!r.ok) throw new Error(`pick ${state.pickNumber} rejected: ${r.reason}`);
    state = r.state;
  }
  console.log(`done at pick ${state.pickNumber}, on clock: ${teamOnClock(state)}`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
