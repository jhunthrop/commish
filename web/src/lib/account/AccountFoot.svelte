<script lang="ts">
	import { SUPPORT_EMAIL, SUPPORT_HREF } from '#lib/legal/contact.ts';
	import { legalLinks } from '#lib/legal/legal-links.ts';
	import { ACCOUNT_FOOT } from './foot-words.ts';

	/** The account page's foot (Lane 151): the way to have the account deleted, by mail until the
	 * page has a verb for it, and the two legal pages, in the basis's quiet type. Signed in or out. */
</script>

<section class="foot" aria-label={ACCOUNT_FOOT.label}>
	<p>
		{ACCOUNT_FOOT.before}<a href={SUPPORT_HREF}>{SUPPORT_EMAIL}</a>{ACCOUNT_FOOT.after}<a
			href={legalLinks.privacy()}>{ACCOUNT_FOOT.privacy}</a
		>{ACCOUNT_FOOT.joint}<a href={legalLinks.terms()}>{ACCOUNT_FOOT.terms}</a>{ACCOUNT_FOOT.end}
	</p>
</section>

<style>
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
