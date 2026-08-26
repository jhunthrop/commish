"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { ApiEnvelope } from "@/lib/api/respond";
import type { MockLobbyBody, CreateMockRoomBody } from "@/app/api/mock-drafts/route";
import type { ClaimMockSeatBody } from "@/app/api/mock-drafts/[code]/route";
import type { MockLobbyRoomSummary, MyMockRoomSummary } from "@/mock-draft-service/lobby";
import type { MockMode } from "@/mock-draft/config";
import { Button, EYEBROW, Panel, SeatMeter } from "@/components/ui";
import { Countdown, formatCoarseDuration, useCountdown } from "@/components/ui/countdown";
import type { DraftStatus } from "@/domain/draft";
import { LEAGUE_ROOM_CONFIG } from "../config";
import { useLeagueRoomDeps } from "../hooks/deps";
import { MockSetupForm } from "./mock-setup-form";

/**
 * `?create=solo`'s own path (`DraftRoom`'s identical `MOCK_LOBBY_PATH`,
 * `@/draft-room/components/draft-room.tsx`) — every one-tap on this page reruns the SAME
 * immediate solo request "Run it again" already sends, never a second invented shortcut.
 */
const SOLO_LOBBY_PATH = "/app/mock-drafts?create=solo";

/** Real-life sentence for a room's own fill window — clamped the same render-time-only way
 *  `formatRelativeCountdown` clamps a real league's own countdown; the wire states the fact
 *  (`startsInMs` can read negative — the ticker has not reached it yet), this is the rendering. */
function startsInSentence(startsInMs: number): string {
  return startsInMs <= 0 ? "Starting any moment" : `Starts in ${formatCoarseDuration(startsInMs)}`;
}

const STATUS_LABEL: Readonly<Record<DraftStatus, string>> = {
  scheduled: "Waiting to start",
  in_progress: "Drafting now",
  complete: "Complete",
  dissolved: "Closed",
};

const STATUS_LINK_LABEL: Readonly<Record<DraftStatus, string>> = {
  scheduled: "Open room",
  in_progress: "Continue",
  complete: "See results",
  dissolved: "Open room",
};

/** Short nouns for a history row's own identity line (E8) — this component's OWN vocabulary,
 *  never `@/mock-draft`'s value-imported labels (the client boundary) and never
 *  `MockSetupForm`'s own descriptive option text ("Solo, play against bots"): a history row
 *  names what already happened, not the choice a fresh form is offering. */
const MODE_ROW_LABEL: Readonly<Record<MockMode, string>> = {
  solo: "Solo",
  lobby: "Lobby",
  link: "Private link",
};

/**
 * E8/R4(a): a history row's own "when" clause — the same coarse-duration family every other
 * relative time on this surface already uses (`formatCoarseDuration`), read forward for a room
 * still waiting to fill (`startsInSentence`) and backward, as "X ago", for one that already
 * started, finished, or was abandoned.
 */
export function historyWhenSentence(status: DraftStatus, startsInMs: number): string {
  if (status === "scheduled") return startsInSentence(startsInMs);
  return `${formatCoarseDuration(Math.abs(startsInMs))} ago`;
}

/**
 * D3/R1's one honest one-tap: states the room it will actually create — the SAME defaults
 * `?create=solo`'s own server route falls back to (`createMockRoomSchema`'s own defaults,
 * threaded here as `defaultTeamCount`/`defaultPickSeconds`) — rather than a generic "Start a
 * mock draft" that could be mistaken for the form's own submit button two feet away.
 */
export function soloQuickStartLabel(teamCount: number, pickSeconds: number): string {
  return `Start a solo mock now, ${teamCount} teams, ${pickSeconds}s clock`;
}

interface SoloQuickStartProps {
  readonly teamCount: number;
  readonly pickSeconds: number;
  readonly "data-testid"?: string;
}

/**
 * ONE component, rendered at up to three call sites (the left column's own quick start beside
 * the form, the open-lobby empty state, and the history empty state) — never a second invented
 * shortcut duplicating its logic. `?create=solo` is `DraftRoom`'s own contract with this page;
 * this is the one place that link ever gets a label.
 */
function SoloQuickStart({ teamCount, pickSeconds, "data-testid": testId }: SoloQuickStartProps) {
  return (
    <Link href={SOLO_LOBBY_PATH} data-testid={testId} className="text-sm font-medium text-accent underline">
      {soloQuickStartLabel(teamCount, pickSeconds)}
    </Link>
  );
}

/** D2's shelf idiom (`LeagueRowsHeader`, `@/league-room/components/league-row.tsx`), scaled down
 *  to this surface's own two-block rows: one quiet eyebrow label over the row's own content, a
 *  second (often blank) one over its action — the sixth League-row column's own "a pill names
 *  itself" reasoning applies here too. `aria-hidden`: every cell that needs a spoken key already
 *  carries its own (the seat sentence, the status text, the action's accessible name). */
function ShelfColumnHeader({ trailing = "" }: { readonly trailing?: string }) {
  return (
    <div aria-hidden="true" className={`flex items-center justify-between gap-3 pb-2 ${EYEBROW} text-text-muted`}>
      <span>Room</span>
      <span>{trailing}</span>
    </div>
  );
}

interface OpenRoomRowProps {
  readonly room: MockLobbyRoomSummary;
  readonly joiningCode: string | null;
  readonly onJoin: (shareCode: string) => void;
}

/**
 * E4/E5: the one live fact this whole page owns, finally rendered live — the same `SeatMeter` +
 * ticking `Countdown` pairing `MockShareLanding` already keeps for the identical room, off the
 * identical wire fact (`startsInMs`). A dedicated row component (rather than inlining the hook
 * in a `.map`) so each room's own countdown ticks independently, the same reason
 * `MockShareLanding` itself is a whole component rather than a fragment.
 */
function OpenRoomRow({ room, joiningCode, onJoin }: OpenRoomRowProps) {
  // Computed once, from the request-time `startsInMs` the server read (ruling 10) — the same
  // "a relative duration becomes an absolute deadline the moment the client has it" shape
  // `MockShareLanding` keeps for this identical fact.
  const [startsAt] = useState(() => new Date(Date.now() + room.startsInMs).toISOString());
  const { remainingMs } = useCountdown(startsAt);
  return (
    <li className="border-t border-line">
      <div className="flex flex-wrap items-center justify-between gap-3 py-3">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-6 gap-y-2">
          <span className="min-w-0 text-sm font-medium text-text-primary">
            {room.teamCount} teams · {room.pickSeconds}s clock
          </span>
          <SeatMeter filled={room.teamCount - room.seatsOpen} total={room.teamCount} />
          {remainingMs === null ? null : <Countdown remainingMs={remainingMs} size="sm" />}
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => onJoin(room.shareCode)}
          disabled={joiningCode !== null}
          loading={joiningCode === room.shareCode}
        >
          Join
        </Button>
      </div>
    </li>
  );
}

/**
 * E8: a history row's own identity — team, mode, size, clock and when, one composed sentence —
 * plus the status-appropriate action every row already carried. `min-w-0`/`break-words`: a long
 * chosen team name must never force the row wider than its column.
 */
function MineRoomRow({ room }: { readonly room: MyMockRoomSummary }) {
  return (
    <li className="border-t border-line">
      <div className="flex flex-wrap items-center justify-between gap-3 py-3">
        <div className="flex min-w-0 flex-col gap-1">
          <span className="min-w-0 break-words text-sm font-medium text-text-primary">
            {room.teamName} · {MODE_ROW_LABEL[room.mode]} · {room.teamCount} teams · {room.pickSeconds}s ·{" "}
            {historyWhenSentence(room.status, room.startsInMs)}
          </span>
          <span className="text-sm text-text-muted">{STATUS_LABEL[room.status]}</span>
        </div>
        <Link href={`/app/drafts/${room.draftId}`} className="text-sm font-medium text-accent underline">
          {STATUS_LINK_LABEL[room.status]}
        </Link>
      </div>
    </li>
  );
}

type HistoryGroupName = "Today" | "Yesterday" | "Earlier";
const HISTORY_GROUP_ORDER: readonly HistoryGroupName[] = ["Today", "Yesterday", "Earlier"];
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function dayKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * E7's own coarse calendar bucket — UTC calendar days, compared render-time-only (never a
 * stored projection, the same discipline every other relative fact on this surface keeps):
 * "Today"/"Yesterday" compare the room's own absolute instant against the render's `now`,
 * "Earlier" catches everything before that.
 */
export function historyGroupFor(startsAtMs: number, nowMs: number): HistoryGroupName {
  const day = dayKey(startsAtMs);
  if (day === dayKey(nowMs)) return "Today";
  if (day === dayKey(nowMs - MS_PER_DAY)) return "Yesterday";
  return "Earlier";
}

export interface MockLobbyProps {
  /** Server-read initial data (Task 9) — the SAME "SSR-first, `fetchJson` only for a write or a
   *  refresh" split `AdvisorPanel`/`LineupEditor`/`TradeInboxLink` already keep
   *  (`DraftSchedulePanel`'s own docblock), never a client-side fetch on this page's first paint. */
  readonly initialOpen: readonly MockLobbyRoomSummary[];
  readonly initialMine: readonly MyMockRoomSummary[];
  readonly modes: readonly MockMode[];
  readonly teamCountOptions: readonly number[];
  readonly pickSecondsOptions: readonly number[];
  readonly defaultTeamCount: number;
  readonly defaultPickSeconds: number;
  /** `MOCK_COPY.lobbyEmptyMessage`, threaded from the server page — ruling 8, the same reason
   *  `MOCK_CONFIG`'s option values above cross as props. */
  readonly emptyMessage: string;
  /** `MOCK_COPY.lobbyHistoryEmptyMessage` (E12) — moved out of a bare string literal in this
   *  component, threaded the identical way its sibling above is. */
  readonly historyEmptyMessage: string;
}

/**
 * The practice lobby's own interactive body (Task 9, Step 2; re-composed by the lobby design
 * review): the setup form and one honest one-tap on the LEFT (R1 — the act), the live lobby a
 * stranger can join and the caller's own history on the RIGHT, two columns at `lg`+ and one
 * unbroken column (form, open, yours) below it. R5: this lobby POLLS — a bounded 30s client
 * interval re-fetch through the same `fetchJson` path first paint already used, no socket
 * (ruling 10 intact) — so the manual "Refresh" ghost button this page used to carry is gone;
 * the page keeps itself current on its own. Every navigation lands on
 * `/app/drafts/${draftId}`, the identical room `DraftRoom` already dresses for every mock phase,
 * so this component never needs its own opinion about which phase a room is in.
 */
export function MockLobby({
  initialOpen,
  initialMine,
  modes,
  teamCountOptions,
  pickSecondsOptions,
  defaultTeamCount,
  defaultPickSeconds,
  emptyMessage,
  historyEmptyMessage,
}: MockLobbyProps) {
  const router = useRouter();
  const { fetchJson } = useLeagueRoomDeps();
  const [open, setOpen] = useState(initialOpen);
  const [mine, setMine] = useState(initialMine);
  const [joiningCode, setJoiningCode] = useState<string | null>(null);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [showAllHistory, setShowAllHistory] = useState(false);

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const response = await fetchJson("/api/mock-drafts");
      const body = (await response.json()) as ApiEnvelope<MockLobbyBody>;
      if (!body.ok) return;
      setOpen(body.data.open);
      setMine(body.data.mine);
    } catch {
      // R5: a failed background poll leaves the last-known list on screen — the page already
      // rendered real data from the server, and this loop exists to keep it moving, not to be
      // the thing that can break the page. The identical swallow `HomeBoard`'s own poll keeps.
    }
  }, [fetchJson]);

  useEffect(() => {
    let cancelled = false;
    const interval = setInterval(() => {
      if (!cancelled) void refresh();
    }, LEAGUE_ROOM_CONFIG.mockLobbyPollIntervalMs);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [refresh]);

  const join = async (shareCode: string): Promise<void> => {
    setJoiningCode(shareCode);
    setJoinError(null);
    try {
      const response = await fetchJson(`/api/mock-drafts/${shareCode}`, { method: "POST" });
      const body = (await response.json()) as ApiEnvelope<ClaimMockSeatBody>;
      if (!body.ok) {
        setJoinError(body.error);
        return;
      }
      router.push(`/app/drafts/${body.data.draftId}`);
    } catch {
      setJoinError("We could not reach the server. Check your connection and try again.");
    } finally {
      setJoiningCode(null);
    }
  };

  // E7: newest first, capped to `mockHistoryVisibleCount` until the reader asks for more.
  const sortedMine = [...mine].sort((a, b) => b.startsInMs - a.startsInMs);
  const visibleMine = showAllHistory ? sortedMine : sortedMine.slice(0, LEAGUE_ROOM_CONFIG.mockHistoryVisibleCount);
  const nowMs = Date.now();
  const historyGroups = HISTORY_GROUP_ORDER.map((group) => ({
    group,
    rooms: visibleMine.filter((room) => historyGroupFor(nowMs + room.startsInMs, nowMs) === group),
  })).filter((bucket) => bucket.rooms.length > 0);

  return (
    <div className="flex flex-col gap-8 lg:grid lg:grid-cols-[minmax(0,28rem)_minmax(0,1fr)] lg:items-start lg:gap-8">
      {/* R1: the act — the form, at its own measure, plus one honest one-tap beneath it. */}
      <div className="flex flex-col gap-4">
        <Panel title="Start a mock draft">
          <MockSetupForm
            modes={modes}
            teamCountOptions={teamCountOptions}
            pickSecondsOptions={pickSecondsOptions}
            defaultTeamCount={defaultTeamCount}
            defaultPickSeconds={defaultPickSeconds}
            onCreated={(created: CreateMockRoomBody) => {
              router.push(`/app/drafts/${created.draftId}`);
            }}
          />
        </Panel>
        <SoloQuickStart teamCount={defaultTeamCount} pickSeconds={defaultPickSeconds} data-testid="quick-start-primary" />
      </div>

      {/* R1: the live lobby and the caller's own history. */}
      <div className="flex flex-col gap-8">
        <Panel title="Open mock drafts">
          <div className="flex flex-col gap-3">
            {joinError === null ? null : (
              <p role="alert" className="text-sm text-negative">
                {joinError}
              </p>
            )}
            {open.length === 0 ? (
              <div className="flex flex-col items-start gap-2">
                <p className="text-sm text-text-muted">{emptyMessage}</p>
                <SoloQuickStart teamCount={defaultTeamCount} pickSeconds={defaultPickSeconds} data-testid="quick-start-open-empty" />
              </div>
            ) : (
              <div>
                <ShelfColumnHeader />
                <ul className="flex flex-col">
                  {open.map((room) => (
                    <OpenRoomRow key={room.shareCode} room={room} joiningCode={joiningCode} onJoin={(code) => void join(code)} />
                  ))}
                </ul>
              </div>
            )}
          </div>
        </Panel>

        <Panel title="Your mock drafts" meta={mine.length === 0 ? undefined : `${mine.length} mock draft${mine.length === 1 ? "" : "s"}`}>
          {mine.length === 0 ? (
            <div className="flex flex-col items-start gap-2">
              <p className="text-sm text-text-muted">{historyEmptyMessage}</p>
              {/* At most TWO one-taps on screen (fix-pass review MEDIUM): a brand-new account
                  has both lists empty, and three byte-identical CTAs raced for the same eyeball
                  — each placement individually right (D3, R1, E12), never reconciled. The open
                  list's empty state already carries the action in exactly that state, so this
                  one yields to it and renders only when the open shelf has real rooms. */}
              {open.length === 0 ? null : (
                <SoloQuickStart teamCount={defaultTeamCount} pickSeconds={defaultPickSeconds} data-testid="quick-start-history-empty" />
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <ShelfColumnHeader />
              {historyGroups.map(({ group, rooms }) => (
                <div key={group} className="flex flex-col gap-1">
                  <h3 className={`${EYEBROW} text-text-muted`}>{group}</h3>
                  <ul className="flex flex-col">
                    {rooms.map((room) => (
                      <MineRoomRow key={room.draftId} room={room} />
                    ))}
                  </ul>
                </div>
              ))}
              {showAllHistory || sortedMine.length <= LEAGUE_ROOM_CONFIG.mockHistoryVisibleCount ? null : (
                <Button variant="ghost" size="sm" onClick={() => setShowAllHistory(true)}>
                  Show all {sortedMine.length}
                </Button>
              )}
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}
