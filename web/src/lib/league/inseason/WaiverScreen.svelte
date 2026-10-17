<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import Chip from '#lib/ui/Chip.svelte';
	import ChipGroup from '#lib/ui/ChipGroup.svelte';
	import Panel from '#lib/ui/Panel.svelte';
	import PanelHead from '#lib/ui/PanelHead.svelte';
	import ProblemLine from '#lib/ui/ProblemLine.svelte';
	import Quiet from '#lib/ui/Quiet.svelte';
	import ValueCell from '#lib/ui/ValueCell.svelte';
	import type { LeagueHost } from '../api.ts';
	import LineRow from './LineRow.svelte';
	import { WAIVERS_AT_PARAM } from './tabs.ts';
	import MovePanel from './MovePanel.svelte';
	import Screen from './Screen.svelte';
	import type {
		HostMoveInput,
		HostMovePlan,
		HostMoveResult,
		WaiverAdvice,
		WaiverPosition,
		WaiverRow
	} from './api.ts';
	import {
		bidProblem,
		addKey,
		claimMove,
		claimable,
		claimsOnHost,
		failedStep,
		planStep,
		resultStep,
		type MoveStep
	} from './move.ts';
	import Label from '#lib/ui/Label.svelte';
	import { Narrowing, sharedDrop, waiverGroups } from './state.ts';
	import {
		GAIN_DECIMALS,
		LATER_RULE,
		LINES,
		NO_START_RULE,
		addsTitle,
		dropWords,
		sharedDropWords,
		startingCount,
		verbWords,
		waiverDecision
	} from './words.ts';

	/** Waivers (spec §5): the unrostered players ranked by what they add to this lineup, each with
	 * the player it costs least to drop for him, a position at a time if you like (read again for
	 * that position, so it is never cut to the first rows of every position). Add marks the pair as
	 * the decision, and the one verb opens the host's waiver page to claim it. Where the API opens
	 * the claim (spec §10.2), Add opens a confirmation on this screen naming the add, the drop and,
	 * where the league bids, the bid the member types; its one verb claims on the host. */
	interface Props {
		advice: WaiverAdvice;
		host: LeagueHost;
		/** Reads the adds at one position. */
		narrow: (position: WaiverPosition) => Promise<WaiverAdvice>;
		/** Plans the claim in words with its confirm token; nothing is sent. */
		plan: (move: HostMoveInput) => Promise<HostMovePlan>;
		/** Makes the planned claim once with its token. */
		make: (move: HostMoveInput, confirm: string) => Promise<HostMoveResult>;
		/** Reads the adds again, once a claim has been made. */
		reread: () => void;
	}

	let { advice, host, narrow, plan, make, reread }: Props = $props();

	const MOVE_ID = 'claim-move';
	/** How long a typed bid rests before the claim is planned again for it: long enough that a
	 * member still typing costs no plan (each plan reads ESPN twice). */
	const BID_PAUSE_MS = 600;
	let step = $state<MoveStep>({ kind: 'closed' });
	/** The claim as last planned: the one the token makes, whatever is typed meanwhile. */
	let planned: HostMoveInput | null = null;
	/** The row the confirmation is for. */
	let claiming = $state<WaiverRow | null>(null);
	/** The bid as typed; the plan's own bid until the member types one. */
	let typed = $state('');
	let replanning = $state(false);
	let pause: ReturnType<typeof setTimeout> | undefined;

	/** The positions the route narrows to, in the board's order. */
	const POSITIONS: readonly WaiverPosition[] = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];

	let position = $state<WaiverPosition | null>(null);
	/** The answer for the chosen position, null for every position or until it is read. */
	let narrowed = $state<WaiverAdvice | null>(null);
	let reading = $state(false);
	let problem = $state<string | null>(null);
	/** The add the member marked, by his host id; null keeps the best add as the decision. */
	let marked = $state<string | null>(null);

	const idOf = addKey;
	const positions = $derived(
		POSITIONS.filter((p) => advice.rows.some((r) => r.add.player.position === p))
	);
	const shown = $derived(narrowed ?? advice);
	/** The rows of the chosen position: the narrowed answer's, or this answer's own while it is read. */
	const visible = $derived(
		position === null || narrowed !== null
			? shown.rows
			: advice.rows.filter((r) => r.add.player.position === position)
	);
	/** Who starts this week (the count), who helps but sits this week, and the rest. */
	const groups = $derived(waiverGroups(visible));
	/** The drop every add shares, said once over the rows rather than on each. */
	const shared = $derived(sharedDrop(visible));
	const chosen = $derived(visible.find((r) => idOf(r) === marked) ?? shown.best);

	// The route's reader is fixed for the page's life.
	// svelte-ignore state_referenced_locally
	const narrowing = new Narrowing(narrow);

	const onHost = $derived(claimsOnHost(shown));

	/** Plans the claim for the row with the bid (null: none typed yet, the plan says the league's
	 * least where it bids). Only the latest plan is kept. */
	async function planFor(row: WaiverRow, bid: number | null): Promise<void> {
		const move = claimMove(shown.week, row, bid);
		planned = move;
		if (bid === null) step = { kind: 'planning' };
		else replanning = true;
		try {
			const answer = await plan(move);
			if (planned !== move) return;
			step = planStep(answer);
			// The first plan says the league's least bid: planned again as that number, so the token
			// makes the bid the member sees, never one the API derives again at send time.
			if (bid === null && answer.bid) {
				typed = String(answer.bid.amount);
				void planFor(row, answer.bid.amount);
			}
		} catch (error) {
			if (planned === move) {
				step = failedStep(error, host, 'plan', shown.host_waivers_url, 'claim');
			}
		} finally {
			if (planned === move) replanning = false;
		}
	}

	/** Add on a row: marks it and opens the claim for it. */
	function openClaim(row: WaiverRow): void {
		// One claim at a time: while one is on its way, its answer stays on screen.
		if (step.kind === 'sending' || !claimable(row)) return;
		marked = idOf(row);
		claiming = row;
		typed = '';
		void planFor(row, null);
	}

	/** A typed bid: planned again once it rests, when the league takes it. */
	function onbid(value: string): void {
		typed = value;
		clearTimeout(pause);
		const row = claiming;
		if (row === null || step.kind !== 'confirm' || step.plan.bid === null) return;
		if (bidProblem(host, value, step.plan.bid) !== null) return;
		pause = setTimeout(() => void planFor(row, Number(value)), BID_PAUSE_MS);
	}

	async function confirm(): Promise<void> {
		if (step.kind !== 'confirm' || planned === null) return;
		const { plan: ready } = step;
		step = { kind: 'sending', plan: ready };
		try {
			step = resultStep(await make(planned, ready.confirm));
			reread();
		} catch (error) {
			step = failedStep(error, host, 'make', shown.host_waivers_url, 'claim');
		}
	}

	function close(): void {
		clearTimeout(pause);
		step = { kind: 'closed' };
		planned = null;
		claiming = null;
	}

	// A link naming a position (the Rest of season screen's Add) opens on it.
	onMount(() => {
		const asked = positions.find((p) => p === page.url.searchParams.get(WAIVERS_AT_PARAM));
		if (asked !== undefined) void choose(asked);
	});

	async function choose(next: WaiverPosition | null): Promise<void> {
		position = next;
		narrowed = null;
		problem = null;
		reading = next !== null;
		const outcome = await narrowing.choose(next);
		if (outcome.kind === 'overtaken') return;
		reading = false;
		if (outcome.kind === 'answer') narrowed = outcome.answer;
		if (outcome.kind === 'failed') problem = outcome.sentence;
	}
</script>

{#snippet row(r: WaiverRow)}
	{@const on = marked === idOf(r)}
	<div class="pick" class:on>
		<LineRow line={r.add} note={shared === null ? dropWords(r) : undefined} factsOnPhone={false}>
			{#snippet trailing()}
				<span class="end">
					{#if r.gain > 0}
						<ValueCell
							value={r.gain}
							label={LINES.toYourLineup}
							phoneLabel={false}
							signed
							decimals={GAIN_DECIMALS}
						/>
					{/if}
					<span class="mark">
						{#if onHost && claimable(r)}
							<Quiet size="sm" onclick={() => openClaim(r)} disabled={step.kind === 'sending'}
								>{LINES.add}</Quiet
							>
						{:else}
							<Quiet size="sm" onclick={() => (marked = on ? null : idOf(r))}
								>{on ? LINES.chosen : LINES.add}</Quiet
							>
						{/if}
					</span>
				</span>
			{/snippet}
		</LineRow>
	</div>
{/snippet}

<Screen
	decision={waiverDecision(chosen)}
	reason={chosen && !chosen.starts ? chosen.sentence : null}
	verb={verbWords('waivers', host)}
	href={shown.host_waivers_url}
	hostNote={shown.host_note ?? shown.moves.note}
	basis={shown.basis}
	basisNote={shown.basis_note}
	onverb={onHost && chosen && claimable(chosen) ? () => openClaim(chosen) : null}
	controls={onHost ? MOVE_ID : undefined}
	expanded={onHost ? step.kind !== 'closed' : undefined}
>
	{#snippet move()}
		{#if step.kind !== 'closed'}
			<MovePanel
				id={MOVE_ID}
				kind="claim"
				{step}
				{host}
				{typed}
				{onbid}
				{replanning}
				onconfirm={() => void confirm()}
				onclose={close}
			/>
		{/if}
	{/snippet}
	<Panel as="section" label={LINES.waiverAdds} padding="none">
		<div class="head">
			<PanelHead
				title={addsTitle(advice.week)}
				aside={startingCount(groups.starting.length)}
				level={2}
			/>
			<ChipGroup label={LINES.position}>
				<Chip size="sm" pressed={position === null} onclick={() => void choose(null)}
					>{LINES.all}</Chip
				>
				{#each positions as p (p)}
					<Chip size="sm" pressed={position === p} onclick={() => void choose(p)}>{p}</Chip>
				{/each}
			</ChipGroup>
			{#if problem}<ProblemLine>{problem}</ProblemLine>{/if}
			{#if shared !== null || groups.starting.length + groups.later.length > 0}
				<div class="under">
					<span
						>{#if shared}{sharedDropWords(shared)}{/if}</span
					>
					<span class="phone"><Label>{LINES.gainHead}</Label></span>
				</div>
			{/if}
		</div>
		<div class="rows" class:reading aria-busy={reading}>
			{#each groups.starting as r (idOf(r))}{@render row(r)}{/each}
			{#if groups.later.length > 0}
				<p class="rule">{LATER_RULE}</p>
				{#each groups.later as r (idOf(r))}{@render row(r)}{/each}
			{/if}
			{#if groups.rest.length > 0}
				<p class="rule">{NO_START_RULE}</p>
				{#each groups.rest as r (idOf(r))}{@render row(r)}{/each}
			{/if}
		</div>
	</Panel>
</Screen>

<style>
	.head {
		display: flex;
		flex-direction: column;
		gap: var(--s-2);
		padding: var(--s-3);
	}

	/* While a position is read, its rows from the last answer stay, quieter. */
	.reading {
		opacity: 0.6;
	}

	.pick.on {
		background: var(--accent-wash);
	}

	.end {
		display: flex;
		align-items: center;
		gap: var(--s-3);
	}

	/* The row's link covers it; the mark sits above so a tap on it marks rather than opens. */
	.mark {
		position: relative;
		z-index: 1;
	}

	/* Over the rows: the drop they share, and on a phone what the rows' number is, since the cell
	   prints it alone there. */
	.under {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: var(--s-3);
		font-size: var(--t-sm);
		font-weight: 600;
		color: var(--ink);
	}

	.phone {
		display: none;
	}

	@media (max-width: 760px) {
		.phone {
			display: inline;
		}
	}

	.rule {
		margin: 0;
		padding: var(--s-3) var(--s-3) var(--s-2);
		border-top: 2px solid var(--line-strong);
		color: var(--ink-2);
		font-size: var(--t-sm);
		font-weight: 600;
	}
</style>
