import { CHAT_CONFIG } from "@/chat/config";
import type { GifResult } from "../provider";

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * The alt text a GIF carries BECOMES the message body (`ChatComposer` sends `gif.alt` as
 * `body`), which `postMessageSchema` caps at `CHAT_CONFIG.maxBodyLength`. An uncapped Giphy
 * title longer than that made a GIF unsendable and surfaced the TEXT path's error — "Please keep
 * this to 500 characters or fewer" — for a GIF the user never typed a word into. So the cap is
 * applied here, at the seam that synthesizes the string, rather than left to fail at the wire.
 *
 * Plain truncation, no ellipsis: an ellipsis is a claim that something was cut, and this is alt
 * text read aloud by a screen reader, where a trailing "dot dot dot" is noise. Trimmed after the
 * slice so a cut landing on a space cannot leave trailing whitespace behind.
 */
function fitAlt(text: string): string {
  return text.length <= CHAT_CONFIG.gif.maxAltLength ? text : text.slice(0, CHAT_CONFIG.gif.maxAltLength).trim();
}

/** Giphy reports every rendition's width/height as a STRING. Anything not a finite positive number becomes 0, never NaN. */
function dimension(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function rendition(images: Record<string, unknown>, name: string): Record<string, unknown> {
  const found = images[name];
  return typeof found === "object" && found !== null ? (found as Record<string, unknown>) : {};
}

/**
 * `/v1/gifs/search`'s `data[]` → the shape chat needs. Two renditions out of the many an `images`
 * object carries: `fixed_height` (a small, fast-loading rendition, ~200px tall) for the picker
 * grid's `previewUrl`, and `original` for the full `url` that actually ships as the message —
 * `width`/`height` describe THAT rendition, because it is the one `message-list.tsx` sets
 * `width`/`height` attributes from to avoid a layout reflow when it loads.
 *
 * An entry missing an id, either rendition's url, or either rendition's dimensions is dropped
 * rather than emitted with a placeholder — the same rule `mapPlayerList` (`src/stats/tank01/
 * map.ts`) uses for a Tank01 player row. A response id repeated within one page (upstream
 * shouldn't, but nothing enforces it) is deduped here too, matching the contract suite's own
 * "never returns the same id twice" case.
 */
export function mapSearchResults(data: unknown, query: string): readonly GifResult[] {
  if (!Array.isArray(data)) return [];
  const seen = new Set<string>();
  return data.flatMap((raw): readonly GifResult[] => {
    const record = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
    const id = str(record.id);
    const images = typeof record.images === "object" && record.images !== null ? (record.images as Record<string, unknown>) : {};
    const original = rendition(images, "original");
    const preview = rendition(images, "fixed_height");
    const url = str(original.url);
    const previewUrl = str(preview.url);
    const width = dimension(original.width);
    const height = dimension(original.height);
    if (id === "" || url === "" || previewUrl === "" || width === 0 || height === 0 || seen.has(id)) return [];
    seen.add(id);
    const title = str(record.title);
    return [{ id, url, previewUrl, width, height, alt: fitAlt(title !== "" ? title : `A GIF for "${query}"`) }];
  });
}
