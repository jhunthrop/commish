import CommishAPI
import CommishDesign
import Foundation

/// The week whose games the schedule says the state of, and when the run read them (its manifest's
/// runAt): the read every state is as of.
public struct CurrentWeek: Equatable, Sendable {
    public let week: Int
    public let readAt: Date
}

/// The current week's games on the schedule grid and a club's schedule (web/src/lib/run/schedule-state.ts,
/// Lane 223, B187), ported: each game's state as the run read it (`RunGame.state`, the nightly's
/// snapshot) in the words the Rankings print (Final, Kicked off, or the kickoff with its day and zone),
/// under one line naming the run's read, so a state is never claimed live. Nothing here reads a clock.
/// Held to shared/fixtures/parity/reference.json.
public enum ScheduleState {
    typealias Game = Components.Schemas.RunGame

    /// currentWeek: the week after the last complete one, while the season is underway, the run carries
    /// every one of that week's states and the schedule holds that week; nil otherwise.
    static func currentWeek(_ games: [Game], reach: Reach, underway: Bool, readAt: Date) -> CurrentWeek? {
        guard underway else {
            return nil
        }
        let week = reach.complete + 1
        let held = games.filter { $0.week == week }
        guard !held.isEmpty, held.allSatisfy({ $0.state != nil }) else {
            return nil
        }
        return CurrentWeek(week: week, readAt: readAt)
    }

    /// statedGame with stateWord: the game's word on the current week alone, nil on any other, and nil
    /// for a state this build does not know rather than a guess.
    static func word(_ game: Game, current: CurrentWeek?, zone: TimeZone) -> String? {
        guard let state = game.state, current?.week == game.week else {
            return nil
        }
        switch state.value1 {
        case .final?: return Words.Kickoff.final
        case .kickedOff?: return Words.Kickoff.kickedOff
        case .upcoming?: return Formatting.kickoffAt(game.kickoff, zone: zone)
        case nil: return nil
        }
    }

    /// asOfLine: "Week 6's games as of Wed Oct 21, 7:00 am Central." (SCHEDULE_STATE_WORDS.asOf over
    /// day-time.ts dayTimeStamp).
    static func asOf(_ current: CurrentWeek, zone: TimeZone) -> String {
        "Week \(current.week)'s games as of \(Formatting.dayTimeStamp(current.readAt, zone: zone))."
    }
}

/// Where the season is at the run as the schedule draws it: what is played, whether the season is
/// underway, the week whose games say their state and the zone they are said in.
struct SeasonAt {
    let played: Reach
    let underway: Bool
    let current: CurrentWeek?
    let zone: TimeZone

    func word(_ game: Components.Schemas.RunGame) -> String? {
        ScheduleState.word(game, current: current, zone: zone)
    }

    /// The line under the current week's games, nil without one.
    var asOf: String? {
        current.map { ScheduleState.asOf($0, zone: zone) }
    }
}

/// A club's line and its section's head, and where its schedule is, from the run's files (Lane 223).
extension ClubFiles {
    /// reference-words.ts clubMeta: "ARI · Bye week 14" while the bye is ahead of the week the board
    /// ranks from, the code alone once it is played (B190), "ARI · Bye week not set" where the run names
    /// none.
    func meta(_ club: RunClub) -> String {
        guard let bye = club.bye else {
            return "\(club.abbr) · \(Words.Bye.notSet)"
        }
        return Byes.line(bye, fromWeek: format.rosFromWeek).map { "\(club.abbr) · \($0)" } ?? club.abbr
    }

    /// The schedule's season at the run: the week whose games say the run's state from the run's
    /// schedule, reach and instant, said in `zone`.
    func season(zone: TimeZone) -> SeasonAt {
        let current = ScheduleState.currentWeek(
            schedule.value.slates.flatMap(\.games), reach: played, underway: underway, readAt: manifest.value.runAt
        )
        return SeasonAt(played: played, underway: underway, current: current, zone: zone)
    }

    /// The club section's head and empty line: the run's board's, the order's once its rows stand
    /// (D2), so the head names what the basis beside it names.
    static func head(_ format: RunFormat, atClock: Bool) -> (title: String, nobody: String) {
        atClock
            ? (Words.ClubOrder.onOrder, Words.ClubOrder.nobody)
            : (filled(Words.ClubPage.onBoard, format.label), Words.ClubPage.nobody)
    }
}
