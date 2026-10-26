/** For tests: a .svelte file compiled for the server as a data URL, its imports pointed at the files
 * they name and every .svelte import compiled the same way, so a component renders with
 * svelte/server under `node --test` (first in routes/app/signed-in/page.test.ts). A component that
 * imports `$app/*` cannot render this way; keep the router in a parent and test the child. */
import { readFileSync } from 'node:fs';
import { compile } from 'svelte/compiler';

export function compiled(file: URL): string {
	const { js } = compile(readFileSync(file, 'utf8'), {
		generate: 'server',
		filename: file.pathname
	});
	const code = js.code.replace(/from '([^']+)'/g, (_, spec: string) => {
		const target = spec.startsWith('.') ? new URL(spec, file).href : import.meta.resolve(spec);
		return `from '${target.endsWith('.svelte') ? compiled(new URL(target)) : target}'`;
	});
	return `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
}
