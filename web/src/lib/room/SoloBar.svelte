<script lang="ts">
	import { pickLabel } from '#lib/format/draft.ts';
	import Quiet from '#lib/ui/Quiet.svelte';

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
		shared: boolean;
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
		shared,
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
			<span>Your next</span><b>{pickLabel(next, teams)}</b><span>{next - now - 1} picks away</span>
		</div>
	{/if}
	<div class="acts">
		<Quiet key="U" disabled={!canUndo || busy} onclick={onundo}>Undo</Quiet>
		<Quiet disabled={busy} onclick={onautopick}>Pick for me to round {autopickTo}</Quiet>
		<Quiet disabled={busy} onclick={onfinish}>Finish the draft</Quiet>
		<Quiet onclick={onshare}>{shared ? 'Link copied' : 'Save and share'}</Quiet>
	</div>
</div>

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
		font-size: 30px;
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
		font-size: 22px;
		line-height: 1;
	}

	.acts {
		margin-left: auto;
		display: flex;
		flex-wrap: wrap;
		gap: var(--s-2);
	}

	@media (max-width: 760px) {
		.acts {
			margin-left: 0;
			width: 100%;
		}
	}
</style>
