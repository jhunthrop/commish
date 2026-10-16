// The deploy's last step: clear the zone's edge cache so every visitor, and the hourly backstop's
// stamp read, sees what was just deployed. Fails the job loudly when the purge is refused.
// Usage in a workflow step: node scripts/purge-cache.ts (CLOUDFLARE_API_TOKEN and ZONE_NAME are set).
import { purgeZoneCache } from '../src/lib/deploy/purge.ts';

function required(name: string): string {
	const value = process.env[name]?.trim();
	if (!value) throw new Error(`${name} is not set.`);
	return value;
}

process.stdout.write(
	`${await purgeZoneCache(fetch, required('CLOUDFLARE_API_TOKEN'), required('ZONE_NAME'))}\n`
);
