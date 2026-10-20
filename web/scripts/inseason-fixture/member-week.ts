// The fixture's GET /me/week (Lane 66k), a stand-in for the API's: each league's bug, lineup summary
// and roster chips made by the rules the API's Go makes them by (api/internal/inseason/week.go), so
// the front door is drawn from the API's shape. The recorded Sleeper league is real as the record
// holds it. The ESPN stand-in is the recorded league answered as ESPN's, its Sunday points made up
// (scoreboard-live.json). The league whose read failed and the league out of season are stand-ins.
import type { components } from '../../src/lib/api/types.ts';
import type { LeagueSync } from '../../src/lib/league/api.ts';
import type { LineupAdvice, Scoreboard, WaiverAdvice } from '../../src/lib/league/inseason/api.ts';
import { roundTenth } from './tenths.ts';

type Schemas = components['schemas'];
type WeekLeague = Schemas['WeekLeague'];
type PlayerLine = Schemas['PlayerLine'];
type LineupSlot = Schemas['LineupSlot'];

const tenth = roundTenth;

/** The slot's player as the platform holds it. */
function asSet(slot: LineupSlot): PlayerLine | null {
	return slot.changed ? slot.host : slot.ours;
}

/** Each line's Proj as printed, summed; null when none has one. */
function printedSum(lines: readonly (PlayerLine | null)[]): number | null {
	const held = lines.flatMap((l) => (l?.week_projection == null ? [] : [tenth(l.week_projection)]));
	return held.length === 0 ? null : tenth(held.reduce((a, b) => a + b, 0));
}

function summary(lineup: LineupAdvice): Schemas['WeekLineup'] {
	const counted = lineup.slots.filter((s) => !s.no_one_can_play);
	const projection = printedSum(counted.map((s) => s.ours));
	const set = printedSum(counted.map(asSet));
	const swaps = lineup.slots
		.filter((s) => s.changed)
		.map((s) => ({ slot: s.slot, in: s.ours.player, out: s.host?.player ?? null }));
	return {
		changes: swaps.length,
		projection,
		as_set: set,
		gain: projection === null || set === null ? null : tenth(projection - set),
		swaps,
		// The Lineup's own sentence once the week is over (inseason week.go lineupSummary).
		week_done: lineup.week_done ?? null
	};
}

function chips(lineup: LineupAdvice, waivers: WaiverAdvice): Schemas['RosterChip'][] {
	const starters = lineup.slots.map((s) => ({ slot: s, line: asSet(s) }));
	const listed = starters
		.flatMap(({ line }) => (line?.facts.designation ? [line] : []))
		.sort((a, b) =>
			(b.facts.designation?.as_of ?? '').localeCompare(a.facts.designation?.as_of ?? '')
		)[0];
	const byes = starters.filter(({ line }) => line?.facts.bye);
	const idle = byes.find(({ slot }) => slot.no_one_can_play) ?? null;
	const pickup = waivers.pickups[0];
	const out: Schemas['RosterChip'][] = [];
	if (listed) out.push({ kind: 'status', line: listed, gain: null, idle: false });
	// Only a bye no one on the roster can play: any other is the strip's swap (review M3).
	if (idle?.line) out.push({ kind: 'bye', line: idle.line, gain: null, idle: true });
	if (pickup) out.push({ kind: 'pickup', line: pickup.add, gain: pickup.week_gain, idle: false });
	return out;
}

/** The starters as set whose kickoff is the earliest of theirs still to come. */
function firstToPlay(lineup: LineupAdvice, now: number): PlayerLine[] {
	const ahead = lineup.slots
		.flatMap((s) => {
			const line = asSet(s);
			const at = line?.facts.kickoff;
			return line && !line.facts.bye && !line.facts.played && at && Date.parse(at) > now
				? [{ line, at: Date.parse(at) }]
				: [];
		})
		.sort((a, b) => a.at - b.at);
	const first = ahead[0]?.at;
	return ahead.filter((a) => a.at === first).map((a) => a.line);
}

export interface WeekReads {
	sync: LeagueSync;
	lineup: LineupAdvice;
	waivers: WaiverAdvice;
	scoreboard: Scoreboard;
	readAt: string;
	/** The week the roster facts turn to once the lineup has played its week (Lane 95, week.go
	 * acts), with the lineup for it; absent while they are the league's week. */
	turned?: { week: number; lineup: LineupAdvice };
}

/** One league in season, its week from the reads. */
export function inSeason(id: string, reads: WeekReads, now: number): WeekLeague {
	const { sync, lineup, waivers, scoreboard } = reads;
	const me = sync.teams.find((t) => t.roster_id === sync.me);
	const game = scoreboard.games[0];
	const teams = game
		? game.sides.flatMap((s) => sync.teams.filter((t) => t.roster_id === s.roster_id))
		: [];
	return {
		id,
		name: sync.name,
		host: sync.host,
		team_name: me?.name ?? '',
		standing: me
			? {
					wins: me.wins,
					losses: me.losses,
					ties: me.ties,
					place: sync.teams.indexOf(me) + 1,
					teams: sync.teams.length
				}
			: null,
		phase: 'in_season',
		week: scoreboard.week,
		read_at: reads.readAt,
		projection_read_at: scoreboard.projection_read_at,
		projection_scoring: scoreboard.projection_scoring,
		bug: game ? { game, teams, first: firstToPlay(lineup, now) } : null,
		lineup: summary(lineup),
		chips_week: reads.turned?.week ?? scoreboard.week,
		chips: chips(reads.turned?.lineup ?? lineup, waivers),
		problem: null
	};
}

/** A league with no week: its row alone, or with the sentence why its read stopped. */
export function noWeek(
	id: string,
	base: Pick<WeekLeague, 'name' | 'host' | 'team_name' | 'standing' | 'phase'>,
	problem: string | null,
	readAt: string | null = null
): WeekLeague {
	return {
		...base,
		id,
		week: 0,
		read_at: readAt,
		projection_read_at: null,
		projection_scoring: null,
		bug: null,
		lineup: null,
		chips: [],
		problem
	};
}
