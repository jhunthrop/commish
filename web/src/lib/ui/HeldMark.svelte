<script lang="ts">
	import Icon from './Icon.svelte';

	/** The league's mark on a player: the league's flag on a disc over the bottom right edge of his
	 * face, the accent for yours and the gain green for a free agent (another team's player carries
	 * none). The words say which ("On Grand Illusion BG 3", "Free agent in your league") on hover and
	 * to assistive tech. It sits in a positioned box the face shares, kept whether or not he is
	 * marked, so the mark's arrival moves nothing. */
	interface Props {
		words: string;
		kind: 'mine' | 'free';
		/** In a line with no face (the players list): the disc sits in the line's flow, before its
		 * number. */
		inline?: boolean;
	}

	let { words, kind, inline = false }: Props = $props();
</script>

<span class="held {kind}" class:inline role="img" aria-label={words} title={words}
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
		box-shadow: 0 0 0 1.5px var(--surface);
	}

	.free {
		background: var(--gain-bg);
		color: var(--gain-ink);
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
