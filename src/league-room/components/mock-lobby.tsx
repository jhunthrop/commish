"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { ApiEnvelope } from "@/lib/api/respond";
import type { MockLobbyBody, CreateMockRoomBody } from "@/app/api/mock-drafts/route";
import type { ClaimMockSeatBody } from "@/app/api/mock-drafts/[code]/route";
import type { MockLobbyRoomSummary, MyMockRoomSummary } from "@/mock-draft-service/lobby";
import type { MockMode } from "@/mock-draft/config";
import { Button, Card } from "@/components/ui";
import { formatCoarseDuration } from "@/components/ui/countdown";
import type { DraftStatus } from "@/domain/draft";
import { useLeagueRoomDeps } from "../hooks/deps";
import { MockSetupForm } from "./mock-setup-form";

/**
 * `?create=solo`'s own path (`DraftRoom`'s identical `MOCK_LOBBY_PATH`,
 * `@/draft-room/components/draft-room.tsx`) — the empty-lobby action reruns the SAME immediate
 * solo request "Run it again" already sends, never a second invented shortcut.
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
  /** `MOCK_COPY.lobbyEmptyMessage`/`lobbyEmptyActionLabel`, threaded from the server page —
   *  ruling 8, the same reason `MOCK_CONFIG`'s option values above cross as props. */
  readonly emptyMessage: string;
  readonly emptyActionLabel: string;
}

/**
 * The practice lobby's own interactive body (Task 9, Step 2): the setup form, the open rooms a
 * stranger can join (ruling 10 — request-time counts with a manual refresh, no anonymous or
 * pre-seat SSE), and the caller's own rooms for re-entry. Every navigation lands on
 * `/app/drafts/${draftId}` — the identical room `DraftRoom` already dresses for every mock phase
 * (the waiting share panel, the live board, the results screen), so this component never needs
 * its own opinion about which of those three a room is in.
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
  emptyActionLabel,
}: MockLobbyProps) {
  const router = useRouter();
  const { fetchJson } = useLeagueRoomDeps();
  const [open, setOpen] = useState(initialOpen);
  const [mine, setMine] = useState(initialMine);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [joiningCode, setJoiningCode] = useState<string | null>(null);
  const [joinError, setJoinError] = useState<string | null>(null);

  const refresh = async (): Promise<void> => {
    setRefreshing(true);
    setRefreshError(null);
    try {
      const response = await fetchJson("/api/mock-drafts");
      const body = (await response.json()) as ApiEnvelope<MockLobbyBody>;
      if (!body.ok) {
        setRefreshError(body.error);
        return;
      }
      setOpen(body.data.open);
      setMine(body.data.mine);
    } catch {
      setRefreshError("We could not reach the server. Check your connection and try again.");
    } finally {
      setRefreshing(false);
    }
  };

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

  return (
    <div className="flex flex-col gap-8">
      <Card as="section" aria-label="Start a practice draft" className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold text-text-primary">Start a practice draft</h2>
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
      </Card>

      <section aria-label="Open practice drafts" className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-text-primary">Open practice drafts</h2>
          <Button variant="ghost" size="sm" onClick={() => void refresh()} disabled={refreshing} loading={refreshing}>
            Refresh
          </Button>
        </div>
        {refreshError === null ? null : (
          <p role="alert" className="text-sm text-negative">
            {refreshError}
          </p>
        )}
        {joinError === null ? null : (
          <p role="alert" className="text-sm text-negative">
            {joinError}
          </p>
        )}
        {open.length === 0 ? (
          <div className="flex flex-col items-start gap-2">
            <p className="text-sm text-text-muted">{emptyMessage}</p>
            <Link href={SOLO_LOBBY_PATH} className="text-sm font-medium text-accent underline">
              {emptyActionLabel}
            </Link>
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {open.map((room) => (
              <li
                key={room.shareCode}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-surface-elevated p-3"
              >
                <div className="flex flex-col gap-1">
                  <span className="text-sm font-medium text-text-primary">
                    {room.teamCount} teams · {room.seatsOpen} open · {room.pickSeconds}s clock
                  </span>
                  <span className="text-sm text-text-muted">{startsInSentence(room.startsInMs)}</span>
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => void join(room.shareCode)}
                  disabled={joiningCode !== null}
                  loading={joiningCode === room.shareCode}
                >
                  Join
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-label="Your practice rooms" className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold text-text-primary">Your practice rooms</h2>
        {mine.length === 0 ? (
          <p className="text-sm text-text-muted">You have no practice rooms yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {mine.map((room) => (
              <li
                key={room.draftId}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-surface-elevated p-3"
              >
                <div className="flex flex-col gap-1">
                  <span className="text-sm font-medium text-text-primary">
                    {room.teamCount} teams · {room.pickSeconds}s clock
                  </span>
                  <span className="text-sm text-text-muted">{STATUS_LABEL[room.status]}</span>
                </div>
                <Link href={`/app/drafts/${room.draftId}`} className="text-sm font-medium text-accent underline">
                  {STATUS_LINK_LABEL[room.status]}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
