import { index } from '#lib/server/run.ts';
import type { RequestHandler } from './$types';

/** The search index, written as a static file at build and fetched on the search's first focus. */
export const prerender = true;

export const GET: RequestHandler = async () => Response.json(await index());
