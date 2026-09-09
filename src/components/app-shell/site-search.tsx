"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useState, type KeyboardEvent } from "react";
import { useAccountRoomDeps } from "@/account-room/hooks/deps";
import { Icon } from "@/components/ui/icon";
import { Modal } from "@/components/ui/modal";
import { PlayerRow } from "@/components/ui/player-row";
import { TeamRow } from "@/components/ui/team-row";
import { rosterStatusLabel } from "@/projections/preseason/roster-status-copy";
import { SEARCH_CONFIG } from "@/search/config";
import { searchResultKey, type SearchResult } from "@/search/contract";
import { useSiteSearch } from "@/search/use-site-search";
import { searchResultHref, useLinkLeague } from "./shell-leagues";

/** The keys that open the palette from anywhere on a signed-in page. */
const OPEN_KEY = "/";
const PALETTE_KEY = "k";

const EDITABLE = "input, textarea, select, [contenteditable=''], [contenteditable='true']";

/** Whether a keypress landed in something that already takes typing, where `/` is just a slash. */
function inEditable(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(EDITABLE) !== null;
}

function shouldOpen(event: globalThis.KeyboardEvent): boolean {
  if (event.defaultPrevented) return false;
  if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === PALETTE_KEY) return true;
  return event.key === OPEN_KEY && !event.metaKey && !event.ctrlKey && !event.altKey && !inEditable(event.target);
}

/** The mono facts after a result's name: club, bye, and the board rank a player carries. Pure. */
export function resultMetaLine(result: SearchResult): string {
  const bye = result.byeWeek === null ? null : `Bye ${result.byeWeek}`;
  if (result.kind === "team") return [result.code, bye].filter((part) => part !== null).join(" · ");
  const board = result.boardRank === null ? null : `Board ${result.boardRank}`;
  const club = result.player.nflTeam === "" ? null : result.player.nflTeam;
  // The roster status leads (the roster-status gate, 2026-09-08): a man on injured reserve or off
  // an active roster is a different search answer from the same name a week earlier, and the
  // short word is the same one the board's pill shows.
  const status = result.rosterStatus === null ? null : rosterStatusLabel(result.rosterStatus.status);
  return [status, club, bye, board].filter((part) => part !== null).join(" · ");
}

function optionId(listboxId: string, result: SearchResult): string {
  return `${listboxId}-${searchResultKey(result).replace(":", "-")}`;
}

/**
 * THE ONE SEARCH FIELD (site search round, 2026-09-08): a trigger in the shell header, reachable
 * on every signed-in page, and a top-anchored palette (`Modal`, placement `top`) with a combobox,
 * a listbox of `PlayerRow`/`TeamRow` results, arrow keys, Enter and Escape. `/` with nothing
 * focused and Cmd or Ctrl plus K open it from anywhere; on a phone the trigger is the icon alone
 * and the palette is the whole screen.
 *
 * WAI-ARIA combobox with `aria-activedescendant`: the field keeps focus, the highlighted option is
 * named on the field, and the options are never focus stops of their own. A result's destination
 * is `searchResultHref` over `useLinkLeague` (`./shell-leagues`), so a player opens in the league
 * the reader is standing in and a team opens its own page.
 *
 * THE WIRE IS `useSiteSearch`'s: debounced and cancelled. The empty line is the one sentence the
 * round fixed, and it renders only for a query that was actually answered with nothing.
 */
export function SiteSearch() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const { fetchJson } = useAccountRoomDeps();
  const router = useRouter();
  const leagueId = useLinkLeague();
  const listboxId = useId();
  const state = useSiteSearch(open ? query : "", fetchJson);
  const results = state.results;

  useEffect(() => {
    setActive(0);
  }, [results]);

  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent): void => {
      if (!shouldOpen(event)) return;
      event.preventDefault();
      setOpen(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
  }, []);

  const go = useCallback(
    (result: SearchResult) => {
      close();
      router.push(searchResultHref(result, leagueId));
    },
    [close, leagueId, router],
  );

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (results.length === 0) return;
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((held) => (held + step + results.length) % results.length);
      return;
    }
    if (event.key === "Enter") {
      const chosen = results[active];
      if (chosen !== undefined) {
        event.preventDefault();
        go(chosen);
      }
    }
  };

  const activeResult = results[active];
  const answeredEmpty = state.status === "ready" && results.length === 0;

  return (
    <>
      <button
        type="button"
        aria-label={SEARCH_CONFIG.copy.placeholder}
        onClick={() => setOpen(true)}
        className="flex h-9 items-center gap-2 rounded-md p-1.5 text-text-muted transition-colors hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent sm:min-w-56 sm:border sm:border-edge sm:bg-surface-elevated sm:px-3"
      >
        <Icon name="search" size={18} />
        <span className="hidden text-sm sm:inline">{SEARCH_CONFIG.copy.placeholder}</span>
        <kbd aria-hidden="true" className="ml-auto hidden rounded-sm bg-surface-raised px-1.5 font-mono text-xs text-text-faint sm:inline">
          {OPEN_KEY}
        </kbd>
      </button>
      <Modal open={open} title={SEARCH_CONFIG.copy.dialogTitle} onClose={close} placement="top" size="lg" titleHidden footer={null}>
        <div className="flex flex-col gap-3">
          <input
            role="combobox"
            aria-label={SEARCH_CONFIG.copy.placeholder}
            aria-expanded={results.length > 0}
            aria-controls={listboxId}
            aria-autocomplete="list"
            aria-activedescendant={activeResult === undefined ? undefined : optionId(listboxId, activeResult)}
            autoComplete="off"
            spellCheck={false}
            placeholder={SEARCH_CONFIG.copy.placeholder}
            value={query}
            maxLength={SEARCH_CONFIG.maxQueryLength}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onKeyDown}
            className="h-11 w-full rounded-md border border-edge bg-surface-raised px-3 text-md text-text-primary placeholder:text-text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          />
          {/* Plain `div`s carrying the listbox and option roles, the APG combobox shape: an option is
              steered by the field and is never a focus stop of its own, so a real `<a>` inside it
              would be a second, contradictory way to open the same result. */}
          <div id={listboxId} role="listbox" aria-label="Results" aria-busy={state.status === "loading"} className="flex flex-col gap-1.5">
            {results.map((result, index) => (
              // `tabIndex={-1}`: programmatically focusable, never a tab stop, which is the APG's own
              // rule for an option under `aria-activedescendant`.
              // eslint-disable-next-line jsx-a11y/click-events-have-key-events -- keys are handled on the combobox field per the APG pattern.
              <div key={searchResultKey(result)} id={optionId(listboxId, result)} role="option" tabIndex={-1} aria-selected={index === active} onClick={() => go(result)} onMouseEnter={() => setActive(index)} className="cursor-pointer">
                {result.kind === "team" ? (
                  <TeamRow code={result.code} name={result.name} meta={resultMetaLine(result)} highlight={index === active} />
                ) : (
                  <PlayerRow player={result.player} positionRank={result.positionRank ?? undefined} meta={resultMetaLine(result)} highlight={index === active} />
                )}
              </div>
            ))}
          </div>
          {answeredEmpty ? (
            <p role="status" className="px-1 text-sm text-text-muted">
              {SEARCH_CONFIG.copy.noMatch}
            </p>
          ) : null}
        </div>
      </Modal>
    </>
  );
}
