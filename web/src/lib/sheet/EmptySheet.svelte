<script lang="ts">
	import { plural } from '#lib/format/number.ts';
	import Label from '#lib/ui/Label.svelte';
	import Panel from '#lib/ui/Panel.svelte';
	import Place from '#lib/ui/Place.svelte';
	import PlayerLine from '#lib/ui/PlayerLine.svelte';
	import Quiet from '#lib/ui/Quiet.svelte';
	import Verb from '#lib/ui/Verb.svelte';
	import type { DirectoryPlayer } from './directory.ts';
	import { FORMAT_LABELS } from './format.ts';
	import type { BoardFormat } from './model.ts';

	/**
	 * A sheet with no one on it: the first players "Start from our board" would put on it, with
	 * their faces, so the verb shows what it does before it is pressed.
	 */
	interface Props {
		/** Our board for the format, or null while it loads or when we have none. */
		board: readonly DirectoryPlayer[] | null;
		format: BoardFormat;
		starting: boolean;
		problem: string | null;
		onstart: () => void;
		onimport: () => void;
	}

	let { board, format, starting, problem, onstart, onimport }: Props = $props();

	/** How many of our board's first players the preview shows. */
	const PREVIEWED = 5;

	const first = $derived(board?.slice(0, PREVIEWED) ?? []);
	const rest = $derived(board ? board.length - first.length : 0);
</script>

<Panel as="section" label="Start your sheet">
	<div class="start">
		<div class="preview">
			<Label>Our {FORMAT_LABELS[format]} board, best first</Label>
			<ol aria-busy={board === null}>
				{#each first as player, index (player.id)}
					<li>
						<PlayerLine
							name={player.name}
							position={player.position}
							positionRank={player.positionRank}
							team={player.team}
							headshot={player.headshot ?? undefined}
							size={40}
						>
							{#snippet trailing()}<Place place={index + 1} />{/snippet}
						</PlayerLine>
					</li>
				{/each}
			</ol>
			{#if rest > 0}<Label>And {plural(rest, 'more player')}</Label>{/if}
		</div>
		<div class="verbs">
			<Verb size="lg" disabled={starting} onclick={onstart}>Start from our board</Verb>
			<Quiet size="lg" onclick={onimport}>Import a sheet</Quiet>
			{#if problem}<p class="problem" role="alert">{problem}</p>{/if}
		</div>
	</div>
</Panel>

<style>
	.start {
		display: grid;
		grid-template-columns: minmax(0, 560px) minmax(0, 280px);
		justify-content: start;
		align-items: center;
		gap: var(--s-6);
	}

	.preview {
		display: flex;
		flex-direction: column;
		gap: var(--s-2);
		min-width: 0;
	}

	ol {
		list-style: none;
		margin: 0;
		padding: 0;
		/* Holds five lines open while our board loads, so nothing below moves when they land. */
		min-height: calc(5 * 52px);
	}

	li {
		border-bottom: 1px solid var(--line);
	}

	.verbs {
		display: flex;
		flex-direction: column;
		align-items: stretch;
		gap: var(--s-3);
	}

	.problem {
		margin: 0;
		color: var(--loss-ink);
		font-size: var(--t-sm);
	}

	@media (max-width: 760px) {
		.start {
			grid-template-columns: minmax(0, 1fr);
			gap: var(--s-4);
		}
	}
</style>
