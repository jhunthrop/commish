import CommishAPI
import Foundation

/// How far the season's figures reach (web/src/lib/run/reach.ts Reach): the last week whose games are
/// all in, then the next week's games in, named by their days.
public struct Reach: Equatable, Sendable {
    public struct Partial: Equatable, Sendable {
        public let week: Int
        /// Their days in kickoff order ("Thursday"), empty where the run does not place them.
        public let days: [String]
        public let games: Int
    }

    /// The last week whose games are all in, 0 before week 1's.
    public let complete: Int
    public let partial: Partial?

    /// Nothing in yet: before the season's first kickoff.
    public static let none = Reach(complete: 0, partial: nil)
}

/// reach.ts and server/run.ts, ported over the run's schedule and the pages a screen read.
enum RunReach {
    typealias Slate = Components.Schemas.RunSlate
    typealias Game = Components.Schemas.RunGame

    /// run.ts seasonUnderway: the run was written at or after the season's first kickoff.
    static func underway(_ manifest: RunManifest, schedule: RunSchedule) -> Bool {
        let first = schedule.slates.flatMap(\.games).map(\.kickoff).min()
        return first.map { manifest.runAt >= $0 } ?? false
    }

    /// The game is final by the run's state.
    static func final(_ game: Game) -> Bool {
        game.state?.value1 == .final
    }

    /// Each game of a week once (both clubs' sides are one game), keyed by its two clubs.
    private static func key(_ club: String, _ opponent: String) -> String {
        [club, opponent].sorted().joined(separator: "-")
    }

    /// A partial week from its games' kickoffs: their days in kickoff order (US Eastern, the NFL's) and
    /// how many.
    private static func partial(week: Int, kickoffs: [Date]) -> Reach.Partial {
        var days: [String] = []
        for kickoff in kickoffs.sorted() {
            let day = Formatting.weekdayName(kickoff, zone: RunWords.eastern)
            if !days.contains(day) {
                days.append(day)
            }
        }
        return Reach.Partial(week: week, days: days, games: kickoffs.count)
    }

    /// reach.ts finalsReach: the complete week, then the next week's games final by their state.
    static func finals(_ slates: [Slate], complete: Int) -> Reach {
        let week = complete + 1
        var kickoffs: [String: Date] = [:]
        for slate in slates {
            for game in slate.games where game.week == week && final(game) {
                kickoffs[key(slate.abbr, game.opponent)] = game.kickoff
            }
        }
        return Reach(
            complete: complete,
            partial: kickoffs.isEmpty ? nil : partial(week: week, kickoffs: Array(kickoffs.values))
        )
    }

    /// server/run.ts playedReach: what the schedule sets back, nothing before the first kickoff. The
    /// complete week is the run's own (a page's season through).
    static func played(_ slates: [Slate], complete: Int, underway: Bool) -> Reach {
        underway ? finals(slates, complete: complete) : .none
    }

    /// A week holding a game of his (reach.ts holdsAGame).
    private static func holdsAGame(_ row: Components.Schemas.RunGameLogRow) -> Bool {
        let status = row.status.value1
        if status == .played {
            return true
        }
        return status == .inactive && (row.opponent != nil || row.unnamedGame == true)
    }

    /// reach.ts countedReach over the pages read: the complete week, then the newest week some
    /// player's counted game belongs to, its clubs' games named by their days.
    static func counted(_ pages: [RunPlayer], slates: [Slate], complete: Int) -> Reach {
        let newest = pages.reduce(0) { week, page in
            page.season.log.reduce(max(week, page.season.through)) { holdsAGame($1) ? max($0, $1.week) : $0 }
        }
        guard newest > complete else {
            return Reach(complete: complete, partial: nil)
        }
        let clubs = Set(pages.filter { page in
            page.season.log.contains { row in
                row.week == newest && (row.status.value1 == .played || row.status.value1 == .inactive)
            }
        }.map(\.team))
        var kickoffs: [String: Date] = [:]
        var placed = true
        for club in clubs {
            guard let game = slates.first(where: { $0.abbr == club })?.games.first(where: { $0.week == newest }) else {
                placed = false
                continue
            }
            kickoffs[key(club, game.opponent)] = game.kickoff
        }
        return Reach(
            complete: complete,
            partial: placed
                ? partial(week: newest, kickoffs: Array(kickoffs.values))
                : Reach.Partial(week: newest, days: [], games: 0)
        )
    }

    private static func joinAnd(_ words: [String]) -> String {
        guard words.count > 1, let last = words.last else {
            return words.joined()
        }
        return "\(words.dropLast().joined(separator: ", ")) and \(last)"
    }

    /// "week 6's Thursday game", "week 16's Thursday and Saturday games", "part of week 6".
    private static func partialWords(_ partial: Reach.Partial) -> String {
        guard !partial.days.isEmpty else {
            return "part of week \(partial.week)"
        }
        return "week \(partial.week)'s \(joinAnd(partial.days)) \(partial.games == 1 ? "game" : "games")"
    }

    /// reach.ts reachWords: "through week 5", "through week 5 and week 6's Thursday game", "" before
    /// week 1's games.
    static func words(_ reach: Reach) -> String {
        let whole = reach.complete == 0 ? "" : "week \(reach.complete)"
        guard let partial = reach.partial else {
            return whole.isEmpty ? "" : "through \(whole)"
        }
        return "through \(whole.isEmpty ? "" : "\(whole) and ")\(partialWords(partial))"
    }

    /// reach.ts playedThroughWords: "weeks 1 to 5 and week 6's Thursday game are played", "week 1 is
    /// played", "" before any game is in.
    static func playedThrough(_ reach: Reach) -> String {
        let complete = reach.complete
        let whole = complete == 0 ? "" : complete == 1 ? "week 1" : "weeks 1 to \(complete)"
        let parts = [whole, reach.partial.map(partialWords) ?? ""].filter { !$0.isEmpty }
        guard !parts.isEmpty else {
            return ""
        }
        let many = complete > 1 || parts.count > 1 || (reach.partial?.games ?? 0) > 1
        return "\(parts.joined(separator: " and ")) \(many ? "are" : "is") played"
    }
}
