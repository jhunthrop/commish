/** A saved league with its own scoring rules, drafted by an account without the Draft Pass's exact
 * rules: the preset the rules score most like, and the line that says so. The rule matches the API's
 * (api/internal/leaguesync/rules.go NearestPreset): by reception points, TE premium when a tight end's
 * catch counts more. A league attached from another host saves ScoringRules' names; an older custom
 * league may carry Sleeper's. */
import type { LeagueSettings } from '../api.ts';
import { SCORING_CHOICES } from './setup.ts';

type Preset = (typeof SCORING_CHOICES)[number]['preset'];

const PPR_FROM = 0.75;
const HALF_FROM = 0.25;

function figure(rules: Readonly<Record<string, number>>, ...keys: readonly string[]): number {
	for (const key of keys) {
		const value = rules[key];
		if (value !== undefined) return value;
	}
	return 0;
}

/** The preset a league's own rules score most like. */
export function nearestPreset(rules: Readonly<Record<string, number>>): Preset {
	const reception = figure(rules, 'points_per_reception', 'rec');
	const teBonus = figure(rules, 'te_reception_bonus', 'bonus_rec_te');
	if (reception >= PPR_FROM) return teBonus > 0 ? 'te_premium' : 'ppr';
	if (reception >= HALF_FROM) return 'half_ppr';
	return 'standard';
}

/** A preset as a sentence names it. */
export function presetWords(preset: Preset): string {
	return SCORING_CHOICES.find((choice) => choice.preset === preset)?.label ?? 'PPR';
}

export interface Rerun {
	settings: LeagueSettings;
	/** Said beside the league when its own rules are not what the mock drafts on, null otherwise. */
	line: string | null;
}

/** The league as this account's mock drafts it: its own rules with the Draft Pass, the nearest
 * preset without. */
export function rerunOf(settings: LeagueSettings, exactRules: boolean): Rerun {
	const custom = settings.scoring.custom;
	if (exactRules || !custom) return { settings, line: null };
	const preset = nearestPreset(custom);
	return {
		settings: { ...settings, scoring: { preset, custom: null } },
		line: `Your league scores like ${presetWords(preset)}, the exact rules come with the Draft Pass`
	};
}
