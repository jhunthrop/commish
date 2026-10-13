<script lang="ts">
	import Field from '#lib/ui/Field.svelte';
	import Stepper from '#lib/ui/Stepper.svelte';
	import { LEAGUE_NAME_MAX } from './intent.ts';

	/** The Group Draft Pass's two choices: how many teams, one pass each, and the league's name, which
	 * the claim link shows to everyone it is shared with. */
	interface Props {
		seats: number;
		min: number;
		max: number;
		league: string;
		onseats: (seats: number) => void;
		onleague: (league: string) => void;
		onenter: () => void;
	}

	let { seats, min, max, league, onseats, onleague, onenter }: Props = $props();
</script>

<div class="group">
	<Stepper label="Teams" value={seats} {min} {max} onchange={onseats} />
	<Field
		label="League name"
		value={league}
		maxlength={LEAGUE_NAME_MAX}
		placeholder="Tuesday night, 12 PPR"
		oninput={onleague}
		{onenter}
	/>
</div>

<style>
	.group {
		display: flex;
		flex-direction: column;
		gap: var(--s-3);
	}
</style>
