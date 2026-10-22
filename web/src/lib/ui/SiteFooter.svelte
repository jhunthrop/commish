<!-- The site's one footer (Lane 151, launch audit C1), under every page the shell draws: who runs the
     site, the Terms, the Privacy Policy and the address to write to, in the basis's quiet type. One
     line at a desk, two at most on a phone, inside every footer budget (Lane 138). Its words and
     addresses are written here as markup, so the shell's chunk, which every page loads, carries no
     code for them (the player page's script budget): site-footer.test.ts holds them to the word
     tables (legal/foot-words.ts, legal/contact.ts) and the two routes, word for word. -->
<footer class="site-foot">
	<span>Commish LLC</span>
	<a href="/terms">Terms</a>
	<a href="/privacy">Privacy</a>
	<a href="mailto:help@trycommish.app">help@trycommish.app</a>
</footer>

<style>
	.site-foot {
		margin-top: auto;
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		column-gap: var(--s-4);
		row-gap: var(--s-1);
		padding: var(--s-4) var(--s-5) var(--s-5);
		font-size: var(--t-sm);
		line-height: 1.45;
		color: var(--ink-3);
	}

	a {
		color: var(--ink-2);
		text-decoration: underline;
		text-decoration-color: var(--shell-line);
		text-underline-offset: 3px;
	}

	a:hover {
		color: var(--ink);
		text-decoration-color: currentColor;
	}

	@media (max-width: 760px) {
		.site-foot {
			padding: var(--s-4);
		}

		/* A page that pins its verb above the tab bar (data-pin: the player card's, PinnedVerb) keeps
		   the room for it under the footer, the page's last words, so nothing ends under the pin. */
		:global(.main:has([data-pin])) .site-foot {
			padding-bottom: var(--pin-reserve);
		}
	}
</style>
