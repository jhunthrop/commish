"use client";

import type { Player } from "@/domain/player";
import type { TeamCard } from "@/domain/league";
import type { CompletedPick } from "@/draft-engine";
import { Avatar, PlayerFace, PositionBadge, PresenceDot } from "@/components/ui";
import { Icon } from "@/components/ui/icon";
import { MICRO_LABEL } from "@/components/ui/config";
import { QUILT_CONFIG } from "../state/config";
import type { Unread } from "../state/stream-items";

export interface RailCall {
  readonly player: Player;
  readonly survived: number | null;
}

export interface StreamRailProps {
  readonly unread: Unread;
  /** The managers with a live connection right now, you excluded, faces first. */
  readonly present: readonly TeamCard[];
  readonly lastPick: CompletedPick | null;
  readonly lastPickTeam: TeamCard | null;
  readonly lastPickPlayer: Player | null;
  readonly call: RailCall | null;
  readonly onOpen: () => void;
  readonly onHide: () => void;
}

/**
 * THE RAIL (ruling 2, the desktop default): the room folded to 64px. The way in, the "new" pill
 * (amber when somebody said your name), who is here as faces with the breathing dot, the last
 * pick as its manager's face and a position chip, and our call as a face and a number. Every
 * line here is also said in words in the open stream; nothing lives only in the rail.
 */
export function StreamRail({ unread, present, lastPick, lastPickTeam, lastPickPlayer, call, onOpen, onHide }: StreamRailProps) {
  const cap = QUILT_CONFIG.stream.presenceFaceCap;
  const shown = present.slice(0, cap);
  const more = present.length - shown.length;
  return (
    <aside data-testid="stream-rail" aria-label="The room, collapsed" className="flex min-h-0 w-16 shrink-0 flex-col items-center gap-2.5 rounded-xl bg-surface-elevated py-3 shadow-card">
      <button type="button" aria-label="Open the room" onClick={onOpen} className="flex size-9 items-center justify-center rounded-pill border border-edge text-text-muted hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
        <span className="inline-flex rotate-180">
          <Icon name="chevron-right" size={16} />
        </span>
      </button>
      {unread.count === 0 ? null : (
        <span data-testid="stream-new-pill" data-mention={unread.mentionBy === null ? undefined : "true"} className={`rounded-pill px-2 py-0.5 font-display text-xs font-bold tabular-nums ${unread.mentionBy === null ? "bg-surface text-text-muted" : "bg-self text-self-text"}`}>
          {unread.count} new
        </span>
      )}
      {unread.mentionBy === null ? null : <span className={`${MICRO_LABEL} px-1 text-center text-[9px] leading-tight text-self-ink`}>{unread.mentionBy} said your name</span>}
      {present.length === 0 ? null : (
        <div className="flex flex-col items-center" aria-label={`Here now: ${present.map((team) => team.ownerDisplayName).join(", ")}`}>
          {shown.map((team, index) => (
            <span key={team.id} className={`relative ${index === 0 ? "" : "-mt-2"}`}>
              <Avatar name={team.ownerDisplayName} avatar={team.ownerAvatarUrl} size="md" className="ring-2 ring-surface-elevated" />
              <PresenceDot className="absolute -bottom-0.5 -right-0.5 ring-2 ring-surface-elevated" />
            </span>
          ))}
          {more > 0 ? <span className="-mt-2 flex size-8 items-center justify-center rounded-pill bg-surface font-display text-xs font-bold text-text-muted ring-2 ring-surface-elevated">+{more}</span> : null}
        </div>
      )}
      {lastPick === null || lastPickPlayer === null ? null : (
        <div className="flex flex-col items-center gap-1">
          <span className={`${MICRO_LABEL} text-[9px] text-text-faint`}>Landed</span>
          <div
            key={lastPick.pickNumber}
            data-testid="rail-last-pick"
            aria-label={`${lastPickTeam?.name ?? "A team"} drafted ${lastPickPlayer.name}`}
            className="flex w-11 flex-col items-center gap-1 rounded-md bg-surface py-1.5 animate-spring-in"
          >
            <Avatar name={lastPickTeam?.ownerDisplayName ?? "?"} avatar={lastPickTeam?.ownerAvatarUrl} size="sm" />
            <PositionBadge position={lastPickPlayer.position} size="sm" />
          </div>
        </div>
      )}
      <span className="flex-1" />
      {call === null ? null : (
        <div data-testid="rail-call" aria-label={`Our call, ${call.player.name}${call.survived === null ? "" : `, ${call.survived} runs still have him`}`} className="flex flex-col items-center gap-0.5">
          <span className={`${MICRO_LABEL} text-[9px] text-text-faint`}>Our call</span>
          <PlayerFace player={call.player} size="sm" />
          {call.survived === null ? null : <span className="font-display text-sm font-extrabold tabular-nums text-text-primary">{call.survived}</span>}
        </div>
      )}
      <button type="button" aria-label="Hide the room" onClick={onHide} className="text-[10px] font-semibold text-text-faint hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
        hide
      </button>
    </aside>
  );
}
