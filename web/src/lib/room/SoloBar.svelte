<script lang="ts">
	import { pickLabel } from '#lib/format/draft.ts';
	import Menu from '#lib/ui/Menu.svelte';
	import Quiet from '#lib/ui/Quiet.svelte';
	import { picksAwayWords } from './words.ts';

	interface Props {
		/** The pick on the clock. */
		now: number;
		round: number;
		/** "12 teams · PPR · slot 8". */
		league: string;
		/** Your next pick after this one, null at your last. */
		next: number | null;
		teams: number;
		/** The round "Pick for me" drafts through. */
		autopickTo: number;
		canUndo: boolean;
		busy: boolean;
		/** Set for a moment after the link is copied. */
		copied: boolean;
		onundo: () => void;
		onautopick: () => void;
		onfinish: () => void;
		onshare: () => void;
	}

	let {
		now,
		round,
		league,
		next,
		teams,
		autopickTo,
		canUndo,
		busy,
		copied,
		onundo,
		onautopick,
		onfinish,
		onshare
	}: Props = $props();
</script>

<div class="bar">
	<div class="where">
		<b>Pick {pickLabel(now, teams)}</b><span>Round {round} · {league}</span>
	</div>
	{#if next !== null}
		<div class="next">
			<span>Your next</span><b>{pickLabel(next, teams)}</b><span
				>{picksAwayWords(next - now - 1)}</span
			>
		</div>
	{/if}
	<!-- On the phone Undo stays out and the rest fold into More, so the strip and our call come
		 first. -->
	<div class="acts">
		<Quiet key="U" disabled={!canUndo || busy} onclick={onundo}>Undo</Quiet>
		<span class="spread">{@render more()}</span>
		<span class="folded"><Menu label="More" id="room-more">{@render more()}</Menu></span>
	</div>
</div>

{#snippet more()}
	<Quiet disabled={busy} onclick={onautopick}>Pick for me to round {autopickTo}</Quiet>
	<Quiet disabled={busy} onclick={onfinish}>Finish the draft</Quiet>
	<Quiet onclick={onshare}>{copied ? 'Link copied' : 'Save and share'}</Quiet>
{/snippet}

<style>
	.bar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--s-3) var(--s-4);
		min-height: 48px;
	}

	.where,
	.next {
		display: flex;
		align-items: baseline;
		gap: var(--s-2);
		white-space: nowrap;
	}

	.where b {
		font-family: var(--font-num);
		font-variant-numeric: tabular-nums;
		font-weight: 800;
		font-size: var(--t-head);
		line-height: 1;
		text-transform: uppercase;
	}

	.where span,
	.next span {
		font-size: var(--t-sm);
		color: var(--ink-2);
	}

	.next b {
		font-family: var(--font-num);
		font-variant-numeric: tabular-nums;
		font-weight: 700;
		font-size: var(--t-xl);
		line-height: 1;
	}

	.acts {
		margin-left: auto;
		display: flex;
		flex-wrap: wrap;
		gap: var(--s-2);
	}

	.spread {
		display: contents;
	}

	.folded {
		display: none;
	}

	@media (max-width: 760px) {
		.acts {
			margin-left: 0;
			width: 100%;
			flex-wrap: nowrap;
		}

		.spread {
			display: none;
		}

		.folded {
			display: inline-flex;
		}
	}
</style>
