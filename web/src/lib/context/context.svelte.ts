/**
 * The site's context (founder ruling 2026-10-13: the league is the site's context): the selected
 * league, or a format with no league. One store, one reader. Signed in, /me answers it and
 * PUT /me/league sets it (choose.svelte.ts); signed out, it is a format this browser chose. The
 * session keeps a copy (boot.ts), tied to the session that wrote it, so the shell's switch and the
 * pages read it before /me answers and no other session ever does. Every page reads the context
 * from here and nowhere else: the board opens in its format, rows mark who holds a player (the
 * rosters arrive through held.ts, loaded only with a league selected).
 */
import { PUBLIC_API_URL } from '$app/env/public';
import { ApiError, apiClient } from '#lib/api/client.ts';
import { sessionToken } from '#lib/api/session.ts';
import type { components } from '#lib/api/types.ts';
import { CONTEXT_KEY, LEAGUE_ATTR, LINES_KEY } from './boot.ts';
import type { Marks } from './held-words.ts';
import type * as NoteLine from './note-line.ts';
import type { BoardFormat, ContextLeague } from './words.ts';

type Account = components['schemas']['Account'];
type Feature = components['schemas']['Feature'];

/** What the browser keeps of the context, with the session it is for (null: signed out, a format
 * this browser chose and never a league) and the account /me named. */
interface Kept {
	session: string | null;
	account: string | null;
	league: ContextLeague | null;
	leagues: readonly ContextLeague[];
	format: BoardFormat | null;
}

const client = apiClient(PUBLIC_API_URL);

/** The lines a league's basis line takes on a phone, 0 with no league: three for TE premium's (plain
 * words, plain PPR, where its exact rules rank it), two for a lineup or a board other than PPR the
 * run may lack, else one. */
function linesFor(league: ContextLeague | null): 0 | 1 | 2 | 3 {
	if (!league) return 0;
	if (league.scoring === 'te_premium') return 3;
	return league.format !== 'ppr' ? 2 : 1;
}

class SiteContext {
	/** This browser holds a session: the context is the account's. */
	signedIn = $state(false);
	/** Every league the account follows, newest first. */
	leagues = $state<readonly ContextLeague[]>([]);
	/** The selected league, null with none. */
	league = $state<ContextLeague | null>(null);
	/** The format pages open in: the league's, or the one chosen; null when neither. */
	format = $state<BoardFormat | null>(null);
	/** What the account may use, from the same /me read: many_leagues on the attach page. */
	features = $state<readonly Feature[]>([]);
	/** The selected league's roster marks, null until read or with no league (held.ts). */
	held = $state<Marks | null>(null);
	/** The basis line's words (note-line.ts), loaded once a league is selected: a page with none
	 * prints no line and carries none of them. */
	notes = $state<typeof NoteLine | null>(null);
	/** The league the rosters are, or are being read, for. */
	heldFor: string | null = null;
	/** The switch's menu is open: the bar's switch and the rail's Leagues open the one menu. */
	open = $state(false);
	/** How many choices the switch has made in this page load: a format page follows the context
	 * only after one (follow.svelte.ts), and a choice's answer counts only while it is the latest. */
	choices = $state(0);

	#asked: Promise<void> | null = null;
	#heldWanted = false;
	#session: string | null = null;
	#account: string | null = null;

	/** Reads the session's copy, then /me, the first time any page asks in this page load. */
	load(): Promise<void> {
		this.#asked ??= this.#start();
		return this.#asked;
	}

	/** The kept copy when this session (or, signed out, this browser) wrote it; null otherwise. */
	#copy(): Kept | null {
		try {
			const kept = JSON.parse(sessionStorage.getItem(CONTEXT_KEY) ?? 'null') as Kept | null;
			return kept?.session === this.#session ? kept : null;
		} catch {
			return null;
		}
	}

	async #start(): Promise<void> {
		this.#session = sessionToken();
		this.signedIn = this.#session !== null;
		const kept = this.#copy();
		if (kept) {
			this.#account = kept.account;
			this.#show(kept.league, kept.leagues, kept.format);
		}
		await this.refresh();
	}

	/** Reads /me again: after the account's leagues change. */
	async refresh(): Promise<void> {
		this.#session = sessionToken();
		this.signedIn = this.#session !== null;
		if (!this.signedIn) {
			this.#account = null;
			this.#show(null, [], this.#copy()?.format ?? null);
			this.features = [];
		} else {
			try {
				this.take(await client.call<Account>('/me'));
				return;
			} catch (error) {
				// The session's own copy, or nothing, stands: the pages read the format they were built in.
				// The one record of a failed /me, with its status, for whoever has the console open.
				// eslint-disable-next-line no-console -- no user-facing text: the context held still stands
				console.warn('Site context: /me', error instanceof ApiError ? error.status : error);
				this.features = [];
			}
		}
		this.#keep();
	}

	/** Makes a league, or a format with no league, the context here and in the session's copy. The
	 * account's side is choose.svelte.ts. */
	select(league: ContextLeague | null, format: BoardFormat | null): void {
		this.#show(league, this.leagues, format);
		this.#keep();
	}

	/** Takes an Account answer's context: /me, or the answer to a choice. An answer for another
	 * account than the one shown drops everything of the one shown first. */
	take(me: Account): void {
		if (this.#account !== me.id) {
			this.held = null;
			this.heldFor = null;
			this.#account = me.id;
		}
		this.features = me.features;
		// An API from before the context answers neither; read it as no league.
		const leagues = Array.isArray(me.leagues) ? me.leagues : [];
		this.#show(me.league ?? null, leagues, me.format ?? null);
		this.#keep();
	}

	/** A page that marks held players asks for the selected league's rosters (held.ts): read once a
	 * session per league, never per page. */
	wantHeld(): void {
		this.#heldWanted = true;
		this.#readHeld();
	}

	#readHeld(): void {
		const id = this.league?.id;
		if (!this.#heldWanted || !this.signedIn || id === undefined || this.heldFor === id) return;
		void import('./held.ts').then((module) => module.readHeld(id));
	}

	#show(
		league: ContextLeague | null,
		leagues: readonly ContextLeague[],
		format: BoardFormat | null
	): void {
		this.league = league;
		this.leagues = leagues;
		this.format = league ? league.format : format;
		if (league && !this.notes) {
			import('./note-line.ts')
				.then((module) => {
					this.notes = module;
				})
				// A chunk that fails to load (a deploy between pages) leaves the line unsaid in its kept
				// room, never an unhandled rejection; the next page loads it again.
				.catch(() => undefined);
		}
		if (this.heldFor !== league?.id) {
			this.held = null;
			this.heldFor = null;
		}
		this.#readHeld();
	}

	#keep(): void {
		const lines = this.signedIn ? linesFor(this.league) : 0;
		const kept: Kept = {
			session: this.#session,
			account: this.#account,
			league: this.league,
			leagues: this.leagues,
			format: this.format
		};
		try {
			sessionStorage.setItem(CONTEXT_KEY, JSON.stringify(kept));
			if (lines === 0) localStorage.removeItem(LINES_KEY);
			else localStorage.setItem(LINES_KEY, String(lines));
		} catch {
			// Storage can be off or full: the context still holds for this page.
		}
		if (lines === 0) document.documentElement.removeAttribute(LEAGUE_ATTR);
		else document.documentElement.setAttribute(LEAGUE_ATTR, String(lines));
	}
}

export const siteContext = new SiteContext();
