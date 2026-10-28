<script lang="ts">
	import Panel from '#lib/ui/Panel.svelte';
	import ProblemLine from '#lib/ui/ProblemLine.svelte';
	import Quiet from '#lib/ui/Quiet.svelte';
	import Verb from '#lib/ui/Verb.svelte';
	import type { LeagueHost } from '../api.ts';
	import {
		MOVE_LINES,
		bidLabel,
		bidProblem,
		hostSaid,
		moveTitle,
		openHostWords,
		readingWords,
		resultWords,
		settingWords,
		type MoveKind,
		type MoveStep
	} from './move.ts';
	import { verbWords } from './words.ts';
	import { focusOnOpen } from './attach.ts';

	/** The confirmation of a move on our screen (spec §10.2): the exact move in the API's words (a
	 * claim with its bid field where the league bids) with the one verb that makes it and a way out;
	 * then what the move came to. A refusal prints the host's reason in its own words under ours; a
	 * move the host has not shown yet says to check the host, a queued claim when the host runs it;
	 * an unavailable one is the host's page. Never a retry, never a second confirmation. */
	interface Props {
		id: string;
		kind: MoveKind;
		step: Exclude<MoveStep, { kind: 'closed' }>;
		host: LeagueHost;
		onconfirm: () => void;
		onclose: () => void;
		/** A claim's bid as typed, and what a change to it does (plans the claim again). */
		typed?: string;
		onbid?: (typed: string) => void;
		/** The claim is planned again for a new bid: its verb waits. */
		replanning?: boolean;
		/** The page's one verb confirms this move with others (the every-league page, Lane 257): the
		 * panel says the move, and while it is sent says so, with no verb of its own. */
		held?: boolean;
	}

	let {
		id,
		kind,
		step,
		host,
		onconfirm,
		onclose,
		typed = '',
		onbid,
		replanning = false,
		held = false
	}: Props = $props();

	const verb = $derived(verbWords(kind === 'claim' ? 'waivers' : 'start', host));
	const bid = $derived(step.kind === 'confirm' || step.kind === 'sending' ? step.plan.bid : null);
	const problem = $derived(bid === null ? null : bidProblem(host, typed, bid));
	/** The verb makes only the move the sentence names: the bid typed is the one planned. */
	const waits = $derived(
		replanning || (bid !== null && (problem !== null || Number(typed) !== bid.amount))
	);
</script>

<div {id} class="move" tabindex="-1" {@attach focusOnOpen}>
	<Panel as="section" label={moveTitle(kind)} edge={step.kind === 'failed' ? 'loss' : 'accent'}>
		<div class="body" aria-live="polite">
			{#if step.kind === 'planning'}
				<p class="line quiet">{readingWords(host, kind)}</p>
			{:else if step.kind === 'confirm' || step.kind === 'sending'}
				<p class="line">{step.plan.sentence}</p>
				{#if bid !== null}
					<label class="bid">
						<span>{bidLabel(bid)}</span>
						<input
							type="number"
							inputmode="numeric"
							min={bid.min}
							max={bid.max}
							step="1"
							value={typed}
							disabled={step.kind === 'sending'}
							oninput={(event) => onbid?.(event.currentTarget.value)}
						/>
					</label>
					{#if problem}<ProblemLine>{problem}</ProblemLine>{/if}
				{/if}
				{#if held}
					{#if step.kind === 'sending'}<p class="line quiet">{settingWords(host, kind)}</p>{/if}
				{:else}
					<div class="actions">
						<Verb onclick={onconfirm} disabled={step.kind === 'sending' || waits}
							>{step.kind === 'sending' ? settingWords(host, kind) : verb}</Verb
						>
						<Quiet onclick={onclose} disabled={step.kind === 'sending'}>{MOVE_LINES.notNow}</Quiet>
					</div>
				{/if}
			{:else if step.kind === 'answered'}
				<p class="line">{resultWords(host, step.result)}</p>
				{#if step.result.outcome === 'refused' && step.result.host_words}
					<p class="said">{hostSaid(host, step.result.host_words)}</p>
				{/if}
				<div class="actions">
					{#if step.result.outcome !== 'done' && step.result.host_url !== ''}
						<Quiet href={step.result.host_url}>{openHostWords(host)}</Quiet>
					{/if}
					<Quiet onclick={onclose}>{MOVE_LINES.done}</Quiet>
				</div>
			{:else if step.kind === 'unavailable'}
				<p class="line">{step.sentence}</p>
				<div class="actions">
					{#if step.href !== ''}<Verb href={step.href}>{verb}</Verb>{/if}
					<Quiet onclick={onclose}>{MOVE_LINES.notNow}</Quiet>
				</div>
			{:else}
				<ProblemLine>{step.sentence}</ProblemLine>
				<div class="actions">
					{#if step.href}<Quiet href={step.href}>{openHostWords(host)}</Quiet>{/if}
					<Quiet onclick={onclose}>{MOVE_LINES.notNow}</Quiet>
				</div>
			{/if}
		</div>
	</Panel>
</div>

<style>
	.move {
		outline: none;
		scroll-margin: var(--s-4);
	}

	.body {
		display: flex;
		flex-direction: column;
		gap: var(--s-3);
	}

	.line {
		margin: 0;
		max-width: 72ch;
		font-size: var(--t-md);
		font-weight: 600;
		line-height: 1.4;
	}

	.quiet {
		color: var(--ink-2);
		font-weight: 400;
	}

	.said {
		margin: 0;
		max-width: 72ch;
		color: var(--ink-2);
		font-size: var(--t-sm);
	}

	.bid {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--s-2) var(--s-3);
		font-size: var(--t-sm);
		color: var(--ink-2);
	}

	.bid input {
		width: 7em;
		min-height: 40px;
		padding: 0 var(--s-2);
		border: 1px solid var(--line-strong);
		border-radius: var(--r-sm);
		background: var(--surface);
		color: var(--ink);
		font: inherit;
		font-variant-numeric: tabular-nums;
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--s-2);
	}
</style>
