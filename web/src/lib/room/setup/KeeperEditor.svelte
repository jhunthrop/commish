<script lang="ts">
	import Quiet from '#lib/ui/Quiet.svelte';
	import TextInput from '#lib/ui/TextInput.svelte';
	import type { BoardPlayer, LeagueSettings } from '../api.ts';

	type Keeper = LeagueSettings['keepers'][number];

	interface Props {
		keepers: readonly Keeper[];
		teams: number;
		rounds: number;
		/** The board's players, for finding a keeper by name. */
		players: readonly BoardPlayer[];
		onchange: (keepers: Keeper[]) => void;
	}

	let { keepers, teams, rounds, players, onchange }: Props = $props();

	/** Names offered while typing: the top of the board is who gets kept. */
	const OFFERED = 300;

	let slot = $state(1);
	let round = $state(1);
	let name = $state('');

	const byName = $derived(new Map(players.map((p) => [p.name.toLowerCase(), p] as const)));
	const byId = $derived(new Map(players.map((p) => [p.id, p] as const)));
	const chosen = $derived(byName.get(name.trim().toLowerCase()) ?? null);
	const taken = $derived(
		chosen !== null &&
			keepers.some((k) => k.player_id === chosen.id || (k.slot === slot && k.round === round))
	);

	function add(): void {
		if (chosen === null || taken) return;
		onchange([...keepers, { slot, round, player_id: chosen.id }]);
		name = '';
	}
</script>

<div class="keepers">
	{#if keepers.length > 0}
		<ul>
			{#each keepers as k (k.player_id)}
				<li>
					<span
						>Slot {k.slot} keeps <b>{byId.get(k.player_id)?.name ?? k.player_id}</b> in round {k.round}</span
					>
					<Quiet
						size="sm"
						onclick={() => onchange(keepers.filter((x) => x.player_id !== k.player_id))}
						>Remove</Quiet
					>
				</li>
			{/each}
		</ul>
	{/if}
	<div class="add">
		<label
			>Slot <select bind:value={slot}>
				{#each Array.from({ length: teams }, (_, i) => i + 1) as n (n)}<option value={n}>{n}</option
					>{/each}
			</select></label
		>
		<label
			>Round <select bind:value={round}>
				{#each Array.from({ length: rounds }, (_, i) => i + 1) as n (n)}<option value={n}
						>{n}</option
					>{/each}
			</select></label
		>
		<TextInput
			list="keeper-names"
			placeholder="Player"
			label="Player to keep"
			bind:value={name}
			onenter={add}
		/>
		<datalist id="keeper-names">
			{#each players.slice(0, OFFERED) as p (p.id)}<option value={p.name}></option>{/each}
		</datalist>
		<Quiet size="sm" disabled={chosen === null || taken} onclick={add}>Keep him</Quiet>
	</div>
</div>

<style>
	.keepers {
		display: flex;
		flex-direction: column;
		gap: var(--s-2);
		width: 100%;
	}

	ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--s-2);
	}

	li {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: var(--s-2);
		font-size: var(--t-sm);
	}

	.add {
		display: flex;
		flex-wrap: wrap;
		gap: var(--s-2);
		align-items: center;
		font-size: var(--t-sm);
	}

	select {
		height: 32px;
		border: 1px solid var(--line-strong);
		border-radius: var(--r-md);
		background: var(--surface);
		color: var(--ink);
		padding: 0 var(--s-2);
	}
</style>
