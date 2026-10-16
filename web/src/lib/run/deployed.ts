/**
 * What the live site holds, and whether the hourly backstop should build. Every build writes its
 * stamp to DEPLOYED_RUN_PATH (src/routes/data/run.txt): the run it prerendered and the commit it was
 * built from. The backstop reads that from the live site, the latest pointer from the bucket and the
 * commit it checked out, and skips only when both match, so an hour with nothing new costs seconds
 * and a pushed commit whose deploy a scheduled run replaced is still deployed. Framework-free: the
 * workflow's script (scripts/run-fresh.ts) uses it.
 */
import { runIdSchema } from './schema.ts';

/** Where the live site says what it holds: one line, the run id and the commit. */
export const DEPLOYED_RUN_PATH = '/data/run.txt';

/** A commit as git names it in full. */
const COMMIT = /^[0-9a-f]{40}$/;
/** What a build with no commit to name (a local build) writes in its place: never a match. */
const NO_COMMIT = 'uncommitted';

export interface DeployedStamp {
	runId: string;
	commit: string;
}

export interface BackstopChoice {
	build: boolean;
	/** The named line the workflow prints, so the log says why it built or did not. */
	line: string;
}

/** The stamp's text: the run id, a space, the commit. */
export function deployedStamp(runId: string, commit: string | undefined): string {
	const named = commit?.trim() ?? '';
	return `${runId} ${named === '' ? NO_COMMIT : named}\n`;
}

/** The stamp the site's text names, or null when it is not one (a 404 page, an older stamp). */
export function parseDeployedStamp(text: string): DeployedStamp | null {
	const [runId = '', commit = '', ...rest] = text.trim().split(/\s+/);
	const parsed = runIdSchema.safeParse(runId);
	if (!parsed.success || !COMMIT.test(commit) || rest.length > 0) return null;
	return { runId: parsed.data, commit };
}

/** How long the backstop waits for the live site before it treats the stamp as unreadable. */
const SITE_TIMEOUT_MS = 10_000;

/**
 * The live site's stamp, or null when it does not answer with one: a miss is a reason to build. The
 * read never trusts the edge: a query string no cached copy has and a request for a fresh copy, so
 * a page cache that outlives a deploy cannot hand back the previous deploy's stamp.
 */
export async function fetchDeployedStamp(
	site: string,
	fetchImpl: typeof fetch,
	now: number
): Promise<DeployedStamp | null> {
	try {
		const url = `${site.replace(/\/+$/, '')}${DEPLOYED_RUN_PATH}?at=${String(now)}`;
		const response = await fetchImpl(url, {
			headers: { 'Cache-Control': 'no-cache' },
			signal: AbortSignal.timeout(SITE_TIMEOUT_MS)
		});
		return response.ok ? parseDeployedStamp(await response.text()) : null;
	} catch {
		return null;
	}
}

const short = (commit: string): string => commit.slice(0, 8);

/** Build unless the site holds the latest run on this commit. A stamp that cannot be read builds. */
export function backstopChoice(
	latest: DeployedStamp,
	deployed: DeployedStamp | null
): BackstopChoice {
	if (deployed === null) {
		return {
			build: true,
			line: `The site's stamp could not be read; building run ${latest.runId} on commit ${short(latest.commit)}.`
		};
	}
	if (deployed.runId !== latest.runId) {
		return {
			build: true,
			line: `The site holds run ${deployed.runId}; the latest is ${latest.runId}, building it.`
		};
	}
	if (deployed.commit !== latest.commit) {
		return {
			build: true,
			line: `The site holds run ${latest.runId} on commit ${short(deployed.commit)}; building ${short(latest.commit)}.`
		};
	}
	return {
		build: false,
		line: `The site already holds run ${latest.runId} on commit ${short(latest.commit)}, the latest of both; nothing to build.`
	};
}
