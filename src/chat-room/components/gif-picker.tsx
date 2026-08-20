"use client";

import { useEffect, useRef, useState } from "react";
import { Input, Modal } from "@/components/ui";
import type { GifResult } from "@/gifs/provider";
import { CHAT_ROOM_CONFIG } from "../config";

const SEARCH_ERROR = "We couldn't search GIFs. Check your connection and try again.";

export interface GifPickerProps {
  readonly open: boolean;
  readonly onClose: () => void;
  /** One request per debounced pause — see `GifProvider`'s docblock (`@/gifs/provider`) on why this component, not the seam, owns pacing. */
  readonly search: (query: string) => Promise<readonly GifResult[]>;
  readonly onPick: (gif: GifResult) => void;
}

/**
 * A search box and a result grid, in a focus-trapped dialog (`Modal`). Reached only through
 * `ChatComposer`, which renders it only when `gifSearchEnabled` is true — this component never
 * decides its own availability.
 *
 * Every button in the grid is named for the GIF's own alt text (`aria-label={gif.alt}`), the same
 * text `message-list.tsx` gives the `<img>` once it is sent — a keyboard or screen-reader user
 * picking "Touchdown Dance GIF" and later seeing "Touchdown Dance GIF" land in the log is one
 * name, not a preview name and a different sent name.
 *
 * Two guards on the search, together: `CHAT_ROOM_CONFIG.gifSearchDebounceMs` collapses a burst of
 * keystrokes into one request after the user pauses, and `searchGeneration` is what protects
 * against the class of bug a debounce alone does NOT — two different debounced requests both
 * ending up in flight (type, pause, keep typing before the first response lands, pause again) and
 * racing each other on the way back. Mirrors `useLeagueChat`'s `refreshGeneration` guard exactly:
 * a monotonic id per request, and a response applied only if it is still the newest one.
 */
export function GifPicker({ open, onClose, search, onPick }: GifPickerProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<readonly GifResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const searchGeneration = useRef(0);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(
    () => () => {
      if (debounceTimer.current !== undefined) clearTimeout(debounceTimer.current);
    },
    [],
  );

  const runSearch = async (value: string): Promise<void> => {
    searchGeneration.current += 1;
    const generation = searchGeneration.current;
    try {
      const found = await search(value);
      if (generation !== searchGeneration.current) return; // a newer search has since started
      setResults(found);
    } catch {
      if (generation !== searchGeneration.current) return;
      setResults([]);
      setError(SEARCH_ERROR);
    } finally {
      if (generation === searchGeneration.current) setLoading(false);
    }
  };

  const onQueryChange = (value: string): void => {
    setQuery(value);
    if (debounceTimer.current !== undefined) clearTimeout(debounceTimer.current);
    const trimmed = value.trim();
    if (trimmed === "") {
      // Invalidates any search still debouncing or already in flight, so its eventual response
      // cannot land after the box has been emptied back out.
      searchGeneration.current += 1;
      setResults([]);
      setError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    debounceTimer.current = setTimeout(() => {
      void runSearch(value);
    }, CHAT_ROOM_CONFIG.gifSearchDebounceMs);
  };

  const showEmptyState = !loading && error === null && query.trim() !== "" && results.length === 0;

  return (
    <Modal open={open} title="Add a GIF" onClose={onClose}>
      <div className="flex flex-col gap-3">
        <Input
          id="gif-picker-search"
          label="Search GIFs"
          type="search"
          autoComplete="off"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
        />
        {error === null ? null : (
          <p role="alert" className="text-sm text-negative">
            {error}
          </p>
        )}
        {showEmptyState ? <p className="text-sm text-text-muted">No GIFs found. Try another search.</p> : null}
        {/* Capped and independently scrollable — not a Modal-wide change — so a full grid of
            results can never push the dialog's own Close control off a small screen. */}
        <ul className="grid max-h-64 grid-cols-3 gap-2 overflow-y-auto">
          {results.map((gif) => (
            <li key={gif.id}>
              <button
                type="button"
                aria-label={gif.alt}
                onClick={() => onPick(gif)}
                className="block w-full overflow-hidden rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- remote Giphy CDN preview, see message-list.tsx's own note. */}
                <img
                  src={gif.previewUrl}
                  alt=""
                  width={gif.width}
                  height={gif.height}
                  loading="lazy"
                  className="h-24 w-full rounded-md object-cover"
                />
              </button>
            </li>
          ))}
        </ul>
      </div>
    </Modal>
  );
}
