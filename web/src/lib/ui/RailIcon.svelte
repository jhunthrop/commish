<script lang="ts">
	import { railIconId } from './nav.ts';
	import type { RailIconName } from './rail-icons.ts';

	/** A rail glyph: the page's sprite symbol (rail-icons.ts, written by the server), drawn in the
	 * icon set's stroke. The page's script holds only its name. */
	interface Props {
		name: RailIconName;
	}

	let { name }: Props = $props();
</script>

<svg
	width="22"
	height="22"
	viewBox="0 0 24 24"
	fill="none"
	stroke="currentColor"
	stroke-width="1.8"
	stroke-linecap="round"
	stroke-linejoin="round"
	aria-hidden="true"><use href="#{railIconId(name)}" /></svg
>
