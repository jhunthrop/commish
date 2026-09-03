"use client";

import { useState } from "react";
import type { ApiEnvelope } from "@/lib/api/respond";
import type { CreateMockRoomBody } from "@/app/api/mock-drafts/route";
import type { MockMode } from "@/mock-draft/config";
import { Button, EYEBROW, Input, SegmentGroup } from "@/components/ui";
import { formatOrdinal } from "@/draft-room/state/format";
import { ROSTER_SHAPE_LABEL } from "@/domain/roster";
import { useLeagueRoomDeps } from "../hooks/deps";
import { PRESETS } from "./create-league-form";

/** "" means random (the silent server-side draw, `createMockRoomSchema`'s own default). Any
 *  other value is a 1-based slot number, as a string, the same string-state idiom every other
 *  numeric `<Select>` in this form already keeps (`teamCount`, `pickSeconds`). */
const RANDOM_DRAFT_SLOT = "";

/** `["", "1", "2", ..., String(teamCount)]`'s options — "Random" first (the default, matching
 *  the schema's own silence), then one "Pick Nth" per slot the CURRENTLY chosen team count
 *  offers (founder directive 2026-08-26: "users should be able to select their draft
 *  position"). Recomputed from `teamCount` on every render rather than from
 *  `MOCK_CONFIG.teamCountOptions`'s widest room, so shrinking Teams shrinks this list too. */
function draftSlotOptions(teamCount: number): readonly { readonly value: string; readonly label: string }[] {
  return [
    { value: RANDOM_DRAFT_SLOT, label: "Random" },
    ...Array.from({ length: teamCount }, (_, i) => i + 1).map((slot) => ({ value: String(slot), label: `Pick ${formatOrdinal(slot)}` })),
  ];
}

/**
 * Words for the three modes — this component's own, not `MOCK_COPY` (`src/league-room/**` may
 * not value-import `@/mock-draft`, the client boundary): a mode NAME is not one of the pre-vetted
 * room-facing sentences that module exists to guard, the same reason `CreateLeagueForm`'s own
 * `FORMATS`/`VISIBILITIES` labels are typed fresh here rather than threaded from anywhere.
 */
const MODE_LABEL: Readonly<Record<MockMode, string>> = {
  solo: "Solo, play against bots",
  lobby: "Lobby, open for anyone to join",
  link: "Private link, invite by code",
};

/** The identical inline construction `CreateLeagueForm`'s own `ROSTER_SHAPE_OPTIONS` uses —
 *  `@/domain/roster` is the browser-safe half every client room may value-import. */
const ROSTER_SHAPE_OPTIONS = Object.entries(ROSTER_SHAPE_LABEL).map(([value, label]) => ({ value, label }));

export interface MockSetupFormProps {
  /** `MOCK_CONFIG.modes`, threaded from the server page (ruling 8) — `@/mock-draft` itself is
   *  blocked from this directory. */
  readonly modes: readonly MockMode[];
  /** `MOCK_CONFIG.teamCountOptions`. */
  readonly teamCountOptions: readonly number[];
  /** `MOCK_CONFIG.pickClockSecondsOptions`. */
  readonly pickSecondsOptions: readonly number[];
  readonly defaultTeamCount: number;
  readonly defaultPickSeconds: number;
  /** Called once with the created room's wire body — the caller (`MockLobby`) owns navigation,
   *  the identical split `CreateLeaguePanel`/`CreateLeagueForm` already keep. */
  readonly onCreated: (created: CreateMockRoomBody) => void;
}

/**
 * The practice lobby's own creation form (Task 9, Step 2): mode, team count and pick clock from
 * `MOCK_CONFIG`'s own options (never a parallel picker), scoring and roster shape reusing
 * `CreateLeagueForm`'s existing option vocabulary — the SAME `PRESETS` table and the SAME
 * `ROSTER_SHAPE_LABEL` map a real league's own create form reads, since a mock shares this whole
 * vocabulary with a real league (`createMockRoomSchema`'s `scoringPreset`/`rosterShape` are the
 * identical enums). One ink action: "Start mock draft" is this page's only primary button,
 * the same one-ink-per-view budget (rule 5) the front door and browse both hold to.
 */
export function MockSetupForm({
  modes,
  teamCountOptions,
  pickSecondsOptions,
  defaultTeamCount,
  defaultPickSeconds,
  onCreated,
}: MockSetupFormProps) {
  const { fetchJson } = useLeagueRoomDeps();
  const [mode, setMode] = useState<MockMode>(modes[0] ?? "solo");
  const [teamCount, setTeamCount] = useState(String(defaultTeamCount));
  const [pickSeconds, setPickSeconds] = useState(String(defaultPickSeconds));
  // `half_ppr`/`standard` — the identical defaults `CreateLeagueForm`'s own local state opens
  // with (`LEAGUE_CONFIG.defaults`), which this client component may not value-import.
  const [scoringPreset, setScoringPreset] = useState("half_ppr");
  const [rosterShape, setRosterShape] = useState("standard");
  // "" (`RANDOM_DRAFT_SLOT`) is the default — the silent server-side draw
  // `createMockRoomSchema.draftSlot` already falls back to when omitted. Founder directive
  // 2026-08-26: "users should be able to select their draft position."
  const [draftSlot, setDraftSlot] = useState(RANDOM_DRAFT_SLOT);
  const [teamName, setTeamName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // E3 (lobby review, 2026-08-26): Randomize is a silent value assignment today — a sighted
  // reader sees the select change, a screen-reader user gets nothing. This is the drawn
  // option's own label ("Pick 4th"), read out politely the moment a draw happens, cleared by
  // nothing (a live region says the last thing that happened, not the current state — the
  // select itself already carries that).
  const [rolledAnnouncement, setRolledAnnouncement] = useState<string | null>(null);

  /** Shrinking Teams can strand a chosen slot above the new ceiling (picking 10th, then
   *  dropping to 8 teams) — reset to Random rather than clamp, so the reader never sees a
   *  silently renumbered choice they never made. */
  const changeTeamCount = (value: string): void => {
    setTeamCount(value);
    if (draftSlot !== RANDOM_DRAFT_SLOT && Number(draftSlot) > Number(value)) setDraftSlot(RANDOM_DRAFT_SLOT);
  };

  /** The founder's own follow-up: "we should also have a randomize button that randomizes for
   *  them." A plain `Math.random()` roll is fine here — this sets a value the person SEES and
   *  can still change before submitting, not a step in the seeded draw itself (the replay law
   *  binds the bot/draw streams `deps.random`/`deps.newSeed` feed, never a form control). */
  const randomize = (): void => {
    const max = Number(teamCount);
    const slot = Math.floor(Math.random() * max) + 1;
    setDraftSlot(String(slot));
    // The drawn option's OWN label, looked up rather than re-derived, so the announcement can
    // never say something different from what the select now shows.
    const rolled = draftSlotOptions(max).find((option) => option.value === String(slot));
    setRolledAnnouncement(rolled?.label ?? null);
  };

  const submit = async (): Promise<void> => {
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetchJson("/api/mock-drafts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mode,
          teamCount: Number(teamCount),
          pickSeconds: Number(pickSeconds),
          scoringPreset,
          rosterShape,
          ...(teamName.trim().length > 0 ? { teamName: teamName.trim() } : {}),
          ...(draftSlot !== RANDOM_DRAFT_SLOT ? { draftSlot: Number(draftSlot) } : {}),
        }),
      });
      const body = (await response.json()) as ApiEnvelope<CreateMockRoomBody>;
      if (!body.ok) {
        setError(body.error);
        return;
      }
      onCreated(body.data);
    } catch {
      setError("We could not reach the server. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    // E2 (lobby review, 2026-08-26): the form gets a MEASURE — `max-w-2xl`, not the full-bleed
    // width the page around it still holds — because a `<select>` whose value is two words at
    // 1,550px is the same defect the constitution's own measured-paragraph carve-out names for
    // body text. Three quiet field groups (Room, Rules, You) replace the old flat run of seven
    // controls, each named by an `EYEBROW` label the way `CreateLeagueForm`'s own drawer and
    // panel headings already are.
    <form
      className="flex max-w-2xl flex-col gap-6"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      {/* SEGMENTS, NOT SELECTS (founder, 2026-08-28: the stadium overhaul reaches the config).
          Every option visible at once, the active one filled amber — the same rail /browse's
          filters and the free-agents board wear, now one shared primitive. The draft position is
          the boundary case: up to twelve values earns PILLS in a wrap, not a strip, and Random
          stays the first of them. */}
      <div className="flex flex-col gap-3">
        <h3 className={`${EYEBROW} text-text-muted`}>Room</h3>
        <div className="flex flex-wrap gap-x-6 gap-y-3">
          <SegmentGroup
            label="Mode"
            options={modes.map((value) => ({ value, label: MODE_LABEL[value] }))}
            value={mode}
            onChange={(value) => setMode(value as MockMode)}
          />
          <SegmentGroup
            label="Teams"
            options={teamCountOptions.map((n) => ({ value: String(n), label: String(n) }))}
            value={teamCount}
            onChange={changeTeamCount}
          />
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <h3 className={`${EYEBROW} text-text-muted`}>Rules</h3>
        <div className="flex flex-wrap gap-x-6 gap-y-3">
          <SegmentGroup
            label="Pick clock"
            options={pickSecondsOptions.map((n) => ({ value: String(n), label: `${n}s` }))}
            value={pickSeconds}
            onChange={setPickSeconds}
          />
          <SegmentGroup label="Scoring" options={PRESETS} value={scoringPreset} onChange={setScoringPreset} />
          <SegmentGroup label="Roster shape" options={ROSTER_SHAPE_OPTIONS} value={rosterShape} onChange={setRosterShape} />
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <h3 className={`${EYEBROW} text-text-muted`}>You</h3>
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-text-primary">Draft position</span>
          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Draft position">
            {draftSlotOptions(Number(teamCount)).map((option) => (
              <button
                key={option.value === "" ? "random" : option.value}
                type="button"
                aria-pressed={draftSlot === option.value}
                onClick={() => setDraftSlot(option.value)}
                className={`min-w-9 rounded-md border px-2 py-1.5 font-display text-sm font-semibold tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                  draftSlot === option.value
                    ? // Accent BORDER and INK, never the fill: the amber fill belongs to the
                      // sanctioned primitives alone (`accent-budget.source.test.ts`), and a
                      // hand-rolled pill does not earn it — the outlined accent still separates
                      // the pressed pill in both themes.
                      "border-accent text-accent"
                    : "border-line text-text-muted hover:text-text-primary"
                }`}
              >
                {option.value === "" ? "Random" : option.value}
              </button>
            ))}
            <Button type="button" variant="ghost" size="sm" onClick={randomize}>
              Roll it
            </Button>
          </div>
        </div>
        {/* Present from first render, announced politely — the same "the region exists before
            it has anything to say" shape `Countdown`'s own sr-only sibling uses. */}
        <span className="sr-only" aria-live="polite">
          {rolledAnnouncement}
        </span>
        <Input className="max-w-sm" label="Team name (optional)" value={teamName} onChange={(event) => setTeamName(event.target.value)} />
      </div>

      {error === null ? null : (
        <p role="alert" className="text-sm text-negative">
          {error}
        </p>
      )}
      {/* E1: `self-start`, not the flex column's default stretch — a submit button at the
          form's own measure is still a PILL, never a bar the width of whatever column holds it. */}
      <Button type="submit" variant="verb" className="self-start" loading={submitting} disabled={submitting}>
        Start mock draft
      </Button>
    </form>
  );
}
