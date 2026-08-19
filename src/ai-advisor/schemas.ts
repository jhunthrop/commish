import { z } from "zod";
import { ADVISOR_CONFIG } from "@/domain/advisor";
import { weekNumberSchema } from "@/league-service";

export const startSitRequestSchema = z.object({
  weekNumber: weekNumberSchema,
  question: z
    .string()
    .trim()
    .min(1, { message: "Ask a question first. For example: who to start at flex." })
    .max(ADVISOR_CONFIG.maxQuestionLength, {
      message: `Please keep this to ${ADVISOR_CONFIG.maxQuestionLength} characters or fewer.`,
    }),
});

const side = z
  .array(z.string().min(1))
  .min(1, { message: "Name at least one player on each side." })
  .max(ADVISOR_CONFIG.maxPlayersPerSide, {
    message: `A side can name at most ${ADVISOR_CONFIG.maxPlayersPerSide} players.`,
  });

export const tradeRequestSchema = z.object({
  weekNumber: weekNumberSchema,
  counterpartyTeamId: z.string().min(1),
  /** What the caller would send. Their own team is always the session's team, never a field. */
  give: side,
  /** What the caller would get back. */
  receive: side,
});
