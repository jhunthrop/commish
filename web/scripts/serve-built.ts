// Serves the built site the way production does, for Lighthouse and screenshots: the prerendered
// pages and assets as compressed static files with clean URLs (Workers static assets), and the
// request-time image routes, the headshots and the club marks, answered by the same upstream the
// Worker uses. A page is measured with its faces coming from our origin, as they do in production.
// Usage: npm run preview:static   (port 4173, or PORT)
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import compression from 'compression';
import handler from 'serve-handler';
import {
	HEADSHOT_MAX_WIDTH,
	HEADSHOT_MIN_WIDTH,
	HEADSHOT_ROUTE,
	isHeadshotLeague
} from '../src/lib/ui/headshot.ts';
import { upstreamClubMarkUrl, upstreamHeadshotUrl } from '../src/lib/ui/headshot-provider.ts';
import { clubMarkPath } from '../src/lib/ui/club-mark.ts';

const PORT = Number(process.env.PORT ?? 4173);
const ROOT = new URL('../.svelte-kit/cloudflare/', import.meta.url).pathname;
const HEADSHOT_PATH = new RegExp(`^${HEADSHOT_ROUTE}/([a-z]+)/(\\d{1,12})/(\\d+)$`);
const WEEK_SECONDS = 7 * 24 * 60 * 60;
type NodeMiddleware = (req: IncomingMessage, res: ServerResponse, next: () => void) => void;
// compression is typed for Express, and it is plain Node middleware underneath.
const compress = compression() as unknown as NodeMiddleware;

async function headshot(res: ServerResponse, match: RegExpExecArray): Promise<void> {
	const [, league = '', id = '', widthText = ''] = match;
	const width = Number(widthText);
	if (!isHeadshotLeague(league) || width < HEADSHOT_MIN_WIDTH || width > HEADSHOT_MAX_WIDTH) {
		res.writeHead(404).end();
		return;
	}
	await image(res, upstreamHeadshotUrl(league, id, width));
}

/** An image from the provider, answered as the Worker answers it. */
async function image(res: ServerResponse, url: string): Promise<void> {
	const upstream = await fetch(url);
	if (!upstream.ok) {
		res.writeHead(upstream.status === 404 ? 404 : 502).end();
		return;
	}
	res.writeHead(200, {
		'content-type': upstream.headers.get('content-type') ?? 'image/png',
		'cache-control': `public, max-age=${String(WEEK_SECONDS)}, immutable`
	});
	res.end(Buffer.from(await upstream.arrayBuffer()));
}

function serve(req: IncomingMessage, res: ServerResponse): void {
	const path = new URL(req.url ?? '/', 'http://localhost').pathname;
	const match = HEADSHOT_PATH.exec(path);
	if (match) {
		headshot(res, match).catch(() => res.writeHead(502).end());
		return;
	}
	const mark = clubMarkPath(path);
	if (mark) {
		image(res, upstreamClubMarkUrl(mark.league, mark.club, mark.width)).catch(() =>
			res.writeHead(502).end()
		);
		return;
	}
	compress(req, res, () => {
		void handler(req, res, { public: ROOT, cleanUrls: true });
	});
}

createServer(serve).listen(PORT, () => {
	process.stdout.write(`Accepting connections at http://localhost:${String(PORT)}\n`);
});
