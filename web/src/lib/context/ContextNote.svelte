<script lang="ts">
	import type { LeagueLine } from './note-line.ts';

	/** A page's line about the selected league: what the figures are against the league's scoring
	 * (words.ts), or one short fact (whose roster a player is on). Its room is kept from the first
	 * paint while a league is selected (the boot script's data-league), so filling it in moves nothing
	 * under it. With no league it takes no room. */
	interface Props {
		/** The line, from words.ts, for the context the page reads; null with no league (signed out
		 * included) or not yet. */
		note: string | null;
		/** A short fact that always fits one line: it keeps one line's room whatever the basis line
		 * takes on a phone. */
		short?: boolean;
		/** The one link the line ends on: where an account with custom_scoring finds its exact board. */
		link?: LeagueLine['link'];
	}

	let { note, short = false, link = null }: Props = $props();
</script>

<p class="note" class:filled={note !== null} class:short>
	{note ?? ''}{#if link}
		<a href={link.href}>{link.words}</a>{/if}
</p>

<style>
	.note {
		display: none;
		margin: 0;
		max-width: 90ch;
		font-size: var(--t-sm);
		line-height: 1.4;
		color: var(--ink-2);
	}

	/* The link follows the sentence before it as the next sentence would. */
	.note a {
		margin-left: 0.25em;
	}

	.filled,
	:global(html[data-league]) .note {
		display: block;
		min-height: 1lh;
	}

	/* Between the phone and the desk the longer lines (a TE premium league's, a board the run lacks)
	   take two lines at their 90ch measure. */
	@media (min-width: 761px) and (max-width: 1180px) {
		:global(html[data-league='2']) .note:not(.short),
		:global(html[data-league='3']) .note:not(.short) {
			min-height: 2lh;
		}
	}

	@media (max-width: 760px) {
		:global(html[data-league='2']) .note:not(.short) {
			min-height: 2lh;
		}

		:global(html[data-league='3']) .note:not(.short) {
			min-height: 3lh;
		}
	}
</style>
