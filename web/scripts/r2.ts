// R2 access for the build and the stand-in, from the one Cloudflare API token the lanes already
// hold. R2's S3 endpoint takes the token's id as the access key and the SHA-256 of the token as
// the secret, so no second credential is minted or stored.
import { createHash } from 'node:crypto';
import type { R2Credentials } from '../src/lib/run/config.ts';

export const RUNS_BUCKET = 'commish-runs';

interface TokenVerify {
	success: boolean;
	result?: { id: string; status: string };
}

function requiredEnv(name: string): string {
	const value = process.env[name]?.trim();
	if (!value) throw new Error(`${name} is not set.`);
	return value;
}

/** The S3 endpoint of a bucket: the PUBLIC_RUN_BASE_URL a build reads runs from. */
export function bucketUrl(accountId: string, bucket: string = RUNS_BUCKET): string {
	return `https://${accountId}.r2.cloudflarestorage.com/${bucket}`;
}

/** S3 credentials derived from CLOUDFLARE_API_TOKEN, verified against the account. */
export async function credentialsFromToken(): Promise<R2Credentials> {
	const token = requiredEnv('CLOUDFLARE_API_TOKEN');
	const accountId = requiredEnv('CLOUDFLARE_ACCOUNT_ID');
	const response = await fetch(
		`https://api.cloudflare.com/client/v4/accounts/${accountId}/tokens/verify`,
		{ headers: { Authorization: `Bearer ${token}` } }
	);
	const body = await response.json<TokenVerify>();
	if (!body.success || body.result?.status !== 'active') {
		throw new Error('CLOUDFLARE_API_TOKEN did not verify as an active account token.');
	}
	return {
		accessKeyId: body.result.id,
		secretAccessKey: createHash('sha256').update(token).digest('hex')
	};
}
