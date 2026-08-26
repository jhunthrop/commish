import { z } from "zod";
import type { RosterShapeName } from "@/domain/roster";
import { SCORING_PRESETS, type ScoringPresetName } from "@/domain/scoring";
import { isPrintableDisplayName } from "@/identity/display-name";
import { LEAGUE_CONFIG } from "@/league";
import { ROSTER_SHAPES } from "@/league/roster-shape";
import { MOCK_CONFIG } from "@/mock-draft/config";

/**
 * The Zod boundary Task 7's routes parse every mock request through. Every bound is DERIVED from
 * the one config that owns it — `MOCK_CONFIG` for the mock-only choices, `LEAGUE_CONFIG` and the
 * scoring/roster vocabularies for everything a mock shares with a real league — never retyped,
 * so a config change moves the boundary with it and a drift (a default falling off its own
 * options list, say) fails `schemas.test.ts` instead of shipping.
 */

/** "8, 10 or 12" — a closed options list, spoken the way the refusal sentence needs it. */
const spoken = (values: readonly number[]): string => `${values.slice(0, -1).join(", ")} or ${values[values.length - 1]}`;

/** Derived, not retyped: the preset names ARE `SCORING_PRESETS`' own keys. */
const scoringPresetNames = Object.keys(SCORING_PRESETS) as [ScoringPresetName, ...ScoringPresetName[]];
const rosterShapeNames = Object.keys(ROSTER_SHAPES) as [RosterShapeName, ...RosterShapeName[]];

/**
 * The same printable, bounded rule every other member-chosen name meets
 * (`createLeagueSchema`'s own `name`, `@/league-service/schemas`) and for the same sharp reason:
 * a team name is interpolated into copy the platform renders in its own voice, and a bidi
 * override planted in one would reverse the platform's words wherever the name lands.
 */
const teamName = z
  .string()
  .trim()
  .min(1, { message: "Please enter a team name." })
  .max(LEAGUE_CONFIG.maxNameLength, { message: `Please keep this to ${LEAGUE_CONFIG.maxNameLength} characters or fewer.` })
  .refine(isPrintableDisplayName, { message: "Please use only characters people can see." });

/**
 * Every field but the mode has a default — `{ "mode": "solo" }` is a complete request body, the
 * same handful-of-interactions doctrine `createLeagueSchema` holds for a real league. The
 * defaults come from the configs that own them (`LEAGUE_CONFIG.defaults` for what a mock shares
 * with a real league, `MOCK_CONFIG` for the practice clock), and the membership refines are what
 * hold those defaults honest against the offered options.
 */
export const createMockRoomSchema = z
  .object({
    mode: z.enum(MOCK_CONFIG.modes),
    teamCount: z
      .number()
      .int()
      .refine((value) => (MOCK_CONFIG.teamCountOptions as readonly number[]).includes(value), {
        message: `Choose ${spoken(MOCK_CONFIG.teamCountOptions)} teams.`,
      })
      .default(LEAGUE_CONFIG.defaults.teamCount),
    pickSeconds: z
      .number()
      .int()
      .refine((value) => (MOCK_CONFIG.pickClockSecondsOptions as readonly number[]).includes(value), {
        message: `Choose a ${spoken(MOCK_CONFIG.pickClockSecondsOptions)} second pick clock.`,
      })
      .default(MOCK_CONFIG.defaultPickClockSeconds),
    scoringPreset: z.enum(scoringPresetNames).default(LEAGUE_CONFIG.defaults.scoringPreset),
    rosterShape: z.enum(rosterShapeNames).default(LEAGUE_CONFIG.defaults.rosterShape),
    teamName: teamName.optional(),
    /**
     * The host's own draft-position pick (founder directive 2026-08-26: "users should be able to
     * select their draft position"). Omitted or `undefined` means random — the same silence a
     * member who never opens the real slot-preference panel leaves — so `createMockRoom` writes
     * nothing for this field unless it is present. Bounded against THIS body's own `teamCount`,
     * never a fixed number, in the cross-field refine below: the identical reasoning
     * `outOfRangeMessage` (`@/draft-service/slot-preference`) already holds for a real league's
     * ranking, since the ceiling is a room's own size, not a platform-wide constant.
     */
    draftSlot: z.number().int({ message: "Please choose a whole number for your draft position." }).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.draftSlot !== undefined && (data.draftSlot < 1 || data.draftSlot > data.teamCount)) {
      ctx.addIssue({ code: "custom", path: ["draftSlot"], message: `Pick a draft position from 1 to ${data.teamCount}.` });
    }
  });

export type CreateMockRoomRequest = z.infer<typeof createMockRoomSchema>;

/** The claim door asks for exactly one thing: the code. Who is claiming comes from the session,
 *  never the body. */
export const claimMockSeatSchema = z.object({
  code: z.string().trim().min(1, { message: "Please enter a share code." }),
});

export type ClaimMockSeatRequest = z.infer<typeof claimMockSeatSchema>;
