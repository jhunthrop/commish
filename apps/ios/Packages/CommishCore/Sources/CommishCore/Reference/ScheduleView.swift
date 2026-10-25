import CommishAPI
import CommishDesign
import Foundation

/// One week's cell of a club's row in the grid (ui/schedule-grid.ts ScheduleCell): the opponent, at
/// or against, his value, shaded among the strongest, set back once played; the bye with none.
public struct ScheduleCell: Equatable, Sendable, Identifiable {
    public let week: Int
    /// "vs DEN", "at LAR", nil on the bye.
    public let opponent: String?
    /// The opponent's club, the cell's way to his page; nil on the bye.
    public let club: String?
    public let value: String
    public let hard: Bool
    public let played: Bool

    public var id: Int {
        week
    }
}

/// A club's row of the grid: its rank and strength pinned, its lead player's face and name, its weeks.
public struct ScheduleGridRow: Equatable, Sendable, Identifiable {
    public let abbr: String
    public let name: String
    /// The club's first player on the default board: his face and name, nil for a club with none.
    public let face: URL?
    public let faceName: String?
    public let rank: Int?
    public let strength: String?
    public let cells: [ScheduleCell]

    public var id: String {
        abbr
    }
}

/// A game on a club's page: the week, the opponent named in full at or against, his value, set back
/// once played.
public struct ClubGame: Equatable, Sendable, Identifiable {
    public let week: Int
    /// "Week 1".
    public let weekWords: String
    /// "at Los Angeles Chargers".
    public let opponent: String
    public let club: String
    public let value: String
    public let played: Bool

    public var id: Int {
        week
    }
}

/// A club's schedule as its page draws it (schedule-view.ts ClubSchedule): the hero's figures, every
/// game and the table's caption.
struct ClubSchedule {
    let hero: ClubHero?
    let games: [ClubGame]
    let caption: String
}

/// A club's hero figures (schedule-view.ts ClubHero): its strength headed and read, and its rank.
public struct ClubHero: Equatable, Sendable {
    public let value: String
    public let caption: String
    public let note: String
    public let hardest: String
    public let hardestCaption: String
}

/// The run's schedule as the reference pages draw it (web/src/lib/run/schedule-view.ts), ported and
/// held to shared/fixtures/parity/reference.json.
enum ScheduleViews {
    /// schedule-view.ts STRONG_SHARE: the top quarter of the league's opponents are shaded.
    static let strongShare = 0.25

    /// The strength each slate shows, by club.
    static func views(_ schedule: RunSchedule, underway: Bool) -> [String: StrengthView] {
        Dictionary(
            schedule.slates
                .compactMap { slate in StrengthWords.view(slate, underway: underway).map { (slate.abbr, $0) } },
            uniquingKeysWith: { first, _ in first }
        )
    }

    /// strengthFigureOf: the figure and its head with its rank among the slates showing one.
    static func figure(_ view: StrengthView?, of count: Int) -> StrengthFigure? {
        view.map {
            StrengthFigure(
                value: StrengthWords.figure($0.strength),
                caption: "\($0.kind.head), \(StrengthWords.hardestWords(rank: $0.rank, of: count))"
            )
        }
    }

    /// isPlayed: final by its state, or on a run from before the states its week complete.
    static func played(_ game: Components.Schemas.RunGame, reach: Reach) -> Bool {
        game.state == nil ? game.week <= reach.complete : RunReach.final(game)
    }

    /// strongFloor: the opponents' values counted strongest, ties kept in.
    static func strongFloor(_ values: [Double]) -> (count: Int, floor: Double) {
        let sorted = values.sorted(by: >)
        let index = max(0, Int((Double(sorted.count) * strongShare).rounded(.up)) - 1)
        let floor = sorted.indices.contains(index) ? sorted[index] : .infinity
        return (sorted.filter { $0 >= floor }.count, floor)
    }

    static func value(_ schedule: RunSchedule, _ abbr: String) -> Double {
        schedule.opponentValues.additionalProperties[abbr] ?? 0
    }

    /// clubSchedule: the hero's figures, every game and the table's caption.
    static func club(
        _ club: RunClub, schedule: RunSchedule, clubs: [RunClub], played: Reach, underway: Bool
    ) -> ClubSchedule {
        let views = Self.views(schedule, underway: underway)
        let hero = views[club.abbr].map { view in
            let hardest = StrengthWords.hardestFigure(rank: view.rank, of: views.count)
            return ClubHero(
                value: StrengthWords.figure(view.strength), caption: view.kind.head, note: StrengthWords.read(view),
                hardest: hardest.figure, hardestCaption: hardest.caption
            )
        }
        let names = ClubNames(clubs)
        let games = (schedule.slates.first { $0.abbr == club.abbr }?.games ?? []).map { game in
            ClubGame(
                week: game.week,
                weekWords: "\(Words.ClubPage.week) \(game.week)",
                opponent: "\(game.home ? Words.ClubPage.home : Words.ClubPage.away) \(names.full(game.opponent))",
                club: game.opponent,
                value: Formatting.fixed(value(schedule, game.opponent), 1),
                played: Self.played(game, reach: played)
            )
        }
        let faded = StrengthWords.played(played)
        return ClubSchedule(
            hero: hero, games: games, caption: "\(schedule.season) schedule\(faded.isEmpty ? "" : ", \(faded)")"
        )
    }

    /// The grid's slates: hardest first by the strength shown, else in the clubs' order.
    private static func order(_ schedule: RunSchedule, views: [String: StrengthView]) -> [Components.Schemas.RunSlate] {
        guard !views.isEmpty else {
            return schedule.slates.sorted { $0.abbr < $1.abbr }
        }
        let rank = { (slate: Components.Schemas.RunSlate) in views[slate.abbr]?.rank ?? .max }
        return schedule.slates.sorted { (rank($0), $0.abbr) < (rank($1), $1.abbr) }
    }

    /// scheduleGrid: every club by week, hardest first, the strongest opponents shaded and the games in
    /// set back.
    static func grid(
        _ schedule: RunSchedule, clubs: [RunClub], rows: [RunBoardRow], played: Reach, underway: Bool
    ) -> ScheduleGridModel {
        let lastWeek = schedule.slates.flatMap(\.games).map(\.week).max() ?? 0
        let weeks = Array(stride(from: 1, through: lastWeek, by: 1))
        let strong = strongFloor(Array(schedule.opponentValues.additionalProperties.values))
        let views = Self.views(schedule, underway: underway)
        let slates = order(schedule, views: views)
        let first = slates.lazy.compactMap { views[$0.abbr] }.first
        let names = ClubNames(clubs)
        return ScheduleGridModel(
            season: schedule.season,
            weeks: weeks,
            lead: StrengthWords.scheduleLead(
                first, strong: (strong.count, Formatting.fixed(strong.floor, 1)), reach: played
            ),
            strengthLabel: first?.kind.column,
            played: played.complete,
            rows: slates.map { slate in
                let lead = rows.first { $0.team == slate.abbr }
                let view = views[slate.abbr]
                return ScheduleGridRow(
                    abbr: slate.abbr,
                    name: names.full(slate.abbr),
                    face: lead.flatMap { BoardCells.face($0.headshot) },
                    faceName: lead?.name,
                    rank: view?.rank,
                    strength: view.map { StrengthWords.figure($0.strength) },
                    cells: weeks.map { week in cell(
                        slate,
                        week: week,
                        schedule: schedule,
                        strong: strong.floor,
                        played: played
                    ) }
                )
            }
        )
    }

    private static func cell(
        _ slate: Components.Schemas.RunSlate, week: Int, schedule: RunSchedule, strong: Double, played: Reach
    ) -> ScheduleCell {
        guard let game = slate.games.first(where: { $0.week == week }) else {
            return ScheduleCell(
                week: week, opponent: nil, club: nil, value: "", hard: false, played: week <= played.complete
            )
        }
        let value = Self.value(schedule, game.opponent)
        return ScheduleCell(
            week: week,
            opponent: "\(game.home ? Words.ClubPage.home : Words.ClubPage.away) \(game.opponent)",
            club: game.opponent,
            value: Formatting.fixed(value, 1),
            hard: value >= strong,
            played: Self.played(game, reach: played)
        )
    }
}

/// Each club's full name by its abbreviation ("Arizona Cardinals"), the abbreviation where the run
/// names none.
struct ClubNames {
    private let names: [String: String]

    init(_ clubs: [RunClub]) {
        names = Dictionary(
            clubs.map { ($0.abbr, "\($0.city) \($0.nickname)") },
            uniquingKeysWith: { first, _ in first }
        )
    }

    func full(_ abbr: String) -> String {
        names[abbr] ?? abbr
    }
}
