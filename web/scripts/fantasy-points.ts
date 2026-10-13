// FANTASY POINTS, ported for the stand-in from research/model/domain.py (`compute_fantasy_points`
// and the three scoring presets), which is itself the port of research-ts's `computeFantasyPoints`.
// The terms are added in the same order, left to right, because a sum of floats is only
// reproducible in the order it was written, and the rounding is the same `Math.round(n * 100) / 100`.
// The nightly scores with the research code itself; this copy dies with the stand-in.
import type { Position } from '../src/lib/types/player.ts';

/** A stat line in the store's names. The first fourteen are always present, the rest optional. */
export interface PointsLine {
	passing_yards: number;
	passing_touchdowns: number;
	interceptions: number;
	rushing_yards: number;
	rushing_touchdowns: number;
	receiving_yards: number;
	receiving_touchdowns: number;
	receptions: number;
	fumbles_lost: number;
	field_goals_made: number;
	extra_points_made: number;
	sacks: number;
	defensive_interceptions: number;
	defensive_touchdowns: number;
	two_point_conversions?: number;
	field_goals_missed?: number;
	extra_points_missed?: number;
	kick_return_touchdowns?: number;
	punt_return_touchdowns?: number;
	defensive_fumbles_recovered?: number;
	safeties?: number;
	points_allowed?: number;
	yards_allowed?: number;
}

interface ScoringRules {
	points_per_passing_yard: number;
	points_per_passing_touchdown: number;
	points_per_interception: number;
	points_per_rushing_yard: number;
	points_per_rushing_touchdown: number;
	points_per_receiving_yard: number;
	points_per_receiving_touchdown: number;
	points_per_reception: number;
	points_per_fumble_lost: number;
	te_reception_bonus: number;
	points_per_field_goal: number;
	points_per_extra_point: number;
	points_per_sack: number;
	points_per_defensive_interception: number;
	points_per_defensive_touchdown: number;
	points_per_two_point_conversion: number;
	points_per_field_goal_missed: number;
	points_per_extra_point_missed: number;
	points_per_return_touchdown: number;
	points_per_defensive_fumble_recovery: number;
	points_per_safety: number;
}

const STANDARD_SCORING: ScoringRules = {
	points_per_passing_yard: 0.04,
	points_per_passing_touchdown: 4,
	points_per_interception: -2,
	points_per_rushing_yard: 0.1,
	points_per_rushing_touchdown: 6,
	points_per_receiving_yard: 0.1,
	points_per_receiving_touchdown: 6,
	points_per_reception: 0,
	points_per_fumble_lost: -2,
	te_reception_bonus: 0,
	points_per_field_goal: 3,
	points_per_extra_point: 1,
	points_per_sack: 1,
	points_per_defensive_interception: 2,
	points_per_defensive_touchdown: 6,
	points_per_two_point_conversion: 2,
	points_per_field_goal_missed: -1,
	points_per_extra_point_missed: 0,
	points_per_return_touchdown: 6,
	points_per_defensive_fumble_recovery: 2,
	points_per_safety: 2
};

/** domain.py's SCORING_PRESETS, keyed as a run's format id names them before its league size. */
const SCORING_PRESETS: Readonly<Record<string, ScoringRules>> = {
	standard: STANDARD_SCORING,
	ppr: { ...STANDARD_SCORING, points_per_reception: 1 },
	'half-ppr': { ...STANDARD_SCORING, points_per_reception: 0.5 }
};

/** The product's defense, domain.py's "DEF". */
const DEFENSE: Position = 'DST';

type Tiers = readonly (readonly [number, number])[];
const POINTS_ALLOWED_TIERS: Tiers = [
	[0, 5],
	[6, 4],
	[13, 3],
	[17, 1],
	[27, 0],
	[34, -1],
	[45, -3],
	[Infinity, -5]
];
const YARDS_ALLOWED_TIERS: Tiers = [
	[99, 5],
	[199, 3],
	[299, 2],
	[349, 0],
	[399, -1],
	[449, -3],
	[499, -5],
	[549, -6],
	[Infinity, -7]
];

/** "ppr-12" scores with the PPR preset. A format with no preset stops the stand-in. */
export function rulesFor(formatId: string): ScoringRules {
	const preset = SCORING_PRESETS[formatId.replace(/-\d+$/, '')];
	if (!preset) throw new Error(`No scoring preset for the format ${formatId}.`);
	return preset;
}

function tierPoints(value: number, tiers: Tiers): number {
	for (const [ceiling, points] of tiers) if (value <= ceiling) return points;
	return 0;
}

function roundPoints(n: number): number {
	return Math.round(n * 100) / 100;
}

function defenseTierPoints(line: PointsLine, position: Position): number {
	if (position !== DEFENSE) return 0;
	const allowed =
		line.points_allowed === undefined ? 0 : tierPoints(line.points_allowed, POINTS_ALLOWED_TIERS);
	const yards =
		line.yards_allowed === undefined ? 0 : tierPoints(line.yards_allowed, YARDS_ALLOWED_TIERS);
	return allowed + yards;
}

/** `compute_fantasy_points`, term for term in its order. */
export function computeFantasyPoints(
	line: PointsLine,
	position: Position,
	rules: ScoringRules
): number {
	const receptionPoints =
		line.receptions *
		(rules.points_per_reception + (position === 'TE' ? rules.te_reception_bonus : 0));
	let total = line.passing_yards * rules.points_per_passing_yard;
	total += line.passing_touchdowns * rules.points_per_passing_touchdown;
	total += line.interceptions * rules.points_per_interception;
	total += line.rushing_yards * rules.points_per_rushing_yard;
	total += line.rushing_touchdowns * rules.points_per_rushing_touchdown;
	total += line.receiving_yards * rules.points_per_receiving_yard;
	total += line.receiving_touchdowns * rules.points_per_receiving_touchdown;
	total += receptionPoints;
	total += line.fumbles_lost * rules.points_per_fumble_lost;
	total += line.field_goals_made * rules.points_per_field_goal;
	total += line.extra_points_made * rules.points_per_extra_point;
	total += line.sacks * rules.points_per_sack;
	total += line.defensive_interceptions * rules.points_per_defensive_interception;
	total += line.defensive_touchdowns * rules.points_per_defensive_touchdown;
	total += (line.two_point_conversions ?? 0) * rules.points_per_two_point_conversion;
	total += (line.field_goals_missed ?? 0) * rules.points_per_field_goal_missed;
	total += (line.extra_points_missed ?? 0) * rules.points_per_extra_point_missed;
	total +=
		((line.kick_return_touchdowns ?? 0) + (line.punt_return_touchdowns ?? 0)) *
		rules.points_per_return_touchdown;
	total += (line.defensive_fumbles_recovered ?? 0) * rules.points_per_defensive_fumble_recovery;
	total += (line.safeties ?? 0) * rules.points_per_safety;
	total += defenseTierPoints(line, position);
	return roundPoints(total);
}
