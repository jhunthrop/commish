import Foundation

/// web/src/lib/format/sentence.ts firstSentence: the first sentence of the advisor's why, the reason;
/// the sentences after it restate the chances the figure beside it already prints.
public enum Sentence {
    /// Words a period follows without ending a sentence: "The No. 3 receiver", "Amon-Ra St. Brown".
    private static let abbreviations: Set = ["No", "St", "Jr", "Sr", "Mr", "vs", "Jan", "Feb"]
    private static let stops: Set<Character> = [".", "!", "?"]

    public static func first(_ text: String) -> String {
        let characters = Array(text)
        for index in characters.indices where stops.contains(characters[index]) && ends(characters, at: index) {
            return String(characters[...index])
        }
        return text
    }

    /// Whether the stop at `index` ends a sentence: not after an abbreviation or a lone initial
    /// ("D.J."), and followed by the end or by a space and a capital, a digit or a quote.
    private static func ends(_ text: [Character], at index: Int) -> Bool {
        let word = String(text[..<index].reversed().prefix { $0.isASCII && $0.isLetter }.reversed())
        if abbreviations.contains(word) || (word.count == 1 && word.first?.isUppercase == true) {
            return false
        }
        let after = text[(index + 1)...]
        guard !after.isEmpty else {
            return true
        }
        let rest = after.drop { $0.isWhitespace }
        guard rest.count < after.count, let next = rest.first else {
            return false
        }
        return (next.isASCII && (next.isUppercase || next.isNumber)) || next == "\"" || next == "\u{201C}"
    }
}
