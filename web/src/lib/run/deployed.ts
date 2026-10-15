/**
 * Which run the live site holds, and whether the hourly backstop should build. The build writes the
 * run it prerendered to DEPLOYED_RUN_PATH (src/routes/data/run.txt); the backstop reads that from the
 * live site and the latest pointer from the bucket, and builds only when they differ, so an hour with
 * nothing new costs seconds. Framework-free: the workflow's script (scripts/run-fresh.ts) uses it.
 */
import { runIdSchema } from './schema.ts';

/** Where the live site says which run it holds: one line, the run id. */
export const DEPLOYED_RUN_PATH = '/data/run.txt';

export interface BackstopChoice {
	build: boolean;
	/** The named line the workflow prints, so the log says why it built or did not. */
	line: string;
}

/** The run id the site's text names, or null when the text is not one (a 404 page, nothing). */
export function parseDeployedRun(text: string): string | null {
	const parsed = runIdSchema.safeParse(text.trim());
	return parsed.success ? parsed.data : null;
}

/** Build unless the site already holds the latest run. A site whose run cannot be read builds. */
export function backstopChoice(latest: string, deployed: string | null): BackstopChoice {
	if (deployed === null) {
		return {
			build: true,
			line: `The site's run could not be read; building the latest, ${latest}.`
		};
	}
	if (deployed === latest) {
		return {
			build: false,
			line: `The site already holds run ${latest}, the latest; nothing to build.`
		};
	}
	return {
		build: true,
		line: `The site holds run ${deployed}; the latest is ${latest}, building it.`
	};
}
