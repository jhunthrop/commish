/** A member's league on a host as its chip says it, so two alike names part. */
import { plural } from '#lib/format/number.ts';
import type { HostLeague } from './api.ts';

/** FFPC writes a record "2 - 3": the page writes it "2-3". */
export function recordWords(record: string): string {
	return record.replace(/\s*-\s*/g, '-');
}

/** What parts two leagues of one name: the member's record where the host's list carries it (FFPC),
 * else the league's size (Yahoo), and whether the public reads it where that was checked (ESPN). */
function aside(league: HostLeague): string | null {
	const parts: string[] = [];
	if (league.record) parts.push(recordWords(league.record));
	else if (league.teams) parts.push(plural(league.teams, 'team'));
	if (league.public !== undefined) parts.push(league.public ? 'public' : 'private');
	return parts.length > 0 ? parts.join(', ') : null;
}

/** A league's chip: "Big Gorilla, 2-3", "The Commish Classic, 10 teams". */
export function chipWords(league: HostLeague): string {
	const extra = aside(league);
	return extra ? `${league.name}, ${extra}` : league.name;
}

/** A league's chip read aloud: its name, the member's team, and what parts it. */
export function chipLabel(league: HostLeague): string {
	const parts = [league.name];
	if (league.team_name) parts.push(`as ${league.team_name}`);
	const extra = aside(league);
	if (extra) parts.push(extra);
	if (league.scoring_type) parts.push(league.scoring_type);
	return parts.join(', ');
}
