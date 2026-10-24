<script lang="ts">
	import ErrorView from '#lib/site/ErrorView.svelte';
	import { ERROR_WORDS } from '#lib/site/error-words.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<ErrorView words={ERROR_WORDS.notFound} weekLabel={data.weekLabel} head={data.head} />
