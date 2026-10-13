<script lang="ts">
	/** One token as a chip of its color, its name and what it is for. Doc-only. */
	interface Props {
		/** The custom property, without the var(): "--paper". */
		token: string;
		about: string;
	}

	let { token, about }: Props = $props();
</script>

<li>
	<span class="chip" style:background="var({token})"></span>
	<code>{token}</code>
	<span class="about">{about}</span>
</li>

<style>
	li {
		display: grid;
		grid-template-columns: 40px 1fr;
		grid-template-rows: auto auto;
		column-gap: var(--s-3);
		align-items: center;
		padding: var(--s-3);
		border: 1px solid var(--line);
		border-radius: var(--r-md);
	}

	.chip {
		grid-row: span 2;
		width: 40px;
		height: 40px;
		border-radius: var(--r-sm);
		border: 1px solid var(--line-strong);
	}

	code {
		font-size: var(--t-sm);
		font-weight: 700;
	}

	.about {
		font-size: var(--t-sm);
		color: var(--ink-2);
	}
</style>
