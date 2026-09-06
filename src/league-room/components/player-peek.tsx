"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { BottomSheet, Card, NOT_STARTED_DASH, PlayerObject, SeasonBars, SourceStrip } from "@/components/ui";
import { MICRO_LABEL } from "@/components/ui/config";
import type { ApiEnvelope } from "@/lib/api/respond";
import type { PlayerSeasonBody } from "@/league-service/player";
import { BooksModule } from "../dossier/books-module";
import { CallCard } from "../dossier/call-card";
import { RangeRail } from "../dossier/range-rail";
import { RoleModule } from "../dossier/role-module";
import { SeasonStrip } from "../dossier/season-strip";
import { StoryModule } from "../dossier/story-module";
import { callCardPropsFor, sourcesFor, weeksFor } from "../lib/player-season-view";
import { useLeagueRoomDeps } from "../hooks/deps";
import { Outlook } from "../outlook/outlook";
import { SeasonSwitcher } from "./season-switcher";

interface PeekTarget {
  readonly leagueId: string;
  readonly playerId: string;
  readonly name: string;
}

/**
 * ONE listener, module scope: `PlayerName` triggers anywhere in the tree reach the single
 * `PlayerPeekHost` the page mounts, with no context threading through the server components
 * between them. A trigger pressed with no host mounted does nothing, quietly — the failure mode
 * is a dead click, never a crash.
 */
let host: ((target: PeekTarget) => void) | null = null;

export function openPlayerPeek(target: PeekTarget): void {
  host?.(target);
}

/**
 * A PLAYER'S NAME, PRESSABLE (founder, 2026-08-30: "we should be able to click the players name
 * wherever they're displayed... it should bring up a pop up from the bottom"). The name is the
 * control everywhere it appears; pressing it raises the bottom-sheet peek instead of navigating
 * away. The full page still exists — the sheet links to it — so a deep look is one more press,
 * never lost.
 */
export function PlayerName({
  leagueId,
  playerId,
  name,
  className = "",
  children,
}: {
  readonly leagueId: string;
  readonly playerId: string;
  readonly name: string;
  readonly className?: string;
  readonly children?: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={() => openPlayerPeek({ leagueId, playerId, name })}
      className={`min-w-0 cursor-pointer text-left hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${className}`}
    >
      {children ?? name}
    </button>
  );
}

/** The header's own identity line — bye week moved up beside the roster fact (dossier plan, Task
 *  5: "WR · NYG · Bye week 8 · Free agent…" in the approved mock). `PlayerObject` already draws
 *  the position and team as chips right above this line, so this states only the two facts it
 *  does not: his bye (from `body.dossier`, `null` when there is no dossier to read it off) and the
 *  roster fact (Task 4, context honesty: silent in a mock league, which has no real room to be a
 *  free agent "in"). Either half missing simply drops out of the joined sentence rather than
 *  leaving a dangling separator. */
function identityLine(body: PlayerSeasonBody): string {
  const byeWeek = body.dossier?.byeWeek ?? null;
  const rosterFact = body.isMockLeague ? null : body.ownedBy === null ? "Free agent in this league" : `On ${body.ownedBy}`;
  return [byeWeek === null ? null : `Bye week ${byeWeek}`, rosterFact].filter((clause): clause is string => clause !== null).join(" · ");
}

/** The auto-written capsule, restyled as its own module Card ("The read") — Task 5 moves this out
 *  of `Outlook`'s own body (where it used to sit directly under the verdict line) now that the
 *  dossier composition gives it a card of its own beside `BooksModule`. `null`/`undefined` renders
 *  nothing, the identical "the sweep has not reached him yet" absence `Outlook` always kept. */
function ReadCard({ capsule }: { readonly capsule: PlayerSeasonBody["capsule"] }) {
  if (capsule === null || capsule === undefined) return null;
  return (
    <Card as="section" aria-label="The read" className="flex flex-col gap-1">
      <h3 className={`${MICRO_LABEL} text-text-faint`}>The read</h3>
      <p className="text-sm text-text-primary">{capsule.bodyCompact}</p>
      {capsule.source === "template" ? <p className="text-xs text-text-faint">The short version while we write him up.</p> : null}
    </Card>
  );
}

/** Newest headlines that name him — unchanged content from the pre-dossier peek, only ever
 *  rendered ONCE per render: the dossier composition relocates this into the grid beside
 *  `StoryModule`, and the fallback (no dossier) composition keeps it below the fold, exactly
 *  where it always was. */
function NewsList({ news }: { readonly news: PlayerSeasonBody["news"] }) {
  if (news.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      <h3 className={`${MICRO_LABEL} text-text-faint`}>News</h3>
      <ul className="flex flex-col gap-1.5">
        {news.map((story) => (
          <li key={story.link}>
            <a href={story.link} target="_blank" rel="noreferrer" className="text-sm text-text-primary underline hover:text-accent">
              {story.title}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The season label, its switcher, and the rookie/no-record/chart branch — byte-identical to the
 *  peek's own pre-dossier composition. Used twice: as the WHOLE fallback when `body.dossier` is
 *  absent, and as the dossier grid's own "last season" cell when the dossier exists but carries no
 *  `lastSeasonStory` for him (a board-ranked rookie, most often) — the same honest substitute
 *  either way, never a `SeasonStrip` built from a story that does not exist. */
function SeasonChartFallback({ body, switcher, played }: { readonly body: PlayerSeasonBody; readonly switcher: ReactNode; readonly played: boolean }) {
  return (
    // `gap-6` matches the pre-Task-5 peek exactly: the label/switcher row and the chart below it
    // used to be flat siblings under the peek's own `gap-6` column, and extracting them into this
    // component must not shrink that spacing to whatever gap this wrapper happens to pick.
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className={`${MICRO_LABEL} text-text-faint`}>{body.season} season</span>
        {switcher}
      </div>
      {body.isRookie ? (
        // A CONFIRMED rookie (`isRookie`, never inferred from `availableSeasons` alone — see
        // `PlayerSeasonBody`'s own docblock): nothing to chart, so one honest sentence stands in
        // for it rather than an empty chart or a "no data" dead end.
        <p className="text-sm text-text-muted">His first NFL season.</p>
      ) : body.availableSeasons.length === 0 ? (
        // THE THIRD STATE (fix round 1, CRITICAL): not a confirmed rookie, and no season on record
        // either — a crosswalk miss, or a placed veteran the store has no weeks for. Never the
        // rookie sentence, which would assert a biography fact this state lacks.
        <p className="text-sm text-text-muted">No prior seasons on record.</p>
      ) : played ? (
        <SeasonBars label={`${body.player.name}, points by week`} weeks={weeksFor(body)} />
      ) : (
        <p className="text-sm text-text-muted">No scored week for him in the {body.season} season.</p>
      )}
    </div>
  );
}

/**
 * The one mounted receiver for `PlayerName` presses: fetches the player's season under this
 * league's rules (the same body the full page reads) and raises the sheet. Loading shows the
 * name immediately — the reader pressed a name, the sheet answers with it before the wire does.
 */
export function PlayerPeekHost() {
  const { fetchJson } = useLeagueRoomDeps();
  const [target, setTarget] = useState<PeekTarget | null>(null);
  const [body, setBody] = useState<PlayerSeasonBody | null>(null);
  const [failed, setFailed] = useState(false);
  // `null` means "let the service pick" — its own default, the newest season with data for him.
  // Set only once a manager presses a segment in the switcher below (2026-09-04 widening).
  const [season, setSeason] = useState<number | null>(null);

  useEffect(() => {
    // Opening a new target resets any season a prior peek's manager had picked — his choice on
    // one player's card has no business surviving onto the next name pressed.
    const openTarget = (next: PeekTarget) => {
      setSeason(null);
      setTarget(next);
    };
    host = openTarget;
    return () => {
      if (host === openTarget) host = null;
    };
  }, []);

  useEffect(() => {
    if (target === null) return;
    setBody(null);
    setFailed(false);
    let alive = true;
    void (async () => {
      try {
        const seasonParam = season === null ? "" : `&season=${season}`;
        const response = await fetchJson(
          `/api/leagues/${target.leagueId}/player-season?playerId=${encodeURIComponent(target.playerId)}${seasonParam}`,
          { method: "GET" },
        );
        const envelope = (await response.json()) as ApiEnvelope<PlayerSeasonBody>;
        if (!alive) return;
        if (envelope.ok) setBody(envelope.data);
        else setFailed(true);
      } catch {
        if (alive) setFailed(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, [target, season, fetchJson]);

  if (target === null) return null;
  const played = body?.weeks.some((week) => week.points !== null) ?? false;
  // Player Dossier plan, Task 5 — `undefined` (a fixture predating the dossier) and `null` (the
  // board never ranked him, `collectPlayerFacts`'s own honest answer) are the SAME "nothing to
  // build the dossier composition from" state; the double-check idiom folds both into one.
  const dossier = body?.dossier ?? null;
  const switcher = body !== null && body.availableSeasons.length > 1 ? <SeasonSwitcher seasons={body.availableSeasons} season={season ?? body.season} onSelect={setSeason} /> : undefined;
  // Whether the grid's `ReadCard`/story cells have anything to pair with `BooksModule`/`SeasonStrip`
  // against — review fix: a missing partner spans its own row's full width instead of leaving the
  // other column empty (see the grid's own inline docblock below for why this must be per-row).
  const hasReadCard = body !== null && body.capsule !== null && body.capsule !== undefined;
  const hasStoryCell = body !== null && (body.injuryDesignation !== null || body.news.length > 0);

  return (
    <BottomSheet label={target.name} onClose={() => setTarget(null)}>
      <div className="flex flex-col gap-6">
        {body === null ? (
          <div className="flex flex-col gap-2">
            <p className="font-display text-2xl font-bold text-text-primary">{target.name}</p>
            <p className="text-sm text-text-muted">{failed ? "We could not load him. Close this and try again." : "Loading…"}</p>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center gap-3">
                  <PlayerObject player={body.player} />
                  {/* The designation, said in the verdict channel: "Q"/"O"/"IR" beside the name
                      is the one fact a manager checks before anything else. Absent = the feed
                      does not name him, and nothing prints. Unchanged by the dossier composition
                      below — `StoryModule`'s own pill covers the story card, this one covers the
                      header, and both may say the same thing at once on purpose. */}
                  {body.injuryDesignation === null ? null : (
                    <span className="rounded-sm bg-negative px-1.5 py-0.5 font-mono text-sm font-semibold text-negative-text">{body.injuryDesignation}</span>
                  )}
                </div>
                {identityLine(body) === "" ? null : <p className="text-sm text-text-muted">{identityLine(body)}</p>}
              </div>
              <Link
                className={`${MICRO_LABEL} pt-2 text-accent underline`}
                href={`/app/leagues/${target.leagueId}/players/${target.playerId}`}
                onClick={() => setTarget(null)}
              >
                Full page
              </Link>
            </div>

            {dossier === null ? (
              <>
                {/* TODAY'S LAYOUT, UNCHANGED — the binding fallback (Task 5): a player without
                    board facts still gets the source strip, the Outlook (verdict and capsule
                    included, exactly as before this task), and his season. */}
                <SourceStrip label={`Where ${body.player.name} is ranked, by source`} sources={sourcesFor(body)} />
                <Outlook reasons={body.reasons} laws={body.laws} position={body.player.position} capsule={body.capsule} capped />
                <SeasonChartFallback body={body} switcher={switcher} played={played} />
              </>
            ) : (
              <>
                {/* THE CALL, FIRST — `callCardPropsFor` is the adapter Task 3 disclosed as its own
                    cost: `market`/`ourBoard` off the dossier, `expertRank` off the body (the one
                    field the dossier itself does not carry), the verdict composed once here. */}
                <CallCard {...callCardPropsFor(body, dossier)} />

                {/* THREE SEPARATE ROW GRIDS, NOT ONE SIX-ITEM GRID (review fix): a single flat
                    `grid-cols-2` auto-places every child in DOM order, so a missing member (most
                    commonly `ReadCard`, absent for the many players the capsule sweep has not
                    written up yet — Task 4's own note) shifts every LATER pair across the seam,
                    cascading `Books`/`SeasonStrip` into row two and stranding `Story`+news alone.
                    One grid per row keeps a missing member's effect confined to its own row: the
                    surviving member spans both columns rather than sitting alone on the left with
                    the right column empty. */}
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                  <RangeRail projection={dossier.projection} availability={dossier.availability} />
                  <RoleModule position={body.player.position} usage={dossier.usage} trend={dossier.trend} />
                </div>
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                  <ReadCard capsule={body.capsule} />
                  <div className={hasReadCard ? undefined : "lg:col-span-2"}>
                    <BooksModule books={dossier.books} />
                  </div>
                </div>
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                  <div className={hasStoryCell ? undefined : "lg:col-span-2"}>
                    {dossier.lastSeasonStory === null ? (
                      <SeasonChartFallback body={body} switcher={switcher} played={played} />
                    ) : (
                      <SeasonStrip story={dossier.lastSeasonStory} weeks={weeksFor(body)} scoringLabel={dossier.basis.scoringLabel} switcher={switcher} />
                    )}
                  </div>
                  {!hasStoryCell ? null : (
                    <div className="flex flex-col gap-4">
                      {/* The season-ending story service wiring converges post-merge (ruling
                          R-d1) — `story` stays `null` here for now, so this renders only the
                          current designation pill, or nothing, honestly. */}
                      <StoryModule story={null} designation={body.injuryDesignation} />
                      <NewsList news={body.news} />
                    </div>
                  )}
                </div>

                {/* THE WHY, UNCHANGED IN SUBSTANCE (ruling R-d2) — the same capped, grouped
                    `Outlook` the peek always rendered, minus the verdict sentence (`CallCard`
                    above already states it from the identical `reasons`/`position`) and minus the
                    capsule prose (`ReadCard` above already states it). Task 6 replaces this with
                    the uncapped why-groups module; this task only stops it from repeating itself. */}
                <Outlook reasons={body.reasons} laws={body.laws} position={body.player.position} capped showVerdict={false} />
              </>
            )}

            {/* SEASON TOTALS + GAME LOG (founder, 2026-08-30: ESPN-depth). Raw production from
                the harvest block, points under THIS league's rules. Columns are position-blind
                on purpose: a zero column is honest and a per-position table is four tables.
                `Carries`/`Targets` print a dash for a PRIOR season (2026-09-04 widening): the
                observation store never carries them — see `PlayerGameLogRow`'s own docblock —
                and a dash is the honest "not recorded", never a fabricated zero. Stays below the
                fold in both compositions, exactly as before this task. */}
            {body.totals === null ? null : (
              <div className="flex flex-col gap-2">
                <h3 className={`${MICRO_LABEL} text-text-faint`}>{body.season} totals</h3>
                <div className="flex flex-wrap gap-x-8 gap-y-2">
                  {[
                    ["Games", String(body.totals.games)],
                    ["Carries", body.totals.carries === null ? NOT_STARTED_DASH : String(body.totals.carries)],
                    ["Rush yds", String(body.totals.rushingYards)],
                    ["Targets", body.totals.targets === null ? NOT_STARTED_DASH : String(body.totals.targets)],
                    ["Rec", String(body.totals.receptions)],
                    ["Rec yds", String(body.totals.receivingYards)],
                    ["Pass yds", String(body.totals.passingYards)],
                    ["TD", String(body.totals.touchdowns)],
                    ["Pts", body.totals.fantasyPoints.toFixed(2)],
                  ].map(([label, value]) => (
                    <div key={label} className="flex flex-col">
                      <span className={`${MICRO_LABEL} text-text-faint`}>{label}</span>
                      <span className="font-display text-xl font-bold tabular-nums text-text-primary">{value}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {body.log.length === 0 ? null : (
              <div className="flex flex-col gap-2">
                <h3 className={`${MICRO_LABEL} text-text-faint`}>{body.season} game log</h3>
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-sm tabular-nums">
                    <thead>
                      <tr className={`${MICRO_LABEL} border-b border-line text-text-faint`}>
                        <th className="py-1 pr-3 text-left font-normal">Wk</th>
                        <th className="py-1 pr-3 text-right font-normal">Car</th>
                        <th className="py-1 pr-3 text-right font-normal">Rush</th>
                        <th className="py-1 pr-3 text-right font-normal">Tgt</th>
                        <th className="py-1 pr-3 text-right font-normal">Rec</th>
                        <th className="py-1 pr-3 text-right font-normal">Rec yds</th>
                        <th className="py-1 pr-3 text-right font-normal">Pass</th>
                        <th className="py-1 pr-3 text-right font-normal">TD</th>
                        <th className="py-1 text-right font-normal">Pts</th>
                      </tr>
                    </thead>
                    <tbody>
                      {body.log.map((row) => (
                        <tr key={row.week} className="border-b border-line/50">
                          <td className="py-1.5 pr-3 text-text-muted">{row.week}</td>
                          <td className="py-1.5 pr-3 text-right text-text-muted">{row.carries === null ? NOT_STARTED_DASH : row.carries}</td>
                          <td className="py-1.5 pr-3 text-right text-text-muted">{row.rushingYards}</td>
                          <td className="py-1.5 pr-3 text-right text-text-muted">{row.targets === null ? NOT_STARTED_DASH : row.targets}</td>
                          <td className="py-1.5 pr-3 text-right text-text-muted">{row.receptions}</td>
                          <td className="py-1.5 pr-3 text-right text-text-muted">{row.receivingYards}</td>
                          <td className="py-1.5 pr-3 text-right text-text-muted">{row.passingYards}</td>
                          <td className="py-1.5 pr-3 text-right text-text-muted">{row.touchdowns}</td>
                          <td className="py-1.5 text-right font-display font-bold text-text-primary">{row.points.toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* News stays below the fold ONLY in the fallback composition (no dossier) — the
                dossier composition already rendered this same list once, beside `StoryModule`,
                further up. Never both: see `NewsList`'s own docblock. */}
            {dossier === null ? <NewsList news={body.news} /> : null}
          </>
        )}
      </div>
    </BottomSheet>
  );
}
