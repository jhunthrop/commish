// The site's one rounding rule for the stand-in run's writer (Lane 66n re-review N2): a figure to one
// decimal, half away from zero, on the shortest decimal the number is written as, exactly as the API's
// tenth.Round and the nightly's research/nightly/build/tenth.py do. A writer's rule, kept in scripts/:
// the web itself never rounds a figure. Its cases are web/src/lib/format/tenth-table.json, the table
// the Go and Python tests read too (src/lib/format/standin-tenth.test.ts).

const DIGITS = 20;

/** n to one decimal, half away from zero; a value that is not finite passes through. */
export function tenth(n: number): number {
	if (!Number.isFinite(n)) return n;
	// The shortest decimal that reads back as n, as Go's FormatFloat(…, 'f', -1, 64) gives it.
	const written = Math.abs(n).toLocaleString('en-US', {
		useGrouping: false,
		maximumFractionDigits: DIGITS
	});
	const [whole = '0', fraction = ''] = written.split('.');
	const digits = `${fraction}00`;
	let tenths = BigInt(`${whole}${digits.charAt(0)}`);
	if (digits.charAt(1) >= '5') tenths += 1n;
	const out = Number(`${(tenths / 10n).toString()}.${(tenths % 10n).toString()}`);
	return n < 0 && out !== 0 ? -out : out;
}

/** A tier's drop as the nightly writes it (research/nightly/build/pages.py drop_between): the tier's
 * last projection less the next tier's first, each rounded to the tenth the board shows, the
 * difference cleaned back to its tenth. */
export function dropBetween(last: number, first: number): number {
	return tenth(tenth(last) - tenth(first));
}

/** The Gap as the nightly writes it (research/nightly/build/pages.py gap_of): the ADP rounded to the
 * tenth its column shows, less our rank, the difference cleaned back to its tenth. */
export function gapOf(adp: number | null, ourRank: number): number | null {
	return adp === null ? null : tenth(tenth(adp) - ourRank);
}
