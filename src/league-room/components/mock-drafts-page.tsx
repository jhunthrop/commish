"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { ApiEnvelope } from "@/lib/api/respond";
import type { MockLobbyBody, CreateMockRoomBody } from "@/app/api/mock-drafts/route";
import type { ClaimMockSeatBody } from "@/app/api/mock-drafts/[code]/route";
import type { MockLobbyRoomSummary, MyMockRoomSummary } from "@/mock-draft-service/lobby";
import type { MockMode } from "@/mock-draft/config";
import { BigNumber, Button, ButtonLink, CountdownLabel, SeatStack, StatPill } from "@/components/ui";
import { MICRO_LABEL } from "@/components/ui/config";
import { LEAGUE_ROOM_CONFIG } from "../config";
import { useLeagueRoomDeps } from "../hooks/deps";
import {
  createRequestFor,
  decodeMockTable,
  encodeMockTable,
  type MockTable,
  type MockTableOptions,
} from "../lib/mock-table";
import { MockTableChips } from "./mock-table-chips";

/**
 * THE MOCK DRAFTS PAGE'S LEFT HALF (the workflow pass, laws 1 and 2): one verb, then people as
 * a door.
 *
 * LAW 1 — the solo card leads. DRAFT NOW is this page's ONE solid amber (`Button` `verb`); the
 * seven settings are `MockTableChips`' quiet sentence, remembered per user in `localStorage`
 * (`LEAGUE_ROOM_CONFIG.mockTableStorageKey` — the cheat sheet's own browser-persistence
 * precedent). Zero decisions stand between landing and the room: the verb posts the remembered
 * table as-is.
 *
 * LAW 2 — people are a door, not a mode toggle. Two rows with outline verbs create the lobby
 * and link rooms with the SAME remembered table; open lobby rooms list beneath them. An EMPTY
 * lobby renders NOTHING — no box announcing an absence, null is absent (founder, 2026-08-28,
 * the stadium pass, now a law).
 *
 * The lobby list polls on the same bounded 30s interval the old lobby kept (R5's ruling —
 * request-time truth, no socket, ruling 10 intact).
 */

/** This surface's own control words — labels, never `MOCK_COPY`'s pre-vetted sentences (the
 *  client boundary split `MODE_ROW_LABEL` recorded for this directory). */
const STATUS_ROW_LABEL: Readonly<Record<string, string>> = {
  scheduled: "Waiting to start",
  in_progress: "Drafting now",
};

export interface MockDraftsPageCopy {
  readonly soloDetail: string;
  readonly tableHint: string;
  readonly openLobbyDetail: string;
  readonly crewDetail: string;
  readonly sheetTieIn: string;
}

export interface MockDraftsPageProps {
  /** Server-read initial data — SSR-first, `fetchJson` only for a write or a refresh, the
   *  same split the old lobby kept. */
  readonly initialOpen: readonly MockLobbyRoomSummary[];
  readonly initialMine: readonly MyMockRoomSummary[];
  readonly options: MockTableOptions;
  readonly copy: MockDraftsPageCopy;
}

/**
 * ONE ROOM FILLING NOW (the Draft area round, 2026-09-12) — an anonymous seat stack, how many
 * people are waiting in it, the table, when it goes, and how many seats are left.
 *
 * NOBODY IS NAMED HERE, and that is a contract rather than a layout choice. `MockRoomSummary`'s
 * own docblock states it: no other member's name or seat is ever named on this surface, the same
 * disclosure discipline `listPublicLeagues` holds for a real league's browse card. So the row
 * leads with the seats themselves (`SeatStack`, whose docblock argues the identical case) and
 * with a count of people, never with initials the reader could not have been shown. Faces with
 * names arrive one tap later, inside the room, where membership is already visible.
 *
 * TWO CLOCKS, ONE SENTENCE. A lobby room fires at its time OR the moment its last seat fills,
 * whichever comes first, and a countdown alone would be a promise the room does not make.
 */
function FillingRow({ room, onJoin, joining, busy }: { readonly room: MockLobbyRoomSummary; readonly onJoin: (code: string) => void; readonly joining: boolean; readonly busy: boolean }) {
  const seated = room.teamCount - room.seatsOpen;
  return (
    <article data-testid="filling-row" className="flex flex-wrap items-center gap-x-6 gap-y-3 border-t border-line py-3 first:border-t-0">
      <div className="flex min-w-0 items-center gap-3">
        <SeatStack filled={seated} total={room.teamCount} />
        <h3 className="font-display text-lg font-bold text-text-primary">
          {seated} waiting
        </h3>
      </div>
      <span className="text-sm text-text-muted">
        {room.teamCount} teams · {room.pickSeconds} seconds a pick
      </span>
      <span className="flex flex-col text-sm leading-tight">
        <span className="font-semibold text-text-primary">
          Starts in <CountdownLabel deadlineAt={room.startsAtIso} data-testid="filling-countdown" />
        </span>
        <span className="text-text-muted">or sooner if it fills</span>
      </span>
      <span className="ml-auto flex items-center gap-5">
        <BigNumber value={String(room.seatsOpen)} basis={`seats left, of ${room.teamCount}`} size="sm" />
        <Button variant="secondary" size="sm" onClick={() => onJoin(room.shareCode)} loading={joining} disabled={busy}>
          Take a seat
        </Button>
      </span>
    </article>
  );
}

/** A room of the caller's own still waiting or drafting — re-entry is an honest necessity the
 *  blueprint simply had no live room to show. Quiet, and never the amber solid. */
function ReentryRow({ room }: { readonly room: MyMockRoomSummary }) {
  return (
    <li className="flex flex-wrap items-center gap-3 rounded-md bg-surface-elevated px-3 py-2">
      {room.status === "in_progress" ? (
        <span className={`${MICRO_LABEL} rounded-sm bg-live px-2 py-0.5 font-semibold text-live-text`}>
          {STATUS_ROW_LABEL.in_progress}
        </span>
      ) : (
        <StatPill label={STATUS_ROW_LABEL[room.status] ?? room.status} tone="neutral" />
      )}
      <span className="min-w-0 break-words text-sm font-semibold text-text-primary">{room.teamName}</span>
      <span className="font-mono text-xs tabular-nums text-text-muted">
        {room.teamCount} teams · {room.pickSeconds}s
      </span>
      <span className="ml-auto">
        <ButtonLink href={`/app/drafts/${room.draftId}`} size="sm" variant="secondary">
          {room.status === "in_progress" ? "Back to your draft" : "Open room"}
        </ButtonLink>
      </span>
    </li>
  );
}

export function MockDraftsPage({ initialOpen, initialMine, options, copy }: MockDraftsPageProps) {
  const router = useRouter();
  const { fetchJson } = useLeagueRoomDeps();
  const [open, setOpen] = useState(initialOpen);
  const [mine, setMine] = useState(initialMine);
  const [table, setTable] = useState<MockTable>(() => decodeMockTable(null, options));
  const [busy, setBusy] = useState<MockMode | "join" | null>(null);
  const [joiningCode, setJoiningCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // The remembered table arrives AFTER first paint on purpose: localStorage does not exist on
  // the server, and hydration must match SSR — the same effect-time read `useSheet` keeps.
  useEffect(() => {
    try {
      setTable(decodeMockTable(window.localStorage.getItem(LEAGUE_ROOM_CONFIG.mockTableStorageKey), options));
    } catch {
      // A blocked store loses the memory, never the page.
    }
    // `options` is server config, stable for the page's life.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rememberTable = (next: MockTable): void => {
    setTable(next);
    try {
      window.localStorage.setItem(LEAGUE_ROOM_CONFIG.mockTableStorageKey, encodeMockTable(next));
    } catch {
      // Same rule: persistence is a convenience, the session's own table still works.
    }
  };

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const response = await fetchJson("/api/mock-drafts");
      const body = (await response.json()) as ApiEnvelope<MockLobbyBody>;
      if (!body.ok) return;
      setOpen(body.data.open);
      setMine(body.data.mine);
    } catch {
      // A failed background poll leaves the last-known list on screen (R5's swallow, kept).
    }
  }, [fetchJson]);

  useEffect(() => {
    const interval = setInterval(() => void refresh(), LEAGUE_ROOM_CONFIG.mockLobbyPollIntervalMs);
    return () => clearInterval(interval);
  }, [refresh]);

  const create = async (mode: MockMode): Promise<void> => {
    setBusy(mode);
    setError(null);
    try {
      const response = await fetchJson("/api/mock-drafts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(createRequestFor(table, mode)),
      });
      const body = (await response.json()) as ApiEnvelope<CreateMockRoomBody>;
      if (!body.ok) {
        setError(body.error);
        return;
      }
      router.push(`/app/drafts/${body.data.draftId}`);
    } catch {
      setError("We could not reach the server. Check your connection and try again.");
    } finally {
      setBusy(null);
    }
  };

  const join = async (shareCode: string): Promise<void> => {
    setBusy("join");
    setJoiningCode(shareCode);
    setError(null);
    try {
      const response = await fetchJson(`/api/mock-drafts/${shareCode}`, { method: "POST" });
      const body = (await response.json()) as ApiEnvelope<ClaimMockSeatBody>;
      if (!body.ok) {
        setError(body.error);
        return;
      }
      router.push(`/app/drafts/${body.data.draftId}`);
    } catch {
      setError("We could not reach the server. Check your connection and try again.");
    } finally {
      setBusy(null);
      setJoiningCode(null);
    }
  };

  const reentry = mine.filter((room) => room.status === "scheduled" || room.status === "in_progress");

  return (
    <div className="flex flex-col gap-4">
      {error === null ? null : (
        <p role="alert" className="text-sm text-negative">
          {error}
        </p>
      )}

      {reentry.length === 0 ? null : (
        <ul aria-label="Your open mock rooms" className="flex flex-col gap-2">
          {reentry.map((room) => (
            <ReentryRow key={room.draftId} room={room} />
          ))}
        </ul>
      )}

      {/* ROOMS FILLING NOW LEAD (the Draft area round): people are the reason to be on this stop,
          and a room that fires in ninety seconds is the most perishable thing on the page. An
          EMPTY lobby renders NOTHING — null is absent, not a sentence about absence. */}
      {open.length === 0 ? null : (
        <section aria-label="Rooms filling now" className="flex flex-col gap-1 rounded-lg bg-surface-elevated p-4 shadow-card">
          <h2 className="font-display text-xl font-bold text-text-primary">Rooms filling now</h2>
          <span className={`${MICRO_LABEL} pb-1 text-text-faint`}>Soonest start first</span>
          {[...open]
            .sort((a, b) => a.startsInMs - b.startsInMs)
            .map((room) => (
              <FillingRow key={room.shareCode} room={room} onJoin={(code) => void join(code)} joining={joiningCode === room.shareCode} busy={busy !== null} />
            ))}
        </section>
      )}

      {/* THE SECOND DOOR, quiet: nobody to wait for. The page's one solid verb sits beside the
          chips it acts on, which is where the draft room puts its verb too — a verb separated
          from the facts it uses is the ambiguity the dock solved. */}
      <section
        aria-label="Against bots"
        className="flex flex-col gap-3 rounded-lg bg-surface-elevated bg-gradient-to-r from-accent-glow via-transparent to-transparent p-4 shadow-card ring-2 ring-accent/40"
      >
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex min-w-0 flex-col gap-0.5">
            <h2 className="font-display text-xl font-bold text-text-primary">Against bots</h2>
            <p className="text-sm text-text-muted">{copy.soloDetail}</p>
          </div>
          <span className="ml-auto">
            {/* SIDELINE (2026-09-10): the page's one verb NAMES THE ACT — "Start mock draft",
                not "Draft now". A lobby whose verb is the same word as the draft room's own
                Draft button reads as the pick you are about to make rather than the room you
                are about to open. */}
            <Button variant="verb" size="lg" onClick={() => void create("solo")} loading={busy === "solo"} disabled={busy !== null}>
              Start mock draft
            </Button>
          </span>
        </div>
        <MockTableChips table={table} options={options} hint={copy.tableHint} onChange={rememberTable} />
      </section>

      {/* The two doors that MAKE the rooms above: without them the lobby could never have a row
          in it. Quiet outline verbs, never the solid. */}
      <section aria-label="Draft with people" className="flex flex-col gap-2 rounded-lg bg-surface-elevated p-4 shadow-card">
        <h2 className={`${MICRO_LABEL} text-text-faint`}>Draft with people</h2>
        <div className="flex flex-wrap items-center gap-3 rounded-md bg-surface-raised px-3 py-2.5">
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="text-sm font-semibold text-text-primary">Open a lobby room</span>
            <span className="text-xs text-text-muted">{copy.openLobbyDetail}</span>
          </div>
          <span className="ml-auto">
            <Button variant="secondary" size="sm" onClick={() => void create("lobby")} loading={busy === "lobby"} disabled={busy !== null}>
              Open lobby
            </Button>
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-3 rounded-md bg-surface-raised px-3 py-2.5">
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="text-sm font-semibold text-text-primary">Mock with your crew</span>
            <span className="text-xs text-text-muted">{copy.crewDetail}</span>
          </div>
          <span className="ml-auto">
            <Button variant="secondary" size="sm" onClick={() => void create("link")} loading={busy === "link"} disabled={busy !== null}>
              Mint a link
            </Button>
          </span>
        </div>
      </section>

      {/* The practice loop's tie-in to the real room — a sentence, not a control. */}
      <p className="rounded-lg bg-surface-elevated px-4 py-3 text-xs text-text-muted">{copy.sheetTieIn}</p>
    </div>
  );
}
