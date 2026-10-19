<script lang="ts">
	import { memberZone } from '#lib/format/clock.ts';
	import BasisBlock from '#lib/ui/BasisBlock.svelte';
	import { boxBasisParts, type BoxBasisFacts } from './basis.ts';

	/** What a box score's numbers are, said once under the boxes as one paragraph (Lane 66t): the
	 * columns the screen draws, each once (basis.ts boxBasisParts). The in-season page names the zone
	 * in its head, so no time here repeats it. now is the page's clock, in ms. */
	type Props = BoxBasisFacts & { now: number };

	let { now, ...facts }: Props = $props();

	const parts = $derived(boxBasisParts(facts, { zone: memberZone(), zoned: false }, now));
</script>

<BasisBlock {parts} />
