<script lang="ts">
	import { RECORD_BOX, RECORD_SOURCES, type RecordSource } from '#lib/run/record.ts';

	/** Order matched by week (Lane 66j): one line per order over the season's weeks, the graded weeks
	 * drawn, each line named at its end. The table above holds every figure; this draws them. */
	interface Props {
		series: Record<RecordSource, { week: number; value: number }[]>;
		/** The season's last week, the axis's end. */
		weeks: number;
	}

	let { series, weeks }: Props = $props();

	const WIDTH = 860;
	const HEIGHT = 230;
	const PAD = { left: 40, right: 104, top: 14, bottom: 28 };
	/** The axis's top: order matched runs to 1, and a week's rarely passes 0.8. */
	const TOP = 0.8;
	const TICKS = [0, 0.2, 0.4, 0.6, 0.8];
	/** How far apart two line names stand where their lines end close together. */
	const LABEL_GAP = 15;
	const NAMES: Record<RecordSource, string> = {
		ours: RECORD_BOX.ours,
		adp: RECORD_BOX.adp,
		published: RECORD_BOX.published
	};

	const x = (week: number): number =>
		PAD.left + ((week - 1) * (WIDTH - PAD.left - PAD.right)) / Math.max(1, weeks - 1);
	const y = (value: number): number =>
		PAD.top + (1 - Math.max(0, Math.min(TOP, value)) / TOP) * (HEIGHT - PAD.top - PAD.bottom);

	const drawn = $derived.by(() => {
		const ends = RECORD_SOURCES.filter((source) => series[source].length > 0)
			.map((source) => ({ source, points: series[source] }))
			.sort((a, b) => y(a.points.at(-1)?.value ?? 0) - y(b.points.at(-1)?.value ?? 0));
		const placed: number[] = [];
		return ends.map(({ source, points }) => {
			const last = points.at(-1);
			const labelY = Math.max(y(last?.value ?? 0) + 4, ...placed.map((p) => p + LABEL_GAP));
			placed.push(labelY);
			return {
				source,
				path: points
					.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.week).toFixed(1)},${y(p.value).toFixed(1)}`)
					.join(' '),
				points,
				label: { x: x(last?.week ?? 1) + 10, y: labelY }
			};
		});
	});
</script>

<figure class="chart">
	<figcaption>{RECORD_BOX.chart}</figcaption>
	<svg viewBox="0 0 {WIDTH} {HEIGHT}" role="img" aria-label={RECORD_BOX.chart}>
		{#each TICKS as tick (tick)}
			<line class="grid" x1={PAD.left} x2={WIDTH - PAD.right} y1={y(tick)} y2={y(tick)} />
			<text class="axis" x={PAD.left - 8} y={y(tick) + 4} text-anchor="end">{tick.toFixed(1)}</text>
		{/each}
		{#each Array.from({ length: weeks }, (_, i) => i + 1) as week (week)}
			<text class="axis" x={x(week)} y={HEIGHT - 8} text-anchor="middle">{week}</text>
		{/each}
		{#each drawn as line (line.source)}
			<g class={line.source}>
				<path d={line.path} />
				{#each line.points as point (point.week)}<circle
						cx={x(point.week)}
						cy={y(point.value)}
						r="3.5"
					/>{/each}
				<text x={line.label.x} y={line.label.y}>{NAMES[line.source]}</text>
			</g>
		{/each}
	</svg>
</figure>

<style>
	.chart {
		margin: 0;
		max-width: 900px;
	}

	figcaption {
		margin-bottom: var(--s-2);
		font-size: var(--t-xs);
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: var(--track-label);
		color: var(--ink-3);
	}

	svg {
		display: block;
		width: 100%;
		height: auto;
	}

	.grid {
		stroke: var(--line);
		stroke-width: 1;
	}

	.axis {
		font-size: 11px;
		fill: var(--ink-3);
	}

	path {
		fill: none;
		stroke-width: 2.5;
	}

	g text {
		font-size: 12px;
		font-weight: 700;
	}

	.ours path {
		stroke: var(--accent);
	}

	.ours circle {
		fill: var(--accent);
	}

	.ours text {
		fill: var(--accent-text);
	}

	.adp path {
		stroke: var(--ink-3);
	}

	.adp circle,
	.adp text {
		fill: var(--ink-3);
	}

	.published path {
		stroke: var(--ink);
		stroke-dasharray: 6 4;
	}

	.published circle,
	.published text {
		fill: var(--ink);
	}

	/* On a phone the chart keeps its drawing at a readable size, at least 200 px tall, and scrolls
	   inside its own box (the coordinator's ruling 3). */
	@media (max-width: 760px) {
		.chart {
			overflow-x: auto;
		}

		svg {
			width: 780px;
			max-width: none;
		}
	}
</style>
