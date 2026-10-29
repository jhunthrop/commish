import CommishDesign
import Foundation

/// A CSV read on the phone before it is sent (a port of web/src/lib/sheet/csv.ts decodeCsv, held to
/// shared/fixtures/parity/sheet.json `reads`): the header must name rank, player_id, name and position in
/// any order and case, a bad line is skipped with its reason, and the players kept are counted. The
/// import sends no CSV the web's panel would not let replace a sheet: a file whose header cannot be used
/// is refused with its sentence, and one that reads no player is refused with what it skipped. A list of
/// names is not read here: the API reads it (Lane 278). The reasons with no slot are the generated
/// Words.SheetImport's, which say "row" on the web, the API and the phone (Lane 283).
public enum SheetCSV {
    /// The header could not be used: the web's (and the API's) sentence.
    public struct HeaderError: Error, Equatable, Sendable {
        public let message: String
    }

    public struct Skip: Equatable, Sendable {
        public let line: Int
        public let reason: String
    }

    /// The players a file reads as, in rank order, and the lines it skipped.
    public struct Read: Equatable, Sendable {
        public let ids: [String]
        public let skipped: [Skip]
    }

    static let columns = ["rank", "player_id", "name", "position", "team", "tier", "tags", "note"]
    static let required = ["rank", "player_id", "name", "position"]
    static let aliases = ["tag": "tags"]
    static let positions = ["QB", "RB", "WR", "TE", "K", "DST"]
    static let positionAliases = ["DEF": "DST", "D/ST": "DST", "DST": "DST", "PK": "K"]
    static let formulaLead: Set<Character> = ["=", "+", "-", "@", "\t", "\r"]
    /// A comma, a bar, and the semicolon, named by its code: the copy rules keep the mark out of words.
    static let tagSeparators: Set<Character> = [",", "|", Character(Unicode.Scalar(0x3B))]
    static let byteOrderMark = "\u{FEFF}"

    static let emptyFile = Words.SheetImport.emptyFile
    static let badHeader = Words.SheetImport.badHeader

    /// True when the text is the sheet's CSV, not a list of names: its first line names player_id (paste.ts
    /// looksLikeCsv, held to sheet.json `lists`). Read as the API reads it (paste.go looksLikeCSV), which
    /// decides: a byte order mark, then spaces, tabs and line breaks set aside, the first line up to "\n".
    public static func looksLikeCSV(_ text: String) -> Bool {
        let unmarked = text.hasPrefix(byteOrderMark) ? String(text.dropFirst()) : text
        let lead: Set<Unicode.Scalar> = [" ", "\t", "\r", "\n"]
        let body = unmarked.unicodeScalars.drop(while: { lead.contains($0) })
        let first = String(String.UnicodeScalarView(body.prefix(while: { $0 != "\n" })))
        return first.lowercased().contains("player_id")
    }

    /// The file read as the web reads it; throws HeaderError when the header cannot be used.
    public static func read(_ text: String) throws -> Read {
        let (records, unterminated) = records(text)
        guard let header = records.first else {
            throw HeaderError(message: emptyFile)
        }
        let index = try headerIndex(header)
        let body = records.dropFirst()
        var kept: [Kept] = []
        var skipped: [Skip] = []
        var seen = Set<String>()
        for (offset, record) in body.enumerated() {
            let line = offset + 2
            if unterminated, offset == body.count - 1 {
                skipped.append(Skip(line: line, reason: Words.SheetImport.notCsv))
                continue
            }
            let read: Row
            switch row(record, index) {
            case let .failure(refusal):
                skipped.append(Skip(line: line, reason: refusal.reason))
                continue
            case let .success(row):
                read = row
            }
            if seen.contains(read.id) {
                skipped.append(Skip(line: line, reason: Words.SheetImport.earlier))
            } else if kept.count >= SheetLimits.rows {
                skipped.append(Skip(line: line, reason: "A sheet holds at most \(SheetLimits.rows) players"))
            } else {
                seen.insert(read.id)
                kept.append(Kept(rank: read.rank, line: line, id: read.id))
            }
        }
        let ordered = kept.sorted { $0.rank != $1.rank ? $0.rank < $1.rank : $0.line < $1.line }
        return Read(ids: ordered.map(\.id), skipped: skipped)
    }

    // MARK: records

    /// Records of an RFC 4180 file (parseRecords); a quote left open runs to the end and is reported.
    static func records(_ text: String) -> (records: [[String]], unterminated: Bool) {
        var reader = RecordReader()
        let chars = Array(text.unicodeScalars)
        var cursor = 0
        while cursor < chars.count {
            let next = cursor + 1 < chars.count ? chars[cursor + 1] : nil
            cursor += reader.take(chars[cursor], next: next) ? 2 : 1
        }
        return reader.finish()
    }

    /// parseRecords' loop, one character at a time.
    struct RecordReader {
        var records: [[String]] = []
        var record: [String] = []
        var field = ""
        var quoted = false
        var fieldStart = true

        mutating func endField() {
            record.append(field)
            field = ""
            fieldStart = true
        }

        /// The character read; true when it took the next one with it (a doubled quote, CRLF).
        mutating func take(_ char: Unicode.Scalar, next: Unicode.Scalar?) -> Bool {
            if quoted {
                return takeQuoted(char, next: next)
            }
            switch char {
            case "\"" where fieldStart:
                quoted = true
                fieldStart = false
            case ",":
                endField()
            case "\n", "\r":
                endField()
                if !(record.count == 1 && record[0].isEmpty) {
                    records.append(record)
                }
                record = []
                return char == "\r" && next == "\n"
            // A read trims leading space, as the API's does; only at a field's start (each pattern carries its
            // own guard: a `where` covers the last pattern of a case alone).
            case " " where fieldStart && field.isEmpty, "\t" where fieldStart && field.isEmpty:
                break
            default:
                field.unicodeScalars.append(char)
                fieldStart = false
            }
            return false
        }

        mutating func takeQuoted(_ char: Unicode.Scalar, next: Unicode.Scalar?) -> Bool {
            if char == "\"", next == "\"" {
                field.unicodeScalars.append("\"")
                return true
            }
            if char == "\"" {
                quoted = false
            } else {
                field.unicodeScalars.append(char)
            }
            return false
        }

        mutating func finish() -> (records: [[String]], unterminated: Bool) {
            if !field.isEmpty || !record.isEmpty {
                endField()
                records.append(record)
            }
            return (records, quoted)
        }
    }

    static func headerIndex(_ header: [String]) throws -> [String: Int] {
        var index: [String: Int] = [:]
        for (column, raw) in header.enumerated() {
            let name = raw.replacingOccurrences(of: byteOrderMark, with: "")
                .trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
            if let known = aliases[name] ?? columns.first(where: { $0 == name }), index[known] == nil {
                index[known] = column
            }
        }
        guard required.allSatisfy({ index[$0] != nil }) else {
            throw HeaderError(message: badHeader)
        }
        return index
    }

    // MARK: a line

    struct Row {
        let rank: Double
        let id: String
    }

    /// A player kept, with where he was in the file, which breaks a tie in rank.
    struct Kept {
        let rank: Double
        let line: Int
        let id: String
    }

    struct Refusal: Error {
        let reason: String
    }

    static func cell(_ record: [String], _ index: [String: Int], _ column: String) -> String {
        guard let place = index[column], place < record.count else {
            return ""
        }
        return undefuse(record[place].trimmingCharacters(in: .whitespacesAndNewlines))
    }

    static func undefuse(_ value: String) -> String {
        let chars = Array(value)
        guard chars.count > 1, chars[0] == "'", formulaLead.contains(chars[1]) else {
            return value
        }
        return String(value.dropFirst())
    }

    /// JavaScript's Number over a trimmed cell: empty is 0, anything else a decimal or nothing.
    static func number(_ text: String) -> Double? {
        text.isEmpty ? 0 : Double(text)
    }

    static func whole(_ value: Double?) -> Bool {
        guard let value else {
            return false
        }
        return value.isFinite && value.rounded() == value
    }

    static func lengthProblem(_ label: String, _ value: String, _ min: Int, _ max: Int) -> String? {
        let length = value.unicodeScalars.count
        return length < min || length > max ? "The \(label) runs \(min) to \(max) characters" : nil
    }

    static func position(_ raw: String) -> String? {
        let upper = raw.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        return positionAliases[upper] ?? positions.first { $0 == upper }
    }

    /// Why a tags cell cannot be read, or nil (readTags).
    static func tagsProblem(_ raw: String) -> String? {
        var tags: [String] = []
        let pieces = raw.split(whereSeparator: { tagSeparators.contains($0) })
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }
        for piece in pieces {
            let tag = SheetTags.canonical(piece)
            if let problem = SheetTags.problem(tag) {
                return problem
            }
            if !SheetTags.has(tags, tag) {
                tags.append(tag)
            }
        }
        if tags.count > SheetLimits.tags {
            return "Keep it to \(SheetLimits.tags) tags"
        }
        if SheetTags.normalized(tags).count < tags.count {
            return Words.SheetImport.bothTargetAndAvoid
        }
        return nil
    }

    static func row(_ record: [String], _ index: [String: Int]) -> Result<Row, Refusal> {
        let rank = number(cell(record, index, "rank"))
        guard let rank, whole(rank), rank >= 1 else {
            return .failure(Refusal(reason: Words.SheetImport.badRank))
        }
        let id = cell(record, index, "player_id")
        let problem = lengthProblem("player_id", id, 1, SheetLimits.playerId)
            ?? lengthProblem("name", cell(record, index, "name"), 1, SheetLimits.playerName)
            ?? lengthProblem("team", cell(record, index, "team"), 0, SheetLimits.team)
            ?? lengthProblem("note", cell(record, index, "note"), 0, SheetLimits.note)
        if let problem {
            return .failure(Refusal(reason: problem))
        }
        guard position(cell(record, index, "position")) != nil else {
            return .failure(Refusal(reason: Words.SheetImport.badPosition))
        }
        let rawTier = cell(record, index, "tier")
        if !rawTier.isEmpty {
            let tier = number(rawTier)
            guard let tier, whole(tier), tier >= 1, tier <= Double(SheetLimits.tier) else {
                return .failure(Refusal(reason: "The tier is not a whole number from 1 to \(SheetLimits.tier)"))
            }
        }
        if let problem = tagsProblem(cell(record, index, "tags")) {
            return .failure(Refusal(reason: problem))
        }
        return .success(Row(rank: rank, id: id))
    }
}
