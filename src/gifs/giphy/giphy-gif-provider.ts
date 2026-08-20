import type { GifProvider } from "../provider";
import { createGiphyClient, type GiphyClientOptions } from "./client";
import { mapSearchResults } from "./map";

export function createGiphyGifProvider(options: GiphyClientOptions): GifProvider {
  const client = createGiphyClient(options);
  return {
    async search(query, limit) {
      const trimmed = query.trim();
      // Answered locally, without a request — the contract's own "an empty query gets no
      // results, not an error" case, and one fewer billable call for a picker opened but not
      // yet typed into.
      if (trimmed === "") return [];
      const data = await client.search(trimmed, limit);
      // Sliced defensively rather than trusted: `limit` is a request param upstream is asked to
      // honor, not a guarantee this adapter enforces on its own behalf.
      return mapSearchResults(data, trimmed).slice(0, limit);
    },
  };
}
