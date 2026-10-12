// THE ADVISOR'S LATENCY, MEASURED (spec §2.3: under 50 ms per call at p90). Starts the advisor's own
// handler on an ephemeral port in this process, drafts a whole 12-team room by ADP from a stored
// board export, asks `POST /advise` at every pick, and prints p50, p90 and the slowest call, server
// time and round trip both. The board is real data, exported from the board the product served
// (docs/design/mocks/2026-10-12-commish/data/board-ppr.csv by default), never synthesized.
//
//   npx tsx scripts/advisor-measure.ts [path/to/board.csv]
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { STANDARD_ROSTER_SLOTS } from "@research/domain/roster";
import { handle } from "@research/advisor/server";
import { snakeSeat } from "@research/advisor/advise";
import type { AdviseRequest, PoolEntry } from "@research/advisor/request";
import { totalRosterSlots } from "@research/draft-engine/order";

const DEFAULT_BOARD = "../docs/design/mocks/2026-10-12-commish/data/board-ppr.csv";
const TEAM_COUNT = 12;
const POSITIONS = new Set(["QB", "RB", "WR", "TE", "K", "DEF"]);

function poolFrom(csvPath: string): readonly PoolEntry[] {
  const [header, ...lines] = readFileSync(csvPath, "utf8").trim().split("\n");
  const columns = header!.split(",");
  const at = (name: string): number => columns.indexOf(name);
  return lines.flatMap((line) => {
    const cells = line.split(",");
    const adp = Number(cells[at("adp")]);
    const position = cells[at("position")]!;
    if (!Number.isFinite(adp) || adp <= 0 || !POSITIONS.has(position)) return [];
    const points = Number(cells[at("projected_points")]);
    return [{ id: cells[at("player_id")]!, position: position as PoolEntry["position"], adp, projectedPoints: Number.isFinite(points) ? points : null }];
  });
}

function percentile(values: readonly number[], share: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(share * sorted.length) - 1)]!;
}

async function main(): Promise<void> {
  const pool = poolFrom(process.argv[2] ?? DEFAULT_BOARD);
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
    serverMs.push(Number(/dur=([\d.]+)/.exec(response.headers.get("server-timing") ?? "")?.[1]));
    if (pickNumber === 1 || pickNumber === 49) process.stdout.write(`pick ${pickNumber}, seat ${seat}: ${envelope.data.shortlist[0]?.playerId} because ${envelope.data.shortlist[0]?.why}\n`);
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
