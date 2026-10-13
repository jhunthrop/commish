// THE PRELOAD FOR RUNNING AN OPERATOR SCRIPT AS IS — `npx tsx --import <this> scripts/x.ts ...`.
//
// A script whose body is its `main()` cannot be imported by `run.ts` without running it, so the
// harness runs the script itself, unmodified, with this module loaded first: it installs the same
// replayed `fetch` and the same frozen wall clock `run.ts` installs, and writes which recordings
// were served to PARITY_REQUESTED_OUT when the process exits.
import { writeFileSync } from "node:fs";
import { installReplay } from "./replay";
import { freezeWallClock } from "./clock";

const dirs = (process.env.PARITY_FIXTURE_DIRS ?? "").split("\n").filter((dir) => dir !== "");
const nowIso = process.env.PARITY_NOW;
const out = process.env.PARITY_REQUESTED_OUT;
if (nowIso === undefined || out === undefined) {
  throw new Error("preload: PARITY_NOW and PARITY_REQUESTED_OUT must be set.");
}
freezeWallClock(Date.parse(nowIso));
const requested = installReplay(dirs);
process.on("exit", () => {
  writeFileSync(out, JSON.stringify({ requested }));
});
