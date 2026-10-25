import CommishDesign
import Foundation

/// The season pages' verbs (web/src/lib/site/season-words.ts PageVerb), each by what it does, its words
/// generated (PAGE_VERBS).
public enum PageVerb: String, Sendable, Equatable {
    case follow
    case openLeague = "open_league"
    case mock
    case sheet

    public var title: String {
        switch self {
        case .follow: Words.PageVerb.follow
        case .openLeague: Words.PageVerb.open_league
        case .mock: Words.PageVerb.mock
        case .sheet: Words.PageVerb.sheet
        }
    }

    /// Where the verb goes on the site (verb-links.ts verbHref): following a league to the follow
    /// page, a mock to its setup, the sheet to its page. The app has no screen for them yet, so the
    /// site's page opens.
    public var page: URL {
        switch self {
        case .follow, .openLeague: SiteLinks.leagueStart
        case .mock: SiteLinks.mockSetup
        case .sheet: SiteLinks.sheet
        }
    }
}

/// What a board covers, as its words need it (season-words.ts BoardCover with its label and view).
public struct BoardCover: Equatable, Sendable {
    public let season: Int
    /// The format's chip, "PPR".
    public let label: String
    /// The view's position, nil for All.
    public let position: String?
    /// The board ranks the rest of the season (the run's rosFromWeek).
    public let restOfSeason: Bool

    public init(season: Int, label: String, position: String?, restOfSeason: Bool) {
        self.season = season
        self.label = label
        self.position = position
        self.restOfSeason = restOfSeason
    }
}

/// The board's words as the web's season pages say them (season-words.ts boardWords, ported and held to
/// shared/fixtures/parity/board.json): the bar's word, the document's title, the heading and the one
/// verb. In season the board is the rest of the season where it ranks it, and the verb follows the
/// league: none once a league is followed, following one until then; before the draft, the mock.
public struct BoardWords: Equatable, Sendable {
    public let bar: String
    public let title: String
    public let heading: String
    public let verb: PageVerb?

    /// `inSeason` is the rail's season (railInSeason); `following` whether the member follows a league.
    public static func of(inSeason: Bool, cover: BoardCover, following: Bool) -> BoardWords {
        let ranksRest = inSeason && cover.restOfSeason
        let noun = ranksRest ? AppWords.Tab.restOfSeason : AppWords.Tab.board
        let lower = ranksRest ? noun.lowercased() : noun
        let named = { (prefix: String) in "\(prefix) \(lower)" }
        return BoardWords(
            bar: cover.position.map(named) ?? noun,
            title: named(cover.position.map { "\($0) \(cover.label)" } ?? cover.label),
            heading: ranksRest ? "Rest of \(cover.season)" : "\(cover.season) \(AppWords.Tab.board)",
            verb: inSeason ? (following ? nil : .follow) : .mock
        )
    }

    /// The capture the statuses come from in the few words a board's basis has room for
    /// (designation.ts captureShort): "Status read Oct 16.", "as of" its last change with no check,
    /// and past a day and a half how old it is.
    public static func capture(asOf: Date, checkedAt: Date?, now: Date, zone: TimeZone) -> String {
        let last = checkedAt ?? asOf
        let when = checkedAt.map { "read \(Formatting.shortDay($0, zone: zone))" }
            ?? "as of \(Formatting.shortDay(asOf, zone: zone))"
        let old = now.timeIntervalSince(last) > captureBehind ? ", over 36 hours ago" : ""
        return "Status \(when)\(old)."
    }

    /// designation.ts CAPTURE_BEHIND_MS: past it the capture says how old it is.
    static let captureBehind: TimeInterval = 36 * 60 * 60
}

/// A board row's figures as the phone prints them (web/src/lib/format/number.ts and gap.ts).
public enum BoardFigures {
    /// format/number.ts MINUS: a negative figure's sign.
    static let minus = "\u{2212}"

    /// His projected points, "262.1"; the empty figure for none.
    public static func projected(_ value: Double?) -> String {
        value.map { Formatting.fixed($0) } ?? Words.Box.none
    }

    /// number.ts signed: "+113.9", "−12.5", "+0.0" for a figure that rounds to nothing.
    public static func signed(_ value: Double) -> String {
        let magnitude = Formatting.fixed(abs(value))
        return value < 0 && Double(magnitude) != 0 ? "\(minus)\(magnitude)" : "+\(magnitude)"
    }

    /// gap.ts gapText: "+1.8", "−4.5", "0.0", the empty figure for none.
    public static func gap(_ value: Double?) -> String {
        guard let value else {
            return Words.Box.none
        }
        return value == 0 ? Formatting.fixed(0) : signed(value)
    }
}

/// Each player's page on the site by his slug, the rule the API names its lines' pages by
/// (api/internal/inseason/faces.go slugOf and pages): accents dropped, lower case, words joined by
/// hyphens; a name two players share gets no page, and a kicker or a defense has none.
public enum PlayerPages {
    /// faces.go slugOf.
    public static func slug(_ name: String) -> String {
        let stripped = String(String.UnicodeScalarView(
            name.decomposedStringWithCanonicalMapping.unicodeScalars.filter {
                $0.properties.generalCategory != .nonspacingMark
            }
        ))
        var slug = ""
        var joining = false
        for scalar in stripped.lowercased().unicodeScalars {
            if ("a" ... "z").contains(scalar) || ("0" ... "9").contains(scalar) {
                if joining, !slug.isEmpty {
                    slug.append("-")
                }
                slug.unicodeScalars.append(scalar)
                joining = false
            } else {
                joining = true
            }
        }
        return slug
    }

    /// The slugs no two names share, among every name given.
    public static func unshared(_ names: [String]) -> Set<String> {
        var seen: [String: Int] = [:]
        for name in names {
            seen[slug(name), default: 0] += 1
        }
        return Set(seen.filter { !$0.key.isEmpty && $0.value == 1 }.keys)
    }
}

/// The board's basis on a phone as the web says it (run/board-basis.ts boardBasis, site/market.ts
/// marketBasis), held to shared/fixtures/parity/board.json: our board's sentence and, where the Gap
/// column shows, its definition; a kicker's or a defense's view says the drafts' order instead. The
/// web's "ADP from <drafts>." and "Tiers are drawn within WR." wait for the run's board on the API.
public enum BoardBasis {
    /// The teams GET /boards/{format} values its board for (openapi.yaml roomBoard).
    public static let teams = 12

    /// board-basis.ts ourBoard for a board of the full season.
    public static func ourBoard(label: String, teams: Int = teams) -> String {
        "Our \(label) board, by points over replacement for \(teams) teams."
    }

    /// market.ts marketBasis with no drafts named.
    public static let draftOrder =
        "Kickers and defenses the drafters take rank in their draft order, with no projected points and no tiers."

    public static func lines(_ columns: BoardColumns, label: String) -> [String] {
        switch columns {
        case let .ranked(gap): [ourBoard(label: label)] + (gap ? [Words.BoardBasis.gap] : [])
        case .draftOrder: [draftOrder]
        }
    }
}
