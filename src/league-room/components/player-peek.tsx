"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { BottomSheet, NOT_STARTED_DASH, PlayerObject, ReasonChip, SeasonBars, SourceStrip } from "@/components/ui";
import { MICRO_LABEL } from "@/components/ui/config";
import type { ApiEnvelope } from "@/lib/api/respond";
import type { PlayerSeasonBody } from "@/league-service/player";
import { sourcesFor, weeksFor } from "../lib/player-season-view";
import { useLeagueRoomDeps } from "../hooks/deps";
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
                      does not name him, and nothing prints. */}
                  {body.injuryDesignation === null ? null : (
                    <span className="rounded-sm bg-negative px-1.5 py-0.5 font-mono text-sm font-semibold text-negative-text">{body.injuryDesignation}</span>
                  )}
                </div>
                <p className="text-sm text-text-muted">{body.ownedBy === null ? "Free agent in this league" : `On ${body.ownedBy}`}</p>
              </div>
              <Link
                className={`${MICRO_LABEL} pt-2 text-accent underline`}
                href={`/app/leagues/${target.leagueId}/players/${target.playerId}`}
                onClick={() => setTarget(null)}
              >
                Full page
              </Link>
            </div>
            <SourceStrip label={`Where ${body.player.name} is ranked, by source`} sources={sourcesFor(body)} />

            {/* THE OUTLOOK (Task 8): the board's own "why", in full — every reason
                `boardReasons` stored for him this season, never truncated to a compact row's
                top two the way the draft board's sticker is. Absent when the board never ranked
                him (no crosswalk placement, no board this season), which is the honest state:
                nothing here invents a reason a store does not carry. */}
            {body.reasons.length === 0 ? null : (
              <div className="flex flex-col gap-2">
                <h3 className={`${MICRO_LABEL} text-text-faint`}>Outlook</h3>
                <div className="flex flex-col gap-1.5">
                  {body.reasons.map((reason) => (
                    <ReasonChip
                      key={reason.code === "law" ? `law:${reason.lawId}` : reason.code}
                      reason={reason}
                      registry={body.laws}
                      className="w-fit"
                    />
                  ))}
                </div>
              </div>
            )}

            {/* THE SEASON LABEL + SWITCHER (2026-09-04 widening) — every number below this line
                answers for `body.season` explicitly, never a silent "this season" that could mean
                two different years depending on when a manager opens the card. The switcher only
                renders once there is a choice to make; a single-season player gets the label with
                nothing to press beside it. */}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className={`${MICRO_LABEL} text-text-faint`}>{body.season} season</span>
              {body.availableSeasons.length > 1 ? <SeasonSwitcher seasons={body.availableSeasons} season={season ?? body.season} onSelect={setSeason} /> : null}
            </div>

            {body.isRookie ? (
              // LAW 7, the rookie case: nothing to chart, so one honest sentence stands in for it
              // rather than an empty chart or a "no data" dead end.
              <p className="text-sm text-text-muted">His first NFL season.</p>
            ) : played ? (
              <SeasonBars label={`${body.player.name}, points by week`} weeks={weeksFor(body)} />
            ) : (
              <p className="text-sm text-text-muted">No scored week for him in the {body.season} season.</p>
            )}

            {/* SEASON TOTALS + GAME LOG (founder, 2026-08-30: ESPN-depth). Raw production from
                the harvest block, points under THIS league's rules. Columns are position-blind
                on purpose: a zero column is honest and a per-position table is four tables.
                `Carries`/`Targets` print a dash for a PRIOR season (2026-09-04 widening): the
                observation store never carries them — see `PlayerGameLogRow`'s own docblock —
                and a dash is the honest "not recorded", never a fabricated zero. */}
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

            {body.news.length === 0 ? null : (
              <div className="flex flex-col gap-2">
                <h3 className={`${MICRO_LABEL} text-text-faint`}>News</h3>
                <ul className="flex flex-col gap-1.5">
                  {body.news.map((story) => (
                    <li key={story.link}>
                      <a href={story.link} target="_blank" rel="noreferrer" className="text-sm text-text-primary underline hover:text-accent">
                        {story.title}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </div>
    </BottomSheet>
  );
}
