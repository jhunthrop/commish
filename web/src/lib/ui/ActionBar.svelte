<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		/** The page's verb first, then the quiet ones beside it. */
		children: Snippet;
		/** Something that went wrong with a verb, said where the verb is, above it. */
		alert?: Snippet;
		/** A line about the verbs: a note, or a quiet way to sign in. Under them on a desk, in the page
		 * above the pinned bar on a phone, so the bar holds only what it must. */
		note?: Snippet;
	}

	let { children, alert, note }: Props = $props();
</script>

<!-- A form's verbs. On a desk they follow the form; on a phone they stay on the first screen, pinned
     above the tab bar, so the verb is never two screens down. One of the two note copies shows at
     each width; the other is display: none, so it is never read twice. -->
{#if note}<div class="note phone">{@render note()}</div>{/if}
<div class="bar">
	{#if alert}{@render alert()}{/if}
	<div class="verbs">{@render children()}</div>
	{#if note}<div class="note desk">{@render note()}</div>{/if}
</div>

<style>
	.bar {
		display: flex;
		flex-direction: column;
		gap: var(--s-3);
		margin-top: var(--s-3);
	}

	.verbs {
		display: flex;
		flex-wrap: wrap;
		gap: var(--s-3);
		align-items: center;
	}

	.note {
		font-size: var(--t-sm);
		color: var(--ink-2);
	}

	.phone {
		display: none;
	}

	@media (max-width: 760px) {
		.phone {
			display: block;
			margin-top: var(--s-3);
		}

		.desk {
			display: none;
		}

		.bar {
			position: sticky;
			bottom: calc(var(--tab-bar-h) + env(safe-area-inset-bottom, 0px));
			z-index: 10;
			gap: var(--s-2);
			margin: var(--s-3) calc(var(--s-4) * -1) 0;
			padding: var(--s-3) var(--s-4);
			background: var(--surface);
			border-top: 1px solid var(--line-strong);
		}

		.verbs {
			flex-wrap: nowrap;
			gap: var(--s-2);
		}
	}
</style>
