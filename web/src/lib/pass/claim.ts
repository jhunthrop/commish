/** What the claim page says about a group pass link and the reader: one state, its sentence and its
 * verb. Pure, so the page only draws it. */
import { hasFeature } from '#lib/account/features.ts';
import { HTTP_STATUS, hasStatus } from '#lib/api/status.ts';
import type { Account, GroupPassPreview } from './pass-api.ts';

export type ClaimState =
	| { kind: 'loading' }
	| { kind: 'unreachable' }
	/** The link opens no pass: a wrong code, or a pass refunded or disputed. */
	| { kind: 'missing' }
	/** The pass's season is over. */
	| { kind: 'ended' }
	| { kind: 'open'; preview: GroupPassPreview; account: Account | null };

/** The page's state from what the preview call answered. */
export function stateFromError(error: unknown): ClaimState {
	if (hasStatus(error, HTTP_STATUS.notFound)) return { kind: 'missing' };
	if (hasStatus(error, HTTP_STATUS.gone)) return { kind: 'ended' };
	return { kind: 'unreachable' };
}

/** What the reader can do with an open link. */
export type ClaimStep =
	/** The seat is theirs already. */
	| 'yours'
	/** Their own pass or Membership covers them, so the seat stays for a teammate. */
	| 'covered'
	/** Every seat is taken. */
	| 'full'
	| 'sign-in'
	| 'claim';

export function claimStep(preview: GroupPassPreview, account: Account | null): ClaimStep {
	if (preview.claimed_by_me) return 'yours';
	// The features /me reports answer it: a reader who already has the live draft advisor is
	// covered, whatever product gave it to them. The API refuses the claim the same way.
	if (account !== null && hasFeature(account.features, 'live_draft_advisor')) return 'covered';
	if (preview.claimed >= preview.seats) return 'full';
	return account === null ? 'sign-in' : 'claim';
}

/** "Bought by @rey", or nothing when the buyer has no handle yet. */
export function fromWords(preview: GroupPassPreview): string {
	const by = preview.purchaser_handle ? ` from @${preview.purchaser_handle}` : '';
	return `${String(preview.season)} Group Draft Pass${by}`;
}
