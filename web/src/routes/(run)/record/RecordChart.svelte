<script lang="ts">
	import { onMount } from 'svelte';
	import {
		RECORD_BOX,
		RECORD_SOURCES,
		chartTicks,
		type ChartSeries,
		type RecordSource
	} from '#lib/run/record.ts';

	/** Order matched by week (Lane 66j): one line per order drawn over the graded weeks alone (Lane 93,
	 * B45: never an empty season axis), each line named at its end. The table above holds every figure. */
	interface Props {
		series: ChartSeries;
		/** The graded weeks, in order: the axis, one step each. */
		weeks: readonly number[];
	}

	let { series, weeks }: Props = $props();

	/** The drawing's width before the page has laid out, and its widest: a wide screen's column. */
	const WIDE = 860;
	/** The drawing's height, the svg's own, so the first paint and the measured redraw stand the same. */
	const HEIGHT = 230;
	const PAD = { left: 44, right: 72, top: 14, bottom: 28 };
	/** The first graded week stands this far right of the axis, clear of its labels. */
	const LEAD_IN = 16;
	/** The drawing is sized to its column (Lane 82), so a phone's labels print at their own size. */
	let figure = $state<HTMLElement | null>(null);
	let measured = $state(0);
	/** Read on mount and on a resize, with no size observer in the page's first script. */
	const measure = (): void => {
		measured = figure?.clientWidth ?? 0;
	};
	onMount(measure);
	const width = $derived(measured > 0 ? Math.min(WIDE, measured) : WIDE);
	const drawnSources = $derived(
		RECORD_SOURCES.filter((source) => (series[source]?.length ?? 0) > 0)
	);
	const ticks = $derived(
		chartTicks(drawnSources.flatMap((source) => (series[source] ?? []).map((p) => p.value)))
	);
	const bottom = $derived(ticks.at(0)?.value ?? 0);
	const top = $derived(ticks.at(-1)?.value ?? 1);
	/** How far apart two line names stand where their lines end close together. */
	const LABEL_GAP = 15;
	const NAMES: Record<RecordSource, string> = {
		ours: RECORD_BOX.ours,
		adp: RECORD_BOX.adp,
		published: RECORD_BOX.published
	};

	/** The widest step between two graded weeks: two weeks stand a step apart, not the page apart. */
	const STEP = 96;
	const step = $derived(
		Math.min(STEP, (width - PAD.left - PAD.right - LEAD_IN) / Math.max(1, weeks.length - 1))
	);
	/** A week's place on the axis: its place among the graded weeks, a step each from the left. */
	const x = (week: number): number => PAD.left + LEAD_IN + Math.max(0, weeks.indexOf(week)) * step;
	const y = (value: number): number =>
		PAD.top + (1 - (value - bottom) / (top - bottom)) * (HEIGHT - PAD.top - PAD.bottom);

	const drawn = $derived.by(() => {
		const ends = drawnSources
			.map((source) => ({ source, points: series[source] ?? [] }))
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

<svelte:window onresize={measure} />

<figure class="chart" bind:this={figure}>
	<figcaption>{RECORD_BOX.chart}, {RECORD_BOX.chartWeeks(weeks.length)}</figcaption>
	<svg viewBox="0 0 {width} {HEIGHT}" height={HEIGHT} role="img" aria-label={RECORD_BOX.chart}>
		{#each ticks as tick (tick.value)}
			<line
				class="grid"
				x1={PAD.left}
				x2={width - PAD.right}
				y1={y(tick.value)}
				y2={y(tick.value)}
			/>
			<text class="axis" x={PAD.left - 8} y={y(tick.value) + 4} text-anchor="end">{tick.label}</text
			>
		{/each}
		{#each weeks as week (week)}
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
</style>
