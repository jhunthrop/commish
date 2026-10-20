/** The record page's reads for a selected league (Lane 93): the league's record from the API, and
 * the run's graded players from the static file the build wrote. Either failing leaves the run's own
 * record on the page: these add to it, never stand in for it. */
import { PUBLIC_API_URL } from '$app/env/public';
import { resolve } from '$app/paths';
import { apiClient } from '#lib/api/client.ts';
import { placedPlayerSchema } from '#lib/run/schema.ts';
import type { LeagueRecord, PlayersByWeek } from '#lib/run/record-league.ts';
import { z } from 'zod';

const client = apiClient(PUBLIC_API_URL);

const playersFile = z.record(z.string(), z.array(placedPlayerSchema));

/** The league's record, null when the API cannot answer it (an older API has no such route). */
export async function readLeagueRecord(league: string): Promise<LeagueRecord | null> {
	try {
		return await client.call<LeagueRecord>(
			`/leagues/attached/${encodeURIComponent(league)}/record`
		);
	} catch {
		return null;
	}
}

/** Each graded week's players, empty when the file is missing or does not parse. */
export async function readRecordPlayers(): Promise<PlayersByWeek> {
	try {
		const response = await fetch(resolve('/data/record-players.json'));
		if (!response.ok) return {};
		const parsed = playersFile.safeParse(await response.json());
		if (!parsed.success) return {};
		return Object.fromEntries(
			Object.entries(parsed.data).map(([week, rows]) => [Number(week), rows])
		);
	} catch {
		return {};
	}
}
