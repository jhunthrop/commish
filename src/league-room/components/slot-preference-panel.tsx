"use client";

import { useState } from "react";
import type { HelpLevel } from "@/identity/preferences";
import type { ApiEnvelope } from "@/lib/api/respond";
import type { SlotPreferenceView } from "../contract";
import { Button, EYEBROW, InfoTip } from "@/components/ui";
import { useLeagueRoomDeps } from "../hooks/deps";

/**
 * The worked-example explainer, verbatim — the one sentence every persona reads before they
 * touch a chip. Named so the source-copy sweeps can find it and this file's own test can assert
 * it without hand-retyping a second copy that could drift from what actually renders.
 */
export const SLOT_PREFERENCE_EXPLAINER =
  "Rank the slots you want. We draw in random order and give each manager their highest choice that is still free.";

/** Moves `slot` one position within `ranking` — the same "swap with a neighbor, clamp at the
 *  ends" shape `moveInQueue` (`@/draft-room/state/queue`) uses for player ids, kept as its own
 *  small pure function here rather than imported: this domain is slot NUMBERS, not player ids,
 *  and a league-room component has no business reaching into the draft room's own state module. */
function moveRank(ranking: readonly number[], slot: number, delta: number): readonly number[] {
  const index = ranking.indexOf(slot);
  const target = index + delta;
  if (index === -1 || target < 0 || target >= ranking.length) return ranking;
  const next = [...ranking];
  const [moved] = next.splice(index, 1);
  next.splice(target, 0, moved!);
  return next;
}

/** "Saved. You ranked: 4, then 1, then 7." — a save that says what it saved, in the exact order
 *  it was saved in. The empty-ranking case gets its own sentence rather than an empty list. */
function savedMessageFor(ranking: readonly number[]): string {
  if (ranking.length === 0) return "Saved. You did not rank any slots, and that is fine.";
  return `Saved. You ranked: ${ranking.join(", then ")}.`;
}

/** Step 4's one-sentence summary, once the draw has run. Three cases: no ranking at all, the
 *  top choice came through, or it did not. */
function resultSentence(ranking: readonly number[], assignedSlot: number): string {
  if (ranking.length === 0) return `You did not rank a slot, so we gave you slot ${assignedSlot}.`;
  if (ranking[0] === assignedSlot) return `You ranked slot ${assignedSlot} first and you got slot ${assignedSlot}.`;
  return `Slot ${ranking[0]} went to another manager, so you got slot ${assignedSlot}.`;
}

const CHIP = "flex shrink-0 items-center gap-1 rounded-pill border border-border bg-surface py-1 pl-2 pr-1";

export interface SlotPreferencePanelProps {
  readonly leagueId: string;
  /** The caller's OWN preference. Never anybody else's — a ranking is a preference a person
   *  expressed privately (Plan A's notice-privacy reasoning applies to it whole). */
  readonly initialPreference: SlotPreferenceView;
  readonly helpLevel?: HelpLevel;
}

/**
 * NFFC's Kentucky Derby System (Phase 3.5, Task 6). Ranked with named buttons and never with
 * drag alone — position IS the meaning, the same reasoning `RoomDock`'s queue chips already
 * carry (`@/draft-room/components/room-dock`) — so every reorder, add and remove is a real
 * `<button>` reachable by Tab and activated by Enter or Space, not a pointer-only gesture.
 *
 * Two shapes, gated on `preference.canEdit`: the ranking editor while the draft is still
 * `scheduled` (the preference window closes at the draw, on both start doors — a commissioner's
 * press and the platform's own auto-start), and a single sentence once it has run. Local state
 * is seeded from the `initialPreference` prop — the same props-in, fetchJson-for-writes-only
 * idiom `DraftSchedulePanel` already uses — and updated directly from the PUT's own response,
 * never re-fetched.
 */
export function SlotPreferencePanel({ leagueId, initialPreference, helpLevel }: SlotPreferencePanelProps) {
  const { fetchJson } = useLeagueRoomDeps();
  const [preference, setPreference] = useState<SlotPreferenceView>(initialPreference);
  const [ranking, setRanking] = useState<readonly number[]>(initialPreference.ranking);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);

  const save = async (): Promise<void> => {
    setSaving(true);
    setError(null);
    setSavedMessage(null);
    try {
      const response = await fetchJson(`/api/leagues/${leagueId}/slot-preference`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ranking }),
      });
      const body = (await response.json()) as ApiEnvelope<SlotPreferenceView>;
      if (!body.ok) {
        setError(body.error);
        return;
      }
      setPreference(body.data);
      setRanking(body.data.ranking);
      setSavedMessage(savedMessageFor(body.data.ranking));
    } catch {
      setError("We couldn't reach the server. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  };

  if (!preference.canEdit) {
    // `assignedSlot === null` here is the never-true case `resolvedSlotFor`'s own docblock
    // guards defensively — nothing to report, so the panel renders nothing rather than a
    // half-true sentence.
    if (preference.assignedSlot === null) return null;
    return (
      <div className="flex flex-col gap-1 rounded-lg border border-border bg-surface-elevated p-4">
        <h2 className={`${EYEBROW} text-text-muted`}>Draft slot</h2>
        <p className="text-sm text-text-primary">{resultSentence(preference.ranking, preference.assignedSlot)}</p>
      </div>
    );
  }

  const allSlots = Array.from({ length: preference.slotCount }, (_, i) => i + 1);
  const unranked = allSlots.filter((slot) => !ranking.includes(slot));

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface-elevated p-4">
      <div className="flex flex-wrap items-center gap-1">
        <h2 className={`${EYEBROW} text-text-muted`}>Draft slot</h2>
        <InfoTip term="draft-slot" helpLevel={helpLevel} />
      </div>
      <p className="text-sm text-text-muted">{SLOT_PREFERENCE_EXPLAINER}</p>

      {ranking.length === 0 ? (
        <p className="text-sm text-text-muted">
          You have not ranked any slots, and that is fine. We will draw you a random one when the draft starts.
        </p>
      ) : (
        <ol aria-label="Your ranked slots" className="flex flex-wrap items-center gap-2">
          {ranking.map((slot, index) => (
            <li key={slot} className={CHIP}>
              <span className="font-mono text-xs tabular-nums text-text-muted">{index + 1}</span>
              <span className="font-display font-semibold text-text-primary">Slot {slot}</span>
              <Button size="sm" variant="ghost" disabled={saving} aria-label={`Move slot ${slot} up`} onClick={() => setRanking((r) => moveRank(r, slot, -1))}>
                <span aria-hidden="true">↑</span>
              </Button>
              <Button size="sm" variant="ghost" disabled={saving} aria-label={`Move slot ${slot} down`} onClick={() => setRanking((r) => moveRank(r, slot, 1))}>
                <span aria-hidden="true">↓</span>
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={saving}
                aria-label={`Remove slot ${slot} from your ranking`}
                onClick={() => setRanking((r) => r.filter((s) => s !== slot))}
              >
                <span aria-hidden="true">×</span>
              </Button>
            </li>
          ))}
        </ol>
      )}

      {unranked.length === 0 ? null : (
        <div className="flex flex-col gap-1">
          <h3 className={`${EYEBROW} text-text-muted`}>Not ranked</h3>
          <ul aria-label="Slots not yet ranked" className="flex flex-wrap items-center gap-2">
            {unranked.map((slot) => (
              <li key={slot} className="flex shrink-0 items-center gap-1 rounded-pill border border-dashed border-border py-1 pl-2 pr-1">
                <span className="font-display text-text-primary">Slot {slot}</span>
                <Button size="sm" variant="ghost" disabled={saving} aria-label={`Add slot ${slot} to your ranking`} onClick={() => setRanking((r) => [...r, slot])}>
                  <span aria-hidden="true">+</span>
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" loading={saving} disabled={saving} onClick={() => void save()}>
          Save ranking
        </Button>
        {savedMessage === null ? null : <p className="text-sm text-text-muted">{savedMessage}</p>}
      </div>
      {error === null ? null : (
        <p role="alert" className="text-sm text-negative">
          {error}
        </p>
      )}
    </div>
  );
}
