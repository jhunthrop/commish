/** Getting a sheet into and out of the browser as a file. */
import { CSV_MAX_BYTES, csvFileName, encodeCsv } from './csv.ts';
import type { Sheet } from './model.ts';
import { SHEET_IMPORT } from './words.ts';

/** Hands the sheet to the browser as a CSV download. */
export function downloadCsv(sheet: Sheet): void {
	const blob = new Blob([encodeCsv(sheet.rows)], { type: 'text/csv;charset=utf-8' });
	const url = URL.createObjectURL(blob);
	const link = document.createElement('a');
	link.href = url;
	link.download = csvFileName(sheet.name);
	link.click();
	// The download starts from the link on its own task. Revoking in this one can cancel it.
	setTimeout(() => {
		URL.revokeObjectURL(url);
	}, 0);
}

export class FileTooLargeError extends Error {}

/** A chosen file's text, refused past the API's limit so a file that works here works there. */
export async function readCsvFile(file: File): Promise<string> {
	if (file.size > CSV_MAX_BYTES) throw new FileTooLargeError(SHEET_IMPORT.tooLarge);
	return file.text();
}
