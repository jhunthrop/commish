/**
 * THE ONE-CALL BUNDLE (refrains round, 2026-09-07) — the shape one gateway call returns for one
 * player: the compact read, the full read and the narrative slots, in one JSON object.
 *
 * WHY ONE CALL. A player was three calls (compact, full, narrative), each paying for the same fact
 * sheet in its prompt and each written without knowing what the other two said, which is how the
 * compact and the full read came to open the same way and the call slot came to restate the
 * compact's last sentence. One call reads the sheet once, writes the three parts knowing each
 * other, and costs about a third of what three did. `generate.ts` still validates every part on
 * its own and corrects only the part that failed.
 *
 * THE PARSER IS TOLERANT OF HABITS, NEVER OF SHAPE. A code fence, a sentence around the object and
 * a raw line break inside a string (a model writing paragraphs) are repaired. A part that is
 * missing, empty or not a string is `null`, and `generate.ts` decides what a null part costs. A
 * body that is not an object at all is `null` outright.
 */

export interface CapsuleBundle {
  readonly compact: string | null;
  readonly full: string | null;
  /** The raw narrative object, still to be validated slot by slot by `narrative.ts`. */
  readonly narrative: Readonly<Record<string, unknown>> | null;
}

/** The keys the prompt asks for and this parser reads, stated once for both. */
export const BUNDLE_KEYS = { compact: "compact", full: "full", narrative: "narrative" } as const;

/**
 * Escapes a raw newline, carriage return or tab that sits INSIDE a JSON string literal. Walks the
 * text once, tracking whether it is inside a string and whether the previous character escaped
 * this one, and touches nothing outside a string, so an already-valid body is returned unchanged.
 */
function repairJsonStrings(text: string): string {
  const out: string[] = [];
  let inString = false;
  let escaped = false;
  for (const character of text) {
    if (inString && !escaped && (character === "\n" || character === "\r" || character === "\t")) {
      out.push(character === "\n" ? "\\n" : character === "\r" ? "\\r" : "\\t");
      continue;
    }
    out.push(character);
    if (escaped) escaped = false;
    else if (character === "\\") escaped = inString;
    else if (character === '"') inString = !inString;
  }
  return out.join("");
}

function parseObject(text: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(text);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function nonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function plainObject(value: unknown): Readonly<Record<string, unknown>> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/** The bundle out of a completion, or `null` when no JSON object can be read from it. */
export function parseBundle(content: string): CapsuleBundle | null {
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return null;
  const body = content.slice(start, end + 1);
  const object = parseObject(body) ?? parseObject(repairJsonStrings(body));
  if (object === null) return null;
  return {
    compact: nonEmptyString(object[BUNDLE_KEYS.compact]),
    full: nonEmptyString(object[BUNDLE_KEYS.full]),
    narrative: plainObject(object[BUNDLE_KEYS.narrative]),
  };
}
