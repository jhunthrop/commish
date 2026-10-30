import CommishAPI
import CommishDesign
import Foundation

/// The figures the position panel reads (positions.ts PanelMode): the rest of the season, the default,
/// or this week's Proj.
public enum PanelMode: String, CaseIterable, Equatable, Sendable {
    case season
    case week

    /// The toggle's chip: "Rest of season", "This week".
    public var word: String {
        switch self {
        case .season: Words.WaiverPanel.season
        case .week: Words.WaiverPanel.week
        }
    }

    /// The list's figure head: "Rest of season", or Proj this week.
    public var head: String {
        switch self {
        case .season: Words.WaiverPanel.season
        case .week: Words.Box.proj
        }
    }
}

/// One player on a card's ranked list (positions.ts PanelEntry): the member's with Starter or Bench, a
/// free agent with the table's Beats words and the table's row for the one verb.
public struct PanelEntry: Equatable, Sendable, Identifiable {
    public let key: String
    /// His short name, as the strip and Beats print a second mention.
    public let name: String
    public let full: String
    public let team: String
    /// "Yours, Starter", "Yours, Bench", or "Free".
    public let mark: String
    /// The toggle's figure: his rest-of-season points, or this week's Proj.
    public let figure: String
    /// A free agent's row as the table draws it, nil for the member's own.
    public let pool: PoolRow?
    /// "Dart, Bench, +0.3 Gain", nil for the member's own.
    public let beats: String?
    /// The player his name opens in the sheet, nil where the site has no page for him.
    public let sheetPlayer: SheetPlayer?

    public var id: String {
        key
    }
}

/// One card of the panel (positions.ts PanelCard).
public struct PanelCard: Equatable, Sendable, Identifiable {
    public let key: String
    /// "RB", "D/ST".
    public let word: String
    /// "RB rank 2 of 12", or "RB --" where the figure is not read.
    public let rank: String
    /// "rank 2 of 12", or "--".
    public let place: String
    public let figure: String
    /// "501.1 median", nil where the mode has no figure.
    public let median: String?
    public let need: Bool
    public let teams: Int
    public let mine: [PanelEntry]
    public let free: [PanelEntry]

    public var id: String {
        key
    }
}

/// positions.ts over the page's answer: one card a position the league starts, the member's rank there
/// with his figure against the median team's and the need mark, opening on his players then the best free
/// agents there, each free agent with the table's Beats words (one rule, the table's: poolRows). Every
/// figure is the API's; nothing is computed but the words and the list's order.
public enum WaiverPanel {
    typealias Card = Components.Schemas.WaiverPositionCard
    typealias Standing = Components.Schemas.WaiverStanding

    static func standing(_ card: Card, _ mode: PanelMode) -> Standing? {
        switch mode {
        case .season: card.restOfSeason?.value1
        case .week: card.week?.value1
        }
    }

    /// positions.ts placeWords: "rank 2 of 12", "--" with no figure.
    static func place(_ standing: Standing?, teams: Int) -> String {
        guard let standing else {
            return Words.Box.none
        }
        return "\(Words.WaiverPanel.rank) \(standing.rank) \(Words.WaiverPanel.of) \(teams)"
    }

    /// positions.ts beatsWords: the name and his place where he beats one of the member's, then the Gain;
    /// the bare figure on a row that names no one.
    static func beats(_ pool: PoolRow) -> String {
        let gain = pool.beats.figure ?? Words.Box.none
        guard let who = pool.beats.who else {
            return gain
        }
        return "\(who.name), \(who.place), \(gain)"
    }

    /// The figure an entry sorts by in the mode, none last.
    static func sortFigure(_ line: PlayerLine, points: Double?, _ mode: PanelMode) -> Double {
        (mode == .season ? points : line.weekProjection) ?? -.infinity
    }

    /// Highest first, ties in the answer's order (the web's sort is stable).
    static func byFigure<T>(_ items: [T], _ figure: (T) -> Double) -> [T] {
        items.enumerated().sorted { lhs, rhs in
            let left = figure(lhs.element)
            let right = figure(rhs.element)
            return left == right ? lhs.offset < rhs.offset : left > right
        }.map(\.element)
    }

    static func figure(_ line: PlayerLine, points: Double?, _ mode: PanelMode) -> String {
        StartWords.number(mode == .season ? points : line.weekProjection)
    }

    static func mine(_ card: Card, _ mode: PanelMode, zone: TimeZone, now: Date) -> [PanelEntry] {
        byFigure(card.mine) { sortFigure($0.line, points: $0.restOfSeasonPoints, mode) }.map { player in
            let line = player.line
            let starts = mode == .season ? player.starter : player.startsThisWeek
            let mark = starts ? Words.Waivers.starter : Words.Waivers.bench
            return PanelEntry(
                key: "mine:\(line.player.hostId)", name: WaiverWords.shortName(line.player.name),
                full: line.player.name, team: line.player.team, mark: "\(Words.WaiverPanel.yours), \(mark)",
                figure: figure(line, points: player.restOfSeasonPoints, mode), pool: nil, beats: nil,
                sheetPlayer: WaiverRows.cells(line, reserve: nil, zone: zone, now: now).sheetPlayer
            )
        }
    }

    static func free(
        _ card: Card, _ advice: WaiverAdvice, _ mode: PanelMode, zone: TimeZone, now: Date
    ) -> [PanelEntry] {
        // This week lists the week's own best five by Proj; an older answer re-sorts its five.
        let listed = mode == .week ? (card.availableWeek ?? card.available) : card.available
        let free = byFigure(listed) { sortFigure($0.row.add, points: $0.restOfSeasonPoints, mode) }
        var drawn = advice
        drawn.rows = free.map(\.row)
        let pools = WaiverRows.pool(drawn, pickups: advice.pickups, zone: zone, now: now)
        return zip(free, pools).map { free, pool in
            let line = free.row.add
            return PanelEntry(
                key: "free:\(pool.key)", name: WaiverWords.shortName(line.player.name), full: line.player.name,
                team: line.player.team, mark: Words.WaiverPanel.free,
                figure: figure(line, points: free.restOfSeasonPoints, mode), pool: pool, beats: beats(pool),
                sheetPlayer: pool.sheetPlayer
            )
        }
    }

    /// positions.ts panelCards: the cards in the mode, none from an answer without the panel.
    public static func cards(_ advice: WaiverAdvice, mode: PanelMode, zone: TimeZone, now: Date) -> [PanelCard] {
        (advice.positions ?? []).map { card in
            let standing = standing(card, mode)
            let position = card.position.value1?.rawValue ?? card.position.value2 ?? ""
            let word = StartRows.positionWord(position)
            let place = place(standing, teams: card.teams)
            return PanelCard(
                key: position, word: word, rank: "\(word) \(place)", place: place,
                figure: StartWords.number(standing?.points),
                median: standing.map { "\(StartWords.number($0.median)) \(Words.WaiverPanel.median)" },
                // The need is the rest of the season's: not marked on this week's figures.
                need: card.need && mode == .season, teams: card.teams,
                mine: mine(card, mode, zone: zone, now: now),
                free: free(card, advice, mode, zone: zone, now: now)
            )
        }
    }

    /// positions.ts panelHasWeek: the toggle is drawn only when a card reads this week.
    public static func hasWeek(_ advice: WaiverAdvice) -> Bool {
        (advice.positions ?? []).contains { $0.week != nil }
    }

    /// positions.ts panelExplain: what the rank is, and where a Need is drawn what it is and how the
    /// Trades screen's needs differ.
    public static func explain(_ mode: PanelMode, cards: [PanelCard]) -> String {
        let rank = mode == .season ? Words.WaiverPanel.explainSeason : Words.WaiverPanel.explainWeek
        guard cards.contains(where: \.need) else {
            return rank
        }
        return "\(rank) \(Words.WaiverPanel.needSays) \(Words.WaiverPanel.tradesNeeds)"
    }
}
