/**
 * The site's context (founder ruling 2026-10-13: the league is the site's context): the selected
 * league, or a format with no league. One store, one reader. Signed in, /me answers it and
 * PUT /me/league sets it; signed out, it is a format this browser chose. The session keeps a copy
 * (boot.ts), so the shell's switch and the pages read it before /me answers. Every page reads the
 * context from here and nowhere else: the board opens in its format, rows mark who holds a player
 * (the rosters arrive through held.ts, loaded only with a league selected).
 */
import { PUBLIC_API_URL } from '$app/env/public';
import { apiClient, hasSessionCookie } from '#lib/api/client.ts';
import type { components } from '#lib/api/types.ts';
import { CONTEXT_KEY, LEAGUE_ATTR, LINES_KEY, ONE_PHONE_LINE } from './boot.ts';
import { contextNote, type BoardFormat, type ContextLeague, type Held } from './words.ts';

type Account = components['schemas']['Account'];
type Feature = components['schemas']['Feature'];

/** What the session keeps of the context. */
interface Kept {
	league: ContextLeague | null;
	leagues: readonly ContextLeague[];
	format: BoardFormat | null;
}

const client = apiClient(PUBLIC_API_URL);

/** The lines a league's basis line takes on a phone, 0 with no league. */
function linesFor(league: ContextLeague | null): 0 | 1 | 2 {
	if (!league) return 0;
	return (contextNote(league, league.format)?.length ?? 0) > ONE_PHONE_LINE ? 2 : 1;
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
	/** The selected league's rosters, null until read or with no league (held.ts). */
	held = $state<Held | null>(null);
	/** The league the rosters are, or are being read, for. */
	heldFor: string | null = null;
	/** The switch's menu is open: the bar's switch and the rail's Leagues open the one menu. */
	open = $state(false);

	#asked: Promise<void> | null = null;
	#heldWanted = false;

	/** Reads the session's copy, then /me, the first time any page asks in this page load. */
	load(): Promise<void> {
		this.#asked ??= this.#start();
		return this.#asked;
	}

	async #start(): Promise<void> {
		this.signedIn = hasSessionCookie();
		try {
			const kept = JSON.parse(sessionStorage.getItem(CONTEXT_KEY) ?? 'null') as Kept | null;
			if (kept && this.signedIn) this.#show(kept.league, kept.leagues, kept.format);
			else if (kept) this.format = kept.format;
		} catch {
			// No copy to read: /me answers.
		}
		await this.refresh();
	}

	/** Reads /me again: after the account's leagues change. */
	async refresh(): Promise<void> {
		this.signedIn = hasSessionCookie();
		if (!this.signedIn) {
			this.#show(null, [], this.format);
			this.features = [];
		} else {
			try {
				this.#take(await client.call<Account>('/me'));
			} catch {
				// The session's copy, or nothing, stands: the pages read the format they were built in.
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

	/** Takes an Account answer's context: /me, or the answer to a choice. */
	take(me: Account): void {
		this.#take(me);
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
		if (this.heldFor !== league?.id) {
			this.held = null;
			this.heldFor = null;
		}
		this.#readHeld();
	}

	#take(me: Account): void {
		this.features = me.features;
		// An API from before the context answers neither; read it as no league.
		const leagues = Array.isArray(me.leagues) ? me.leagues : [];
		this.#show(me.league ?? null, leagues, me.format ?? null);
	}

	#keep(): void {
		const lines = this.signedIn ? linesFor(this.league) : 0;
		const kept: Kept = { league: this.league, leagues: this.leagues, format: this.format };
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
