/**
 * Clearing Cloudflare's edge cache after a deploy. The edge kept serving a page the deploy removed and
 * the previous stamp under `max-age=0, must-revalidate` (ledger 2026-10-15), so every deploy purges the
 * zone. The zone id is looked up by name, never written down. Framework-free: the workflow's script
 * (scripts/purge-cache.ts) uses it.
 */
const API = 'https://api.cloudflare.com/client/v4';

/** The permission the purge needs, named in the error when Cloudflare refuses. */
export const PURGE_PERMISSION = 'Zone > Cache Purge > Purge';

interface Envelope<T> {
	success: boolean;
	errors?: { code: number; message: string }[];
	result?: T;
}

async function call<T>(
	fetchImpl: typeof fetch,
	token: string,
	path: string,
	init?: RequestInit
): Promise<Envelope<T>> {
	const response = await fetchImpl(`${API}${path}`, {
		...init,
		headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
	});
	const body = (await response.json().catch(() => ({}))) as Envelope<T>;
	if (response.ok && body.success) return body;
	const reasons = (body.errors ?? []).map((error) => `${String(error.code)} ${error.message}`);
	throw new Error(
		`Cloudflare answered ${String(response.status)} for ${path}: ${reasons.join(', ') || 'no reason given'}`
	);
}

/** The id of the zone with this name. */
export async function zoneIdFor(
	fetchImpl: typeof fetch,
	token: string,
	zoneName: string
): Promise<string> {
	const body = await call<{ id: string }[]>(
		fetchImpl,
		token,
		`/zones?name=${encodeURIComponent(zoneName)}`
	);
	const id = body.result?.[0]?.id;
	if (!id) throw new Error(`The token sees no zone named ${zoneName}.`);
	return id;
}

/** Purges everything the zone's edge holds and returns the line the log prints. Throws on any refusal. */
export async function purgeZoneCache(
	fetchImpl: typeof fetch,
	token: string,
	zoneName: string
): Promise<string> {
	const zoneId = await zoneIdFor(fetchImpl, token, zoneName);
	try {
		await call<{ id: string }>(fetchImpl, token, `/zones/${zoneId}/purge_cache`, {
			method: 'POST',
			body: JSON.stringify({ purge_everything: true })
		});
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error);
		throw new Error(
			`The cache purge for ${zoneName} failed (needs ${PURGE_PERMISSION}): ${reason}`,
			{ cause: error }
		);
	}
	return `Purged the edge cache of ${zoneName} (zone ${zoneId}).`;
}
