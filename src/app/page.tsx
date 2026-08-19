import Link from "next/link";
import type { Position } from "@/domain/player";
import { Sticker } from "@/components/ui";
import { getDb } from "@/db/client";
import { getDraftStore } from "@/draft-service";
import { rankedPlayers } from "@/draft-service/pool";

/**
 * The signed-out landing page. The hero panel is NOT a mock: it renders the first rounds of a
 * real draft — the platform-owned showcase league — through the identical service/selector
 * path the live room uses (`getDraftStore().getDraftState`, `rankedPlayers`). If that draft
 * doesn't exist or hasn't started (fresh database, no seed), the panel simply doesn't render;
 * the landing page never invents picks and never breaks over a data problem.
 *
 * A public page must never show a customer's league — the showcase id points at a
 * platform-owned league, dev-seeded locally, and is env-swappable for production.
 */

// Reads DB per request (no build-time prerender against a database that may not exist).
export const dynamic = "force-dynamic";

const SHOWCASE_DRAFT_ID = process.env.SHOWCASE_DRAFT_ID ?? "dev_draft_snake";
const SHOWCASE_ROUNDS = 4;
const SHOWCASE_TEAMS = 4;

interface ShowcaseCell {
  readonly name: string;
  readonly position: Position;
}
interface ShowcaseRow {
  readonly round: number;
  readonly serpentine: "→" | "←";
  readonly picks: readonly ShowcaseCell[];
}
interface Showcase {
  readonly caption: string;
  readonly rows: readonly ShowcaseRow[];
}

async function loadShowcase(): Promise<Showcase | null> {
  try {
    const state = await getDraftStore().getDraftState(SHOWCASE_DRAFT_ID);
    if (state === null || state.picks.length === 0) return null;
    const players = await rankedPlayers(getDb(), state.config.leagueId);
    const byId = new Map(players.map((player) => [player.id, player]));
    const teams = state.draftOrder.slice(0, SHOWCASE_TEAMS);

    const rows = Array.from({ length: SHOWCASE_ROUNDS }, (_, index) => {
      const round = index + 1;
      const roundPicks = state.picks.filter((pick) => pick.round === round);
      return {
        round,
        serpentine: round % 2 === 1 ? ("→" as const) : ("←" as const),
        picks: teams
          .map((teamId) => roundPicks.find((pick) => pick.teamId === teamId))
          .flatMap((pick) => {
            const player = pick === undefined ? undefined : byId.get(pick.playerId);
            return player === undefined ? [] : [{ name: player.name, position: player.position }];
          }),
      };
    }).filter((row) => row.picks.length > 0);
    if (rows.length === 0) return null;

    const latest = state.picks[state.picks.length - 1]!;
    const caption =
      state.phase === "complete"
        ? "A finished draft on Commish. Every pick, live on the board."
        : `Round ${latest.round} · Pick ${latest.pickNumber} · drafted live on Commish`;
    return { caption, rows };
  } catch {
    // The public front door renders without its showcase before it ever renders an error.
    return null;
  }
}

const STICKER_TILT = ["-rotate-1", "rotate-1", "rotate-0", "-rotate-1"] as const;

function ShowcaseBoard({ showcase }: { readonly showcase: Showcase }) {
  return (
    <div aria-hidden="true" className="rotate-1 rounded-lg border border-border bg-surface-elevated p-4 shadow-sticker">
      <p className="mb-3 font-display text-sm font-semibold uppercase tracking-widest text-text-muted">
        {showcase.caption}
      </p>
      <div className="flex flex-col gap-2">
        {showcase.rows.map((row, rowIndex) => (
          <div key={row.round} className="grid grid-cols-[2rem_repeat(4,1fr)] items-center gap-2">
            <span className="font-mono text-xs tabular-nums text-text-muted">{`${row.round} ${row.serpentine}`}</span>
            {row.picks.map((cell, cellIndex) => (
              <Sticker
                key={`${row.round}:${cell.name}`}
                position={cell.position}
                className={`px-2 py-1.5 ${STICKER_TILT[(rowIndex + cellIndex) % STICKER_TILT.length]}`}
              >
                <p className="truncate font-display text-sm font-bold leading-tight">{cell.name}</p>
                <p className="text-xs uppercase opacity-80">{cell.position}</p>
              </Sticker>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

const PROOF = [
  {
    title: "Drafts that feel live",
    body: "A sticker board, a real clock, and autopick that never stalls the room.",
  },
  {
    title: "The trash talk stays in",
    body: "League chat lives beside the board and the standings, not in a separate app.",
  },
  {
    title: "An advisor on your bench",
    body: "Start/sit and trade calls computed from your league's own scoring. Advice only. You make the move.",
  },
] as const;

export default async function Home() {
  const showcase = await loadShowcase();
  return (
    <main className="min-h-screen bg-surface">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-5">
        <p className="font-display text-2xl font-bold uppercase tracking-wide text-text-primary">Commish</p>
        <Link
          href="/sign-in"
          className="rounded-md px-4 py-2 font-medium text-text-primary transition-colors hover:bg-surface-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          Sign in
        </Link>
      </header>

      <section
        className={`mx-auto grid w-full max-w-6xl items-center gap-10 px-6 py-14 lg:py-20 ${showcase === null ? "" : "lg:grid-cols-2"}`}
      >
        <div className="flex flex-col items-start gap-6">
          <p className="font-display text-sm font-semibold uppercase tracking-widest text-text-muted">
            Season-long · Real stakes · No spreadsheets
          </p>
          <h1 className="font-display text-display-xl font-bold uppercase leading-display text-text-primary">
            The money league your group chat deserves
          </h1>
          <p className="max-w-prose text-lg text-text-muted">
            Live drafts, standings that settle arguments, and the trash talk built in. Season-long fantasy football
            without the twenty-year-old software.
          </p>
          <div className="flex flex-col gap-2">
            <Link
              href="/sign-in"
              className={
                "inline-flex h-12 items-center justify-center rounded-md bg-accent px-8 text-lg font-medium text-accent-text transition-colors " +
                "hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
              }
            >
              Get in the room
            </Link>
            <p className="text-sm text-text-muted">Free to sign up. Set up a league and invite your group in minutes.</p>
          </div>
        </div>
        {showcase === null ? null : <ShowcaseBoard showcase={showcase} />}
      </section>

      <section aria-label="What you get" className="border-t border-border bg-surface-elevated">
        <div className="mx-auto grid w-full max-w-6xl gap-8 px-6 py-12 sm:grid-cols-3">
          {PROOF.map((item) => (
            <div key={item.title} className="flex flex-col gap-2">
              <h2 className="font-display text-xl font-bold uppercase text-text-primary">{item.title}</h2>
              <p className="text-sm text-text-muted">{item.body}</p>
            </div>
          ))}
        </div>
      </section>

      <footer className="mx-auto w-full max-w-6xl px-6 py-8">
        <p className="text-sm text-text-muted">Commish. Season-long fantasy football, run properly.</p>
      </footer>
    </main>
  );
}
