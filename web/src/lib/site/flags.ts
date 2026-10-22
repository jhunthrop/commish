/** The site's feature flags, one constant each: a ruling is one flip here. */
export type Flag = 'in_season_tools';

export const FLAGS: Readonly<Record<Flag, boolean>> = {
	/** The in-season screens under a followed league (start and sit, waivers, trades) and the tabs
	 * that reach them. On for every follower this season; behind a paid tier only once tiers return
	 * (spec 2026-10-15-in-season-tools-design §10.3). */
	in_season_tools: true
};
