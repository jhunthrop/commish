import type { GifResult } from "../provider";

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
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
    return [{ id, url, previewUrl, width, height, alt: title !== "" ? title : `A GIF for "${query}"` }];
  });
}
