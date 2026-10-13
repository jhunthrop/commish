// Gives a GitHub Actions job the build's R2 inputs: R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and
// PUBLIC_RUN_BASE_URL, appended to the job's environment file with the two keys masked in the log.
// Usage in a workflow step: node scripts/r2-env.ts
import { appendFile } from 'node:fs/promises';
import { bucketUrl, credentialsFromToken } from './r2.ts';

const envFile = process.env.GITHUB_ENV;
if (!envFile)
	throw new Error('GITHUB_ENV is not set. This script runs inside a GitHub Actions job.');

const credentials = await credentialsFromToken();
const accountId = process.env.CLOUDFLARE_ACCOUNT_ID ?? '';

process.stdout.write(`::add-mask::${credentials.accessKeyId}\n`);
process.stdout.write(`::add-mask::${credentials.secretAccessKey}\n`);

await appendFile(
	envFile,
	[
		`R2_ACCESS_KEY_ID=${credentials.accessKeyId}`,
		`R2_SECRET_ACCESS_KEY=${credentials.secretAccessKey}`,
		`PUBLIC_RUN_BASE_URL=${bucketUrl(accountId)}`,
		''
	].join('\n')
);
process.stdout.write(`Run reads come from ${bucketUrl(accountId)}.\n`);
