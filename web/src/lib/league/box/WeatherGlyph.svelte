<script lang="ts">
	import type { WeatherGlyph } from './box.ts';

	/** The kickoff weather's glyph, beside its words, which carry the meaning: wind for a forecast,
	 * a dome indoors, a roof whose state is not decided, a globe for a game abroad. Its own paths, so
	 * the shell's icon set does not grow for a box score. */
	interface Props {
		glyph: WeatherGlyph;
	}

	let { glyph }: Props = $props();

	const PATHS: Readonly<Record<WeatherGlyph, readonly string[]>> = {
		wind: ['M3 8h11a3 3 0 1 0-3-3', 'M3 12h15a3 3 0 1 1-3 3', 'M3 16h8'],
		indoors: ['M3 19h18', 'M5 19v-5a7 7 0 0 1 14 0v5'],
		roof: ['M3 19h18', 'M5 19v-6l7-5 7 5v6', 'M12 8V4'],
		abroad: [
			'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18',
			'M3 12h18',
			'M12 3a14 14 0 0 1 0 18a14 14 0 0 1 0-18'
		],
		outdoors: ['M12 4v2', 'M12 18v2', 'M4 12h2', 'M18 12h2', 'M12 8a4 4 0 1 0 0 8a4 4 0 1 0 0-8']
	};
</script>

<svg
	width="13"
	height="13"
	viewBox="0 0 24 24"
	fill="none"
	stroke="currentColor"
	stroke-width="2"
	stroke-linecap="round"
	stroke-linejoin="round"
	aria-hidden="true"
>
	{#each PATHS[glyph] as d (d)}<path {d} />{/each}
</svg>
