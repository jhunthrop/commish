<script lang="ts">
	import { fixed, MINUS, plural } from '#lib/format/number.ts';
	import { tierColor, tierInk, type GroupName, type TierCliff } from './tier.ts';

	interface TierLink {
		tier: number;
		count: number;
		cliff: TierCliff | null;
		/** The tier strip's anchor on the page. */
		href: string;
	}

	interface Props {
		tiers: readonly TierLink[];
		/** What each count counts, one and many. */
		group: GroupName;
	}

	let { tiers, group }: Props = $props();
</script>

<ul>
	{#each tiers as link (link.tier)}
		<li>
			<a href={link.href} style:--tier={tierColor(link.tier)} style:--tier-ink={tierInk(link.tier)}>
				<span class="n">{link.tier}</span>
				<span>{plural(link.count, group.one, group.many)}</span>
				<span class="d">{link.cliff ? `${MINUS}${fixed(link.cliff.drop)}` : ''}</span>
			</a>
		</li>
	{/each}
</ul>

<style>
	ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	a {
		display: grid;
		grid-template-columns: 26px 1fr auto;
		align-items: center;
		gap: var(--s-2);
		padding: 6px 4px;
		border-radius: var(--r-sm);
		text-decoration: none;
		font-size: var(--t-sm);
	}

	a:hover {
		background: var(--surface-2);
	}

	.n {
		display: grid;
		place-items: center;
		height: 22px;
		border-radius: var(--r-sm);
		background: var(--tier);
		color: var(--tier-ink);
		font-family: var(--font-num);
		font-weight: 800;
		font-size: 15px;
	}

	.d {
		font-family: var(--font-num);
		font-weight: 700;
		font-size: 17px;
		font-variant-numeric: tabular-nums;
		color: var(--ink-2);
	}
</style>
