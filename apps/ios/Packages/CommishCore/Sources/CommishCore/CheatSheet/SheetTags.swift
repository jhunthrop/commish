import Foundation

/// The sheet's bounds (web/src/lib/sheet/limits.ts SHEET_LIMITS, the API's validate.go and tags.go),
/// held to shared/fixtures/parity/sheet.json.
public enum SheetLimits {
    public static let rows = 1000
    public static let sheetName = 60
    public static let note = 500
    public static let tags = 4
    public static let tagLength = 20
    public static let headshot = 300
    /// The largest CSV an import takes (csv.ts CSV_MAX_BYTES, the API's maxSheetBody).
    public static let csvBytes = 1 << 20
}

/// How a tag is drawn (tags.ts tagTone): yours in your color, Avoid in the loss tone, so it never
/// reads as a pick.
public enum TagTone: String, Sendable, Equatable {
    case you
    case loss
}

/// A tag as a row prints it: its word and its tone.
public struct TagMark: Equatable, Sendable, Hashable {
    public let label: String
    public let tone: TagTone
}

/// Tags: the fixed set the API names plus the drafter's own words (a port of web/src/lib/sheet/tags.ts,
/// held to shared/fixtures/parity/sheet.json). A tag is trimmed with its inner spaces closed up, a word
/// that spells a fixed tag in any case is that tag, no tag appears twice in any case, Target and Avoid
/// never sit on one row, and a row holds at most four.
public enum SheetTags {
    public struct Fixed: Equatable, Sendable {
        public let tag: String
        public let label: String
    }

    /// The fixed tags in the order the sheet offers them, each with the word its chip prints.
    public static let fixed = [
        Fixed(tag: "target", label: "Target"),
        Fixed(tag: "sleeper", label: "Sleeper"),
        Fixed(tag: "breakout", label: "Breakout"),
        Fixed(tag: "avoid", label: "Avoid"),
        Fixed(tag: "injury", label: "Injury"),
        Fixed(tag: "handcuff", label: "Handcuff"),
    ]

    /// Tags that contradict each other: a row holds the one chosen last.
    static let opposites = ["target": "avoid", "avoid": "target"]

    /// Letters, digits, spaces, apostrophes, periods and hyphens, starting with a letter or digit.
    static let ownTag = try? NSRegularExpression(pattern: "^[\\p{L}\\p{N}][\\p{L}\\p{N} '\u{2019}.-]*$")

    public static func isFixed(_ tag: String) -> Bool {
        fixed.contains { $0.tag == tag }
    }

    /// The tag in its stored spelling.
    public static func canonical(_ raw: String) -> String {
        let tag = raw.split(whereSeparator: \.isWhitespace).joined(separator: " ")
        return fixed.first { $0.tag == tag.lowercased() }?.tag ?? tag
    }

    /// Why a tag cannot be used, or nil when it can (tagProblem).
    public static func problem(_ tag: String) -> String? {
        let length = tag.unicodeScalars.count
        let range = NSRange(tag.startIndex..., in: tag)
        let shaped = ownTag?.firstMatch(in: tag, range: range) != nil
        guard length >= 1, length <= SheetLimits.tagLength, shaped else {
            return "A tag is 1 to \(SheetLimits.tagLength) letters or numbers"
        }
        return nil
    }

    public static func same(_ lhs: String, _ rhs: String) -> Bool {
        lhs.lowercased() == rhs.lowercased()
    }

    public static func has(_ tags: [String], _ tag: String) -> Bool {
        tags.contains { same($0, tag) }
    }

    /// Canonical, valid, each once, never with its opposite, at most four, first ones kept.
    public static func normalized(_ raw: [String]) -> [String] {
        var out: [String] = []
        for candidate in raw {
            let tag = canonical(candidate)
            guard problem(tag) == nil, !out.contains(where: { same($0, tag) || $0 == opposites[tag] }) else {
                continue
            }
            guard out.count < SheetLimits.tags else {
                break
            }
            out.append(tag)
        }
        return out
    }

    /// A tap on a tag: off when it is on, otherwise on in place of its opposite; nil when the row is
    /// full and the tag cannot go on (toggledTags).
    public static func toggled(_ tags: [String], _ raw: String) -> [String]? {
        let tag = canonical(raw)
        if has(tags, tag) {
            return tags.filter { !same($0, tag) }
        }
        let rest = tags.filter { $0 != opposites[tag] }
        guard rest.count < SheetLimits.tags else {
            return nil
        }
        return normalized(rest + [tag])
    }

    /// The word a chip prints for a tag.
    public static func label(_ tag: String) -> String {
        fixed.first { $0.tag == tag }?.label ?? tag
    }

    public static func tone(_ tag: String) -> TagTone {
        canonical(tag) == "avoid" ? .loss : .you
    }

    public static func marks(_ tags: [String]) -> [TagMark] {
        tags.map { TagMark(label: label($0), tone: tone($0)) }
    }

    /// Every tag a sheet uses that is not a fixed one, in first-seen order: the drafter's own set.
    public static func own(_ lists: [[String]]) -> [String] {
        var out: [String] = []
        for tag in lists.joined() where !isFixed(tag) && !has(out, tag) {
            out.append(tag)
        }
        return out
    }
}
