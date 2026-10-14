/**
 * The site's context (founder ruling 2026-10-13: the league is the site's context): the selected
 * league, or a format with no league. One store, one reader. Signed in, /me answers it and
 * PUT /me/league sets it; signed out, it is a format this browser chose. The session keeps a copy
 * (boot.ts), so the shell's switch and the pages read it before /me answers. Every page reads the
 * context from here and nowhere else: the board opens in its format, rows mark who holds a player.
 */
import { PUBLIC_API_URL } from '$app/env/public';
import { apiClient, hasSessionCookie } from '#lib/api/client.ts';
import type { components } from '#lib/api/types.ts';
import { CONTEXT_KEY, LEAGUE_ATTR, LINES_KEY, ONE_PHONE_LINE } from './boot.ts';
import {
	contextNote,
	heldOf,
	type BoardFormat,
	type ContextFormat,
	type ContextLeague,
	type Held
} from './words.ts';

type Account = components['schemas']['Account'];
type Feature = components['schemas']['Feature'];
type LeagueSync = components['schemas']['LeagueSync'];

/** A choice in the switch: one of the account's leagues, or a format with no league. */
export type Choice = { league: string } | { format: ContextFormat };

/** A league's rosters are read again after this long in one session. */
const HELD_FRESH_MS = 10 * 60_000;

/** What the session keeps: the context and the rosters last read. */
interface Kept {
	league: ContextLeague | null;
	leagues: readonly ContextLeague[];
	format: BoardFormat | null;
	held: { id: string; at: number; held: Held } | null;
}

const client = apiClient(PUBLIC_API_URL);

function readKept(): Kept | null {
	try {
		return JSON.parse(sessionStorage.getItem(CONTEXT_KEY) ?? 'null') as Kept | null;
	} catch {
		return null;
	}
}

/** The lines a league's basis line takes on a phone, 0 with no league. */
function linesFor(league: ContextLeague | null): 0 | 1 | 2 {
	if (!league) return 0;
	return (contextNote(league, league.format)?.length ?? 0) > ONE_PHONE_LINE ? 2 : 1;
}

class SiteContext {
	/** This browser holds a session: the context is the account's. */
	signedIn = $state(false);
	/** /me answered (or there is no session to ask about). */
	ready = $state(false);
	/** Every league the account follows, newest first. */
	leagues = $state<readonly ContextLeague[]>([]);
	/** The selected league, null with none. */
	league = $state<ContextLeague | null>(null);
	/** The format pages open in: the league's, or the one chosen; null when neither. */
	format = $state<BoardFormat | null>(null);
	/** What the account may use, from the same /me read: many_leagues on the attach page. */
	features = $state<readonly Feature[]>([]);
	/** The selected league's rosters, null until read or with no league. */
	held = $state<Held | null>(null);
	/** The switch's menu is open: the bar's switch and the rail's Leagues open the one menu. */
	open = $state(false);
	/** Why the last switch did not hold, in a sentence; null when it did. */
	problem = $state<string | null>(null);

	#asked: Promise<void> | null = null;
	#heldWanted = false;
	#heldFor: string | null = null;
	/** When the rosters held now were read. */
	#heldAt = 0;

	/** Reads the session's copy, then /me, the first time any page asks in this page load. */
	load(): Promise<void> {
		this.#asked ??= this.#start();
		return this.#asked;
	}

	async #start(): Promise<void> {
		this.signedIn = hasSessionCookie();
		const kept = readKept();
		if (kept) {
			this.format = kept.format;
			if (this.signedIn) this.#show(kept.league, kept.leagues, kept.format);
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
		this.ready = true;
		this.#keep();
	}

	/** Makes a choice the context at once, then on the account. A choice the account refuses puts
	 * the last context back and says so. */
	async choose(choice: Choice): Promise<void> {
		this.open = false;
		this.problem = null;
		const before = { league: this.league, format: this.format };
		if ('league' in choice) {
			const league = this.leagues.find((candidate) => candidate.id === choice.league);
			if (!league) return;
			this.#show(league, this.leagues, league.format);
		} else {
			this.#show(null, this.leagues, choice.format);
		}
		this.#keep();
		if (!this.signedIn) return;
		const body = 'league' in choice ? { league_id: choice.league } : { format: choice.format };
		try {
			this.#take(await client.call<Account>('/me/league', { method: 'PUT', body }));
		} catch {
			this.#show(before.league, this.leagues, before.format);
			this.problem = 'Your league could not be switched just now. Try again in a moment.';
		}
		this.#keep();
	}

	/** A page that marks held players asks for the selected league's rosters: read once a session
	 * per league, never per page. */
	wantHeld(): void {
		this.#heldWanted = true;
		void this.#readHeld();
	}

	/** A read of the league that a page already made (the league page), so the rosters come from it. */
	takeHeld(id: string, sync: Pick<LeagueSync, 'me' | 'teams' | 'held_by'>): void {
		if (this.league?.id !== id) return;
		this.#heldFor = id;
		this.#heldAt = Date.now();
		this.held = heldOf(sync);
		this.#keep();
	}

	#show(
		league: ContextLeague | null,
		leagues: readonly ContextLeague[],
		format: BoardFormat | null
	): void {
		this.league = league;
		this.leagues = leagues;
		this.format = league ? league.format : format;
		if (this.#heldFor !== league?.id) {
			this.held = null;
			this.#heldFor = null;
		}
		if (this.#heldWanted) void this.#readHeld();
	}

	#take(me: Account): void {
		this.features = me.features;
		// An API from before the context answers neither; read it as no league.
		const leagues = Array.isArray(me.leagues) ? me.leagues : [];
		this.#show(me.league ?? null, leagues, me.format ?? null);
	}

	async #readHeld(): Promise<void> {
		const league = this.league;
		if (!league || !this.signedIn || this.#heldFor === league.id) return;
		this.#heldFor = league.id;
		const kept = readKept()?.held;
		if (kept?.id === league.id && Date.now() - kept.at < HELD_FRESH_MS) {
			this.#heldAt = kept.at;
			this.held = kept.held;
			return;
		}
		try {
			const sync = await client.call<LeagueSync>(
				`/leagues/attached/${encodeURIComponent(league.id)}/sync`
			);
			this.takeHeld(league.id, sync);
		} catch {
			// No marks is the floor: the page reads the same without them, and the next page tries again.
			this.#heldFor = null;
		}
	}

	#keep(): void {
		const lines = this.signedIn ? linesFor(this.league) : 0;
		const held =
			this.held && this.#heldFor ? { id: this.#heldFor, at: this.#heldAt, held: this.held } : null;
		const kept: Kept = { league: this.league, leagues: this.leagues, format: this.format, held };
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
