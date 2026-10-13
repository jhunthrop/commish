/**
 * The rules across a run's season blocks that no one file can check: every block in one format
 * through one week (the league board prints one basis for all), and every week still to play on a
 * player's club slate with a kickoff (his page prints its day). The stand-in's writer and the build's
 * reader (server/run.ts) both run them, so a run that breaks one fails before any page renders.
 */
import type { PlayerSeason } from './season.ts';
import type { Schedule } from './schema.ts';

/** What the checks read of a player file. */
export interface SeasonedPlayer {
	id: string;
	team: string;
	season: PlayerSeason;
}

/** Every season block shares one format and one through week. */
function checkOneBasis(players: readonly SeasonedPlayer[]): void {
	const [first] = players;
	if (!first) return;
	const odd = players.find(
		(p) => p.season.format !== first.season.format || p.season.through !== first.season.through
	);
	if (odd) {
		throw new Error(
			`Season blocks disagree: ${first.season.format} through week ${String(first.season.through)}, but players/${odd.id}.json is ${odd.season.format} through week ${String(odd.season.through)}.`
		);
	}
}

/** Every upcoming week is a game on his club's slate, so it has a kickoff. */
function checkKickoffs(players: readonly SeasonedPlayer[], schedule: Schedule): void {
	const slates = new Map(schedule.slates.map((slate) => [slate.abbr, slate] as const));
	for (const p of players) {
		const slate = slates.get(p.team);
		if (!slate) throw new Error(`players/${p.id}.json's club ${p.team} has no slate.`);
		const weeks = new Set(slate.games.map((game) => game.week));
		const missing = p.season.log.find((row) => row.status === 'upcoming' && !weeks.has(row.week));
		if (missing) {
			throw new Error(
				`players/${p.id}.json has week ${String(missing.week)} to play, but ${p.team}'s slate has no game, so no kickoff, that week.`
			);
		}
	}
}

export function checkRunSeasons(players: readonly SeasonedPlayer[], schedule: Schedule): void {
	checkOneBasis(players);
	checkKickoffs(players, schedule);
}
