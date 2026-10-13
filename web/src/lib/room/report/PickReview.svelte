<script lang="ts">
	import { oddsShort, pickLabel } from '#lib/format/draft.ts';
	import { signed } from '#lib/format/number.ts';
	import Face from '#lib/ui/Face.svelte';
	import Label from '#lib/ui/Label.svelte';
	import ToneChip from '#lib/ui/ToneChip.svelte';
	import type { MockReport } from '../api.ts';
	import type { Board } from '../model.ts';

	type Pick = MockReport['picks'][number];
	type Tone = 'gain' | 'loss' | 'even';

	interface Props {
		picks: MockReport['picks'];
		board: Board;
		teams: number;
		/** "Could wait" starts here. */
		couldWaitFrom: number;
		/** Whose picks: your own, or a shared draft's drafter. */
		whose?: 'your' | 'their';
	}

	let { picks, board, teams, couldWaitFrom, whose = 'your' }: Props = $props();

	type MadeFor = Readonly<Record<Exclude<Pick['made_by'], 'you'>, string>>;

	/** Who made a pick nobody chose, in the row's words, for your draft and for a shared one. */
	const MADE_FOR: Readonly<Record<'your' | 'their', MadeFor>> = {
		your: {
			for_you: 'picked for you',
			queue: 'your queue, after you left',
			clock: 'your clock ran out'
		},
		their: {
			for_you: 'picked for them',
			queue: 'their queue, after they left',
			clock: 'their clock ran out'
		}
	};

	function adpChip(pick: Pick): { tone: Tone; text: string } {
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

	/** The hindsight chip, or who made the pick when nobody chose it: a pick made for you carries no
	 * lesson. */
	function hindsight(pick: Pick): { tone: Tone; text: string } {
		if (pick.made_by !== 'you') return { tone: 'even', text: MADE_FOR[whose][pick.made_by] };
		const odds = pick.still_there;
		// No chance recorded: at the last pick there is no next turn, anywhere else the player was
		// deeper than the odds the room computed.
		if (odds === null)
			return { tone: 'even', text: pick.pick === lastPick ? 'last pick' : 'not in the odds' };
		if (odds >= couldWaitFrom)
			return { tone: 'loss', text: `could wait, ${oddsShort(odds)} there next turn` };
		return { tone: 'gain', text: `right on time, ${oddsShort(odds)} there next turn` };
	}

	const lastPick = $derived(picks.at(-1)?.pick ?? null);
	const fellBack = $derived(picks.some((p) => p.odds_source.startsWith('fallback')));
	const madeFor = $derived(picks.filter((p) => p.made_by !== 'you').length);
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
		{@const hind = hindsight(pick)}
		<div class="pk" class:made={pick.made_by !== 'you'}>
			<span class="no">{pickLabel(pick.pick, teams)}</span>
			{#if player}<Face src={player.headshot} name={player.name} size={36} />{:else}<span
				></span>{/if}
			<span class="who">
				<b>{player?.name ?? pick.player_id}</b>
				{#if player}<span>{player.position} {player.positionRank} · {player.team}</span>{/if}
			</span>
			<span class="vor">{pick.over_replacement === null ? '–' : signed(pick.over_replacement)}</span
			>
			<span class="chips">
				<span class="gapc"><ToneChip tone={adp.tone}>{adp.text}</ToneChip></span>
				<span class="hind"><ToneChip tone={hind.tone}>{hind.text}</ToneChip></span>
			</span>
		</div>
	{/each}
</div>
<p class="basis">
	Hindsight is the chance he was still there at {whose} next turn, as the room said at that pick.
	{#if fellBack}A pick the room recorded no odds for reads 200 runs of the room from that pick.{/if}
	"Could wait" starts at {Math.round(couldWaitFrom * 100)}%.
	{#if madeFor > 0}A pick made by Pick for me, a stand-in or the clock has no hindsight, since
		nobody chose it.{/if}
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

	/* On a desk the two chips sit in their own columns. */
	.chips {
		display: contents;
	}

	.no {
		font-family: var(--font-num);
		font-weight: 700;
		font-size: var(--t-lg);
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
		font-size: var(--t-lg);
		text-align: right;
		font-variant-numeric: tabular-nums;
	}

	/* A pick nobody chose reads quieter than the ones you made. */
	.made .no,
	.made .who b {
		color: var(--ink-3);
	}

	.basis {
		font-size: var(--t-xs);
		color: var(--ink-3);
		margin-top: var(--s-3);
		max-width: 70ch;
	}

	/* Narrower: Against ADP and Hindsight move to a second line under the player, never dropped. */
	@media (max-width: 1180px) {
		.pk {
			grid-template-columns: 48px 36px minmax(0, 1fr) 90px;
			row-gap: 6px;
			padding: var(--s-2) 0;
		}

		.head .gapc,
		.head .hind {
			display: none;
		}

		.chips {
			grid-column: 3 / -1;
			display: flex;
			flex-wrap: wrap;
			gap: 6px;
		}
	}

	@media (max-width: 760px) {
		.pk {
			grid-template-columns: 44px 32px minmax(0, 1fr) 70px;
		}
	}
</style>
