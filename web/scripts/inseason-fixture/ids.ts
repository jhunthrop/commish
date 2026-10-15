/** The fixture's attachment ids, shared by the build, the stand-in API and the shots. */
export const FIXTURE_IDS = {
	/** The recorded Sleeper league, answering every route. */
	league: '6f1d1c52-2626-4a26-9a26-000000000026',
	/** The same league out of season: the in-season routes answer 409. */
	outOfSeason: '6f1d1c52-2626-4a26-9a26-000000000027',
	/** The same league held, so a page shows its loading rows. */
	slow: '6f1d1c52-2626-4a26-9a26-000000000028',
	/** The same league whose last read lacks the drafter's team: the in-season routes answer 404. */
	noTeam: '6f1d1c52-2626-4a26-9a26-000000000029'
} as const;
