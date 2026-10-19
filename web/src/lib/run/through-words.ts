/** The one way every basis says how far this season's figures reach (Lane 80): ", through week 5 and
 * week 6's Thursday game" (run/reach.ts reachWords), or nothing before week 1's games. No imports, so
 * a client basis carries no word module with it. */
export function throughClause(reach: { through: string }): string {
	return reach.through === '' ? '' : `, ${reach.through}`;
}
