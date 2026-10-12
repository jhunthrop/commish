import { z } from "zod";
import type { Position } from "@research-ts/domain/player";
import type { RosterSlotType } from "@research-ts/domain/roster";

/**
 * THE ROOM STATE `POST /advise` TAKES, validated at the boundary (`research-ts/README.md` documents the
 * same shape for the callers). Everything the closed form needs and nothing it does not: the pool
 * with what we project and where drafters take each man, the picks so far, the seat on the clock and
 * the league's roster rules.
 */

const POSITIONS = ["QB", "RB", "WR", "TE", "K", "DEF"] as const satisfies readonly Position[];
const SLOT_TYPES = ["QB", "RB", "WR", "TE", "FLEX", "SUPERFLEX", "K", "DEF", "BENCH"] as const satisfies readonly RosterSlotType[];

/** One player in the room's pool, drafted or not. `projectedPoints` is null for a position the board
 *  ships in market order (kickers and defenses), which then has survival odds but no value. */
const poolEntrySchema = z.object({
  id: z.string().min(1),
  position: z.enum(POSITIONS),
  adp: z.number().positive().finite(),
  projectedPoints: z.number().finite().nullable(),
});

const pickSchema = z.object({
  pickNumber: z.number().int().positive(),
  playerId: z.string().min(1),
  seat: z.number().int().positive(),
});

const rosterSlotSchema = z.object({
  slot: z.enum(SLOT_TYPES),
  count: z.number().int().positive(),
  eligiblePositions: z.array(z.enum(POSITIONS)).min(1).readonly(),
});

export const adviseRequestSchema = z
  .object({
    teamCount: z.number().int().min(2).max(32),
    rosterSlots: z.array(rosterSlotSchema).min(1).readonly(),
    pool: z.array(poolEntrySchema).min(1).readonly(),
    picks: z.array(pickSchema).readonly(),
    /** 1-based draft slot of the seat on the clock. Must be the seat the snake order puts there. */
    seatOnClock: z.number().int().positive(),
    shortlistSize: z.number().int().min(1).max(20).optional(),
  })
  .superRefine((request, context) => {
    const ids = new Set(request.pool.map((entry) => entry.id));
    if (ids.size !== request.pool.length) context.addIssue({ code: "custom", message: "pool ids must be unique" });
    request.picks.forEach((pick, index) => {
      if (pick.pickNumber !== index + 1) context.addIssue({ code: "custom", path: ["picks", index, "pickNumber"], message: `picks must be numbered 1..n in order; expected ${index + 1}` });
      if (!ids.has(pick.playerId)) context.addIssue({ code: "custom", path: ["picks", index, "playerId"], message: `"${pick.playerId}" is not in the pool` });
      if (pick.seat > request.teamCount) context.addIssue({ code: "custom", path: ["picks", index, "seat"], message: "seat is past the team count" });
    });
    if (new Set(request.picks.map((pick) => pick.playerId)).size !== request.picks.length) context.addIssue({ code: "custom", path: ["picks"], message: "a player was picked twice" });
    if (request.seatOnClock > request.teamCount) context.addIssue({ code: "custom", path: ["seatOnClock"], message: "seat is past the team count" });
  });

export type AdviseRequest = z.infer<typeof adviseRequestSchema>;
export type PoolEntry = AdviseRequest["pool"][number];
