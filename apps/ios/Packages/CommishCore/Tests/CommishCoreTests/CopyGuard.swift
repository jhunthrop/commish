import Foundation

/// The site's copy guard (web/src/lib/format/copy-guard.ts) built the same way from the same list:
/// each banned word matched whole in any case, the betting line with the field's own lines spared,
/// and the marks.
struct CopyGuard {
    struct Examples: Decodable {
        let caught: [String]
        let spared: [String]
    }

    private struct List: Decodable {
        struct Line: Decodable {
            let word: String
            let sparedAfter: [String]
            let sparedSide: [String]
            let sparedBefore: [String]
        }

        let bettingOnly: [String: String]
        let bettingShared: [String: String]
        let line: Line
        let trading: [String: String]
        let platform: [String: String]
        let marks: [String]
        let examples: Examples
    }

    let pattern: NSRegularExpression
    let examples: Examples

    static func shared() throws -> CopyGuard {
        let list = try JSONDecoder().decode(List.self, from: Fixtures.data("words/banned-words.json"))
        let line = list.line
        let field = line.sparedAfter.map { "(?<!\($0)[ -])" }.joined()
            + line.sparedSide.map { #"(?<!\b\#($0)-)"# }.joined()
            + line.word
            + line.sparedBefore.map { "(?! \($0))" }.joined()
        let words = list.bettingOnly.keys.sorted() + [field] + list.bettingShared.keys.sorted()
            + list.trading.keys.sorted() + list.platform.keys.sorted()
        let marks = list.marks.map { NSRegularExpression.escapedPattern(for: $0) }.joined(separator: "|")
        let source = #"\b("# + words.joined(separator: "|") + #")\b|"# + marks
        return try CopyGuard(
            pattern: NSRegularExpression(pattern: source, options: [.caseInsensitive]),
            examples: list.examples
        )
    }

    /// The first banned word or mark in the text, nil with none.
    func banned(in text: String) -> String? {
        let range = NSRange(text.startIndex..., in: text)
        guard let match = pattern.firstMatch(in: text, range: range), let found = Range(match.range, in: text) else {
            return nil
        }
        return String(text[found])
    }
}
