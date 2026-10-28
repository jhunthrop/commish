import CommishAPI
import CommishDesign
import Foundation

/// The week's read as the page and the sheet show it (web/src/lib/player/week-read.ts shownWeekRead):
/// the writer's words with their caption, or a withheld read's words alone.
public enum ShownRead: Equatable, Sendable {
    case written(body: String, caption: String)
    case withheld(String)
}

/// What the read is held to (week-read.ts CardProjection): the week's published projection as the card
/// prints it, in the card's scoring, and his game's state by its line's field at the card's clock.
public struct CardProjection: Equatable, Sendable {
    public let week: Int
    /// The card reads in PPR, the scoring the read quotes.
    public let ppr: Bool
    public let points: Double?
    /// His game's state, nil for a bye or a week with no game held.
    public let state: GameRead?

    public init(week: Int, ppr: Bool, points: Double?, state: GameRead?) {
        self.week = week
        self.ppr = ppr
        self.points = points
        self.state = state
    }
}

/// The figure a read quotes: none named on a run older than the field, none when the read was written
/// without one, or its points. The API's spec reads an absent and a null projection alike, so a read
/// that carries the moved caption (the field the projection arrived with, Lane 162) and no projection
/// was written without one.
public enum QuotedProjection: Equatable, Sendable {
    case notNamed
    case none
    case points(Double)

    public init(_ read: RunWeekRead) {
        if let points = read.projection {
            self = .points(points)
        } else {
            self = read.movedCaption == nil ? .notNamed : .none
        }
    }
}

/// The projection's move, one fact for the Proj change tile, the moved caption and the run's serve rule
/// (card.ts ProjectionMove): its signed change (nil with no figures to subtract), whether it reaches the
/// shown threshold, and what it is measured from.
struct ProjectionMove: Equatable {
    enum Basis: Equatable {
        case read
        case earlier
    }

    let change: Double?
    let crosses: Bool
    let basis: Basis

    /// card.ts SHOWN_CHANGE_FROM.
    static let shownFrom = 0.5
    static let tenths = 10.0

    /// card.ts projectionMove: since the read was written when it quotes a figure, else since the
    /// earlier snapshot, in whole printed tenths so no float edge decides.
    static func of(now: Double?, quoted: QuotedProjection, earlier: Double?) -> ProjectionMove {
        switch quoted {
        case .notNamed:
            let crosses = earlier.map { crossesShown(jsRound($0 * tenths)) } ?? false
            return ProjectionMove(change: earlier, crosses: crosses, basis: .earlier)
        case .none:
            return ProjectionMove(change: nil, crosses: now != nil, basis: .read)
        case let .points(points):
            guard let now else {
                return ProjectionMove(change: nil, crosses: true, basis: .read)
            }
            let moved = jsRound(now * tenths) - jsRound(points * tenths)
            return ProjectionMove(change: moved / tenths, crosses: crossesShown(moved), basis: .read)
        }
    }

    private static func crossesShown(_ tenthsMoved: Double) -> Bool {
        abs(tenthsMoved) >= shownFrom * tenths
    }

    /// JavaScript's Math.round: half up, toward positive infinity.
    private static func jsRound(_ value: Double) -> Double {
        (value + 0.5).rounded(.down)
    }
}

/// week-read.ts: the read beside the card's live projection, and the place's words when none stands.
public enum WeekReads {
    /// weekReadLabel: "Our read for week 7", never "the week ahead".
    public static func label(week: Int) -> String {
        "\(Words.Card.ourRead) for week \(week)"
    }

    /// shownWeekRead: a read the run withheld keeps its caption while his game is to come and says it
    /// was not written once his game is under way; a read the card's projection has moved past by the
    /// shown threshold is withheld behind the run's moved caption; otherwise it stands.
    public static func shown(_ read: RunWeekRead, card: CardProjection?) -> ShownRead {
        guard let body = read.body else {
            return .withheld(withheldWords(read, card: card))
        }
        if movedPastRead(read, card: card), let moved = read.movedCaption {
            return .withheld(moved)
        }
        return .written(body: body, caption: read.caption)
    }

    /// movedPastRead: the one test the read's withhold and the Wk tile's quote share.
    static func movedPastRead(_ read: RunWeekRead, card: CardProjection?) -> Bool {
        guard read.body != nil, let card, card.ppr, card.week == read.week, !underway(card.state) else {
            return false
        }
        let quoted = QuotedProjection(read)
        guard quoted != .notNamed, read.movedCaption != nil else {
            return false
        }
        return ProjectionMove.of(now: card.points, quoted: quoted, earlier: nil).crosses
    }

    /// noReadWords: his next game while it is to come, never "next" for one under way or final; while the
    /// coming week's reads are not yet written, the night they are (Lane 256, the run's `weekReadsDue`).
    public static func noRead(_ state: GameRead?, due: RunReadsDue?) -> String {
        if underway(state) {
            return Words.Card.readNotWritten
        }
        guard let due, let night = due.night.value1?.rawValue ?? due.night.value2 else {
            return Words.Card.readNotYet
        }
        return readsDue(week: due.week, night: night)
    }

    /// card.ts CARD.readsDue: "Our reads for week 8 are written Tuesday night."
    static func readsDue(week: Int, night: String) -> String {
        "Our reads for week \(week) are written \(night) night."
    }

    private static func withheldWords(_ read: RunWeekRead, card: CardProjection?) -> String {
        card?.week == read.week && underway(card?.state) ? Words.Card.readNotWritten : read.caption
    }

    private static func underway(_ state: GameRead?) -> Bool {
        state == .kickedOff || state == .final
    }
}
