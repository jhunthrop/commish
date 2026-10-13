<script lang="ts">
	import { oddsShort, pickLabel } from '#lib/format/draft.ts';
	import { signed } from '#lib/format/number.ts';
	import Face from '#lib/ui/Face.svelte';
	import Label from '#lib/ui/Label.svelte';
	import ToneChip from '#lib/ui/ToneChip.svelte';
	import type { MockReport } from '../api.ts';
	import type { Board } from '../model.ts';

	interface Props {
		picks: MockReport['picks'];
		board: Board;
		teams: number;
		/** "Could wait" starts here. */
		couldWaitFrom: number;
	}

	let { picks, board, teams, couldWaitFrom }: Props = $props();

	function adpChip(pick: MockReport['picks'][number]): {
		tone: 'gain' | 'loss' | 'even';
		text: string;
	} {
		const gap = pick.adp_gap === null ? null : Math.round(pick.adp_gap);
		switch (pick.chip) {
			case 'reach':
				return { tone: 'loss', text: `${Math.abs(gap ?? 0)} before drafters` };
			case 'steal':
				return { tone: 'gain', text: `${Math.abs(gap ?? 0)} after drafters` };
			case 'at_adp':
				return { tone: 'even', text: 'at ADP' };
			default:
				return { tone: 'even', text: 'no ADP' };
		}
	}

	function hindsight(odds: number | null): { tone: 'gain' | 'loss' | 'even'; text: string } {
		if (odds === null) return { tone: 'even', text: 'last pick' };
		if (odds >= couldWaitFrom)
			return { tone: 'loss', text: `could wait, ${oddsShort(odds)} there next turn` };
		return { tone: 'gain', text: `right on time, ${oddsShort(odds)} there next turn` };
	}

	const fellBack = $derived(picks.some((p) => p.odds_source.startsWith('fallback')));
</script>

<div class="picks">
	<div class="pk head" aria-hidden="true">
		<Label>Pick</Label><span></span><Label>Player</Label>
		<Label align="end">Over repl</Label>
		<span class="gapc"><Label>Against ADP</Label></span>
		<span class="hind"><Label>Hindsight</Label></span>
	</div>
	{#each picks as pick (pick.pick)}
		{@const player = board.byId.get(pick.player_id)}
		{@const adp = adpChip(pick)}
		{@const hind = hindsight(pick.still_there)}
		<div class="pk">
			<span class="no">{pickLabel(pick.pick, teams)}</span>
			{#if player}<Face src={player.headshot} size={36} />{:else}<span></span>{/if}
			<span class="who">
				<b>{player?.name ?? pick.player_id}</b>
				{#if player}<span>{player.position} {player.positionRank} · {player.team}</span>{/if}
			</span>
			<span class="vor">{pick.over_replacement === null ? '–' : signed(pick.over_replacement)}</span
			>
			<span class="gapc"><ToneChip tone={adp.tone}>{adp.text}</ToneChip></span>
			<span class="hind"><ToneChip tone={hind.tone}>{hind.text}</ToneChip></span>
		</div>
	{/each}
</div>
<p class="basis">
	Hindsight is the chance he was still there at your next turn, as the room said at that pick.
	{#if fellBack}A pick the room recorded no odds for reads 200 runs of the room from that pick.{/if}
	"Could wait" starts at {Math.round(couldWaitFrom * 100)}%.
</p>

<style>
	.picks {
		display: flex;
		flex-direction: column;
	}

	.pk {
		display: grid;
		grid-template-columns: 52px 36px minmax(0, 1fr) 112px 150px 190px;
		gap: var(--s-3);
		align-items: center;
		min-height: var(--row-h);
		padding: 4px 0;
		border-bottom: 1px solid var(--line);
		font-size: var(--t-sm);
	}

	.head {
		min-height: 0;
		padding-bottom: var(--s-2);
		border-bottom: 1px solid var(--line-strong);
	}

	.no {
		font-family: var(--font-num);
		font-weight: 700;
		font-size: 20px;
		color: var(--ink-2);
	}

	.who {
		min-width: 0;
	}

	.who b {
		display: block;
		font-weight: 600;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.who span {
		color: var(--ink-3);
		font-size: var(--t-xs);
	}

	.vor {
		font-family: var(--font-num);
		font-weight: 700;
		font-size: 20px;
		text-align: right;
		font-variant-numeric: tabular-nums;
	}

	.basis {
		font-size: var(--t-xs);
		color: var(--ink-3);
		margin-top: var(--s-3);
		max-width: 70ch;
	}

	@media (max-width: 1180px) {
		.pk {
			grid-template-columns: 48px 36px minmax(0, 1fr) 90px 190px;
		}

		.gapc {
			display: none;
		}
	}

	@media (max-width: 760px) {
		.pk {
			grid-template-columns: 44px 32px minmax(0, 1fr) 70px;
		}

		.hind {
			display: none;
		}
	}
</style>
