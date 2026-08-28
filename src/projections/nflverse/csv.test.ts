import { describe, expect, it } from "vitest";
import { parseCsv } from "./csv";

describe("parseCsv", () => {
  it("reads a header row and keys every following row by it", () => {
    expect(parseCsv("season,week,player\n2024,1,Josh Allen\n")).toEqual([
      { season: "2024", week: "1", player: "Josh Allen" },
    ]);
  });

  it("keeps a comma inside a quoted field — nflverse embeds them in URLs and name lists", () => {
    const rows = parseCsv('player,url\nJosh Allen,"https://x/y,z/w.png"\n');
    expect(rows[0]?.url).toBe("https://x/y,z/w.png");
  });

  it("unescapes a doubled quote inside a quoted field", () => {
    expect(parseCsv('nick\n"He said ""go"""\n')[0]?.nick).toBe('He said "go"');
  });

  it("keeps a newline inside a quoted field", () => {
    expect(parseCsv('note\n"line one\nline two"\n')[0]?.note).toBe("line one\nline two");
  });

  it("reads CRLF line endings", () => {
    expect(parseCsv("a,b\r\n1,2\r\n")).toEqual([{ a: "1", b: "2" }]);
  });

  it("tolerates a missing trailing newline", () => {
    expect(parseCsv("a,b\n1,2")).toEqual([{ a: "1", b: "2" }]);
  });

  it("reads an empty field as an empty string, not as absent", () => {
    expect(parseCsv("a,b,c\n1,,3\n")).toEqual([{ a: "1", b: "", c: "3" }]);
  });

  it("returns no rows for a header-only file", () => {
    expect(parseCsv("a,b\n")).toEqual([]);
  });

  it("refuses a ragged row rather than guessing which field is missing", () => {
    expect(() => parseCsv("a,b,c\n1,2\n")).toThrow(/2 fields.*declares 3/i);
  });

  it("refuses a file with no header at all", () => {
    expect(() => parseCsv("")).toThrow(/header/i);
  });

  it("refuses a duplicated header name — one column would silently shadow the other", () => {
    expect(() => parseCsv("a,a\n1,2\n")).toThrow(/duplicate/i);
  });
});
