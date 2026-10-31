import CommishAPI
import CommishDesign
import Foundation

/// A week game's head by the one rule (web/src/lib/league/box/kickoff.ts gameHead): the API's state,
/// and a next kickoff only while it is still to come at the screen's clock.
///
/// A port: the API does not yet send a scoreboard game's head (spec §5.1 game_state on the wire). Once
/// it does, this reads the field and the port goes.
public enum GameHeadState: String, Sendable, Equatable {
    case upcoming
    case kickedOff = "kicked_off"
    case final
}

struct GameHead: Equatable {
    let state: GameHeadState
    let next: Date?

    init(state: Components.Schemas.ScoreboardGame.StatePayload, next: Date?, now: Date) {
        // A state this build does not know reads by its kickoff alone, as an upcoming game does.
        let read: GameHeadState = switch state.value1 {
        case .final: .final
        case .playing: .kickedOff
        case .upcoming, nil: .upcoming
        }
        self.init(read: read, next: next, now: now)
    }

    /// kickoff.ts gameHead over a read's state (kicked off for the API's playing) and its next kickoff.
    init(read: GameHeadState, next: Date?, now: Date) {
        let ahead = next.flatMap { $0 > now ? $0 : nil }
        switch read {
        case .final: (state, self.next) = (.final, nil)
        case .kickedOff: (state, self.next) = (.kickedOff, ahead)
        case .upcoming:
            if next == nil {
                (state, self.next) = (.upcoming, nil)
            } else if let ahead {
                (state, self.next) = (.upcoming, ahead)
            } else {
                (state, self.next) = (.kickedOff, nil)
            }
        }
    }
}

/// Once a game has started, how a side reads against the other.
public enum Stands: String, Sendable, Equatable {
    case ahead
    case behind
    case level
}

/// One side of a score bug, as home.ts BugSide.
public struct BugSide: Sendable, Equatable {
    public let rosterID: Int
    public let name: String
    /// The face's letters where the platform gives no image (the app draws no image yet).
    public let initials: String
    public let record: String
    public let me: Bool
    public let small: String
    public let big: String
    public let toPlay: String
    public let stands: Stands
    let final: Bool
    let unlisted: Bool
    let bestLineup: Bool
    let paced: Bool
    let skipped: Bool
}

/// A game of the week as a score bug, as home.ts Bug.
public struct ScoreBug: Sendable, Equatable, Identifiable {
    public let id: String
    public let mine: Bool
    public let state: GameHeadState
    public let head: String
    public let words: String
    public let small: String
    public let big: String
    public let sides: [BugSide]

    /// The roster the bug opens the game of (game.ts bugRoster, Lane 204): none for the member's game,
    /// which is the Matchup's own, else its first side's.
    public var roster: Int? {
        mine ? nil : sides.first?.rosterID
    }
}

/// home.ts bugsOf and its helpers, over the generated types.
enum ScoreBugs {
    typealias Game = Components.Schemas.ScoreboardGame
    typealias Side = Components.Schemas.ScoreboardSide

    struct Read {
        /// The stamp's lead: the platform's name, or the store graphics' neutral word (HostWords.stamp).
        let platform: String
        let readAt: Date
    }

    static func bugs(_ board: Scoreboard, sync: LeagueSync, now: Date, zone: TimeZone, read: Read?) -> [ScoreBug] {
        let teams = Dictionary(sync.teams.map { ($0.rosterId, $0) }, uniquingKeysWith: { first, _ in first })
        return board.games.enumerated().map { index, game in
            let head = GameHead(state: game.state, next: game.nextKickoff, now: now)
            let finals = game.sides.map { sideFinal($0, state: head.state) }
            let allFinal = !finals.isEmpty && finals.allSatisfy(\.self)
            let small = head.state == .upcoming ? "" : allFinal ? Words.Box.final : Words.Box.projFinal
            let big = head.state == .upcoming ? Words.Box.proj : Words.Box.pts
            let (headWords, words) = headAndWords(head, zone: zone, read: read, now: now)
            let sides = zip(game.sides, finals).map { side, final in
                bugSide(
                    side, game: game, team: teams[side.rosterId], member: sync.me,
                    drawn: .init(state: head.state, final: final, headFinal: small == Words.Box.final)
                )
            }
            return ScoreBug(
                id: "\(index)-" + game.sides.map { String($0.rosterId) }.joined(separator: "-"),
                mine: game.sides.contains { $0.rosterId == sync.me },
                state: head.state, head: headWords, words: words, small: small, big: big, sides: sides
            )
        }
    }

    /// How a side is drawn: its game's head, whether the side is final, whether the column head says Final.
    struct Drawn {
        let state: GameHeadState
        let final: Bool
        let headFinal: Bool
    }

    private static func bugSide(
        _ side: Side, game: Game, team: Components.Schemas.LeagueTeam?, member: Int, drawn: Drawn
    ) -> BugSide {
        let state = drawn.state
        let final = drawn.final
        let (small, big) = figures(side, state: state, final: final, headFinal: drawn.headFinal)
        let name = team?.name ?? LeagueNames.unnamedTeam(side.rosterId)
        return BugSide(
            rosterID: side.rosterId,
            name: name,
            initials: Initials.of(name),
            record: record(team),
            me: side.rosterId == member,
            small: small,
            big: big,
            toPlay: state == .kickedOff ? side.toPlay ?? "" : "",
            stands: stands(side, game: game, started: state != .upcoming),
            final: final,
            unlisted: side.scheduleState != nil,
            bestLineup: side.projectionBestLineup == true,
            paced: side.projectedFinalPaced == true,
            skipped: side.bestLineupSkipped == true
        )
    }

    /// home.ts sideFinal: every starter with a game final, else the schedule's state for an unlisted side.
    static func sideFinal(_ side: Side, state: GameHeadState) -> Bool {
        if state == .upcoming {
            return false
        }
        if let startersFinal = side.startersFinal {
            return startersFinal
        }
        if let schedule = side.scheduleState?.value1 {
            return schedule.value1 == .final
        }
        return state == .final
    }

    /// home.ts sideFigures: Proj before kickoff; from it Pts with the projected final small; Final.
    private static func figures(_ side: Side, state: GameHeadState, final: Bool, headFinal: Bool) -> (String, String) {
        let none = Words.Box.none
        let proj = side.projection.map { Formatting.fixed($0) } ?? none
        if state == .upcoming {
            return ("", proj)
        }
        let pts = side.pointsRead ? Formatting.fixed(side.points) : none
        if !final {
            return (side.projectedFinal.map { Formatting.fixed($0) } ?? none, pts)
        }
        return (headFinal ? pts : "\(Words.Box.final) \(pts)", pts)
    }

    private static func stands(_ side: Side, game: Game, started: Bool) -> Stands {
        guard started, let other = game.sides.first(where: { $0.rosterId != side.rosterId }),
              side.pointsRead, other.pointsRead, side.points != other.points
        else {
            return .level
        }
        return side.points > other.points ? .ahead : .behind
    }

    /// "5-0", "5-0-1" with a tie, as a bug prints a record.
    private static func record(_ team: Components.Schemas.LeagueTeam?) -> String {
        guard let team else {
            return ""
        }
        let base = "\(team.wins)-\(team.losses)"
        return team.ties > 0 ? "\(base)-\(team.ties)" : base
    }

    private static func headAndWords(_ head: GameHead, zone: TimeZone, read: Read?, now: Date) -> (String, String) {
        switch head.state {
        case .final: return (Words.Box.final, "")
        case .kickedOff: return (Words.Box.kickedOff, read.map { readCell($0, now: now) } ?? "")
        case .upcoming:
            guard let next = head.next else {
                return ("", "")
            }
            return (Formatting.weekdayTime(next, zone: zone), Words.LeagueHome.nextKickoff)
        }
    }

    /// home.ts readCell: "FFPC 4 min ago".
    static func readCell(_ read: Read, now: Date) -> String {
        "\(read.platform) \(agoCell(max(0, now.timeIntervalSince(read.readAt))))"
    }

    /// home.ts agoCell.
    static func agoCell(_ seconds: TimeInterval) -> String {
        if seconds < 60 {
            return Words.LeagueHome.justNow
        }
        if seconds < 3600 {
            return "\(Int(seconds / 60)) \(Words.LeagueHome.minAgo)"
        }
        return "\(Int(seconds / 3600)) \(Words.LeagueHome.hrAgo)"
    }

    /// home.ts projections: each team's Proj before its game, its projected final from it.
    static func projections(_ board: Scoreboard?, now: Date) -> [Int: Double?] {
        var out: [Int: Double?] = [:]
        for game in board?.games ?? [] {
            let upcoming = GameHead(state: game.state, next: game.nextKickoff, now: now).state == .upcoming
            for side in game.sides {
                out[side.rosterId] = upcoming ? side.projection : side.projectedFinal
            }
        }
        return out
    }
}
