<script lang="ts">
	import type { Snippet } from 'svelte';
	import { WORD_SETS, type WordSet } from './nav.ts';

	/** Words that follow the season the rail shows, drawn once per set and shown by the root's rail
	 * (rail-css.ts): the HTML holds both, so a member whose league is in another phase than the
	 * site's sees the right words on the first frame and nothing changes when the script runs. */
	interface Props {
		children: Snippet<[WordSet]>;
	}

	let { children }: Props = $props();
</script>

{#each WORD_SETS as set (set)}<span data-words={set}>{@render children(set)}</span>{/each}
