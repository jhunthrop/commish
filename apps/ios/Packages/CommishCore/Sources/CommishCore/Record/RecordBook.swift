import CommishAPI
import Foundation

/// A record in the one shape the record page reads (web/src/lib/run/records.ts weeklyAsRecord): the
/// run's own record, or its weekly record read in the run's own shape, so one set of functions says
/// either.
struct RecordBook: Equatable, Sendable {
    let statistic: Components.Schemas.RunRecordStatistic
    let scale: String
    let startersBasis: String?
    let method: String
    let publishedFromWeek: Int?
    let honest: String?
    let weeks: [RunRecordWeek]
    let toDate: [RunRecordLine]

    /// The run's own record.
    init(own run: RunRecord) {
        statistic = run.statistic
        scale = run.scale
        startersBasis = run.startersBasis
        method = run.method
        publishedFromWeek = run.publishedFromWeek
        honest = run.honest
        weeks = run.weeks
        toDate = run.toDate
    }

    /// records.ts weeklyAsRecord: the weekly record, its published projection's first week the first
    /// graded week whose lines carry it.
    init(weekly: RunWeeklyRecord) {
        statistic = weekly.statistic
        scale = weekly.scale
        startersBasis = weekly.startersBasis
        method = weekly.method
        publishedFromWeek = weekly.weeks.first { week in
            RecordBook.status(week) == .graded && week.lines.contains { $0.published != nil }
        }?.week
        honest = weekly.honest
        weeks = weekly.weeks
        toDate = weekly.toDate
    }

    static func status(_ week: RunRecordWeek) -> Components.Schemas.RunRecordWeekStatusKnown? {
        week.status.value1
    }
}

/// The orders a record row compares, ours first (record.ts RECORD_SOURCES).
enum RecordSource: String, CaseIterable, Sendable {
    case ours
    case adp
    case espn
    case published
}

/// The three figures a record row gives each order (record.ts RECORD_FIGURES).
public enum RecordFigure: String, CaseIterable, Hashable, Sendable, Identifiable {
    case agreement
    case placesOff
    case starters

    public var id: String {
        rawValue
    }
}

/// A set week not played yet or under way at the screen's clock, by the run's schedule
/// (server/pages/week-state.ts weekStates, the one rule every screen reads).
struct WeekStates: Equatable, Sendable {
    let unplayed: [Int]
    let underway: [Int]

    /// week-state.ts GAME_ENDS_AFTER_MS: a game the run has not marked final counts as final four hours
    /// after its kickoff.
    static let gameEndsAfter: TimeInterval = 4 * 60 * 60

    init(unplayed: [Int] = [], underway: [Int] = []) {
        self.unplayed = unplayed
        self.underway = underway
    }

    init(_ book: RecordBook, schedule: RunSchedule, now: Date) {
        let games = schedule.slates.flatMap(\.games)
        let frozen = book.weeks.filter { RecordBook.status($0) == .frozen }.map(\.week)
        let read = { (week: Int) in Self.read(games.filter { $0.week == week }, now: now) }
        unplayed = frozen.filter { read($0) == .upcoming }
        underway = frozen.filter { read($0) == .playing }
    }

    enum Read {
        case upcoming
        case playing
        case final
    }

    /// One week's games as one read (kickoff.ts linesRead over each game's factsState); nil for a week
    /// with no game on the schedule.
    static func read(_ games: [Components.Schemas.RunGame], now: Date) -> Read? {
        guard !games.isEmpty else {
            return nil
        }
        let states = games.map { game -> Read in
            var state = game.state?.value1
            if state != .final, now >= game.kickoff.addingTimeInterval(gameEndsAfter) {
                state = .final
            }
            switch state {
            case .final?: return .final
            case .kickedOff?: return .playing
            default: return game.kickoff > now ? .upcoming : .playing
            }
        }
        if states.allSatisfy({ $0 == .final }) {
            return .final
        }
        return states.contains { $0 != .upcoming } ? .playing : .upcoming
    }
}

/// The weekly record's next week to grade with its last kickoff from the schedule
/// (server/pages/record.ts nextGrade).
struct NextGrade: Equatable, Sendable {
    let week: Int
    let lastKickoff: Date?

    init?(_ book: RecordBook, schedule: RunSchedule) {
        guard let week = book.weeks.first(where: { ![.graded, .missed].contains(RecordBook.status($0)) })?.week else {
            return nil
        }
        self.week = week
        lastKickoff = schedule.slates.flatMap(\.games).filter { $0.week == week }.map(\.kickoff).max()
    }
}
