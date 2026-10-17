/** A club's mark, beside the headshot helper (headshot.ts): a defense's face, where a player's
 * headshot sits, from the same image host. The one place the mark's address is built, in its own
 * module so the shell's chunk, which carries the headshot helper, does not carry it too. */
const ESPN_CLUB_MARKS = 'https://a.espncdn.com/i/teamlogos/nfl/500';

export function clubMark(club: string): string {
	return `${ESPN_CLUB_MARKS}/${club.toLowerCase()}.png`;
}
