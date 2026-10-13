// THE ADVISOR'S LATENCY, MEASURED (spec §2.3: under 50 ms per call at p90). Starts the advisor's own
// handler on an ephemeral port in this process, drafts a whole 12-team room by ADP from a stored
// board, asks `POST /advise` at every pick, and prints p50, p90 and the slowest call, server time and
// round trip both. The board is real data, never synthesized: a nightly run's board file
// (`runs/<runId>/boards/ppr-12.json`, which carries the kickers and defenses in market order), or
// the CSV export the approved mocks were built from. That export has no kickers or defenses, so its
// last rounds have no legal player for those slots and the advisor refuses them (422): measure a
// whole draft from a run's board file.
//
//   npx tsx scripts/advisor-measure.ts <path/to/runs/<runId>/boards/ppr-12.json | path/to/board.csv>
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { STANDARD_ROSTER_SLOTS } from "@research-ts/domain/roster";
import { handle } from "@research-ts/advisor/server";
import { snakeSeat } from "@research-ts/advisor/advise";
import type { AdviseRequest, PoolEntry } from "@research-ts/advisor/request";
import { totalRosterSlots } from "@research-ts/draft-engine/order";

const TEAM_COUNT = 12;
const POSITIONS = new Set(["QB", "RB", "WR", "TE", "K", "DEF"]);
/** The positions the served board ships in market order, with no projection (the kdef decision):
 *  the room sends them as the board does, so the late rounds exercise the advisor's fallback. */
const MARKET_ORDER_POSITIONS = new Set(["K", "DEF"]);

interface BoardFileRow {
  readonly playerId: string;
  readonly position: PoolEntry["position"];
  readonly marketAdp: number | null;
  readonly projectedPoints: number | null;
}

function poolFromRun(jsonPath: string): readonly PoolEntry[] {
  const { rows } = JSON.parse(readFileSync(jsonPath, "utf8")) as { readonly rows: readonly BoardFileRow[] };
  return rows.flatMap((row) => (row.marketAdp === null ? [] : [{ id: row.playerId, position: row.position, adp: row.marketAdp, projectedPoints: row.projectedPoints }]));
}

function poolFrom(path: string): readonly PoolEntry[] {
  return path.endsWith(".json") ? poolFromRun(path) : poolFromCsv(path);
}

function poolFromCsv(csvPath: string): readonly PoolEntry[] {
  const [header, ...lines] = readFileSync(csvPath, "utf8").trim().split("\n");
  const columns = header!.split(",");
  const at = (name: string): number => columns.indexOf(name);
  return lines.flatMap((line) => {
    const cells = line.split(",");
    const adp = Number(cells[at("adp")]);
    const position = cells[at("position")]!;
    if (!Number.isFinite(adp) || adp <= 0 || !POSITIONS.has(position)) return [];
    const points = Number(cells[at("projected_points")]);
    const projected = Number.isFinite(points) && !MARKET_ORDER_POSITIONS.has(position);
    return [{ id: cells[at("player_id")]!, position: position as PoolEntry["position"], adp, projectedPoints: projected ? points : null }];
  });
}

function percentile(values: readonly number[], share: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(share * sorted.length) - 1)]!;
}

async function main(): Promise<void> {
  const path = process.argv[2];
  if (path === undefined) throw new Error("advisor-measure: name a board, a run's boards/ppr-12.json or the mocks' board-ppr.csv.");
  const pool = poolFrom(path);
  const server = createServer((request, response) => void handle(request, response));
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as AddressInfo;
  const totalPicks = TEAM_COUNT * totalRosterSlots(STANDARD_ROSTER_SLOTS);
  const byAdp = [...pool].sort((a, b) => a.adp - b.adp);
  const picks: AdviseRequest["picks"][number][] = [];
  const serverMs: number[] = [];
  const roundTripMs: number[] = [];
  for (let pickNumber = 1; pickNumber <= Math.min(totalPicks, byAdp.length); pickNumber += 1) {
    const seat = snakeSeat(TEAM_COUNT, pickNumber);
    const body: AdviseRequest = { teamCount: TEAM_COUNT, rosterSlots: STANDARD_ROSTER_SLOTS, pool, picks: [...picks], seatOnClock: seat };
    const started = performance.now();
    const response = await fetch(`http://127.0.0.1:${port}/advise`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const envelope = (await response.json()) as { ok: boolean; error: string | null; data: { shortlist: { playerId: string; why: string }[] } };
    roundTripMs.push(performance.now() - started);
    if (!envelope.ok) throw new Error(`pick ${pickNumber}: ${envelope.error}`);
    if (envelope.data.shortlist.length === 0) throw new Error(`pick ${pickNumber}: the advisor answered with an empty shortlist`);
    serverMs.push(Number(/dur=([\d.]+)/.exec(response.headers.get("server-timing") ?? "")?.[1]));
    if (pickNumber === 1 || pickNumber === 49 || pickNumber > totalPicks - TEAM_COUNT) process.stdout.write(`pick ${pickNumber}, seat ${seat}: ${envelope.data.shortlist[0]?.playerId} because ${envelope.data.shortlist[0]?.why}\n`);
    // The room drafts by ADP: the cheapest man left.
    const taken = new Set(picks.map((pick) => pick.playerId));
    const next = byAdp.find((entry) => !taken.has(entry.id))!;
    picks.push({ pickNumber, playerId: next.id, seat });
  }
  server.close();
  const line = (label: string, values: readonly number[]): string =>
    `${label}: p50 ${percentile(values, 0.5).toFixed(2)} ms, p90 ${percentile(values, 0.9).toFixed(2)} ms, max ${Math.max(...values).toFixed(2)} ms`;
  process.stdout.write(`${serverMs.length} calls over a ${TEAM_COUNT}-team draft, pool of ${pool.length}\n${line("server", serverMs)}\n${line("round trip", roundTripMs)}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
  process.exit(1);
});
