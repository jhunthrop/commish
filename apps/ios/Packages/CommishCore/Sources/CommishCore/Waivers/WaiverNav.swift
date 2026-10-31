import CommishAPI
import CommishDesign
import Foundation

/// The figures the cards and the list read (positions.ts PanelMode): the rest of the season, the default,
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

    /// The rank's meaning, said once a mode under the cards (positions.ts PANEL.explain).
    public var explain: String {
        switch self {
        case .season: Words.WaiverPanel.explainSeason
        case .week: Words.WaiverPanel.explainWeek
        }
    }
}

/// One card of the row (position-nav.ts NavCard).
public struct NavCard: Equatable, Sendable, Identifiable {
    /// The member's figure as a share of twice the median, 0 to 1 (the median at the half), and whether it
    /// is under the median.
    public struct Meter: Equatable, Sendable {
        public let share: Double
        public let under: Bool
    }

    /// A position ("QB", "DEF"), or `WaiverNav.all`.
    public let key: String
    /// "All", "QB", "D/ST".
    public let word: String
    /// "rank 9 of 12"; on a count card its free agents' count; nil with no figure (the card says what it
    /// waits on, never a bare "--").
    public let place: String?
    /// The member's figure (on a count card, how many beat a player of his); nil with no figure.
    public let figure: String?
    /// "155.6 median"; on All, "Every position"; nil with no figure.
    public let foot: String?
    /// Beside the figure: "this week" on a card that reads this week's Proj, a count card's "beat yours".
    public let tag: String?
    public let need: Bool
    /// The strip's pickups include one here.
    public let pickup: Bool
    /// Said in place of a figure where none is read yet.
    public let waits: String?
    public let meter: Meter?

    public var id: String {
        key
    }

    /// The card's name for VoiceOver: the position, its rank, the figure and Need (ruling 3).
    public var spoken: String {
        let marks = [need ? Words.WaiverPanel.need : nil, pickup ? Words.WaiverNav.pickup : nil]
        return ([word, place, figure, tag] + marks + [foot, waits]).compactMap(\.self).joined(separator: ", ")
    }
}

/// The counts a count card says (position-nav.ts NavCounts).
public struct NavCounts: Equatable, Sendable {
    public let free: Int
    public let gaining: Int
}

/// The line over the comparison (position-nav.ts navLead): the chosen card's rank, and only what the
/// card cannot say.
public struct NavLead: Equatable, Sendable {
    public let head: String
    public let words: String?
}

/// One of the member's players at the chosen position, in the table's columns (position-nav.ts YoursRow).
public struct YoursRow: Equatable, Sendable, Identifiable {
    public let key: String
    public let cells: RowCells
    /// "Opp 2nd, Avg 8.9, Last 10.5, A game 6.4", the table's evidence line.
    public let evidence: String
    /// His rest-of-season points a game, the table's A game.
    let rest: Double?
    /// Starter or Bench in the mode's lineup.
    public let role: String
    public let starts: Bool

    public var id: String {
        key
    }

    /// The player his name opens in the sheet, nil where the site has no page for him.
    public var sheetPlayer: SheetPlayer? {
        cells.sheetPlayer
    }
}

/// position-nav.ts over the page's answer: the Waivers screen's position cards as its navigation, All
/// first, then a card a position the league starts, each with the member's rank there, his figure against
/// the median team's and the Need mark; the card the screen opens on; the member's players at the chosen
/// position over the free agents there. Every figure is the API's; nothing is computed but the words and
/// the order.
public enum WaiverNav {
    typealias Card = Components.Schemas.WaiverPositionCard
    typealias Standing = Components.Schemas.WaiverStanding

    /// The All card's key (position-nav.ts ALL).
    public static let all = "ALL"

    /// "Your TE", over the member's players at the position.
    public static func yours(_ word: String) -> String {
        "Your \(word)"
    }

    /// "Free at TE", over the free agents there.
    public static func freeAt(_ word: String) -> String {
        "Free at \(word)"
    }

    /// The lead on a card that ranks this week's Proj in place of a rest-of-season order (K, D/ST).
    public static func swapped(_ word: String) -> String {
        "\(word) has no rest-of-season order, so its card ranks this week's Proj."
    }

    /// Where a position's own read failed: its players from the screen's first read stay listed.
    public static func firstRead(_ word: String) -> String {
        "Showing the first read's players at \(word)."
    }

    static func position(_ card: Card) -> String {
        card.position.value1?.rawValue ?? card.position.value2 ?? ""
    }

    static func card(_ advice: WaiverAdvice, _ key: String) -> Card? {
        (advice.positions ?? []).first { position($0) == key }
    }

    /// positions.ts placeWords: "rank 9 of 12".
    static func place(_ standing: Standing, teams: Int) -> String {
        "\(Words.WaiverPanel.rank) \(standing.rank) \(Words.WaiverPanel.of) \(teams)"
    }

    /// position-nav.ts navStanding: the standing a card reads in the mode, its own, or on Rest of season
    /// where the position has no rest-of-season order (K, D/ST) this week's, marked as swapped; nil where
    /// neither is read.
    static func standing(_ card: Card, _ mode: PanelMode) -> (standing: Standing, swapped: Bool)? {
        let own = mode == .season ? card.restOfSeason?.value1 : card.week?.value1
        if let own {
            return (own, false)
        }
        if mode == .season, let week = card.week?.value1 {
            return (week, true)
        }
        return nil
    }

    /// position-nav.ts navCounts: the free agents a set of rows holds and how many beat a player of his.
    public static func counts(_ rows: [PoolRow]) -> NavCounts {
        NavCounts(free: rows.count, gaining: rows.count { $0.gains })
    }

    static func countCard(_ key: String, word: String, counts: NavCounts, foot: String?, pickup: Bool) -> NavCard {
        NavCard(
            key: key, word: word, place: "\(counts.free) \(Words.WaiverNav.freeAgents)",
            figure: String(counts.gaining), foot: foot, tag: Words.WaiverNav.beat, need: false, pickup: pickup,
            waits: nil, meter: nil
        )
    }

    static func meter(_ standing: Standing) -> NavCard.Meter? {
        guard standing.median > 0 else {
            return nil
        }
        let ratio = standing.points / standing.median
        return .init(share: max(0, min(1, ratio / 2)), under: ratio < 1)
    }

    static func positionCard(_ card: Card, _ mode: PanelMode, pickups: Set<String>) -> NavCard {
        let key = position(card)
        let word = StartRows.positionWord(key)
        guard let (standing, swapped) = standing(card, mode) else {
            return NavCard(
                key: key, word: word, place: nil, figure: nil, foot: nil, tag: nil, need: false,
                pickup: pickups.contains(key), waits: Words.WaiverNav.waits, meter: nil
            )
        }
        return NavCard(
            key: key, word: word, place: place(standing, teams: card.teams),
            figure: StartWords.number(standing.points),
            foot: "\(StartWords.number(standing.median)) \(Words.WaiverPanel.median)",
            tag: swapped ? Words.WaiverNav.weekTag : nil,
            // The need is the rest of the season's (the profile's): never marked on this week's figures.
            need: card.need && mode == .season && !swapped, pickup: pickups.contains(key), waits: nil,
            meter: meter(standing)
        )
    }

    /// position-nav.ts navCards: All first, then each position the answer's panel carries, in its order. An
    /// answer without the panel (an older API, or no rest-of-season points read) still navigates: a count
    /// card for each position its rows hold, in the board's order.
    public static func cards(
        _ advice: WaiverAdvice, mode: PanelMode, counts: NavCounts, byPosition: [(String, NavCounts)]
    ) -> [NavCard] {
        let pickups = Set(advice.pickups.map(\.add.player.position))
        let all = countCard(
            all, word: Words.WaiverNav.all, counts: counts, foot: Words.WaiverNav.every, pickup: false
        )
        guard let positions = advice.positions, !positions.isEmpty else {
            return [all] + byPosition.map { key, counts in
                countCard(
                    key, word: StartRows.positionWord(key), counts: counts, foot: nil, pickup: pickups.contains(key)
                )
            }
        }
        return [all] + positions.map { positionCard($0, mode, pickups: pickups) }
    }

    /// position-nav.ts openingKey: the Need with the weakest rank, the first in the panel's order on a tie;
    /// All where no card marks one.
    public static func opening(_ advice: WaiverAdvice) -> String {
        var weakest: (key: String, rank: Int)?
        for card in advice.positions ?? [] {
            guard card.need, let rest = card.restOfSeason?.value1 else {
                continue
            }
            if rest.rank > (weakest?.rank ?? Int.min) {
                weakest = (position(card), rest.rank)
            }
        }
        return weakest?.key ?? all
    }

    /// position-nav.ts yoursRows: the member's players at the position, starters first, then by the mode's
    /// figure (his rest-of-season points, or this week's Proj), none last; empty for All or a position
    /// without a card.
    public static func yours(
        _ advice: WaiverAdvice, key: String, mode: PanelMode, zone: TimeZone, now: Date
    ) -> [YoursRow] {
        guard let card = card(advice, key) else {
            return []
        }
        let starts = { (mine: Components.Schemas.WaiverPositionPlayer) in
            mode == .season ? mine.starter : mine.startsThisWeek
        }
        let figure = { (mine: Components.Schemas.WaiverPositionPlayer) in
            (mode == .season ? mine.restOfSeasonPoints : mine.line.weekProjection) ?? -.infinity
        }
        let ordered = card.mine.enumerated().sorted { lhs, rhs in
            let left = (starts(lhs.element), figure(lhs.element))
            let right = (starts(rhs.element), figure(rhs.element))
            if left.0 != right.0 {
                return left.0
            }
            return left.1 == right.1 ? lhs.offset < rhs.offset : left.1 > right.1
        }.map(\.element)
        return ordered.map { mine in
            let line = mine.line
            let cells = WaiverRows.cells(line, reserve: nil, zone: zone, now: now)
            return YoursRow(
                key: "yours:\(line.player.hostId)", cells: cells,
                evidence: WaiverRows.evidence(cells, rest: line.restOfSeasonPerGame),
                rest: line.restOfSeasonPerGame, role: starts(mine) ? Words.Waivers.starter : Words.Waivers.bench,
                starts: starts(mine)
            )
        }
    }

    /// position-nav.ts navLead: the chosen card's rank, and beside it only what the card cannot say (a
    /// Need's meaning, a swapped figure's); All's words for All. A position with no card, or no figure, is
    /// named alone.
    public static func lead(_ advice: WaiverAdvice, key: String, mode: PanelMode) -> NavLead {
        if key == all {
            return NavLead(head: Words.WaiverNav.allHead, words: Words.WaiverNav.allSays)
        }
        let word = StartRows.positionWord(key)
        guard let card = card(advice, key), let (standing, swapped) = standing(card, mode) else {
            return NavLead(head: word, words: nil)
        }
        let need = card.need && mode == .season && !swapped
        return NavLead(
            head: "\(word) \(place(standing, teams: card.teams))",
            words: swapped ? Self.swapped(word) : need ? Words.WaiverPanel.needSays : nil
        )
    }

    /// position-nav.ts withoutRostered: a narrowed answer kept on screen while the next lands, less any free
    /// agent the fresher answer has on the member's roster (claimed since).
    public static func withoutRostered(_ answer: WaiverAdvice, roster: [PlayerLine]) -> WaiverAdvice {
        let mine = Set(roster.map(\.player.hostId))
        guard !mine.isEmpty else {
            return answer
        }
        var kept = answer
        kept.rows = answer.rows.filter { !mine.contains($0.add.player.hostId) }
        kept.stash = answer.stash?.filter { !mine.contains($0.add.player.hostId) }
        return kept
    }

    /// position-nav.ts navSort: the list's order the toggle sets, the season Gain or this week's Proj.
    public static func sort(_ mode: PanelMode) -> WaiverSort {
        mode == .season ? .initial : WaiverSort(key: .proj, down: true)
    }

    /// position-nav.ts atPosition: the answer's rows at one position, until the position's own read lands.
    public static func atPosition(_ advice: WaiverAdvice, key: String) -> WaiverAdvice {
        guard key != all else {
            return advice
        }
        var here = advice
        here.rows = advice.rows.filter { $0.add.player.position == key }
        here.stash = advice.stash?.filter { $0.add.player.position == key }
        return here
    }

    /// One answer's mark (WaiverScreen.svelte answerMark): when it was read and whose players the member
    /// holds, so an unchanged answer reads the chosen position no second time.
    static func mark(_ advice: WaiverAdvice) -> String {
        "\(advice.readAt)|\(advice.roster.map(\.player.hostId).joined(separator: ","))"
    }
}
