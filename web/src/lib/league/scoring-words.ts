/** The scoring a league states that mock drafts do not use, in a drafter's words. The API names each
 * dropped rule by the host's own key and figure ("fgm_0_19 3") or rule ("FG 31-99 *.1 (PK)"); a page
 * says what kind of rule it is, once, in plain words. */

/** Sleeper's key prefixes and MyFantasyLeague's event codes, by the words a page uses. First match
 * wins, so a longer prefix comes before a shorter one. */
const KINDS: readonly (readonly [RegExp, string])[] = [
	[/^fgmiss/, 'missed field goals by distance'],
	[/^fgm_|^FG$/, 'field goals by distance'],
	[/^MG$/, 'missed field goals'],
	[/^pts_allow|^(TPA|PA|STPA\+OPA|OPA\+STPA|OPA|STPA)$/, 'points allowed'],
	[/^yds_allow/, 'yards allowed'],
	[/^bonus_|^(PY|RY|CY)$/, 'yardage bonuses'],
	[/^(def_st_|st_)|^FLS$/, 'special teams scoring'],
	[/^idp_/, 'defensive players'],
	[/_2pt$|^(P2|R2|C2|D2)$/, 'two-point plays'],
	[/^(fum_rec_td|#FR|#FT)$/, 'fumble return touchdowns'],
	[/^(ff|blk_kick)$/, 'forced fumbles and blocked kicks'],
	[/^(kr_|pr_)/, 'kick and punt returns'],
	[/^fum/, 'fumbles']
];

function kindOf(rule: string): string {
	const [head = ''] = rule.split(' ');
	const kind = KINDS.find(([pattern]) => pattern.test(head));
	return kind ? kind[1] : 'other scoring rules';
}

/** Each kind of dropped rule once, in the order first met. */
export function droppedKinds(dropped: readonly string[]): string[] {
	return [...new Set(dropped.map(kindOf))];
}
