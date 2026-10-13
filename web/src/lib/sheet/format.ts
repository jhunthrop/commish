/**
 * The board formats a sheet can be ranked for, as the API names them, with the words a chip prints.
 * The record is checked against the API's enum, so a format added there fails the type check here.
 */
import type { BoardFormat } from './model.ts';

export const FORMAT_LABELS = {
	ppr: 'PPR',
	half_ppr: 'Half PPR',
	standard: 'Standard',
	te_premium: 'TE premium',
	superflex: 'Superflex',
	two_flex: 'Two flex',
	dynasty: 'Dynasty',
	best_ball: 'Best ball'
} as const satisfies Record<BoardFormat, string>;

export const BOARD_FORMATS = Object.keys(FORMAT_LABELS) as readonly BoardFormat[];

export function parseFormat(value: unknown): BoardFormat | null {
	return BOARD_FORMATS.find((format) => format === value) ?? null;
}
