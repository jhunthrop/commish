"use client";

import { memo, useEffect, useMemo, useRef, useState } from "react";
import type { ChatMessageView } from "@/chat/contract";
import type { Player } from "@research-ts/domain/player";
import type { TeamCard } from "@/domain/league";
import type { CompletedPick, DraftStateView } from "@/draft-engine";
import { ChatComposer } from "@/chat-room/components/chat-composer";
import { ReactionBar } from "@/chat-room/components/reaction-bar";
import { RemovedMessage } from "@/chat-room/components/removed-message";
import { ReportDialog } from "@/chat-room/components/report-dialog";
import { useLeagueChat } from "@/chat-room/hooks/use-league-chat";
import { formatChatTime } from "@/chat-room/lib/format";
import { Avatar, Button, MessageBubble, PresenceDot, Skeleton } from "@/components/ui";
import { Icon } from "@/components/ui/icon";
import { LeagueRoomDepsProvider } from "@/league-room/hooks/deps";
import { usePresence } from "@/league-room/hooks/use-presence";
import { useStableList } from "@/design/use-stable-list";
import { useDraftRoomDeps } from "../../hooks/deps";
import { PickLanding } from "../../components/pick-landing";
import { pickPlace } from "../state/board";
import { mergeStreamItems, unreadSince, type StreamItem } from "../state/stream-items";
import type { StreamWidth } from "../state/stream-width";
import { useOwnerIds } from "../hooks/use-owner-ids";
import { StreamRail, type RailCall } from "./stream-rail";

export interface StreamPanelProps {
  readonly view: DraftStateView;
  readonly leagueName: string;
  readonly teams: readonly TeamCard[];
  readonly playersById: ReadonlyMap<string, Player>;
  readonly myTeamId: string | null;
  /** The desktop width; the phone passes "open" and never changes it. */
  readonly width: StreamWidth;
  readonly onWidth: (width: StreamWidth) => void;
  /** Whether the stream is the page (phone) or a column beside the board (desktop). */
  readonly asPage: boolean;
  readonly call: RailCall | null;
  /** Reports the unread count for the top strip's pill while the stream is hidden. */
  readonly onUnread: (count: number) => void;
}

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

function hereSentence(names: readonly string[]): string {
  if (names.length === 0) return "Just you right now.";
  if (names.length === 1) return `${names[0]} is here.`;
  if (names.length === 2) return `${names[0]} and ${names[1]} are here.`;
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]} are here.`;
}

const streamItemKey = (item: StreamItem): string => item.id;

/** A pick as a line in the stream: the manager's face, the sentence, the place. Memoized over
 *  the pick object and the room's own dictionaries, so a new pick re-renders its own line only. */
const PickLine = memo(function PickLine({ pick, team, player, mine, teamCount }: { readonly pick: CompletedPick; readonly team: TeamCard | null; readonly player: Player | null; readonly mine: boolean; readonly teamCount: number }) {
  const who = mine ? "You" : (team?.name ?? "A team");
  return (
    <div data-testid="stream-item" data-kind="pick" className="flex items-start gap-2.5">
      <Avatar name={team?.ownerDisplayName ?? "?"} avatar={team?.ownerAvatarUrl} size="sm" ring={mine ? "self" : undefined} />
      <div className="flex min-w-0 flex-1 flex-col">
        <p className="break-words text-md text-text-primary">
          {who} drafted <span className="font-semibold">{player?.name ?? "a player"}</span>.
        </p>
        <p className="text-xs text-text-faint tabular-nums">
          {pickPlace(pick, teamCount)}
          {player === null ? "" : ` · ${player.position} · ${player.nflTeam}`}
          {" · "}
          <time dateTime={pick.timestamp}>{formatChatTime(pick.timestamp)}</time>
        </p>
      </div>
    </div>
  );
});

const MessageLine = memo(function MessageLine({ message, meUserId, onReact, onReport }: { readonly message: ChatMessageView; readonly meUserId: string; readonly onReact: (id: string, emoji: string) => void; readonly onReport: (id: string) => void }) {
  if (message.removal !== null) return <RemovedMessage authorName={message.authorName} authorAvatarUrl={message.authorAvatarUrl} removal={message.removal} />;
  const mine = message.authorUserId === meUserId;
  return (
    <div data-testid="stream-item" data-kind="message">
      <MessageBubble
        author={message.authorName}
        avatar={message.authorAvatarUrl}
        mine={mine}
        time={formatChatTime(message.createdAt)}
        reactions={<ReactionBar targetId={message.id} reactions={message.reactions} meUserId={meUserId} disabled={false} onReact={onReact} />}
        aside={
          mine ? undefined : (
            <button type="button" onClick={() => onReport(message.id)} className="text-xs text-text-faint underline hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
              Report
            </button>
          )
        }
      >
        {message.gif === null ? (
          message.body
        ) : (
          // eslint-disable-next-line @next/next/no-img-element -- a remote Giphy rendition; width and height are fixed server-side
          <img src={message.gif.url} alt={message.gif.alt} width={message.gif.width} height={message.gif.height} loading="lazy" className="h-auto max-h-64 w-auto max-w-full rounded-md" />
        )}
      </MessageBubble>
    </div>
  );
});

/**
 * THE STREAM (P5, rulings 1 and 2): picks and messages in one column in the room's own voice,
 * with who is here and the field to say something. Three widths on the desktop, remembered per
 * browser: open at 320, the 64px rail (the default), hidden with a pill on the top strip. On the
 * phone the stream is the screen. The hooks live HERE at every width, so the rail's "3 new" and
 * the strip's pill count what actually arrived while the column was folded.
 *
 * Presence and the chat ride the shared league stream through the room's own deps seam, so a
 * test double for the draft room is a test double for the whole panel.
 */
export function StreamPanel(props: StreamPanelProps) {
  const deps = useDraftRoomDeps();
  return (
    <LeagueRoomDepsProvider deps={deps}>
      <StreamPanelBody {...props} />
    </LeagueRoomDepsProvider>
  );
}

function StreamPanelBody({ view, leagueName, teams, playersById, myTeamId, width, onWidth, asPage, call, onUnread }: StreamPanelProps) {
  const chat = useLeagueChat(view.leagueId);
  const present = usePresence(view.leagueId, []);
  const owners = useOwnerIds(view.leagueId);
  const teamsById = useMemo(() => new Map(teams.map((team) => [team.id, team])), [teams]);
  const me = myTeamId === null ? null : (teamsById.get(myTeamId) ?? null);
  const merged = useMemo(() => mergeStreamItems(view.picks, chat.messages), [view.picks, chat.messages]);
  // Untouched items keep their objects across a pick or a message, so the memoized lines skip.
  const items = useStableList(merged, streamItemKey);
  const open = width === "open";

  // What the reader has seen: everything on the first paint (a cold open owes nobody a "new"
  // pill for picks that landed before they arrived), everything whenever the column is open,
  // frozen when it folds.
  const [seen, setSeen] = useState<number | null>(null);
  const historyCounted = useRef(false);
  useEffect(() => {
    if (open) {
      setSeen(items.length);
      return;
    }
    // The first paint baselines whatever is already here (the picks, whether or not the chat
    // ever answers); the chat's first page, when it lands, is history and joins the baseline once.
    if (seen === null) setSeen(items.length);
    else if (!historyCounted.current && chat.status === "ready") {
      historyCounted.current = true;
      setSeen(items.length);
    }
  }, [open, seen, chat.status, items.length]);
  const unread = useMemo(() => (open || seen === null ? { count: 0, mentionBy: null } : unreadSince(items, seen, chat.meUserId, me?.ownerDisplayName ?? null)), [open, items, seen, chat.meUserId, me]);
  useEffect(() => {
    onUnread(width === "hidden" ? unread.count : 0);
  }, [onUnread, width, unread.count]);

  const others = useMemo(() => teams.filter((team) => team.id !== myTeamId && present.has(owners.get(team.id) ?? "")), [teams, myTeamId, present, owners]);
  const lastPick = view.picks[view.picks.length - 1] ?? null;
  const lastPickTeam = lastPick === null ? null : (teamsById.get(lastPick.teamId) ?? null);
  const lastPickPlayer = lastPick === null ? null : (playersById.get(lastPick.playerId) ?? null);
  const teamCount = view.draftOrder.length;

  const [reportingId, setReportingId] = useState<string | null>(null);
  const { react } = chat;
  const onReact = useMemo(() => (id: string, emoji: string) => void react(id, emoji), [react]);
  const footRef = useRef<HTMLDivElement | null>(null);
  const painted = useRef(false);
  const atFoot = useRef(true);
  useEffect(() => {
    const foot = footRef.current;
    if (foot === null || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => {
      atFoot.current = entry?.isIntersecting ?? false;
    });
    observer.observe(foot);
    return () => observer.disconnect();
  }, [open]);
  // THE FOOT FOLLOWS ONLY A READER WHO WAS ALREADY THERE, and only inside the column's own box.
  // On the phone the stream is the page, so nothing here ever scrolls: a short stream's foot is
  // in view at the top of the page, and following it would walk the reader down the room pick
  // by pick. The desktop column scrolls itself to its foot once, then a new item pulls the view
  // to the foot only while the foot was already in view.
  useEffect(() => {
    if (!open || asPage) return;
    if (!painted.current) {
      painted.current = true;
      footRef.current?.scrollIntoView({ block: "end" });
      return;
    }
    if (atFoot.current) footRef.current?.scrollIntoView({ block: "end" });
  }, [open, asPage, items.length]);

  if (width === "hidden") return null;
  if (!open) {
    return <StreamRail unread={unread} present={others} lastPick={lastPick} lastPickTeam={lastPickTeam} lastPickPlayer={lastPickPlayer} call={call} onOpen={() => onWidth("open")} onHide={() => onWidth("hidden")} />;
  }

  const confirmed = others.length > 0 || (me !== null && present.has(owners.get(me.id) ?? ""));
  const older = items.slice(0, -1);
  const latest = items[items.length - 1] ?? null;
  // The latest pick lands as the frame worth sending (P8); every earlier pick is a line.
  const latestIsPick = latest !== null && latest.kind === "pick";

  const line = (item: StreamItem) =>
    item.kind === "pick" ? (
      <PickLine key={item.id} pick={item.pick} team={teamsById.get(item.pick.teamId) ?? null} player={playersById.get(item.pick.playerId) ?? null} mine={item.pick.teamId === myTeamId} teamCount={teamCount} />
    ) : (
      <MessageLine key={item.id} message={item.message} meUserId={chat.meUserId} onReact={onReact} onReport={setReportingId} />
    );

  return (
    <section
      aria-label="The room"
      data-testid="room-stream"
      data-width={asPage ? "page" : "open"}
      className={`flex min-h-0 flex-col gap-3 rounded-xl bg-surface-elevated p-3 shadow-card ${asPage ? "" : "w-80 shrink-0"}`}
    >
      <div className="flex items-center gap-2">
        <h2 className="font-display text-md font-bold text-text-primary">The room</h2>
        {chat.connection === "reconnecting" ? (
          <p role="status" className="text-xs text-text-faint">
            Getting you back into the room
          </p>
        ) : null}
        <span className="flex-1" />
        {asPage ? null : (
          <button type="button" aria-label="Collapse the room" onClick={() => onWidth("rail")} className="flex size-8 items-center justify-center rounded-pill border border-edge text-text-muted hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
            <Icon name="chevron-right" size={16} />
          </button>
        )}
      </div>
      {confirmed ? (
        <div data-testid="who-is-here" className="flex items-center gap-2 text-sm text-text-muted">
          {others.length === 0 ? null : (
            <span className="flex shrink-0" aria-hidden="true">
              {others.map((team, index) => (
                <Avatar key={team.id} name={team.ownerDisplayName} avatar={team.ownerAvatarUrl} size="sm" className={index === 0 ? "" : "-ml-2 ring-2 ring-surface-elevated"} />
              ))}
            </span>
          )}
          <PresenceDot />
          <span>{hereSentence(others.map((team) => firstName(team.ownerDisplayName)))}</span>
        </div>
      ) : null}
      <div className={`flex min-h-0 flex-1 flex-col gap-3 ${asPage ? "" : "overflow-y-auto"}`}>
        {chat.status === "loading" ? <Skeleton lines={3} /> : null}
        {chat.status === "error" ? (
          <p className="text-sm text-text-muted">
            The room would not open.{" "}
            <Button variant="ghost" size="sm" onClick={() => void chat.refresh()}>
              Try again
            </Button>
          </p>
        ) : null}
        {chat.hasMore ? (
          <Button variant="secondary" size="sm" className="self-center" loading={chat.loadingEarlier} disabled={chat.loadingEarlier} onClick={() => void chat.loadEarlier()}>
            Earlier messages
          </Button>
        ) : null}
        {items.length === 0 && chat.status === "ready" ? <p className="py-4 text-center text-sm text-text-faint">Nothing has happened here yet. Say the first thing.</p> : null}
        <div role="log" aria-live="polite" aria-label="What happened" className="flex flex-col gap-3">
          {(latestIsPick ? older : items).map(line)}
          {latestIsPick && latest.kind === "pick" ? (
            <div data-testid="stream-item" data-kind="landing">
              <PickLanding pick={latest.pick} team={lastPickTeam} player={lastPickPlayer} mine={latest.pick.teamId === myTeamId} leagueName={leagueName} teamCount={teamCount} />
            </div>
          ) : null}
        </div>
        <div ref={footRef} />
      </div>
      <ChatComposer sending={chat.sending} onSend={chat.send} gifSearchEnabled={chat.gifSearchEnabled} onSearchGifs={chat.searchGifs} sendVariant="secondary" />
      <ReportDialog open={reportingId !== null} leagueId={view.leagueId} messageId={reportingId ?? ""} onClose={() => setReportingId(null)} />
    </section>
  );
}
