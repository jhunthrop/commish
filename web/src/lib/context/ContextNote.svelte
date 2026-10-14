<script lang="ts">
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
		/** On a desk the line sits in a column as narrow as a phone's (the board's side column, under
		 * the switch), so it keeps the phone's room there too. */
		narrow?: boolean;
	}

	let { note, short = false, narrow = false }: Props = $props();
</script>

<p class="note" class:filled={note !== null} class:short class:narrow>{note ?? ''}</p>

<style>
	.note {
		display: none;
		margin: 0;
		max-width: 90ch;
		font-size: var(--t-sm);
		line-height: 1.4;
		color: var(--ink-2);
	}

	.filled,
	:global(html[data-league]) .note {
		display: block;
		min-height: 1lh;
	}

	@media (min-width: 1181px) {
		:global(html[data-league='2']) .narrow {
			min-height: 2lh;
		}

		:global(html[data-league='3']) .narrow {
			min-height: 3lh;
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
