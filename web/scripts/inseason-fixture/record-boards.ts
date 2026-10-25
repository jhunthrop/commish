// Records the API's draft board (GET /boards/{format}) for the fixture API to answer (serve.ts), so
// the apps' Board screen is built and tested on the API's own answer (Lane 182): every player in the
// order drafters take them, each with his position rank, points, over replacement, gap, bye and his
// designation on the newest injury capture, the basis sentence and the capture's stamp. Recorded
// from a dev API (api/, the dev database's research store, never production) on 2026-10-24.
//
//   API_URL=http://localhost:18182 node scripts/inseason-fixture/record-boards.ts
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { format as prettierFormat, resolveConfig } from 'prettier';

/** The formats recorded: PPR, the board the Board screen opens on. */
export const RECORDED_BOARDS = ['ppr'] as const;

const DATA = new URL('./data/', import.meta.url);

/** A board's data file under data/. */
export function boardFile(format: string): string {
	return `boards-${format}`;
}

async function record(api: string, format: string): Promise<void> {
	const response = await fetch(`${api}/boards/${format}`);
	if (!response.ok) throw new Error(`GET /boards/${format} answered ${String(response.status)}.`);
	const { data } = await response.json<{ data: unknown }>();
	if (data === null || typeof data !== 'object')
		throw new Error(`GET /boards/${format} sent no board.`);
	const file = new URL(`${boardFile(format)}.json`, DATA);
	const style = await resolveConfig(fileURLToPath(file));
	await writeFile(file, await prettierFormat(JSON.stringify(data), { ...style, parser: 'json' }));
}

if (import.meta.main) {
	const api = process.env.API_URL?.replace(/\/+$/, '');
	if (!api) throw new Error('Set API_URL to a dev API, as http://localhost:18182.');
	for (const format of RECORDED_BOARDS) await record(api, format);
}
