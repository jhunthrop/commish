/// The tabs' glyphs, by the web's rail key (web/src/lib/ui/rail-icons.ts names the same items).
public enum TabSymbols {
    static let symbols: [String: String] = [
        "league": "trophy", "lineup": "list.bullet.rectangle", "matchup": "sportscourt",
        "waivers": "person.badge.plus", "trades": "arrow.left.arrow.right",
        "board": "square.grid.3x3", "rest_first": "square.grid.3x3",
        "players": "person.2", "week": "person.2",
        "mock": "timer", "mock_late": "timer", "sheet": "doc.text",
        "advisor": "lightbulb", "advisor_first": "lightbulb", "record": "checkmark.seal",
        "account": "person.crop.circle",
    ]

    public static func symbol(_ key: String) -> String {
        symbols[key] ?? "circle"
    }
}
