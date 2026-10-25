import CommishAPI
import CommishDesign
import Foundation

/// A stat line's figures as the game log reads them: a week's row and a season's totals carry the same.
protocol StatFigures {
    var passAttempts: Double? { get }
    var completions: Double? { get }
    var passingYards: Double? { get }
    var passingTouchdowns: Double? { get }
    var interceptions: Double? { get }
    var carries: Double? { get }
    var rushingYards: Double? { get }
    var rushingTouchdowns: Double? { get }
    var targets: Double? { get }
    var receptions: Double? { get }
    var receivingYards: Double? { get }
    var receivingTouchdowns: Double? { get }
    var fumblesLost: Double? { get }
    var fieldGoalsMade: Double? { get }
    var extraPointsMade: Double? { get }
    var sacks: Double? { get }
    var defensiveInterceptions: Double? { get }
    var defensiveTouchdowns: Double? { get }
    var snapShare: Double? { get }
}

extension Components.Schemas.RunStatLine: StatFigures {}
extension Components.Schemas.RunGameLogRow: StatFigures {}

/// A game log column (run/stat-columns.ts StatColumn): its short head, its full words, those words for a
/// total of exactly 1, and its figure from a line.
struct StatColumn: Sendable {
    let short: String
    let full: String
    let one: String
    let value: @Sendable (any StatFigures) -> String

    /// stat-columns.ts captionFor: the singular for exactly 1.
    func caption(_ value: String) -> String {
        value == "1" ? one : full
    }
}

/// stat-columns.ts STAT_COLUMNS by position, ported.
enum StatColumns {
    static func figure(_ value: Double?) -> String {
        value.map(Formatting.count) ?? ""
    }

    static func stat(
        _ field: @escaping @Sendable (any StatFigures) -> Double?,
        _ short: String,
        _ full: String,
        _ one: String
    )
        -> StatColumn {
        StatColumn(short: short, full: full, one: one) { figure(field($0)) }
    }

    static let completions = StatColumn(
        short: "Comp/att", full: "completions of attempts", one: "completions of attempts"
    ) { line in
        guard let made = line.completions, let tried = line.passAttempts else {
            return ""
        }
        return "\(Formatting.count(made))/\(Formatting.count(tried))"
    }

    static let snaps = StatColumn(short: "Snap %", full: "share of snaps", one: "share of snaps") { line in
        line.snapShare.map { "\(Int(($0 * 100 + 0.5).rounded(.down)))%" } ?? ""
    }

    static let rushing = [
        stat(\.carries, "Car", "carries", "carry"),
        stat(\.rushingYards, "Rush yds", "rushing yards", "rushing yard"),
        stat(\.rushingTouchdowns, "Rush TD", "rushing touchdowns", "rushing touchdown"),
    ]
    static let fumbles = stat(\.fumblesLost, "Fum", "fumbles lost", "fumble lost")
    static let catching = [stat(\.targets, "Tgt", "targets", "target"), stat(\.receptions, "Rec", "catches", "catch")]
    static let receiver = catching + [
        stat(\.receivingYards, "Yds", "receiving yards", "receiving yard"),
        stat(\.receivingTouchdowns, "TD", "receiving touchdowns", "receiving touchdown"),
    ] + rushing + [snaps]

    static func of(_ position: String) -> [StatColumn] {
        switch position {
        case "QB":
            [
                completions,
                stat(\.passingYards, "Yds", "passing yards", "passing yard"),
                stat(\.passingTouchdowns, "TD", "passing touchdowns", "passing touchdown"),
                stat(\.interceptions, "INT", "interceptions", "interception"),
            ] + rushing + [fumbles]
        case "RB":
            [
                stat(\.carries, "Car", "carries", "carry"),
                stat(\.rushingYards, "Yds", "rushing yards", "rushing yard"),
                stat(\.rushingTouchdowns, "TD", "rushing touchdowns", "rushing touchdown"),
            ] + catching + [
                stat(\.receivingYards, "Rec yds", "receiving yards", "receiving yard"),
                stat(\.receivingTouchdowns, "Rec TD", "receiving touchdowns", "receiving touchdown"),
                fumbles, snaps,
            ]
        case "K":
            [
                stat(\.fieldGoalsMade, "FG", "field goals made", "field goal made"),
                stat(\.extraPointsMade, "XP", "extra points made", "extra point made"),
            ]
        case "DST":
            [
                stat(\.sacks, "Sacks", "sacks", "sack"),
                stat(\.defensiveInterceptions, "INT", "interceptions", "interception"),
                stat(\.defensiveTouchdowns, "TD", "defensive touchdowns", "defensive touchdown"),
            ]
        default: receiver
        }
    }
}

/// His "This season" block (web/src/lib/server/pages/player-season.ts SeasonView): the head's aside, the
/// log's heads, the season line, the weeks so far, the weeks still to play with their days, the one
/// sentence with no line, the box's basis and his earlier seasons. Held to the parity's pages.
public struct SeasonView: Equatable, Sendable {
    public struct Head: Equatable, Sendable {
        public let short: String
        public let full: String
    }

    public struct Cell: Equatable, Sendable {
        public let value: String
        public let caption: String
    }

    public struct Line: Equatable, Sendable {
        public let lead: String
        public let sub: String
        public let total: String
        public let points: Cell
        public let cells: [Cell]
    }

    public enum Tone: String, Sendable {
        case played
        case bye
        case quiet
    }

    public struct Row: Equatable, Sendable, Identifiable {
        public let week: Int
        public let opponent: String
        public let note: String
        public let tone: Tone
        public let points: String?
        public let cells: [String]?

        public var id: Int {
            week
        }
    }

    public struct Ahead: Equatable, Sendable, Identifiable {
        public let week: Int
        public let opponent: String
        public let bye: Bool
        public let day: String

        public var id: Int {
            week
        }
    }

    public struct Prior: Equatable, Sendable, Identifiable {
        public let season: Int
        public let sub: String
        public let total: String
        public let cells: [String]

        public var id: Int {
            season
        }
    }

    public let season: Int
    public let aside: String
    public let heads: [Head]
    public let pointsHead: Head
    public let line: Line?
    public let rows: [Row]
    public let ahead: [Ahead]
    public let none: String
    public let basis: String?
    public let prior: [Prior]
}

enum SeasonViews {
    typealias LogRow = Components.Schemas.RunGameLogRow

    /// The season log's words (run/season-log-words.ts SEASON_LOG_WORDS).
    static let didNotPlay = "Did not play"
    static let playedNoStats = "Played, no stats"
    static let specialTeams = "Special teams only"

    /// player-season.ts seasonView.
    static func view(_ player: RunPlayer, formats: [RunFormat], slates: [Components.Schemas.RunSlate]) -> SeasonView? {
        let season = player.season
        guard let format = formats.first(where: { $0.id == season.format }) else {
            return nil
        }
        let position = player.position.value1?.rawValue ?? player.position.value2 ?? ""
        let columns = StatColumns.of(position)
        let first = season.log.firstIndex { $0.status.value1 == .upcoming } ?? season.log.endIndex
        let through = countedWeek(season)
        let special = player.lastGameClub?.value1.specialTeams == true ? player.lastGameClub?.value1.week : nil
        let byClub = Dictionary(slates.map { ($0.abbr, $0) }, uniquingKeysWith: { first, _ in first })
        return SeasonView(
            season: season.season,
            aside: "\(season.season), \(format.label)\(through == 0 ? "" : ", through week \(through)")",
            heads: columns.map { .init(short: $0.short, full: $0.full) },
            pointsHead: .init(short: Words.Box.pts, full: "\(format.label) points"),
            line: line(season, columns: columns, format: format),
            rows: season.log[..<first].filter { !unnamedAhead($0, through: season.through) }
                .map { row($0, columns: columns, specialTeams: special) },
            ahead: season.log[first...].map { ahead($0, slates: byClub, team: player.team) },
            none: season.through == 0
                ? "The \(season.season) season has not reached its first week."
                : "He has no \(season.season) stats through week \(season.through).",
            basis: season.games > 0 && position == "QB" && season.totals.completions == nil
                ? "Completions are not in our records yet." : nil,
            prior: (player.priorSeasons ?? []).map { prior($0, columns: columns) }
        )
    }

    /// reach.ts countedWeek: the run's through week, or his own later game already in the records.
    static func countedWeek(_ season: Components.Schemas.RunSeason) -> Int {
        season.log.reduce(season.through) { week, row in
            let holds = row.status.value1 == .played
                || (row.status.value1 == .inactive && (row.opponent != nil || row.unnamedGame == true))
            return holds ? max(week, row.week) : week
        }
    }

    static func opponent(_ row: LogRow) -> String {
        if row.status.value1 == .bye {
            return Words.Box.bye
        }
        guard let opponent = row.opponent else {
            return row.unnamedGame == true ? playedNoStats : didNotPlay
        }
        return "\(row.home == true ? "vs" : "at") \(opponent)"
    }

    static func row(_ row: LogRow, columns: [StatColumn], specialTeams: Int?) -> SeasonView.Row {
        let points = row.status.value1 == .played ? row.points : nil
        let note = row.status.value1 == .inactive && row.opponent != nil
            ? (row.week == specialTeams ? Self.specialTeams : didNotPlay) : ""
        let tone: SeasonView.Tone = points != nil ? .played : row.status.value1 == .bye ? .bye : .quiet
        return SeasonView.Row(
            week: row.week, opponent: opponent(row), note: note, tone: tone,
            points: points.map { Formatting.fixed($0) }, cells: points == nil ? nil : columns.map { $0.value(row) }
        )
    }

    /// A week still to play with its day: "Kicked off" or "Final" by the run's state, else its kickoff's
    /// day ("Sun Nov 8", Eastern, the run's clock).
    static func ahead(_ row: LogRow, slates: [String: Components.Schemas.RunSlate], team: String) -> SeasonView.Ahead {
        let bye = row.status.value1 == .bye
        let game = bye ? nil : rowGame(slates, team: team, row: row)
        let day: String = switch game?.state?.value1 {
        case .kickedOff?: Words.Box.kickedOff
        case .final?: Words.Box.final
        default: game.map { weekdayLabel($0.kickoff) } ?? ""
        }
        return SeasonView.Ahead(week: row.week, opponent: opponent(row), bye: bye, day: day)
    }

    /// row-game.ts rowGame: his club's game that week when it is the row's, else the slate game whose
    /// week, opponent and home are the row's.
    static func rowGame(_ slates: [String: Components.Schemas.RunSlate], team: String, row: LogRow)
        -> Components.Schemas.RunGame? {
        let own = slates[team]?.games.first { $0.week == row.week }
        guard let named = row.opponent else {
            return own
        }
        if let own, own.opponent == named, own.home == row.home {
            return own
        }
        return slates.values.lazy.compactMap { slate in
            slate.games.first { $0.week == row.week && $0.opponent == named && $0.home == row.home }
        }.first
    }

    /// date.ts weekdayLabel: "Thu Oct 15", on the run's Eastern clock.
    static func weekdayLabel(_ date: Date) -> String {
        let weekday = String(Formatting.weekdayTime(date, zone: RunWords.eastern).prefix(3))
        return "\(weekday) \(Formatting.shortDay(date, zone: RunWords.eastern))"
    }

    static func unnamedAhead(_ row: LogRow, through: Int) -> Bool {
        row.week > through && row.status.value1 == .inactive && row.opponent == nil && row.unnamedGame != true
    }

    static func line(_ season: Components.Schemas.RunSeason, columns: [StatColumn], format: RunFormat)
        -> SeasonView.Line? {
        guard season.games > 0, let perGame = season.pointsPerGame else {
            return nil
        }
        let rate = Formatting.fixed(perGame, 1)
        let tenths = season.log.reduce(0.0) { sum, row in
            guard row.status.value1 == .played, let points = row.points,
                  let printed = Double(Formatting.fixed(points)) else {
                return sum
            }
            return sum + (printed * 10 + 0.5).rounded(.down)
        }
        return SeasonView.Line(
            lead: "Season", sub: "\(Formatting.plural(season.games, "game")), \(rate) a game",
            total: Formatting.fixed(tenths / 10),
            points: .init(value: rate, caption: "\(format.label) points a game"),
            cells: columns.map { column in
                let value = column.value(season.totals)
                return .init(value: value, caption: column.caption(value))
            }
        )
    }

    static func prior(_ prior: Components.Schemas.RunPriorSeason, columns: [StatColumn]) -> SeasonView.Prior {
        let perGame = prior.pointsPerGame.map { ", \(Formatting.fixed($0, 1)) a game" } ?? ""
        return SeasonView.Prior(
            season: prior.season, sub: "\(Formatting.plural(prior.games, "game"))\(perGame)",
            total: prior.totals.points.map { Formatting.fixed($0) } ?? "", cells: columns.map { $0.value(prior.totals) }
        )
    }

    /// player-season.ts heldSeasonView: a page held back with no copy has no line and no log.
    static func held(year: Int, position: String, format: RunFormat) -> SeasonView {
        SeasonView(
            season: year, aside: "\(year), \(format.label)",
            heads: StatColumns.of(position).map { .init(short: $0.short, full: $0.full) },
            pointsHead: .init(short: Words.Box.pts, full: "\(format.label) points"), line: nil, rows: [], ahead: [],
            none: Words.HeldPage.log, basis: Words.HeldPage.basis, prior: []
        )
    }
}
