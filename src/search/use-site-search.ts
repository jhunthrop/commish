"use client";

import { useEffect, useState } from "react";
import type { ApiEnvelope } from "@/lib/api/respond";
import { SEARCH_CONFIG } from "./config";
import type { SearchBody, SearchResult } from "./contract";

/** The one dependency the hook has: how a request is made. Injected so a test never touches
 *  the network — the same `fetchJson` shape `AccountRoomDeps` already carries. */
export type FetchJson = (url: string, init?: RequestInit) => Promise<Response>;

export type SiteSearchStatus = "idle" | "loading" | "ready" | "failed";

export interface SiteSearchState {
  readonly status: SiteSearchStatus;
  /** The query the `results` answer. */
  readonly query: string;
  readonly results: readonly SearchResult[];
}

const IDLE: SiteSearchState = { status: "idle", query: "", results: [] };

export function searchUrlFor(query: string): string {
  return `/api/search?q=${encodeURIComponent(query)}`;
}

function isSearchEnvelope(value: unknown): value is ApiEnvelope<SearchBody> {
  return typeof value === "object" && value !== null && "ok" in value;
}

/**
 * THE OVERLAY'S WIRE (item 4 of the round): one request per settled keystroke, never per key.
 *
 * DEBOUNCED at `SEARCH_CONFIG.debounceMs`, so typing a name at speed costs a handful of requests
 * rather than one per character. CANCELLED WHEN SUPERSEDED: every effect cleanup clears the
 * pending timer and aborts the in-flight request, so a slow answer to "gi" can never land after
 * the fast answer to "gibbs" and overwrite it. The last ready results stay on screen while the
 * next answer is in flight, which is what keeps the list from flickering empty on every key.
 */
export function useSiteSearch(query: string, fetchJson: FetchJson): SiteSearchState {
  const [state, setState] = useState<SiteSearchState>(IDLE);
  const trimmed = query.trim();

  useEffect(() => {
    if (trimmed.length < SEARCH_CONFIG.minQueryLength) {
      setState(IDLE);
      return;
    }
    setState((held) => ({ ...held, status: "loading", query: trimmed }));
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void answer(trimmed, fetchJson, controller.signal).then((results) => {
        if (controller.signal.aborted) return;
        setState(results === null ? { status: "failed", query: trimmed, results: [] } : { status: "ready", query: trimmed, results });
      });
    }, SEARCH_CONFIG.debounceMs);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [trimmed, fetchJson]);

  return state;
}

/** The results for one query, or `null` for a failed request or a malformed answer. */
async function answer(query: string, fetchJson: FetchJson, signal: AbortSignal): Promise<readonly SearchResult[] | null> {
  try {
    const response = await fetchJson(searchUrlFor(query), { signal });
    const envelope: unknown = await response.json();
    if (!isSearchEnvelope(envelope) || !envelope.ok) return null;
    return envelope.data.results;
  } catch {
    return null;
  }
}
