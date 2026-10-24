import CommishAPI
import CommishDesign
import Foundation

/// One starter as the League home's lineup draws him.
public struct LineupLine: Sendable, Equatable, Identifiable {
    public let id: String
    public let name: String
    public let initials: String
    /// "QB PIT": his position and club, under the name.
    public let detail: String
    public let points: String
}

/// The member's lineup as set on the platform (web LineupSummary.svelte), from the league's read:
/// the starters, the team's points, the bench as a count. The advice and its swaps arrive with the
/// Lineup screen, so the verb here is the quiet one that opens it.
public struct LineupSection: Sendable, Equatable {
    public let title: String
    public let setOn: String
    public let columns: [String]
    public let rows: [LineupLine]
    public let total: String
    public let bench: String
    public let verb: String
}

/// The League home as its view draws it, every word and figure decided here: the week's score bugs,
/// the standings, the member's lineup, the moves, and the basis said once. The order is the web's
/// (web/src/lib/league/LeaguePage.svelte): scoreboard, standings, lineup, moves.
public struct LeagueHomeModel: Sendable, Equatable {
    public let leagueName: String
    public let platform: String
    public let weekTitle: String
    public let scoreboardAside: String
    public let bugs: [ScoreBug]
    public let standings: StandingsSection
    public let lineup: LineupSection?
    public let moves: MovesSection
    /// The team sentence whole (home.ts teamBasis), nil with no scoreboard.
    public let teamBasis: String?
    /// The paragraph under the screen as a phone says it (week-basis.ts weekBasisText).
    public let basis: String

    typealias Home = CommishDesign.Words.LeagueHome

    public init(sync: LeagueSync, scoreboard: Scoreboard?, now: Date, zone: TimeZone) {
        let platform = PortedWords.platform(sync.host)
        let bugs = scoreboard.map {
            ScoreBugs.bugs($0, sync: sync, now: now, zone: zone, read: .init(platform: platform, readAt: $0.readAt))
        } ?? []
        let facts = WeekBasis.Facts(host: sync.host, terms: sync.terms, board: scoreboard, bugs: bugs, zone: zone)
        leagueName = sync.name
        self.platform = platform
        weekTitle = "\(Home.week) \(scoreboard?.week ?? sync.week)"
        scoreboardAside = Home.scoreboardAside
        self.bugs = bugs
        standings = Standings.section(
            sync, projections: ScoreBugs.projections(scoreboard, now: now), projected: scoreboard != nil
        )
        lineup = Self.lineup(sync, platform: platform)
        moves = MovesFeed.section(sync, zone: zone)
        teamBasis = scoreboard.map { WeekBasis.team(facts, board: $0, cuts: TeamCuts()) }
        basis = WeekBasis.phone(facts)
    }

    private static func lineup(_ sync: LeagueSync, platform: String) -> LineupSection? {
        guard let mine = sync.matchup?.value1.mine else {
            return nil
        }
        let none = PortedWords.Box.none
        let rows = mine.starters.enumerated().map { index, starter in
            let player = starter.player
            let position = player.position == "DEF" ? "D/ST" : player.position
            return LineupLine(
                id: "\(index)-\(player.hostId)",
                name: player.name,
                initials: Initials.of(player.name),
                detail: "\(position) \(player.team)",
                points: mine.playerPoints ? starter.points.map { Formatting.fixed($0) } ?? none : none
            )
        }
        let bench = sync.roster.filter { $0.slot == .bench }.count
        let reserve = sync.roster.filter { $0.slot == .reserve }.count
        let reserveWords = reserve > 0 ? ". \(PortedWords.Box.reserve), \(reserve)" : ""
        return LineupSection(
            title: Home.yourLineup,
            setOn: AppWords.asSetOn(platform),
            columns: [PortedWords.Box.player, PortedWords.Box.pts],
            rows: rows,
            total: mine.pointsRead ? Formatting.fixed(mine.points) : none,
            bench: "\(PortedWords.Box.bench), \(Formatting.plural(bench, "player"))\(reserveWords)",
            verb: Home.openLineup
        )
    }
}

/// What the screen reads and keeps: the league and its week's scoreboard, saved together.
public struct LeagueHomeAnswer: Codable, Sendable, Equatable {
    public let sync: LeagueSync
    public let scoreboard: Scoreboard?

    public init(sync: LeagueSync, scoreboard: Scoreboard?) {
        self.sync = sync
        self.scoreboard = scoreboard
    }
}
