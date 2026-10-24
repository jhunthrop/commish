import Foundation

/// A face with no image holds its initials (web/src/lib/ui/initials.ts initialsOf): someone is on every
/// row. The first name's and the last name's letters, a one-word name its first two.
public enum Initials {
    private static let suffixes: Set<String> = ["jr", "sr", "ii", "iii", "iv", "v"]

    public static func of(_ name: String) -> String {
        let words = name.split(whereSeparator: \.isWhitespace)
            .map { $0.filter(\.isLetter) }
            .filter { !$0.isEmpty && !suffixes.contains($0.lowercased()) }
        guard let first = words.first else {
            return ""
        }
        guard words.count > 1, let last = words.last else {
            return String(first.prefix(2)).uppercased()
        }
        return "\(first.prefix(1))\(last.prefix(1))".uppercased()
    }
}
