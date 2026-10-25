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

    public init(id: String, slug: String, name: String, position: String?, rank: String?, club: String?) {
        self.id = id
        self.slug = slug
        self.name = name
        self.position = position
        self.rank = rank
        self.club = club
    }
}

/// The sheet's frame (the web's player shelf, PlayerShelf.svelte): his name, position pill and club
/// in the head from the row, his full page on the site, and the words the shelf shows while his week
/// is read, which the body says until the player sheet's own lane fills it.
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
    public static func unreadBasis(failed: Bool, weekTile: String) -> String {
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

    public init() {}

    public func open(_ player: SheetPlayer) {
        shown = player
    }

    public func close() {
        shown = nil
    }

    /// The screen under the sheet read its list again: the sheet keeps its player.
    public func parentRefreshed(_ rows: [SheetPlayer]) {
        guard let held = shown else {
            return
        }
        shown = rows.first { $0.id == held.id } ?? held
    }
}
