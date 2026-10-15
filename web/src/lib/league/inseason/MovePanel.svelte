<script lang="ts">
	import Panel from '#lib/ui/Panel.svelte';
	import ProblemLine from '#lib/ui/ProblemLine.svelte';
	import Quiet from '#lib/ui/Quiet.svelte';
	import Verb from '#lib/ui/Verb.svelte';
	import type { LeagueHost } from '../api.ts';
	import {
		MOVE_LINES,
		hostSaid,
		openHostWords,
		readingWords,
		settingWords,
		type MoveStep
	} from './move.ts';
	import { verbWords } from './words.ts';

	/** The confirmation of a lineup move on our screen (spec §10.2): the exact changes in the API's
	 * words with the one verb that makes them and a way out; then what the move came to. A refusal
	 * prints the host's reason in its own words under ours; a move the host has not shown yet says to
	 * check the host; an unavailable one is the host's page. Never a retry, never a second
	 * confirmation. */
	interface Props {
		id: string;
		step: Exclude<MoveStep, { kind: 'closed' }>;
		host: LeagueHost;
		onconfirm: () => void;
		onclose: () => void;
	}

	let { id, step, host, onconfirm, onclose }: Props = $props();

	const verb = $derived(verbWords('start', host));

	/** The panel takes the focus when it opens, so a keyboard or a phone lands on the move. */
	function focusOnOpen(node: HTMLElement): void {
		node.focus({ preventScroll: true });
		node.scrollIntoView({ block: 'nearest' });
	}
</script>

<div {id} class="move" tabindex="-1" {@attach focusOnOpen}>
	<Panel as="section" label={MOVE_LINES.title} edge={step.kind === 'failed' ? 'loss' : 'accent'}>
		<div class="body" aria-live="polite">
			{#if step.kind === 'planning'}
				<p class="line quiet">{readingWords(host)}</p>
			{:else if step.kind === 'confirm' || step.kind === 'sending'}
				<p class="line">{step.plan.sentence}</p>
				<div class="actions">
					<Verb onclick={onconfirm} disabled={step.kind === 'sending'}
						>{step.kind === 'sending' ? settingWords(host) : verb}</Verb
					>
					<Quiet onclick={onclose} disabled={step.kind === 'sending'}>{MOVE_LINES.notNow}</Quiet>
				</div>
			{:else if step.kind === 'answered'}
				<p class="line">{step.result.sentence}</p>
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

	.actions {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--s-2);
	}
</style>
