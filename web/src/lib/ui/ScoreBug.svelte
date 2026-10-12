<script lang="ts">
	import { DEFAULT_TEAMS, pickLabel, snakeSlot } from '#lib/format/draft.ts';

	interface Props {
		/** The overall pick on the clock. */
		now: number;
		/** The drafter on the clock, by handle. */
		onClock: string;
		/** The clock as it reads: "0:19". */
		clock: string;
		/** Your next overall pick. */
		yourPick: number;
		teams?: number;
	}

	let { now, onClock, clock, yourPick, teams = DEFAULT_TEAMS }: Props = $props();

	const round = $derived(snakeSlot(now, teams).round);
	const away = $derived(yourPick - now);
</script>

<!-- Lobby only: the score bug appears only in a room with people in it, because only there is anyone on a clock. -->
<div class="bug" role="status" aria-live="polite">
	<div><small>Round {round}</small><b>Pick {pickLabel(now, teams)}</b></div>
	<div class="grow"><small>On the clock</small><b>{onClock}</b></div>
	<div class="clock"><small>Clock</small><b>{clock}</b></div>
	<div class="you">
		<small>Your pick</small>
		<b>{away === 0 ? 'Now' : `${pickLabel(yourPick, teams)}, in ${away}`}</b>
	</div>
</div>

<style>
	.bug {
		display: flex;
		align-items: stretch;
		min-height: 64px;
		border-radius: var(--r-md);
		overflow: hidden;
		background: var(--scoreboard);
		color: var(--scoreboard-ink);
		border: 1px solid var(--line);
	}

	.bug > div {
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: 3px;
		padding: 0 var(--s-4);
		border-right: 1px solid var(--scoreboard-line);
		white-space: nowrap;
	}

	.bug > div:last-child {
		border-right: 0;
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

		.bug > div {
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
		.bug > div {
			padding: 0 var(--s-2);
		}

		.clock {
			min-width: 0;
		}
	}
</style>
