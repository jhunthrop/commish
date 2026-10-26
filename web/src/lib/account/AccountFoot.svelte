<script lang="ts">
	import { legalLinks } from '#lib/legal/legal-links.ts';
	import { links } from '#lib/site/links.ts';
	import Quiet from '#lib/ui/Quiet.svelte';
	import { ACCOUNT_DELETE_FOOT } from './delete-words.ts';
	import { ACCOUNT_FOOT } from './foot-words.ts';

	/** The account page's foot (Lane 151, Lane 233): the one verb that deletes the account, on its
	 * own page, and the two legal pages, in the basis's quiet type. Signed in or out. */
</script>

<section class="foot" aria-label={ACCOUNT_FOOT.label}>
	<Quiet size="sm" href={links.accountDelete()}>{ACCOUNT_DELETE_FOOT.verb}</Quiet>
	<p>
		{ACCOUNT_DELETE_FOOT.keep}<a href={legalLinks.privacy()}>{ACCOUNT_FOOT.privacy}</a
		>{ACCOUNT_FOOT.joint}<a href={legalLinks.terms()}>{ACCOUNT_FOOT.terms}</a>{ACCOUNT_FOOT.end}
	</p>
</section>

<style>
	.foot {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: var(--s-2);
	}

	p {
		margin: 0;
		max-width: 72ch;
		font-size: var(--t-sm);
		line-height: 1.45;
		color: var(--ink-3);
	}

	a {
		color: var(--accent-text);
	}
</style>
