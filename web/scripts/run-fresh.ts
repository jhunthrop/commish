// The hourly backstop's first step: does the live site already hold the latest run, built from the
// commit this workflow checked out? Reads the bucket's latest pointer (with the run inputs
// scripts/r2-env.ts set), GITHUB_SHA and the site's /data/run.txt, prints one named line, and writes
// build=true or build=false to the step's outputs. A build that is pushed or dispatched never asks;
// only the schedule does.
// Usage in a workflow step: node scripts/run-fresh.ts (SITE_URL names the live site).
import { appendFile } from 'node:fs/promises';
import { LATEST_RUN, locationFor, parseBaseUrl } from '../src/lib/run/config.ts';
import {
	DEPLOYED_RUN_PATH,
	backstopChoice,
	parseDeployedStamp,
	type DeployedStamp
} from '../src/lib/run/deployed.ts';
import { openRun } from '../src/lib/run/source.ts';

const SITE_TIMEOUT_MS = 10_000;

function required(name: string): string {
	const value = process.env[name]?.trim();
	if (!value) throw new Error(`${name} is not set.`);
	return value;
}

async function latestRun(): Promise<string> {
	const base = parseBaseUrl(required('PUBLIC_RUN_BASE_URL'));
	const run = await openRun({ runId: LATEST_RUN, location: locationFor(base, process.env) });
	return run.runId;
}

/** The site's stamp, or null when it does not answer with one: a miss is a reason to build. */
async function deployedStamp(site: string): Promise<DeployedStamp | null> {
	try {
		const url = `${site.replace(/\/+$/, '')}${DEPLOYED_RUN_PATH}?at=${String(Date.now())}`;
		const response = await fetch(url, {
			headers: { 'Cache-Control': 'no-cache' },
			signal: AbortSignal.timeout(SITE_TIMEOUT_MS)
		});
		return response.ok ? parseDeployedStamp(await response.text()) : null;
	} catch {
		return null;
	}
}

const outputs = required('GITHUB_OUTPUT');
const latest = { runId: await latestRun(), commit: required('GITHUB_SHA') };
const choice = backstopChoice(latest, await deployedStamp(required('SITE_URL')));
process.stdout.write(`${choice.line}\n`);
await appendFile(outputs, `build=${String(choice.build)}\n`);
