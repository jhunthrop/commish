import CommishDesign
import Foundation
import Observation

/// A player as the row that opens his sheet drew him: the row's own facts, which the sheet's head
/// shows before anything else is read (web/src/lib/player/shelf.ts shelfHead).
public struct SheetPlayer: Equatable, Hashable, Sendable, Identifiable {
    /// His id: what the sheet holds, so it keeps him whatever the list under it does.
    public let id: String
    /// His page's address on the site, /players/<slug>.
    public let slug: String
    public let name: String
    /// His position, nil where the row draws none.
    public let position: String?
    /// His rank at the position as the row draws it, or the list he is on ("IR"); nil with none.
    public let rank: String?
    /// His club as the row draws it.
    public let club: String?
    /// His board id where the row carries it: his week is read by it when the run's index names no page
    /// for his slug.
    public let boardID: String?

    public init(
        id: String, slug: String, name: String, position: String?, rank: String?, club: String?,
        boardID: String? = nil
    ) {
        self.id = id
        self.slug = slug
        self.name = name
        self.position = position
        self.rank = rank
        self.club = club
        self.boardID = boardID
    }
}

/// What the screen under the sheet offers him (shelf-state.ts ScreenOffer): the verb in the screen's
/// words, the line under it, what it does there, and whether the screen is one of the lineup's, whose
/// verb gives way to his game's state once it has kicked off (shelf.ts LINEUP_SCREENS).
public struct SheetOffer: Sendable {
    public let label: String
    public let line: String?
    public let lineup: Bool
    public let act: @MainActor @Sendable () -> Void

    public init(label: String, line: String?, lineup: Bool, act: @escaping @MainActor @Sendable () -> Void) {
        self.label = label
        self.line = line
        self.lineup = lineup
        self.act = act
    }
}

public extension SheetOffer {
    /// shelf-state.ts compareOffer: Compare, the comparison with him on one side (the card's word), opened
    /// by its site link, which the app pushes as its own screen.
    static func compare(_ player: SheetPlayer, open: @escaping @MainActor @Sendable (URL) -> Void) -> SheetOffer {
        SheetOffer(label: Words.Card.compare, line: nil, lineup: false) {
            open(SiteLinks.compare(first: player.slug))
        }
    }
}

/// The sheet's verb (shelf.ts shelfVerb): the screen's offer, or on a lineup screen once his game has
/// kicked off the held words in its place, since no lineup move takes him then.
public enum SheetVerb: Equatable, Sendable {
    case act(label: String, line: String?)
    case held(String)

    public static func of(_ offer: SheetOffer?, game: GameRead?) -> SheetVerb? {
        guard let offer else {
            return nil
        }
        if offer.lineup {
            if game == .final {
                return .held(Words.Card.gameFinal)
            }
            if game == .kickedOff {
                return .held(Words.Card.kickedOff)
            }
        }
        return .act(label: offer.label, line: offer.line)
    }
}

/// The sheet's frame (the web's player shelf, PlayerShelf.svelte): his name, position pill and club
/// in the head from the row, his full page on the site, and the words the shelf shows while his week
/// is read, which the body says until his card (PlayerSheetViewModel) is read.
public struct PlayerSheetModel: Equatable, Sendable {
    public let name: String
    /// His face where no headshot is drawn yet: his initials.
    public let initials: String
    /// "WR 4", "RB IR", or his position alone; nil where the row draws none.
    public let pill: String?
    public let club: String?
    /// His page on the site, a universal link the app opens in place of the browser.
    public let fullPage: URL
    public let fullPageWords: String
    public let closeWords: String
    public let loading: String

    public init(player: SheetPlayer) {
        name = player.name
        initials = Initials.of(player.name)
        pill = player.position.map { position in player.rank.map { "\(position) \($0)" } ?? position }
        club = player.club
        fullPage = SiteLinks.player(player.slug)
        fullPageWords = Words.Shelf.fullPage
        closeWords = Words.Shelf.close
        loading = PlayerSheetWords.unreadBasis(failed: false, weekTile: Words.Card.proj)
    }
}

/// The shelf's sentences built from the card's words (web/src/lib/player/card.ts).
public enum PlayerSheetWords {
    /// card.ts unreadBasis for a player on no list: what the week's tiles are, read as the sheet
    /// opens, or why they show "--".
    public static func unreadBasis(failed: Bool, weekTile: String, listed: String? = nil) -> String {
        // A listed player's week tiles say his list, read or not (Lane 128).
        if listed != nil {
            return Words.Card.listedWeek
        }
        let tiles = "\(weekTile), \(Words.Card.opp) and \(Words.Card.delta)"
        return failed
            ? "\(tiles) show \"\(Words.Card.none)\" because this week's figures could not be read just now."
            : "\(tiles) are this week's, read as the page opens."
    }
}

/// The site's addresses the app links to.
public enum SiteLinks {
    /// The site, whose association file hands its app-link paths to the app.
    public static let origin = URL(string: "https://trycommish.app")!

    /// A player's page, /players/<slug>.
    public static func player(_ slug: String) -> URL {
        origin.appendingPathComponent("players").appendingPathComponent(slug)
    }

    /// Our record, past weeks of our order (the Lineup strip's link, web links.record()).
    public static let record = origin.appendingPathComponent("record")

    /// The follow page, where a league is followed (nav.ts LEAGUE_START).
    public static let leagueStart = origin.appendingPathComponent("league/new")

    /// A mock draft's setup (nav.ts MOCK_SETUP).
    public static let mockSetup = origin.appendingPathComponent("mock/new")

    /// The cheat sheet (nav.ts, the sheet's rail item).
    public static let sheet = origin.appendingPathComponent("sheet")

    /// ADP for a format as the run names it (links.ts adp): /adp/ppr-12.
    public static func adp(_ format: String) -> URL {
        origin.appendingPathComponent("adp").appendingPathComponent(format)
    }

    /// Every club (links.ts clubs).
    public static let clubs = origin.appendingPathComponent("clubs")

    /// A club's page by its abbreviation, lower case (links.ts club): /clubs/ari.
    public static func club(_ abbr: String) -> URL {
        clubs.appendingPathComponent(abbr.lowercased())
    }

    /// The strength of schedule (links.ts schedule).
    public static let schedule = origin.appendingPathComponent("schedule")

    /// Compare with the sides by their pages' slugs (links.ts compare): /compare?a=chris-olave&b=nico-collins.
    public static func compare(first: String? = nil, second: String? = nil) -> URL {
        let base = origin.appendingPathComponent("compare")
        let items = [("a", first), ("b", second)].compactMap { name, slug in slug.map { URLQueryItem(
            name: name,
            value: $0
        ) } }
        return items.isEmpty ? base : base.appending(queryItems: items)
    }
}

/// The sheet a screen presents from its rows: the player shown, by his id. A screen whose list reads
/// again hands the new rows here, and the sheet keeps the player it opened on, his fresh facts when
/// the list still has him (plan Review Focus 3).
@MainActor
@Observable
public final class PlayerSheetHost {
    /// The player the sheet shows, nil while it is closed; the sheet's binding sets it nil when the
    /// member swipes it away.
    public var shown: SheetPlayer?
    /// What the screen the sheet opened from offers him, nil where it offers none.
    public private(set) var offer: SheetOffer?

    public init() {}

    public func open(_ player: SheetPlayer, offer: SheetOffer? = nil) {
        shown = player
        self.offer = offer
    }

    public func close() {
        shown = nil
        offer = nil
    }

    /// The screen under the sheet read its list again: the sheet keeps its player.
    public func parentRefreshed(_ rows: [SheetPlayer]) {
        guard let held = shown else {
            return
        }
        shown = rows.first { $0.id == held.id } ?? held
    }
}
