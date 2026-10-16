<script lang="ts">
	import Footnote from '#lib/ui/Footnote.svelte';
	import { CREDIT, CREDIT_LICENCE_HREF } from './credit.ts';
</script>

<Footnote
	>{CREDIT.before}<a href={CREDIT_LICENCE_HREF}>{CREDIT.licenceWords}</a>{CREDIT.after}</Footnote
>
