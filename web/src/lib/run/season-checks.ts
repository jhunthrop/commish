/**
 * The rules across a run's season blocks that no one file can check: every block in one format
 * through one week (the league board prints one basis for all), and every week still to play on a
 * player's club slate with a kickoff (his page prints its day). The stand-in's writer and the build's
 * reader (server/run.ts) both run them, so a run that breaks one fails before any page renders.
 * A bye in a log is a week his club's slate has no game (Lane 119), the only place the run can say it.
 * A page that says his newest line was another club's names that club and a week of its game in his log
 * (Lanes 120, 135).
 *
 * Each rule names the page that breaks it (Lane 136): the nightly holds a refused page back and
 * publishes the rest when few enough are refused, so a rule says which page, never only that the run
 * is wrong. The one basis is the one most blocks share, so the odd page is the one named.
 */
import { FREE_AGENT_WORDS, isFreeAgent } from '#lib/format/free-agent.ts';
import { rowGame } from './row-game.ts';
import type { PlayerSeason } from './season.ts';
import type { Schedule, Slate } from './schema.ts';

/** What the checks read of a player file. */
export interface SeasonedPlayer {
	id: string;
	team: string;
	season: PlayerSeason;
	lastGameClub?: { club: string; week: number; specialTeams?: true } | null;
}

type Slates = ReadonlyMap<string, Slate>;
/** One rule over one page: what it says is wrong, or null. */
type PageRule = (p: SeasonedPlayer, slates: Slates) => string | null;

interface Basis {
	format: string;
	through: number;
}

/** The format and through week most blocks share; on a tie, the first page's. */
function sharedBasis(players: readonly SeasonedPlayer[]): Basis | null {
	const counts = new Map<string, { basis: Basis; count: number }>();
	for (const { season } of players) {
		const key = `${season.format}:${String(season.through)}`;
		counts.set(key, {
			basis: { format: season.format, through: season.through },
			count: (counts.get(key)?.count ?? 0) + 1
		});
	}
	let best: { basis: Basis; count: number } | null = null;
	for (const entry of counts.values()) if (best === null || entry.count > best.count) best = entry;
	return best?.basis ?? null;
}

/** Every season block shares one format and one through week. */
function basisRefusal(p: SeasonedPlayer, basis: Basis): string | null {
	if (p.season.format === basis.format && p.season.through === basis.through) return null;
	return `Season blocks disagree: ${basis.format} through week ${String(basis.through)}, but players/${p.id}.json is ${p.season.format} through week ${String(p.season.through)}.`;
}

/** A free agent (Lane 123) has no club, so no slate: no week of his is still to play and none is a bye.
 * A week he played keeps the club his line was for. */
function freeAgentRefusal(p: SeasonedPlayer): string | null {
	const wrong = p.season.log.find((row) => row.status === 'upcoming' || row.status === 'bye');
	if (!wrong) return null;
	return `players/${p.id}.json is ${FREE_AGENT_WORDS}, but his week ${String(wrong.week)} is ${wrong.status === 'bye' ? 'a bye' : 'still to play'}.`;
}

/** Every upcoming week is a game on a club's slate, so it has a kickoff: his club's, or, a mover's week
 * under the club his line was for, that club's game (run/row-game.ts, Lane 136). A week that is no
 * club's game is refused, and so is a row naming an opponent no club plays that week while his club
 * plays (a false row, Lane 138). */
const kickoffRefusal: PageRule = (p, slates) => {
	if (isFreeAgent(p.team)) return freeAgentRefusal(p);
	if (!slates.has(p.team)) return `players/${p.id}.json's club ${p.team} has no slate.`;
	const missing = p.season.log.find(
		(row) => row.status === 'upcoming' && rowGame(slates, p.team, row) === null
	);
	if (!missing) return null;
	const week = String(missing.week);
	const own = slates.get(p.team)?.games.some((game) => game.week === missing.week) ?? false;
	if (own && missing.opponent !== null)
		return `players/${p.id}.json has week ${week} to play ${missing.home === true ? 'vs' : 'at'} ${missing.opponent}, but no club plays that game that week.`;
	return `players/${p.id}.json has week ${week} to play, but ${p.team}'s slate has no game, so no kickoff, that week.`;
};

/** Every bye is a week his club does not play. A week it does not play may also be a game he played
 * for the club he was with, so the log need not carry the bye (season.ts allows at most one). */
const byeRefusal: PageRule = (p, slates) => {
	const weeks = new Set(slates.get(p.team)?.games.map((game) => game.week));
	const wrong = p.season.log.find((row) => row.status === 'bye' && weeks.has(row.week));
	if (!wrong) return null;
	return `players/${p.id}.json has a bye in week ${String(wrong.week)}, but ${p.team} plays that week.`;
};

/** A page that says his newest line was another club's (Lane 120) names a club other than his own and
 * a week his log shows as that club's game. His line that week may carry no stat and no offensive snap
 * (a special-teams game), so the week reads inactive, but it names that club's opponent (Lane 135). A week
 * the writer says was special teams alone reads inactive (Lane 144). */
const lastGameClubRefusal: PageRule = (p, slates) => {
	const last = p.lastGameClub;
	if (!last) return null;
	const game = slates.get(last.club)?.games.find((g) => g.week === last.week);
	const row = p.season.log.find((r) => r.week === last.week);
	const theirs =
		game !== undefined &&
		row !== undefined &&
		row.status !== 'bye' &&
		row.opponent === game.opponent &&
		row.home === game.home;
	if (last.club === p.team || !theirs)
		return `players/${p.id}.json says his week ${String(last.week)} line was for ${last.club}, but ${last.club === p.team ? 'that is his club' : `his log has no ${last.club} game that week`}.`;
	if (last.specialTeams === true && row.status !== 'inactive')
		return `players/${p.id}.json says his week ${String(last.week)} snaps were on special teams, but his log reads that week ${row.status}.`;
	return null;
};

const PAGE_RULES: readonly PageRule[] = [kickoffRefusal, byeRefusal, lastGameClubRefusal];

/** Each page the rules refuse, by id, with the first rule it breaks, in the players' order. `basis:
 * false` leaves the one basis out: a held page's copy is an earlier run's, through an earlier week. */
export function seasonRefusals(
	players: readonly SeasonedPlayer[],
	schedule: Schedule,
	options: { basis: boolean } = { basis: true }
): Map<string, string> {
	const slates = new Map(schedule.slates.map((slate) => [slate.abbr, slate] as const));
	const basis = options.basis ? sharedBasis(players) : null;
	const refusals = new Map<string, string>();
	for (const p of players) {
		const refusal =
			(basis === null ? null : basisRefusal(p, basis)) ??
			PAGE_RULES.reduce<string | null>((found, rule) => found ?? rule(p, slates), null);
		if (refusal !== null) refusals.set(p.id, refusal);
	}
	return refusals;
}

/** Every rule over every page, the first refusal thrown: the stand-in's writer, which holds nothing. */
export function checkRunSeasons(players: readonly SeasonedPlayer[], schedule: Schedule): void {
	const [first] = seasonRefusals(players, schedule).values();
	if (first !== undefined) throw new Error(first);
}
