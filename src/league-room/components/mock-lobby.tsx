"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { ApiEnvelope } from "@/lib/api/respond";
import type {
  MockLobbyBody,
  CreateMockRoomBody,
} from "@/app/api/mock-drafts/route";
import type { ClaimMockSeatBody } from "@/app/api/mock-drafts/[code]/route";
import type {
  MockLobbyRoomSummary,
  MyMockRoomSummary,
} from "@/mock-draft-service/lobby";
import type { MockWireItem } from "@/mock-draft-service/wire";
import type { MockMode } from "@/mock-draft/config";
import { Button, ButtonLink, EYEBROW, LowerThird, Panel, SeatMeter, StatPill, type LowerThirdCell } from "@/components/ui";
import { MICRO_LABEL, UI_CONFIG } from "@/components/ui/config";
import {
  Countdown,
  formatCoarseDuration,
  formatCountdown,
  useCountdown,
} from "@/components/ui/countdown";
import type { DraftStatus } from "@/domain/draft";
import { LEAGUE_ROOM_CONFIG } from "../config";
import { useLeagueRoomDeps } from "../hooks/deps";
import { MockSetupForm } from "./mock-setup-form";
import { MockWire } from "./mock-wire";

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
  return startsInMs <= 0
    ? "Starting any moment"
    : `Starts in ${formatCoarseDuration(startsInMs)}`;
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
export function historyWhenSentence(
  status: DraftStatus,
  startsInMs: number,
): string {
  if (status === "scheduled") return startsInSentence(startsInMs);
  return `${formatCoarseDuration(Math.abs(startsInMs))} ago`;
}

/**
 * D3/R1's one honest one-tap: states the room it will actually create — the SAME defaults
 * `?create=solo`'s own server route falls back to (`createMockRoomSchema`'s own defaults,
 * threaded here as `defaultTeamCount`/`defaultPickSeconds`) — rather than a generic "Start a
 * mock draft" that could be mistaken for the form's own submit button two feet away.
 */
export function soloQuickStartLabel(
  teamCount: number,
  pickSeconds: number,
): string {
  return `Start a solo mock now, ${teamCount} teams, ${pickSeconds}s clock`;
}

/** The open lobby's own axis: seats remaining, ascending. The room closest to firing is P1 — the
 *  same one number the storefront's tower ranks by, for the same reason: it is the only fact that
 *  varies between two practice rooms and the only one that decides which to join. */
function bySeatsRemaining(a: MockLobbyRoomSummary, b: MockLobbyRoomSummary): number {
  return a.seatsOpen - b.seatsOpen;
}

interface OpenRoomRowProps {
  readonly room: MockLobbyRoomSummary;
  readonly position: number;
  readonly leader: boolean;
  readonly joiningCode: string | null;
  readonly onJoin: (shareCode: string) => void;
}

/**
 * AN OPEN PRACTICE ROOM AS A TIMING-TOWER LINE (Sunday v5), pattern-matched to `LeagueRow` rather
 * than re-derived: a position numeral, the seats left as the row's HERO number, the room's shape
 * in mono, its countdown, and the verb last in the same horizontal place on every row.
 *
 * IT WAS A CARD, and rule 4's amended test permitted that. The founder's own storefront ruling
 * settles which side of the "may" this list falls on — a ranked list of near-identical rooms is
 * something you read DOWN, and eight bordered cards is exactly the "my eyes do not know where to
 * focus" complaint at a smaller scale.
 *
 * THE LIVE CHANNEL, on the real threshold every seat sentence in the product already keys on
 * (`UI_CONFIG.seatMeter.lowSeatsThreshold`): a room this close to firing paints its numeral and
 * its hero figure live-red, and the leader wears the amber rail. `SeatMeter` still owns the SPOKEN
 * sentence via `srOnlySentence`, so the figure beside the bar is one product seat statement
 * rendered twice, never two that can disagree.
 *
 * A dedicated row component (rather than inlining the hook in a `.map`) so each room's own
 * countdown ticks independently, the same reason `MockShareLanding` is a whole component.
 */
function OpenRoomRow({ room, position, leader, joiningCode, onJoin }: OpenRoomRowProps) {
  // Computed once, from the request-time `startsInMs` the server read (ruling 10) — the same
  // "a relative duration becomes an absolute deadline the moment the client has it" shape
  // `MockShareLanding` keeps for this identical fact.
  const [startsAt] = useState(() =>
    new Date(Date.now() + room.startsInMs).toISOString(),
  );
  const { remainingMs } = useCountdown(startsAt);
  const urgent = room.seatsOpen > 0 && room.seatsOpen < UI_CONFIG.seatMeter.lowSeatsThreshold;
  return (
    <li className="border-t border-line">
      <div
        className={`flex items-center gap-4 border-l-[3px] py-3 pl-2 transition-colors hover:bg-surface-elevated ${
          leader ? "border-l-accent bg-gradient-to-r from-accent-glow via-transparent to-transparent" : "border-l-transparent"
        }`}
      >
        <span
          aria-hidden="true"
          className={`font-display text-2xl font-extrabold tabular-nums ${
            leader ? "text-accent" : urgent ? "text-live" : "text-text-faint"
          }`}
        >
          {position}
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <span
            data-testid="lobby-seats-open"
            className={`font-display text-2xl font-bold leading-none tabular-nums ${urgent ? "text-live" : "text-text-primary"}`}
          >
            {room.seatsOpen}
            <span className={`${MICRO_LABEL} ml-1.5 align-middle font-sans text-text-faint`}>
              {room.seatsOpen === 1 ? "seat open" : "open"} of {room.teamCount}
            </span>
          </span>
          <SeatMeter
            filled={room.teamCount - room.seatsOpen}
            total={room.teamCount}
            srOnlySentence
          />
        </div>
        <span className="hidden shrink-0 font-mono text-xs tabular-nums text-text-muted sm:inline">
          {room.teamCount} teams · {room.pickSeconds}s clock
        </span>
        {remainingMs === null ? null : (
          <Countdown remainingMs={remainingMs} size="md" />
        )}
        {/* LAW 5: `verb`, because a lobby is a shelf you act on once per row. `primary` belongs
            to the form's own submit — the one ceremonial act this page exists to perform. */}
        <Button
          variant="verb"
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
      <div className="flex flex-wrap items-center justify-between gap-3 py-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="min-w-0 break-words text-sm font-semibold text-text-primary">
            {room.teamName}
          </span>
          {/* Mono, because every clause after the name is DATA — a mode, a size, a clock, a
              coarse duration — and mono keeps those columns aligned as the eye runs down a
              history. Law 4: the same facts, one line tighter. */}
          <span className="min-w-0 break-words font-mono text-xs tabular-nums text-text-muted">
            {MODE_ROW_LABEL[room.mode]} · {room.teamCount} teams ·{" "}
            {room.pickSeconds}s · {historyWhenSentence(room.status, room.startsInMs)}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {/* The status as a chip rather than a second sentence. `in_progress` is the only one
              that is genuinely happening now, so it is the only one that takes the LIVE channel
              (Sunday v5, law 4) — a filled plate in live red, the same shape the storefront's own
              chapter bands wear. Everything else is a quiet neutral chip: a finished mock draft
              is a record, and a record is grey. */}
          {room.status === "in_progress" ? (
            <span className={`${MICRO_LABEL} rounded-sm bg-live px-2 py-0.5 font-semibold text-live-text`}>{STATUS_LABEL.in_progress}</span>
          ) : (
            <StatPill label={STATUS_LABEL[room.status]} tone="neutral" />
          )}
          {/* LAW 5: a room still drafting is an ACT you return to, and it wears the verb; a
              finished or waiting room is a thing you look at, and its way in stays quiet. A bare
              underlined green link was neither — it spent the money channel on navigation. */}
          <ButtonLink
            href={`/app/drafts/${room.draftId}`}
            size="sm"
            variant={room.status === "in_progress" ? "verb" : "secondary"}
          >
            {STATUS_LINK_LABEL[room.status]}
          </ButtonLink>
        </div>
      </div>
    </li>
  );
}

type HistoryGroupName = "Today" | "Yesterday" | "Earlier";
const HISTORY_GROUP_ORDER: readonly HistoryGroupName[] = [
  "Today",
  "Yesterday",
  "Earlier",
];
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
export function historyGroupFor(
  startsAtMs: number,
  nowMs: number,
): HistoryGroupName {
  const day = dayKey(startsAtMs);
  if (day === dayKey(nowMs)) return "Today";
  if (day === dayKey(nowMs - MS_PER_DAY)) return "Yesterday";
  return "Earlier";
}

/**
 * THE LOBBY'S LOWER THIRD (Sunday v5, law 6): the subject, the fact the decision rests on, and
 * one verb. It replaces the three identical "Start a solo mock now" links this page used to
 * scatter through its two empty states and its left column — each placement individually
 * defensible, never reconciled, and all three saying the same sentence to the same eye.
 *
 * THE VERB IS WHICHEVER ACT IS ACTUALLY WAITING, in this order: a room of your own that is
 * drafting right now outranks everything (you are late to it), then the open room closest to
 * firing, then the standing offer to start a solo room. Only one of the three ever renders, so
 * this page has exactly one loud action however many rooms are on it.
 *
 * `live` follows the same rule the front door's own strip does: the strip goes red when there is
 * something genuinely happening, and stays amber when the only thing on offer is a standing one.
 */
function LobbyLowerThird({
  open,
  mine,
  defaultTeamCount,
  defaultPickSeconds,
  joiningCode,
  onJoin,
}: {
  readonly open: readonly MockLobbyRoomSummary[];
  readonly mine: readonly MyMockRoomSummary[];
  readonly defaultTeamCount: number;
  readonly defaultPickSeconds: number;
  readonly joiningCode: string | null;
  readonly onJoin: (shareCode: string) => void;
}) {
  const drafting = mine.find((room) => room.status === "in_progress") ?? null;
  const nearest = [...open].sort(bySeatsRemaining)[0] ?? null;
  const [startsAt] = useState(() => new Date(Date.now() + (nearest?.startsInMs ?? 0)).toISOString());
  const { remainingMs } = useCountdown(nearest === null ? null : startsAt);

  if (drafting !== null) {
    return (
      <LowerThird
        live
        cells={[
          { label: "Drafting now", value: drafting.teamName },
          { label: "Room", value: `${drafting.teamCount} teams · ${drafting.pickSeconds}s` },
        ]}
        action={
          <ButtonLink href={`/app/drafts/${drafting.draftId}`} variant="verb" size="lg">
            Back to your draft
          </ButtonLink>
        }
      />
    );
  }

  if (nearest !== null) {
    const cells: LowerThirdCell[] = [
      { label: "Rooms open", value: open.length },
      {
        label: "Closest to filling",
        value: (
          <>
            {nearest.seatsOpen}
            <span className={`${MICRO_LABEL} ml-1.5 align-middle font-sans text-text-faint`}>
              {nearest.seatsOpen === 1 ? "seat open" : "open"} of {nearest.teamCount}
            </span>
          </>
        ),
      },
    ];
    if (remainingMs !== null) cells.push({ label: "Starts in", value: formatCountdown(remainingMs), clock: true });
    return (
      <LowerThird
        live
        cells={cells}
        action={
          <Button
            variant="verb"
            size="lg"
            onClick={() => onJoin(nearest.shareCode)}
            disabled={joiningCode !== null}
            loading={joiningCode === nearest.shareCode}
          >
            Take a seat
          </Button>
        }
      />
    );
  }

  return (
    <LowerThird
      cells={[{ label: "Open rooms", value: "None right now" }]}
      action={
        <ButtonLink href={SOLO_LOBBY_PATH} variant="verb" size="lg" data-testid="quick-start-primary">
          {soloQuickStartLabel(defaultTeamCount, defaultPickSeconds)}
        </ButtonLink>
      }
    />
  );
}

export interface MockLobbyProps {
  /** Server-read initial data (Task 9) — the SAME "SSR-first, `fetchJson` only for a write or a
   *  refresh" split `AdvisorPanel`/`LineupEditor`/`TradeInboxLink` already keep
   *  (`DraftSchedulePanel`'s own docblock), never a client-side fetch on this page's first paint. */
  readonly initialOpen: readonly MockLobbyRoomSummary[];
  readonly initialMine: readonly MyMockRoomSummary[];
  /** R3: the practice wire's own server-read items, refreshed by the SAME 30s poll as `open`/
   *  `mine` (one fetch, not two) — see `MockWire`'s own docblock for the surface it renders. */
  readonly initialWireItems: readonly MockWireItem[];
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
  initialWireItems,
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
  const [wireItems, setWireItems] = useState(initialWireItems);
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
      setWireItems(body.data.wire);
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
      const response = await fetchJson(`/api/mock-drafts/${shareCode}`, {
        method: "POST",
      });
      const body = (await response.json()) as ApiEnvelope<ClaimMockSeatBody>;
      if (!body.ok) {
        setJoinError(body.error);
        return;
      }
      router.push(`/app/drafts/${body.data.draftId}`);
    } catch {
      setJoinError(
        "We could not reach the server. Check your connection and try again.",
      );
    } finally {
      setJoiningCode(null);
    }
  };

  // E7: newest first, capped to `mockHistoryVisibleCount` until the reader asks for more.
  const sortedMine = [...mine].sort((a, b) => b.startsInMs - a.startsInMs);
  const visibleMine = showAllHistory
    ? sortedMine
    : sortedMine.slice(0, LEAGUE_ROOM_CONFIG.mockHistoryVisibleCount);
  const nowMs = Date.now();
  const historyGroups = HISTORY_GROUP_ORDER.map((group) => ({
    group,
    rooms: visibleMine.filter(
      (room) => historyGroupFor(nowMs + room.startsInMs, nowMs) === group,
    ),
  })).filter((bucket) => bucket.rooms.length > 0);

  return (
    <div className="flex flex-col gap-6">
      {/* R3: the practice wire — the Sunday Standard's signature on this surface, a quiet ticker
          of real events directly under the page's own h1/promise line (rendered by the server
          page above this component). Renders nothing at all when `wireItems` is empty. */}
      <MockWire items={wireItems} />
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
                // The empty state says the one true thing and stops: the strip at the foot of
                // this page already carries the action, in every state, so an empty list no
                // longer grows its own CTA beside two others.
                <p className="text-sm text-text-muted">{emptyMessage}</p>
              ) : (
                <ul className="flex flex-col">
                  {[...open].sort(bySeatsRemaining).map((room, index) => (
                    <OpenRoomRow
                      key={room.shareCode}
                      room={room}
                      position={index + 1}
                      leader={index === 0}
                      joiningCode={joiningCode}
                      onJoin={(code) => void join(code)}
                    />
                  ))}
                </ul>
              )}
            </div>
          </Panel>

          <Panel
            title="Your mock drafts"
            meta={
              mine.length === 0
                ? undefined
                : `${mine.length} mock draft${mine.length === 1 ? "" : "s"}`
            }
          >
            {mine.length === 0 ? (
              <p className="text-sm text-text-muted">{historyEmptyMessage}</p>
            ) : (
              <div className="flex flex-col gap-4">
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
                {showAllHistory ||
                sortedMine.length <=
                  LEAGUE_ROOM_CONFIG.mockHistoryVisibleCount ? null : (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowAllHistory(true)}
                  >
                    Show all {sortedMine.length}
                  </Button>
                )}
              </div>
            )}
          </Panel>
        </div>
      </div>
      {/* LAW 6: the page ends in a lower third. Full-bleed against the shell's own gutter, the
          way a strip across the foot is meant to read. */}
      <div className="-mx-4 mt-2">
        <LobbyLowerThird
          open={open}
          mine={mine}
          defaultTeamCount={defaultTeamCount}
          defaultPickSeconds={defaultPickSeconds}
          joiningCode={joiningCode}
          onJoin={(code) => void join(code)}
        />
      </div>
    </div>
  );
}
