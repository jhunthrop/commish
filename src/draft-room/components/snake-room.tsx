"use client";

import type { ReactNode } from "react";
import type { Player } from "@/domain/player";
import type { ClientDraftAction } from "@/draft-engine";
import type { DraftRoom as DraftRoomState } from "../hooks/use-draft-room";
import { QuiltRoom } from "../quilt/quilt-room";

export interface SnakeRoomProps {
  readonly room: DraftRoomState;
  readonly playersById: ReadonlyMap<string, Player>;
  readonly onAct: (action: ClientDraftAction) => void;
  /**
   * The old shell's social band. Accepted for `DraftRoom`'s call-site compatibility and
   * DELIBERATELY unrendered: the Quilt's design law gives the stage to the board and the right
   * edge to the peek sheet, and the mocks carry no chat column. League chat stays reachable
   * from the league room; the auction room still renders this band.
   */
  readonly aside?: ReactNode;
}

/**
 * THE SNAKE ROOM IS THE QUILT (founder-approved direction, 2026-09-02 — the blueprint mocks in
 * `.superpowers/mocks/`). The old `RoomShell` composition still serves the auction format;
 * snake drafts get the board-owns-the-stage rebuild.
 */
export function SnakeRoom({ room, playersById, onAct }: SnakeRoomProps) {
  return <QuiltRoom room={room} playersById={playersById} onAct={onAct} />;
}
