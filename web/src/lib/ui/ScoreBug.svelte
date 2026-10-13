<script lang="ts">
	import { DEFAULT_TEAMS, clockLabel, pickLabel, snakeSlot } from '#lib/format/draft.ts';

	interface Props {
		/** The overall pick on the clock. */
		now: number;
		/** The drafter on the clock, by handle. */
		onClock: string;
		/** Seconds left on the pick clock. */
		secondsLeft: number;
		/** Your next overall pick. */
		yourPick: number;
		teams?: number;
	}

	let { now, onClock, secondsLeft, yourPick, teams = DEFAULT_TEAMS }: Props = $props();

	/** A screen reader hears the clock only at these marks, never every tick, and only on your own. */
	const SPOKEN_MARKS = [10, 5] as const;

	const round = $derived(snakeSlot(now, teams).round);
	const away = $derived(yourPick - now);
	const yours = $derived(away === 0);
	const spokenMark = $derived(SPOKEN_MARKS.findLast((mark) => secondsLeft <= mark));
	const clockWords = $derived(
		!yours || spokenMark === undefined ? '' : `${spokenMark} seconds left`
	);
</script>

<!-- Lobby only: the score bug appears only in a room with people in it, because only there is anyone on a clock.
     The pick and who is on the clock are announced as they change, with "Your pick is now" when the
     clock turns to you. The countdown to your pick is read, not announced. The ticking clock is hidden
     from screen readers, and a separate line speaks it at ten and five seconds only on your clock. -->
<div class="bug">
	<div role="status" aria-live="polite" class="spoken">
		<div class="seg"><small>Round {round}</small><b>Pick {pickLabel(now, teams)}</b></div>
		<div class="seg grow"><small>On the clock</small><b>{onClock}</b></div>
		<span class="visually-hidden">{yours ? 'Your pick is now' : ''}</span>
	</div>
	<div class="seg clock" aria-hidden="true">
		<small>Clock</small><b>{clockLabel(secondsLeft)}</b>
	</div>
	<!-- Read when a reader moves to it, never announced: "Your pick is now" above is the one line
	     this segment speaks. -->
	<div class="seg you">
		<small>Your pick</small>
		{#if yours}
			<b aria-hidden="true">Now</b>
		{:else}
			<b>{pickLabel(yourPick, teams)}, in {away}</b>
		{/if}
	</div>
	<span class="visually-hidden" aria-live="polite">{clockWords}</span>
</div>

<style>
	.bug {
		position: relative;
		display: flex;
		align-items: stretch;
		min-height: 64px;
		border-radius: var(--r-md);
		overflow: hidden;
		background: var(--scoreboard);
		color: var(--scoreboard-ink);
		border: 1px solid var(--scoreboard-line);
	}

	.seg {
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: 3px;
		padding: 0 var(--s-4);
		border-right: 1px solid var(--scoreboard-line);
		white-space: nowrap;
	}

	.you {
		border-right: 0;
	}

	/* The announced segments, one live region, laid out as part of the bug's row. */
	.spoken {
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: stretch;
	}

	.visually-hidden {
		position: absolute;
		width: 1px;
		height: 1px;
		margin: -1px;
		padding: 0;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
		border: 0;
	}

	small {
		font-size: var(--t-xs);
		font-weight: 600;
		letter-spacing: var(--track-label);
		text-transform: uppercase;
		color: var(--scoreboard-ink-2);
	}

	b {
		font-family: var(--font-num);
		font-weight: 800;
		font-size: var(--t-xl);
		line-height: 1;
		font-variant-numeric: tabular-nums;
	}

	.grow {
		flex: 1;
		min-width: 0;
	}

	.grow b {
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.clock {
		align-items: center;
		min-width: 120px;
	}

	.clock b {
		font-size: var(--t-2xl);
		color: var(--scoreboard-num);
		line-height: 0.85;
	}

	.you b {
		color: var(--scoreboard-num);
	}

	@media (max-width: 760px) {
		.bug {
			min-height: 56px;
		}

		.seg {
			padding: 0 var(--s-3);
		}

		b {
			font-size: var(--t-lg);
		}

		.clock {
			min-width: 80px;
		}

		.clock b {
			font-size: 34px;
		}
	}

	/* The narrowest phones: the four segments only fit with tighter padding and a clock as wide as its digits. */
	@media (max-width: 420px) {
		.seg {
			padding: 0 var(--s-2);
		}

		.clock {
			min-width: 0;
		}
	}
</style>
