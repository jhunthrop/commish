import CommishAPI
import CommishDesign
import Foundation

/// A chip over the Rankings (order.ts PLAYERS_CHIPS): one of our order's four positions, or the week's
/// kickers or defenses, which the published projection orders (we rank neither). nil is All.
public enum RankingsChip: String, CaseIterable, Hashable, Sendable, Identifiable {
    case quarterback = "QB"
    case runningBack = "RB"
    case receiver = "WR"
    case tightEnd = "TE"
    case kicker = "K"
    case defense = "DEF"

    public var id: String {
        rawValue
    }

    /// box.ts positionWord: a defense is "D/ST".
    public var word: String {
        StartRows.positionWord(rawValue)
    }

    /// The order's position for our order's chips, nil for the week's.
    public var orderPosition: OrderPosition? {
        OrderPosition(rawValue: rawValue)
    }

    /// The week's position for the kickers' and defenses' chips (order.ts weekChip), nil for ours.
    public var weekPosition: WeekOrderPosition? {
        switch self {
        case .kicker: .k
        case .defense: .def
        default: nil
        }
    }
}

/// A player's cell as the Rankings' rows draw it (BoxPlayer.svelte at 390): his face or his club's
/// mark, his name whole and short, his club, his pill (his position and, across positions, his rank at
/// it, or the list he is on), his status chip, his game with its zone, and while it is to come the
/// expected score with both clubs and the kickoff weather.
public struct RankingsPlayer: Equatable, Sendable {
    /// His board id: the row's key and the player sheet's.
    public let key: String
    public let name: String
    /// His short form where the whole does not fit: "D. Swift", "Titans".
    public let fit: String
    public let slug: String?
    /// A defense draws its club's mark in place of a face.
    public let clubMark: Bool
    public let club: String
    /// "RB 15", "TE IR", "K"; nil for a defense, whose mark names it.
    public let pill: String?
    public let status: RowStatus?
    public let game: RowGame
    /// "Expected score CHI 26.5, ATL 23", while his game is to come.
    public let expected: String?
    public let weather: WeatherCell?

    /// The player his name opens in the sheet, by his id: nil where the site has no page for him (a
    /// kicker, a defense), as the web's row draws no link.
    public var sheetPlayer: SheetPlayer? {
        slug.map { slug in
            let position = pill.map { String($0.prefix { $0 != " " }) }
            let rank = pill.flatMap { words in words.firstIndex(of: " ").map { String(words[$0...].dropFirst()) } }
            return SheetPlayer(id: key, slug: slug, name: name, position: position, rank: rank, club: club)
        }
    }
}

/// One row of our order as the phone draws it (OrderTable.svelte at 390): the # cell, the player, the
/// line folded under him, the week's figure and his Projected.
public struct RankingsRow: Equatable, Sendable, Identifiable {
    public let player: RankingsPlayer
    /// The API's rank, never numbered again here (Review Focus 4).
    public let rank: Int
    /// The # cell: his rank, the list's word for a player on a season-long list, or nothing for a bye.
    public let place: String
    public let bye: Bool
    /// The week's column: his Pts once final, his Proj before, "--" without.
    public let week: String
    /// His rest-of-season Projected, the big figure.
    public let total: String
    /// "Over repl. 52.8, A game 10.3, Opp 1st, Avg 11.8, Last 17.3".
    public let folded: String

    public var id: String {
        player.key
    }
}

/// One row of the kickers' or defenses' week (WeekTable.svelte at 390): the player with the evidence
/// folded under him and his Proj.
public struct WeekRankingsRow: Equatable, Sendable, Identifiable {
    public let player: RankingsPlayer
    public let proj: String
    /// "Opp 16th, Avg 9.7, Last 5.0".
    public let folded: String

    public var id: String {
        player.key
    }
}

/// A run of rows under one head: the players who play with none, then "Bye in week 6", or on the
/// week's tab "Kicked off" or "Played Thursday".
public struct RankingsSection<Row: Equatable & Sendable & Identifiable>: Equatable, Sendable, Identifiable {
    public let key: String
    public let head: String?
    public let rows: [Row]

    public var id: String {
        key
    }
}

/// order.ts orderView and week.ts weekView over the API's rows, ported.
enum RankingsRows {
    /// box.ts POSITIONS: the positions a pill names; a defense has none.
    static let pilled: Set = ["QB", "RB", "WR", "TE", "K"]

    /// The player cell (boxRow with order.ts gameCell): the kickoff still to come with its zone, the
    /// expected score with both clubs.
    static func player(_ line: PlayerLine, pillRank: Bool, zone: TimeZone, now: Date) -> RankingsPlayer {
        let row = StartRows.row(line, slot: "", zone: zone, now: now, ranked: false)
        let facts = line.facts
        let key = line.player.boardId ?? line.player.hostId
        let listed = row.status?.onList == true
        let rank = pillRank && !listed ? line.positionRank : nil
        let pill: String? = pilled.contains(line.player.position)
            ? [line.player.position, rank.map(String.init) ?? row.status?.rank].compactMap(\.self)
            .joined(separator: " ")
            : nil
        var game = row.game
        if case let .game(place, _) = row.game, row.read.toPlay, let kickoff = facts.kickoff {
            game = .game(where: place, when: Formatting.kickoffAt(kickoff, zone: zone))
        }
        let defense = line.player.position == "DEF"
        let name = defense ? "\(nickname(line.player.name)) \(row.position)" : row.name
        return RankingsPlayer(
            key: key, name: name, fit: defense ? StartRows.lastName(StartRows.withoutDefense(name)) : row.fit,
            slug: line.slug, clubMark: row.clubMark, club: row.club, pill: pill, status: row.status, game: game,
            expected: row.expected == nil ? nil : expectedScore(facts, club: line.player.team), weather: row.weather
        )
    }

    /// clubs.ts clubNickname from the API's name for a club: its last word ("Titans", "49ers").
    static func nickname(_ club: String) -> String {
        club.split(whereSeparator: \.isWhitespace).last.map(String.init) ?? club
    }

    /// box.ts expectedScoreWords: "Expected score CHI 26.5, ATL 23", his club's first.
    static func expectedScore(_ facts: Components.Schemas.WeekFacts, club: String) -> String? {
        guard let total = facts.gameTotal?.value1, let opponent = facts.opponent else {
            return nil
        }
        let theirs = total.points - total.teamPoints
        return "\(RankingsWords.expectedScore) \(club) \(StartRows.halves(total.teamPoints)), "
            + "\(opponent) \(StartRows.halves(theirs))"
    }

    /// order.ts orderView at the phone: byes sit apart (the week's rankings), the # the API's rank.
    static func row(_ row: OrderRow, rankBy: RankBy, pillRank: Bool, zone: TimeZone, now: Date) -> RankingsRow {
        let line = row.line
        let player = player(line, pillRank: pillRank, zone: zone, now: now)
        let listed = player.status?.onList == true
        let bye = line.facts.bye && !listed
        let place = listed ? player.status?.rank ?? "" : bye ? "" : String(row.rank)
        let figures = rankBy == .pointsOverReplacement
            ? ["\(Words.Order.overRepl) \(StartWords.number(row.pointsOverReplacement))"] : []
        let read = StartRows.row(line, slot: "", zone: zone, now: now, ranked: false)
        return RankingsRow(
            player: player, rank: row.rank, place: place, bye: bye,
            week: StartWords.number(listed ? nil : weekFigure(line, now: now)),
            total: StartWords.number(row.restOfSeasonPoints),
            folded: (figures + ["\(Words.Order.perGame) \(StartWords.number(line.restOfSeasonPerGame))"]
                + evidence(read)).joined(separator: ", ")
        )
    }

    /// The Opp rank, Avg and Last folded under a name (week.ts foldedEvidence).
    static func evidence(_ row: StartRow) -> [String] {
        let opp = row.oppRank.map { ["\(Words.Box.opp) \(Formatting.ordinal($0))"] } ?? []
        return opp + [
            "\(Words.Box.avg) \(StartWords.number(row.avg))",
            "\(Words.Box.last) \(StartWords.number(row.last))",
        ]
    }

    /// order.ts weekFigure: once his game is final his points, else his Proj.
    static func weekFigure(_ line: PlayerLine, now: Date) -> Double? {
        guard LineRead.game(line, now: now) == .final else {
            return line.weekProjection
        }
        let facts = line.facts
        return facts.pointsThisWeek ?? facts.lastGames.first { $0.week == facts.week }?.points
    }

    /// order.ts orderSections: the players who play, then the byes under "Bye in week 6".
    static func sections(_ rows: [RankingsRow], week: Int) -> [RankingsSection<RankingsRow>] {
        [
            RankingsSection(key: "playing", head: nil, rows: rows.filter { !$0.bye }),
            RankingsSection(key: "bye", head: RankingsWords.byeHead(week), rows: rows.filter(\.bye)),
        ].filter { !$0.rows.isEmpty }
    }

    /// week.ts weekView's row.
    static func weekRow(_ row: WeekOrderRow, zone: TimeZone, now: Date) -> WeekRankingsRow {
        let read = StartRows.row(row.line, slot: "", zone: zone, now: now, ranked: false)
        return WeekRankingsRow(
            player: player(row.line, pillRank: false, zone: zone, now: now), proj: StartWords.number(read.proj),
            folded: evidence(read).joined(separator: ", ")
        )
    }

    /// The week's sections, a row by its section at the screen's clock (week.ts sectionAt).
    enum WeekSection: String, CaseIterable {
        case toPlay = "to_play"
        case kickedOff = "kicked_off"
        case bye
    }

    static func section(_ row: WeekOrderRow, now: Date) -> WeekSection {
        let api = WeekSection(rawValue: row.section.value1?.rawValue ?? row.section.value2 ?? "") ?? .toPlay
        guard api != .bye, let state = LineRead.game(row.line, now: now).stateName else {
            return api
        }
        return state == "upcoming" ? .toPlay : .kickedOff
    }

    /// week.ts weekSections: to play with no head, then kicked off ("Played Thursday" once every one of
    /// its games is final), then the byes; a section with no rows is not drawn.
    static func weekSections(
        _ rows: [(row: WeekOrderRow, shown: WeekRankingsRow)], week: Int, zone: TimeZone, now: Date
    ) -> [RankingsSection<WeekRankingsRow>] {
        WeekSection.allCases.compactMap { key in
            let held = rows.filter { section($0.row, now: now) == key }
            guard !held.isEmpty else {
                return nil
            }
            let head: String? = switch key {
            case .toPlay: nil
            case .bye: RankingsWords.byeHead(week)
            case .kickedOff: kickedOffHead(held.map(\.row), shown: held.map(\.shown), zone: zone)
            }
            return RankingsSection(key: key.rawValue, head: head, rows: held.map(\.shown))
        }
    }

    /// week.ts kickedOffHead.
    static func kickedOffHead(_ rows: [WeekOrderRow], shown: [WeekRankingsRow], zone: TimeZone) -> String {
        let final = shown.allSatisfy { row in
            if case let .game(_, when) = row.player.game {
                return when == Words.Box.final
            }
            return false
        }
        guard final else {
            return Words.WeekTab.kickedOff
        }
        var days: [String] = []
        for kickoff in rows.compactMap(\.line.facts.kickoff) {
            let day = Formatting.weekdayName(kickoff, zone: zone)
            if !days.contains(day) {
                days.append(day)
            }
        }
        return "\(Words.WeekTab.played) \(days.joined(separator: " and "))"
    }

    /// week.ts weekSearch: a row whose name, the API's name or club holds the letters, any case; every
    /// row until the search holds the API's fewest letters.
    static func matches(_ row: WeekOrderRow, shown: WeekRankingsRow, query: String) -> Bool {
        let letters = query.trimmingCharacters(in: .whitespaces).lowercased()
        guard letters.count >= OrderQuery.minSearch else {
            return true
        }
        return [shown.player.name, row.line.player.name, shown.player.club].contains {
            $0.lowercased().contains(letters)
        }
    }
}

/// What the order's # sorts on: Over repl. across positions, Projected at one.
public enum RankBy: Equatable, Sendable {
    case pointsOverReplacement
    case restOfSeasonPoints

    init(_ payload: Components.Schemas.OrderAdvice.RankByPayload) {
        self = payload.value1 == .restOfSeasonPoints ? .restOfSeasonPoints : .pointsOverReplacement
    }
}
