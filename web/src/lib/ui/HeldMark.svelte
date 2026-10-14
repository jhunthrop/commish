<script lang="ts">
	import Icon from './Icon.svelte';

	/** A team in your league holds him: the league's flag on a disc over the bottom right edge of his
	 * face, ink for another team's player and the accent for yours. The words say whose ("On your
	 * roster", "Rostered by Gmoneyman") on hover and to assistive tech. It sits in a positioned box
	 * the face shares, kept whether or not he is held, so the mark's arrival moves nothing. */
	interface Props {
		words: string;
		mine: boolean;
		/** In a line with no face (the players list): the disc sits in the line's flow, before its
		 * number. */
		inline?: boolean;
	}

	let { words, mine, inline = false }: Props = $props();
</script>

<span class="held" class:mine class:inline role="img" aria-label={words} title={words}
	><Icon name="league" size={10} /></span
>

<style>
	.held {
		position: absolute;
		/* Over a row's stretched link, so its words show on hover. */
		z-index: 1;
		right: -4px;
		bottom: -2px;
		display: grid;
		place-items: center;
		width: 16px;
		height: 16px;
		border-radius: 50%;
		background: var(--ink-2);
		color: var(--bg);
		box-shadow: 0 0 0 1.5px var(--surface);
	}

	.inline {
		position: static;
		box-shadow: none;
	}

	.mine {
		background: var(--accent);
		color: var(--accent-ink);
	}
</style>
