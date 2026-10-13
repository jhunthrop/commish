/** What the claim page says about a group pass link and the reader: one state, its sentence and its
 * verb. Pure, so the page only draws it. */
import { hasLiveMembership } from '#lib/account/words.ts';
import { ApiError, HTTP, type Account, type GroupPassPreview } from './pass-api.ts';

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
	if (error instanceof ApiError && error.status === HTTP.notFound) return { kind: 'missing' };
	if (error instanceof ApiError && error.status === HTTP.gone) return { kind: 'ended' };
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
	if (account !== null) {
		const ownPass = account.draft_pass !== null && account.draft_pass.season === preview.season;
		if (ownPass || hasLiveMembership(account)) return 'covered';
	}
	if (preview.claimed >= preview.seats) return 'full';
	return account === null ? 'sign-in' : 'claim';
}

/** "Bought by @rey", or nothing when the buyer has no handle yet. */
export function fromWords(preview: GroupPassPreview): string {
	const by = preview.purchaser_handle ? ` from @${preview.purchaser_handle}` : '';
	return `${String(preview.season)} Group Draft Pass${by}`;
}
