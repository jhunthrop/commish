import { z } from "zod";
import { CHAT_CONFIG, isReactionEmoji } from "@/chat/config";

export const postMessageSchema = z.object({
  body: z
    .string()
    .trim()
    .min(1, { message: "Type a message first." })
    .max(CHAT_CONFIG.maxBodyLength, { message: `Please keep this to ${CHAT_CONFIG.maxBodyLength} characters or fewer.` }),
});

/**
 * The reaction set is validated through `isReactionEmoji`, not a second literal list here —
 * one closed set, one place it is written.
 */
export const reactionSchema = z.object({
  emoji: z.string().refine(isReactionEmoji, { message: "That isn't one of this league's reactions." }),
});

/** A page cursor is a bigserial id and nothing else — it goes straight into a WHERE clause. */
export const chatCursorSchema = z.string().regex(/^\d{1,19}$/, { message: "That isn't a place we can load from." });
