/**
 * A STRICT RFC 4180 reader, written here rather than taken from npm — a rare call in this repo,
 * and the reasoning is specific.
 *
 * nflverse publishes its releases as CSV and nothing else this project can read (the alternatives
 * are parquet and R's `.rds`), so a reader is unavoidable. Every general-purpose CSV library is
 * built to be LENIENT — a short row is padded, a long row is truncated or spilled into an extras
 * key, a bad quote is recovered from — because that is what a library facing arbitrary
 * human-authored spreadsheets must do. That behaviour is exactly wrong at this boundary. nflverse
 * files are machine-generated and well-formed; a ragged row means the download truncated or the
 * schema changed under us, and quietly padding it puts a zero where a snap count belonged. A zero
 * snap count is indistinguishable from a healthy scratch, and it would flow into a target share,
 * into a projection, into a scorecard, and be believed.
 *
 * So this throws where a library would recover, which makes it forty lines rather than four
 * thousand, and makes the failure land at the download instead of six layers downstream.
 */

/** One CSV record, keyed by header name. Every value is raw text — the mappers do the coercion. */
export type CsvRow = Readonly<Record<string, string>>;

/**
 * Splits one CSV document into rows of raw fields, honouring quoting.
 *
 * A single character-at-a-time pass rather than a regex or a `split(",")`: quoted fields may
 * legally contain commas, newlines and doubled quotes, and every shortcut that ignores that
 * corrupts real nflverse rows (the weekly stats file carries headshot URLs with commas in them).
 */
function splitRecords(text: string): readonly (readonly string[])[] {
  const records: string[][] = [];
  let fields: string[] = [];
  let field = "";
  let quoted = false;
  let started = false;

  const endField = () => {
    fields.push(field);
    field = "";
    started = true;
  };
  const endRecord = () => {
    endField();
    records.push(fields);
    fields = [];
    started = false;
  };

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]!;
    if (quoted) {
      if (char !== '"') {
        field += char;
      } else if (text[i + 1] === '"') {
        // RFC 4180 escapes a quote by doubling it; consume both and emit one.
        field += '"';
        i += 1;
      } else {
        quoted = false;
      }
      continue;
    }
    if (char === '"' && field === "") {
      quoted = true;
    } else if (char === ",") {
      endField();
    } else if (char === "\n") {
      endRecord();
    } else if (char !== "\r") {
      // A lone `\r` is dropped: CRLF is the line ending nflverse's own tooling emits on Windows
      // runners, and treating the CR as data would append it to the last field of every row.
      field += char;
    } else {
      started = started || field.length > 0;
    }
  }
  // A file with no trailing newline still has a final record; one WITH a trailing newline must not
  // produce a phantom empty row after it.
  if (field !== "" || fields.length > 0 || started) endRecord();
  return records;
}

/**
 * Parses a whole CSV document into header-keyed rows.
 *
 * Throws — rather than repairing — on a missing header, a duplicated header name (one column would
 * silently shadow the other, and which one wins would depend on field order) and any row whose
 * field count disagrees with the header. See the module docblock for why strictness is the point.
 */
export function parseCsv(text: string): readonly CsvRow[] {
  const records = splitRecords(text);
  const header = records[0];
  if (header === undefined || header.length === 0 || (header.length === 1 && header[0] === "")) {
    throw new Error("nflverse CSV has no header row.");
  }
  const duplicate = header.find((name, index) => header.indexOf(name) !== index);
  if (duplicate !== undefined) {
    throw new Error(`nflverse CSV header has a duplicate column "${duplicate}".`);
  }
  return records.slice(1).map((record, index) => {
    if (record.length !== header.length) {
      throw new Error(
        `nflverse CSV row ${index + 2} has ${record.length} fields; the header declares ${header.length}. The download is truncated or the schema changed.`,
      );
    }
    return Object.fromEntries(header.map((name, column) => [name, record[column]!]));
  });
}
