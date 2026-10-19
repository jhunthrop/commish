<script lang="ts">
	import Icon from './Icon.svelte';

	/** A row's one move in the member's league, as a link to the league screen that makes it: an add
	 * ("Add on ESPN") outlined with a plus, a trade ("Trade for him") in the quietest ink (the
	 * coordinator's ruling 3). Below 900 px it keeps its glyph and its spoken words, its printed words
	 * giving their width away. The order's and the week's tables share it (Lane 66w). */
	interface Props {
		href: string;
		move: 'add' | 'trade';
		/** The verb in words. */
		said: string;
		/** The player it is for, as a screen reader hears it after the verb. */
		name: string;
	}

	let { href, move, said, name }: Props = $props();
</script>

<a class="verb {move}" {href} aria-label="{said}, {name}"
	>{#if move === 'add'}<Icon name="plus" size={14} />{:else}<svg
			width="14"
			height="14"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="2"
			stroke-linecap="round"
			stroke-linejoin="round"
			aria-hidden="true"><path d="M4 8h14l-3-3M20 16H6l3 3" /></svg
		>{/if}<span>{said}</span></a
>

<style>
	.verb {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		height: 30px;
		padding: 0 var(--s-3) 0 var(--s-2);
		border: 1px solid var(--line-strong);
		border-radius: var(--r-md);
		font-size: var(--t-xs);
		font-weight: 600;
		color: var(--ink);
		text-decoration: none;
		white-space: nowrap;
	}

	.trade {
		border-color: transparent;
		color: var(--ink-3);
	}

	.verb:hover {
		border-color: var(--ink-3);
	}

	@media (max-width: 900px) {
		.verb {
			width: 32px;
			padding: 0;
			justify-content: center;
		}

		.verb span {
			display: none;
		}

		.trade {
			border-color: var(--line);
		}
	}
</style>
