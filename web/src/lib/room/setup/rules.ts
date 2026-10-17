/** A league's own scoring on the setup page: the 21 rules the contract names (ScoringRules), grouped
 * the way a league's settings page groups them, each preset's figures to start from, and the words
 * for what an import brought in. The figures match api/internal/scoring and
 * research/model/domain.py. */
import type { components } from '#lib/api/types.ts';
import type { LeagueSettings } from '../api.ts';

export type ScoringRules = components['schemas']['ScoringRules'];
export type ScoringImport = components['schemas']['ScoringImport'];
export type ImportHost = components['schemas']['ScoringImportInput']['host'];
export type RuleKey = keyof ScoringRules;
type Preset = NonNullable<LeagueSettings['scoring']['preset']>;

/** A group of the form: `boardless` for the kicking and defense rules, which move nothing on the
 * board (kickers and defenses rank in draft order) and are kept for the league's record. */
export interface RuleGroup {
	label: string;
	boardless?: boolean;
	rules: readonly RuleField[];
}

export interface RuleField {
	key: RuleKey;
	label: string;
	step: number;
}

const YARD_STEP = 0.01;
const POINT_STEP = 0.5;

/** The form's groups, in a league settings page's order. */
export const RULE_GROUPS: readonly RuleGroup[] = [
	{
		label: 'Passing',
		rules: [
			{ key: 'points_per_passing_yard', label: 'Each passing yard', step: YARD_STEP },
			{ key: 'points_per_passing_touchdown', label: 'Passing touchdown', step: POINT_STEP },
			{ key: 'points_per_interception', label: 'Interception thrown', step: POINT_STEP }
		]
	},
	{
		label: 'Rushing and receiving',
		rules: [
			{ key: 'points_per_rushing_yard', label: 'Each rushing yard', step: YARD_STEP },
			{ key: 'points_per_rushing_touchdown', label: 'Rushing touchdown', step: POINT_STEP },
			{ key: 'points_per_receiving_yard', label: 'Each receiving yard', step: YARD_STEP },
			{ key: 'points_per_receiving_touchdown', label: 'Receiving touchdown', step: POINT_STEP },
			{ key: 'points_per_reception', label: 'Each catch', step: POINT_STEP },
			{ key: 'te_reception_bonus', label: 'Extra for a tight end catch', step: POINT_STEP }
		]
	},
	{
		label: 'Everyone',
		rules: [
			{ key: 'points_per_fumble_lost', label: 'Fumble lost', step: POINT_STEP },
			{ key: 'points_per_two_point_conversion', label: 'Two-point conversion', step: POINT_STEP },
			{
				key: 'points_per_return_touchdown',
				label: 'Kick or punt return touchdown',
				step: POINT_STEP
			}
		]
	},
	{
		label: 'Kicking',
		boardless: true,
		rules: [
			{ key: 'points_per_field_goal', label: 'Field goal made', step: POINT_STEP },
			{ key: 'points_per_field_goal_missed', label: 'Field goal missed', step: POINT_STEP },
			{ key: 'points_per_extra_point', label: 'Extra point made', step: POINT_STEP },
			{ key: 'points_per_extra_point_missed', label: 'Extra point missed', step: POINT_STEP }
		]
	},
	{
		label: 'Defense',
		boardless: true,
		rules: [
			{ key: 'points_per_sack', label: 'Sack', step: POINT_STEP },
			{ key: 'points_per_defensive_interception', label: 'Interception', step: POINT_STEP },
			{ key: 'points_per_defensive_fumble_recovery', label: 'Fumble recovery', step: POINT_STEP },
			{ key: 'points_per_defensive_touchdown', label: 'Touchdown', step: POINT_STEP },
			{ key: 'points_per_safety', label: 'Safety', step: POINT_STEP }
		]
	}
];

/** STANDARD_SCORING's figures, then the longer field goals and the defense's tiers at the API's
 * standard figures (api/internal/scoring). */
const STANDARD: Readonly<ScoringRules> = {
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
	points_per_safety: 2,
	points_per_field_goal_40_49: 3,
	points_per_field_goal_50_plus: 3,
	points_allowed_0: 5,
	points_allowed_1_6: 4,
	points_allowed_7_13: 3,
	points_allowed_14_17: 1,
	points_allowed_18_20: 0,
	points_allowed_21: 0,
	points_allowed_22_27: 0,
	points_allowed_28_34: -1,
	points_allowed_35_45: -3,
	points_allowed_46_plus: -5,
	yards_allowed_0_99: 5,
	yards_allowed_100_199: 3,
	yards_allowed_200_299: 2,
	yards_allowed_300_349: 0,
	yards_allowed_350_399: -1,
	yards_allowed_400_449: -3,
	yards_allowed_450_499: -5,
	yards_allowed_500_549: -6,
	yards_allowed_550_plus: -7
};

/** What each preset changes from standard: reception points, and a tight end's extra. */
const PRESET_CHANGES: Readonly<Record<Preset, Partial<ScoringRules>>> = {
	standard: {},
	half_ppr: { points_per_reception: 0.5 },
	ppr: { points_per_reception: 1 },
	te_premium: { points_per_reception: 1, te_reception_bonus: 0.5 }
};

/** A preset's figures as rules: where a league's own scoring starts from. */
export function rulesFrom(preset: Preset | null): ScoringRules {
	return { ...STANDARD, ...(preset ? PRESET_CHANGES[preset] : {}) };
}

/** The hosts an import reads, by name as the mechanism. Yahoo is entered by hand. */
export const IMPORT_HOSTS: readonly { host: ImportHost; label: string; hint: string }[] = [
	{ host: 'sleeper', label: 'Sleeper', hint: 'sleeper.com/leagues/...' },
	{ host: 'espn', label: 'ESPN', hint: 'fantasy.espn.com/football/league?leagueId=...' },
	{ host: 'mfl', label: 'MyFantasyLeague', hint: 'myfantasyleague.com/2026/home/...' }
];

/** The host a pasted link names, by its address, or null for a bare league id (the chip then says
 * which host it is). The API reads the id out of the link itself. */
export function hostOfLink(link: string): ImportHost | null {
	const text = link.trim();
	if (!URL.canParse(text)) return null;
	const host = new URL(text).hostname.toLowerCase();
	const on = (domain: string): boolean => host === domain || host.endsWith(`.${domain}`);
	if (on('sleeper.com') || on('sleeper.app')) return 'sleeper';
	if (on('espn.com')) return 'espn';
	if (on('myfantasyleague.com')) return 'mfl';
	return null;
}

const LABELS: ReadonlyMap<string, string> = new Map(
	RULE_GROUPS.flatMap((g) => g.rules.map((r) => [r.key, r.label] as const))
);

/** "Field goal missed" for points_per_field_goal_missed, from the API's "key figure" words. */
export function ruleLabel(defaulted: string): string {
	const key = defaulted.split(' ')[0] ?? defaulted;
	return LABELS.get(key) ?? key;
}

export type DroppedRule = components['schemas']['DroppedRule'];

const GROUP_WORDS: Readonly<Record<DroppedRule['group'], string>> = {
	offense: 'Offense',
	bonus: 'Bonuses',
	kicking: 'Kicking',
	defense: 'Defense',
	other: 'Other'
};

/** The left-out rules by group, in the API's order, each group named once. */
export function droppedGroups(
	rules: readonly DroppedRule[]
): { label: string; rules: DroppedRule[] }[] {
	const out: { label: string; rules: DroppedRule[] }[] = [];
	for (const rule of rules) {
		const label = GROUP_WORDS[rule.group];
		const last = out.at(-1);
		if (last?.label === label) last.rules.push(rule);
		else out.push({ label, rules: [rule] });
	}
	return out;
}

/** "+10 points", "-4 points", "1 point". */
export function pointsWords(points: number): string {
	const sign = points > 0 ? '+' : '';
	return `${sign}${String(points)} ${Math.abs(points) === 1 ? 'point' : 'points'}`;
}

/** The line that says what an import brought in, with its count's basis. */
export function importLine(result: ScoringImport): string {
	const n = result.applied.length;
	return `${n} of the 21 rules we score came from your league.`;
}
