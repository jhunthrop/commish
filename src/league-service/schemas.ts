import { z } from "zod";
import { LEAGUE_CONFIG } from "@/league";

const name = z
  .string()
  .trim()
  .min(1, { message: "Please enter a name." })
  .max(LEAGUE_CONFIG.maxNameLength, { message: `Please keep this to ${LEAGUE_CONFIG.maxNameLength} characters or fewer.` });

/**
 * Every field except the name has a default, because the spec's exit criterion is that a
 * commissioner goes from signed in to an invitable league in a handful of interactions by
 * accepting defaults. `{ "name": "Sunday Money" }` is a complete request body.
 *
 * `teamCount` is bounded here and nowhere else: creation is the only moment a league's size
 * is chosen, so `LEAGUE_CONFIG.minTeams`/`maxTeams` are enforced at this boundary rather than
 * re-checked by every downstream consumer (the schedule generator, for one, is happy with
 * fewer teams than a real league should ever have).
 */
export const createLeagueSchema = z.object({
  name,
  format: z.enum(["snake", "auction"]).default(LEAGUE_CONFIG.defaults.format),
  teamCount: z
    .number()
    .int()
    .min(LEAGUE_CONFIG.minTeams, { message: `A league needs at least ${LEAGUE_CONFIG.minTeams} teams.` })
    .max(LEAGUE_CONFIG.maxTeams, { message: `A league can have at most ${LEAGUE_CONFIG.maxTeams} teams.` })
    .default(LEAGUE_CONFIG.defaults.teamCount),
  scoringPreset: z.enum(["standard", "ppr", "half_ppr", "te_premium"]).default(LEAGUE_CONFIG.defaults.scoringPreset),
  auctionBudget: z
    .number()
    .int()
    .positive({ message: "An auction budget must be more than zero." })
    .default(LEAGUE_CONFIG.defaults.auctionBudget),
  /** Defaults at the route to the creator's display name, which the route knows and the service does not. */
  teamName: name.optional(),
});

export const createInviteSchema = z.object({
  maxUses: z
    .number()
    .int()
    .positive({ message: "An invite has to be usable at least once." })
    .max(LEAGUE_CONFIG.invite.maxUses, { message: `An invite can be used at most ${LEAGUE_CONFIG.invite.maxUses} times.` })
    .default(LEAGUE_CONFIG.invite.maxUses),
});

export const acceptInviteSchema = z.object({
  teamName: name.optional(),
});

export type CreateLeagueRequest = z.infer<typeof createLeagueSchema>;
