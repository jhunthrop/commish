"use client";

import { useState } from "react";
import { Button } from "@/components/ui";
import { DRAFT_ROOM_CONFIG } from "../../state/config";

export interface Paging {
  /** How many rows to render right now. */
  readonly shown: number;
  /** How many more the list holds beyond `shown`. */
  readonly remaining: number;
  readonly more: () => void;
}

/**
 * The drawer's one paging rule (fluidity round, 2026-09-10): a list shows the pool's own page
 * (`DRAFT_ROOM_CONFIG.poolPageSize`) and grows a page at a time on request. The sheet and the
 * byes tab used to render every board player — 1,700 rows, 14,000 components a commit, a 300 ms
 * tab open — for a list nobody scrolls to the end of.
 */
export function usePaging(total: number): Paging {
  const [pages, setPages] = useState(1);
  const shown = Math.min(total, pages * DRAFT_ROOM_CONFIG.poolPageSize);
  return { shown, remaining: total - shown, more: () => setPages((count) => count + 1) };
}

/** The footer row that offers the next page; renders nothing when everything is shown. */
export function PagedFooter({ paging, total }: { readonly paging: Paging; readonly total: number }) {
  if (paging.remaining <= 0) return null;
  return (
    <li className="flex items-center justify-between gap-2 px-2.5 py-1.5">
      <span className="font-mono text-xs tabular-nums text-text-muted">
        Showing the top {paging.shown} of {total}.
      </span>
      <Button size="sm" variant="ghost" onClick={paging.more}>
        Show {Math.min(paging.remaining, DRAFT_ROOM_CONFIG.poolPageSize)} more
      </Button>
    </li>
  );
}
