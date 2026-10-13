/**
 * The sheet's bounds. They mirror the API's (api/internal/sheets/validate.go and tags.go, and
 * openapi.yaml's SheetRowInput and SheetTags), so a sheet the browser accepts is one the account
 * accepts. Change them there first.
 */
export const SHEET_LIMITS = {
	rows: 1000,
	sheetName: 60,
	playerId: 64,
	playerName: 80,
	position: 8,
	team: 8,
	tier: 50,
	note: 500,
	tags: 4,
	tagLength: 20,
	headshot: 300
} as const;

/** The name a sheet starts with. */
export const DEFAULT_SHEET_NAME = 'My sheet';
