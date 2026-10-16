/**
 * The account's sheets over the API: the calls the sync makes, and the one place a row is read
 * from or written to the API's shape. The API stores positions only in the six spellings this
 * site reads (api/internal/sheets/validate.go and the table's check).
 */
import { ApiError, type ApiClient } from '#lib/api/client.ts';
import { hasSessionCookie } from '#lib/api/session.ts';
import { HTTP_STATUS } from '#lib/api/status.ts';
import type { components } from '#lib/api/types.ts';
import { parseFormat } from './format.ts';
import { DEFAULT_FORMAT, parsePosition, type Sheet, type SheetRow } from './model.ts';
import { normalizeTags } from './tags.ts';

type ApiSheet = components['schemas']['Sheet'];
type ApiSheetDetail = components['schemas']['SheetDetail'];
type ApiRow = components['schemas']['SheetRow'];
type ApiRowInput = components['schemas']['SheetRowInput'];
type ApiAccount = components['schemas']['Account'];

export type Account = ApiAccount;

/** An account sheet as the sync holds it: the sheet and its stamp. */
export interface RemoteSheet {
	id: string;
	updatedAt: string;
	sheet: Sheet;
}

export interface SheetSummary {
	id: string;
	name: string;
	format: Sheet['format'];
	rowCount: number;
	updatedAt: string;
}

const SHEETS_PER_PAGE = 50;

/** A row as this site reads it, or null for a position it does not rank. The database refuses
 * those (migration 00007's sheet_rows_position_known), so null is a guard, not a path: one odd row
 * never fails a whole sync. */
function fromApiRow(row: ApiRow): SheetRow | null {
	const position = parsePosition(row.position);
	if (position === null) return null;
	return {
		id: row.player_id,
		name: row.name,
		position,
		team: row.team,
		headshot: row.headshot,
		tier: row.tier,
		tags: normalizeTags(row.tags),
		note: row.note
	};
}

function toApiRow(row: SheetRow): ApiRowInput {
	return {
		player_id: row.id,
		name: row.name,
		position: row.position,
		team: row.team,
		headshot: row.headshot,
		tier: row.tier,
		tags: [...row.tags],
		note: row.note
	};
}

function fromDetail(detail: ApiSheetDetail): RemoteSheet {
	return {
		id: detail.id,
		updatedAt: detail.updated_at,
		sheet: {
			name: detail.name,
			format: parseFormat(detail.format) ?? DEFAULT_FORMAT,
			rows: detail.rows.map(fromApiRow).filter((row): row is SheetRow => row !== null)
		}
	};
}

function fromSummary(sheet: ApiSheet): SheetSummary {
	return {
		id: sheet.id,
		name: sheet.name,
		format: sheet.format,
		rowCount: sheet.row_count,
		updatedAt: sheet.updated_at
	};
}

export interface SheetsApi {
	me(): Promise<Account>;
	list(): Promise<readonly SheetSummary[]>;
	get(id: string): Promise<RemoteSheet>;
	create(sheet: Sheet): Promise<RemoteSheet>;
	remove(id: string): Promise<void>;
	/** Writes the name and every row in one request. With ifUpdatedAt, nothing is written and the
	 * answer is 409 when the sheet changed since. */
	replace(id: string, sheet: Sheet, ifUpdatedAt: string | null): Promise<RemoteSheet>;
	signInUrl(returnTo: string): string;
}

/** What the API answers a browser with no session, said without asking it. */
function signedOut(): Promise<never> {
	return Promise.reject(
		new ApiError(HTTP_STATUS.unauthorized, { code: 'unauthorized', message: 'Not signed in' })
	);
}

export function sheetsApi(client: ApiClient): SheetsApi {
	return {
		// With no session the answer is a 401: the sheet stays in this browser without asking.
		me: () => (hasSessionCookie() ? client.call<Account>('/me') : signedOut()),
		async list() {
			const sheets = await client.call<ApiSheet[]>(`/sheets?per_page=${SHEETS_PER_PAGE}`);
			return sheets.map(fromSummary);
		},
		async get(id) {
			return fromDetail(await client.call<ApiSheetDetail>(`/sheets/${encodeURIComponent(id)}`));
		},
		async create(sheet) {
			const body: components['schemas']['SheetCreate'] = {
				name: sheet.name,
				format: sheet.format,
				rows: sheet.rows.map(toApiRow)
			};
			return fromDetail(await client.call<ApiSheetDetail>('/sheets', { method: 'POST', body }));
		},
		async remove(id) {
			await client.call<null>(`/sheets/${encodeURIComponent(id)}`, { method: 'DELETE' });
		},
		async replace(id, sheet, ifUpdatedAt) {
			const body: components['schemas']['SheetRowsReplace'] = {
				rows: sheet.rows.map(toApiRow),
				name: sheet.name,
				if_updated_at: ifUpdatedAt
			};
			const path = `/sheets/${encodeURIComponent(id)}/rows`;
			return fromDetail(await client.call<ApiSheetDetail>(path, { method: 'PUT', body }));
		},
		signInUrl: (returnTo) => client.signInUrl(returnTo)
	};
}
