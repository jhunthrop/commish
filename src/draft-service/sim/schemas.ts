import { z } from "zod";
import { SIM_RUN_OPTIONS } from "./config";

/** `POST /api/draft/sim`'s own request body. `slot` accepts a 1-based seat or `"all"` (spec §5's
 *  "find my best slot" mode). `runs` is any of the UI's three offered sizes — the service itself
 *  would accept any positive integer, but the request boundary holds the line at the closed set
 *  a caller can actually reach from the page. */
export const createSimRunSchema = z.object({
  leagueId: z.string().nullish(),
  slot: z.union([z.number().int().min(1).max(64), z.literal("all")]),
  rounds: z.number().int().min(1).max(30),
  runs: z.union(SIM_RUN_OPTIONS.map((n) => z.literal(n)) as [z.ZodLiteral<number>, ...z.ZodLiteral<number>[]]),
  sharpness: z.number().min(0).max(1),
});

export type CreateSimRunBody = z.infer<typeof createSimRunSchema>;
