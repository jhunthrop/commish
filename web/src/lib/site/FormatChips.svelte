<script lang="ts">
	import type { FormatChip } from '#lib/server/pages/format-route.ts';
	import Chip from '#lib/ui/Chip.svelte';
	import ChipGroup from '#lib/ui/ChipGroup.svelte';

	/** The scoring chooser: every format the run carries, then the chooser's formats it lacks, each a
	 * link to its page. A format the run lacks draws absent and its page says so. */
	interface Props {
		formats: readonly FormatChip[];
		/** The format this page shows. */
		current: string;
		/** The page a chip opens. */
		href: (chip: FormatChip) => string;
	}

	let { formats, current, href }: Props = $props();
</script>

<ChipGroup label="Scoring">
	{#each formats as chip (chip.id)}
		<Chip
			href={href(chip)}
			pressed={chip.id === current}
			absent={!chip.onRun && chip.id !== current}
			label={chip.onRun ? undefined : `${chip.label}, not on this run`}>{chip.label}</Chip
		>
	{/each}
</ChipGroup>
