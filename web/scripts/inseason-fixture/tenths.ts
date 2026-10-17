// The fixture's figures as the API now sends them (Lane 66k H1): every figure a screen shows rounded
// once to a tenth, half away from zero on the decimal it is written as, the rule of api/internal/tenth.
// The recorded answers in data/ carry cents; the stand-in API rounds them on load, as the API does.

/** n to one decimal, half away from zero on its shortest decimal string (api tenth.Round). */
export function roundTenth(n: number): number {
	if (!Number.isFinite(n)) return n;
	const [whole = '0', frac = ''] = Math.abs(n).toString().split('.');
	const digits = `${frac}00`;
	let tenths = Number(whole) * 10 + Number(digits[0]);
	if ((digits[1] ?? '0') >= '5') tenths += 1;
	const out = tenths / 10;
	return n < 0 && out !== 0 ? -out : out;
}

/** The keys whose figures a screen prints. */
const FIGURES = new Set([
	'week_projection',
	'projection_delta',
	'season_avg',
	'last_points',
	'points_this_week',
	'points',
	'points_for',
	'points_against',
	'team_points'
]);

/** A recorded answer with every printed figure in tenths, a new value, the recording untouched. */
export function inTenths<T>(value: T): T {
	if (Array.isArray(value)) return value.map((v: unknown) => inTenths(v)) as T;
	if (value === null || typeof value !== 'object') return value;
	return Object.fromEntries(
		Object.entries(value).map(([key, v]) => [
			key,
			FIGURES.has(key) && typeof v === 'number' ? roundTenth(v) : inTenths(v)
		])
	) as T;
}
