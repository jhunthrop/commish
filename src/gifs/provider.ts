/**
 * One search result, mapped from whatever the provider actually returned into the shape chat
 * needs to render it. `previewUrl` is the small rendition the picker grid shows while a manager
 * is choosing; `url` is the one that ships as the message and is what `width`/`height` describe,
 * so `message-list.tsx` can set both attributes up front and never reflow the log when the image
 * finishes loading.
 *
 * `alt` is not optional, and is never empty — see `describeGifProviderContract` in
 * `test-support.ts`. A GIF in a chat log with no alt text is a message a blind manager cannot
 * read; an adapter whose upstream result has no title synthesizes one from the search query
 * rather than shipping `""`.
 */
export interface GifResult {
  readonly id: string;
  readonly previewUrl: string;
  readonly url: string;
  readonly width: number;
  readonly height: number;
  readonly alt: string;
}

/**
 * The seam between chat and a GIF source. Phase 2 ships Giphy as the one real implementation;
 * a future Tenor adapter (or any other) plugs in as another implementation of this interface,
 * proved by the same `describeGifProviderContract` suite, not a rewrite of chat.
 *
 * REQUEST COST: one upstream request per `search()` call, uncached. Unlike `StatsProvider`
 * (`src/stats/provider.ts`), there is no `requestCost` field here — a GIF search is a live,
 * user-typed query with no fixed cadence to budget against, so there is nothing for a
 * `RequestBudget`-style ledger to reserve ahead of time. The caller controls how often it calls:
 * `src/chat-room/components/gif-picker.tsx` fires one request per keystroke it is given, by
 * design, and does not debounce on this seam's behalf.
 */
export interface GifProvider {
  /** `limit` bounds the RESULT COUNT, not the request — every implementation issues exactly one request per call. */
  search(query: string, limit: number): Promise<readonly GifResult[]>;
}

/** `GET /api/gifs/search`'s response body. */
export interface GifSearchBody {
  readonly results: readonly GifResult[];
}
