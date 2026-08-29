"use client";

import { useState } from "react";
import type { ApiEnvelope } from "@/lib/api/respond";
import type { CreateLeagueBody } from "../contract";
import { Button, Input, Select } from "@/components/ui";
import { ROSTER_SHAPE_LABEL } from "@/domain/roster";
import { LEAGUE_EXPERIENCE_TIER_HINT, LEAGUE_EXPERIENCE_TIER_LABEL } from "@/identity/config";
import { MATCHMAKING_CONFIG, SIT_AND_GO_GRACE_MINUTES } from "@/matchmaking/config";
import { useLeagueRoomDeps } from "../hooks/deps";

const FORMATS = [
  { value: "snake", label: "Snake" },
  { value: "auction", label: "Auction" },
];
const TEAM_COUNTS = [8, 10, 12, 14, 16].map((n) => ({ value: String(n), label: `${n} teams` }));
/**
 * Half-PPR leads (founder decision, §4.2's launch canon: "half-PPR default with PPR /
 * TE-premium / superflex toggles") — full PPR stays one tap away, not removed or demoted past
 * reach, only no longer preselected.
 *
 * Exported (Task 9): `MockSetupForm` (`./mock-setup-form.tsx`) reuses this SAME table for the
 * practice lobby's own scoring control — "reuse the create-league form's existing option
 * vocabulary, never a parallel picker" (the brief's own words). A mock room shares this whole
 * vocabulary with a real league (`createMockRoomSchema`'s `scoringPreset` is the identical
 * `ScoringPresetName` enum), so the labels a commissioner already knows are the labels a
 * practice host sees too.
 */
export const PRESETS = [
  { value: "half_ppr", label: "Half PPR" },
  { value: "ppr", label: "PPR (a point per catch)" },
  { value: "standard", label: "Standard" },
  { value: "te_premium", label: "TE premium" },
];
/**
 * Superflex is a TOGGLE on the canonical format here, not a separate browse queue (the
 * liquidity ruling) — one more select beside scoring, words from `ROSTER_SHAPE_LABEL`
 * (`@/domain/roster`) rather than typed at this call site, the same discipline `EXPERIENCE_TIERS`
 * below already holds `LEAGUE_EXPERIENCE_TIER_LABEL` to. `@/domain/roster` (not
 * `@/league/roster-shape`, where the actual slot ROWS live) is what a client component may
 * value-import at all — the client boundary, `eslint.config.mjs`.
 */
const ROSTER_SHAPE_OPTIONS = Object.entries(ROSTER_SHAPE_LABEL).map(([value, label]) => ({ value, label }));
/**
 * WHO CAN JOIN, promoted out of the drawer alongside WHO IT'S FOR (Phase 3.5, Task 9) — see
 * `CreateLeagueForm`'s own docblock below for why the two sit together, in this order, above the
 * fold rather than one click away.
 *
 * A hint of its own, not a renamed label: "Who can join" and "Who it is for" read as near
 * homonyms side by side, and the gauntlet finding was that the CONTROL was unfindable, not that
 * either label was ambiguous once both are actually on screen. Renaming one would only move the
 * defect; a distinct sentence under each is what actually tells them apart. That sentence is
 * `VISIBILITY_DISCLOSURE` below — this control used to carry a second one of its own on the
 * `Select`'s `hint` prop (`VISIBILITY_HINT`, since deleted), one promise phrased two ways stacked
 * on top of each other the moment Step 3b landed the disclosure underneath it (the gauntlet's
 * NEW-6). One sentence, at the control, said once.
 */
export const VISIBILITIES = [
  { value: "invite_only", label: "Invite only" },
  { value: "public", label: "Anyone can find and join" },
];
/**
 * Step 3b's disclosure, verbatim and tested. The join-flow panel filed the absence as the thing
 * a first-time commissioner learns AFTER their league appears somewhere they did not expect —
 * this describes behavior that already exists (`is_public_matchmade` and the browse shelf), said
 * at the visibility control, above the submit button, where the decision is actually made.
 */
export const VISIBILITY_DISCLOSURE = "Public leagues appear on the open shelf, where anyone can take a seat. Private leagues are invite only.";
/**
 * WHO THE LEAGUE IS FOR, and the control the final review's own battery proved was missing.
 *
 * `createLeague` refuses a veteran opening a PUBLIC league declared `beginner`
 * (`tierJoinPrecondition`, ruling 6) and tells them "Open it to everyone instead" — and this form
 * carried no control that could do that, so the remedy the refusal named was unreachable and a
 * veteran could not create a public league at all. `experienced` leads and is the default because
 * it is the choice that refuses nobody: the only way to reach that refusal now is to pick the
 * reserved option on purpose.
 *
 * Order and words both come from `LEAGUE_EXPERIENCE_TIER_LABEL` (`@/identity/config`) rather than
 * being typed here, the same "one map decides the words" discipline `EXPERIENCE_TIER_LABEL`
 * already holds the profile and browse surfaces to.
 */
const EXPERIENCE_TIERS = Object.entries(LEAGUE_EXPERIENCE_TIER_LABEL).map(([value, label]) => ({ value, label }));
const STAKE_TIERS = MATCHMAKING_CONFIG.stakeTiers.map((entry) => ({ value: String(entry.tier), label: entry.label }));
/**
 * WHEN IT DRAFTS (Phase 3.5, Task 9): the sit-and-go trigger's own creation-time control, wired
 * for the first time — Task 7 taught `createLeagueSchema` to accept `startTrigger`, and Task 8
 * gave a `when_full` league a room to wait in, but nothing before this form could actually
 * choose it. Stays in the drawer, unlike the two controls above: it is a REFINEMENT of a public
 * league, not a decision that gates who may enter it, and it renders only once `visibility` is
 * `"public"` — the schema's own refusal ("Leagues that start when they fill are public leagues")
 * names the exact rule this conditional enforces, so a commissioner can never submit the
 * combination that trips it.
 */
export const START_TRIGGERS = [
  { value: "scheduled", label: "On a schedule I set later" },
  { value: "when_full", label: "Starts as soon as it fills" },
];
export const START_TRIGGER_HINT = `A sit-and-go league starts on its own about ${SIT_AND_GO_GRACE_MINUTES} minutes after its last seat fills.`;
/**
 * Named once, so the drawer's own summary and the fields it actually contains can never say two
 * different things — the defect this task exists to close (the old summary named three of the
 * seven fields the drawer actually held).
 */
export const DRAWER_SUMMARY = "Advanced settings: draft format, teams, scoring, roster shape, auction budget, draft start, and stake tier.";

/**
 * The two promoted controls, extracted so `CreateLeagueForm`'s own render stays a plain list of
 * sections rather than a wall of JSX. Pure presentation plus the two `onChange` callbacks —
 * `handleVisibilityChange`'s own reset-on-leaving-public logic stays in the parent, since that
 * rule is about `startTrigger`, a field this component never touches.
 */
function WhoCanJoinAndWhoItsFor({
  visibility,
  onVisibilityChange,
  experienceTier,
  onExperienceTierChange,
}: {
  readonly visibility: string;
  readonly onVisibilityChange: (value: string) => void;
  readonly experienceTier: string;
  readonly onExperienceTierChange: (value: string) => void;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Select
        label="Who can join"
        options={VISIBILITIES}
        value={visibility}
        onChange={(event) => onVisibilityChange(event.target.value)}
      />
      <Select
        label="Who it is for"
        options={EXPERIENCE_TIERS}
        value={experienceTier}
        hint={LEAGUE_EXPERIENCE_TIER_HINT}
        onChange={(event) => onExperienceTierChange(event.target.value)}
      />
    </div>
  );
}

/**
 * Everything still behind the closed disclosure: format, teams, scoring, roster shape, auction
 * budget (auction only), draft start (public leagues only), and stake tier. Extracted for the
 * same reason `WhoCanJoinAndWhoItsFor` above is — `CreateLeagueForm`'s render reads as a list of
 * sections, and this is the one section with real internal conditionals of its own.
 */
function AdvancedSettingsDrawer({
  format,
  onFormatChange,
  teamCount,
  onTeamCountChange,
  scoringPreset,
  onScoringPresetChange,
  rosterShape,
  onRosterShapeChange,
  auctionBudget,
  onAuctionBudgetChange,
  visibility,
  startTrigger,
  onStartTriggerChange,
  stakeTier,
  onStakeTierChange,
}: {
  readonly format: string;
  readonly onFormatChange: (value: string) => void;
  readonly teamCount: string;
  readonly onTeamCountChange: (value: string) => void;
  readonly scoringPreset: string;
  readonly onScoringPresetChange: (value: string) => void;
  readonly rosterShape: string;
  readonly onRosterShapeChange: (value: string) => void;
  readonly auctionBudget: string;
  readonly onAuctionBudgetChange: (value: string) => void;
  readonly visibility: string;
  readonly startTrigger: string;
  readonly onStartTriggerChange: (value: string) => void;
  readonly stakeTier: string;
  readonly onStakeTierChange: (value: string) => void;
}) {
  return (
    // `border-edge`, never `border-line`: a disclosure is a control a user must find, not a
    // decorative hairline (Step 3b, "edge on every field boundary and never line").
    <details className="rounded-md border border-edge p-3">
      <summary className="cursor-pointer text-sm text-text-muted">{DRAWER_SUMMARY}</summary>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Select label="Draft format" options={FORMATS} value={format} onChange={(event) => onFormatChange(event.target.value)} />
        <Select label="Teams" options={TEAM_COUNTS} value={teamCount} onChange={(event) => onTeamCountChange(event.target.value)} />
        <Select label="Scoring" options={PRESETS} value={scoringPreset} onChange={(event) => onScoringPresetChange(event.target.value)} />
        {/* NO TIPS (founder ruling, 2026-08-28): the superflex definition sat under this field
            as a lone trigger with no words beside it, which is the worst form of the pattern — a
            button a reader has to press to find out what it is even about. It is a `hint` now, so
            the field says what it does at the moment somebody is choosing. */}
        <Select
          label="Roster shape"
          options={ROSTER_SHAPE_OPTIONS}
          value={rosterShape}
          hint="Superflex lets a second quarterback start in the flex, which makes quarterbacks worth far more."
          onChange={(event) => onRosterShapeChange(event.target.value)}
        />
        {format === "auction" ? (
          <Input
            label="Auction budget"
            type="number"
            value={auctionBudget}
            hint="Dollars each manager has to spend."
            onChange={(event) => onAuctionBudgetChange(event.target.value)}
          />
        ) : null}
        {visibility === "public" ? (
          <Select
            label="Draft start"
            options={START_TRIGGERS}
            value={startTrigger}
            hint={START_TRIGGER_HINT}
            onChange={(event) => onStartTriggerChange(event.target.value)}
          />
        ) : null}
        <Select label="Stake tier" options={STAKE_TIERS} value={stakeTier} onChange={(event) => onStakeTierChange(event.target.value)} />
        <p className="text-sm text-text-muted sm:col-span-2">{MATCHMAKING_CONFIG.stakeDisclosure}</p>
      </div>
    </details>
  );
}

/**
 * Three visible fields, not one — the league name plus the two questions the gauntlet finding
 * named: who can join, and who it's for. Everything else stays behind a closed disclosure,
 * because every OTHER setting already has a server-side default — a commissioner who types a
 * name and presses the button still gets a complete, playable league. That is the spec's exit
 * criterion, and the interaction-count test in `create-league-interactions.test.tsx` makes it
 * mechanical: promoting a control that already carries a default adds a visible element, never
 * a required interaction, so the count does not move.
 *
 * WHY THESE TWO, AND IN THIS ORDER (Phase 3.5, Task 9). Both used to sit inside "Advanced
 * settings", nested two disclosures deep, sixth and seventh of seven, under a summary that named
 * neither — a beginner filling in a name and pressing the button never saw either, and a veteran
 * hunting for the control the creation gate's own refusal names ("Open it to everyone instead")
 * had no reason to open a drawer whose own summary never mentioned it. `visibility` leads
 * because it decides whether `experienceTier` means anything at all: `enforcementAppliesTo`
 * (`@/league-service/enforcement`) never applies to an invite-only league, so a commissioner
 * choosing "Who it is for" for a private league is choosing a label nobody's join is ever checked
 * against. Neither label changed — the near-homonymy IS the actual defect the gauntlet named,
 * and renaming one would only move it — so each carries its own distinct hint instead.
 *
 * The numeric fields are `<Select>`s of the values we actually support rather than free
 * number inputs: there is no such thing as a 13-team league here, and a select cannot
 * produce one.
 *
 * PERSONA PANEL, STEP 5 — commissioner first this time, then first-timer, casual, veteran.
 * Commissioner: yes — "Who can join" is the first control under the name, answered without
 * opening anything (`create-league-panel.test.tsx`'s own composed assertion). First-timer:
 * `LEAGUE_EXPERIENCE_TIER_HINT`'s "Open leagues accept everyone" reads "reserved" as a
 * protection a newer manager's OWN league can opt into, never a demotion — the same sentence a
 * veteran reads as the rule keeping them out of somebody else's reserved room. Casual: three
 * fields to glance at and one button, same as before this task — the drawer still opens to
 * exactly nothing a casual commissioner needs to touch. Veteran: `DRAWER_SUMMARY` now names
 * every field the drawer holds, roster shape and draft start (the sit-and-go trigger) included,
 * so a veteran hunting for either finds the word in the summary before opening it.
 *
 * `WhoCanJoinAndWhoItsFor` and `AdvancedSettingsDrawer` above hold the actual field markup
 * (fix round 1, LOW 2): this function's own body is state, the visibility-reset rule, and the
 * submit handler — composition, not a 140-line wall of JSX.
 */
export function CreateLeagueForm({
  onCreated,
}: {
  readonly onCreated: (created: CreateLeagueBody) => void;
}) {
  const { fetchJson } = useLeagueRoomDeps();
  const [name, setName] = useState("");
  const [format, setFormat] = useState("snake");
  const [teamCount, setTeamCount] = useState("12");
  const [scoringPreset, setScoringPreset] = useState("half_ppr");
  const [rosterShape, setRosterShape] = useState("standard");
  const [auctionBudget, setAuctionBudget] = useState("200");
  const [visibility, setVisibility] = useState("invite_only");
  // `experienced` — the choice that refuses nobody. See `EXPERIENCE_TIERS` above.
  const [experienceTier, setExperienceTier] = useState("experienced");
  // `'scheduled'` — `createLeagueSchema`'s own default, and the only legal value for a private
  // league (that refine's own refusal). See `handleVisibilityChange` below for what keeps this
  // control from ever holding a value the schema would then refuse.
  const [startTrigger, setStartTrigger] = useState("scheduled");
  const [stakeTier, setStakeTier] = useState("0");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  /**
   * PUBLIC-MATCHMADE ONLY (the sit-and-go ruling): a private league's fill would otherwise write
   * a time nobody pressed. Switching away from `"public"` resets `startTrigger` back to its
   * default in the SAME gesture that hides its control, so a commissioner can never be left
   * holding `"when_full"` on a field they can no longer see — the identical "the remedy points at
   * something visible" discipline `EXPERIENCE_TIERS` above already holds the creation gate's own
   * refusal to.
   */
  const handleVisibilityChange = (value: string): void => {
    setVisibility(value);
    if (value !== "public") setStartTrigger("scheduled");
  };

  const submit = async (): Promise<void> => {
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetchJson("/api/leagues", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name,
          format,
          teamCount: Number(teamCount),
          scoringPreset,
          rosterShape,
          auctionBudget: Number(auctionBudget),
          visibility,
          experienceTier,
          startTrigger,
          stakeTier: Number(stakeTier),
        }),
      });
      const body = (await response.json()) as ApiEnvelope<CreateLeagueBody>;
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
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <Input label="League name" value={name} onChange={(event) => setName(event.target.value)} error={error ?? undefined} />

      <WhoCanJoinAndWhoItsFor
        visibility={visibility}
        onVisibilityChange={handleVisibilityChange}
        experienceTier={experienceTier}
        onExperienceTierChange={setExperienceTier}
      />

      <p className="text-sm text-text-muted">{VISIBILITY_DISCLOSURE}</p>

      <AdvancedSettingsDrawer
        format={format}
        onFormatChange={setFormat}
        teamCount={teamCount}
        onTeamCountChange={setTeamCount}
        scoringPreset={scoringPreset}
        onScoringPresetChange={setScoringPreset}
        rosterShape={rosterShape}
        onRosterShapeChange={setRosterShape}
        auctionBudget={auctionBudget}
        onAuctionBudgetChange={setAuctionBudget}
        visibility={visibility}
        startTrigger={startTrigger}
        onStartTriggerChange={setStartTrigger}
        stakeTier={stakeTier}
        onStakeTierChange={setStakeTier}
      />

      {/* SECONDARY, deliberately (page-audit harness, 2026-08-27): this form lives inside the
          home's create disclosure, and the home already spends its one ink on the live draft a
          member can join RIGHT NOW — a draft in progress outranks starting a new league, and
          rule 5 allows exactly one ink action per view, not per component. */}
      <Button type="submit" variant="secondary" loading={submitting} disabled={submitting}>
        Create league
      </Button>
    </form>
  );
}
