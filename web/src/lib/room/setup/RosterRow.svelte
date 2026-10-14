<script lang="ts">
	import Stepper from '#lib/ui/Stepper.svelte';
	import type { LeagueSettings } from '../api.ts';
	import {
		ROSTER_FIELDS,
		flexCount,
		flexMax,
		lineupForFlex,
		lineupForSuperflex,
		superflexCount
	} from './setup.ts';
	import SetupRow from './SetupRow.svelte';

	/** The roster's steppers: the counts, then the flex spots the lineup makes, the bench last, so
	 * they add up to the rounds line. */
	interface Props {
		roster: LeagueSettings['roster'];
		lineup: LeagueSettings['lineup'];
		rounds: number;
		onchange: (patch: Partial<Pick<LeagueSettings, 'roster' | 'lineup'>>) => void;
	}

	let { roster, lineup, rounds, onchange }: Props = $props();

	const head = ROSTER_FIELDS.filter((f) => f.key !== 'bench');
	const bench = ROSTER_FIELDS.find((f) => f.key === 'bench');
</script>

<SetupRow label="Roster" note="rounds follow from it: {rounds}">
	{#each head as f (f.key)}
		<Stepper
			label={f.label}
			value={roster[f.key]}
			min={0}
			max={f.max}
			onchange={(v: number) => onchange({ roster: { ...roster, [f.key]: v } })}
		/>
	{/each}
	<Stepper
		label="FLEX"
		value={flexCount(lineup)}
		min={1}
		max={flexMax(lineup)}
		onchange={(v: number) => onchange({ lineup: lineupForFlex(lineup, v) })}
	/>
	{#if superflexCount(lineup) > 0}
		<Stepper
			label="SFLX"
			value={superflexCount(lineup)}
			min={0}
			max={1}
			onchange={(v: number) => onchange({ lineup: lineupForSuperflex(v) })}
		/>
	{/if}
	{#if bench}
		<Stepper
			label={bench.label}
			value={roster.bench}
			min={0}
			max={bench.max}
			onchange={(v: number) => onchange({ roster: { ...roster, bench: v } })}
		/>
	{/if}
</SetupRow>
