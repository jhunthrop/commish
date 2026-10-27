import CommishAPI
@testable import CommishCore
import CommishDesign
import Foundation
import RunFixtures
import Testing

/// Lane 223's game-day rules ported (Lane 232, B224): a played bye draws nothing (bye.ts), compare's
/// Bye row in its three states (compare-rows.ts), the current week's game states and the run's read
/// (schedule-state.ts), each at fixed instants in Chicago.
struct GameDayTests {
    typealias Game = Components.Schemas.RunGame

    static let zone = TimeZone(identifier: "America/Chicago")!
    /// Sun Oct 25 2026, 12:00 pm CDT.
    static let sundayNoon = APIDecoding.parseDate("2026-10-25T17:00:00Z")!
    static let readAt = APIDecoding.parseDate("2026-10-21T12:00:00Z")!

    static func game(_ week: Int, _ state: Components.Schemas.RunGameStateKnown?, unknown: String? = nil) -> Game {
        let said = state.map { Components.Schemas.RunGameState(value1: $0, value2: $0.rawValue) }
            ?? unknown.map { Components.Schemas.RunGameState(value1: nil, value2: $0) }
        return Game(week: week, opponent: "DEN", home: true, kickoff: sundayNoon, state: said)
    }

    // MARK: Byes

    @Test func aByeAheadSaysItsWeekAPlayedOneNothing() {
        #expect(Byes.line(11, fromWeek: 7) == "Bye week 11")
        #expect(Byes.line(7, fromWeek: 7) == "Bye week 7")
        #expect(Byes.line(5, fromWeek: 7) == nil)
        #expect(Byes.line(nil, fromWeek: 7) == nil)
        // A board of the full season counts every bye.
        #expect(Byes.line(5, fromWeek: nil) == "Bye week 5")
    }

    @Test func theByeCellIsTheWeekBlankOncePlayedAndTheEmptyFigureUnnamed() {
        #expect(Byes.cell(11, fromWeek: 7) == "11")
        #expect(Byes.cell(5, fromWeek: 7) == "")
        #expect(Byes.cell(nil, fromWeek: 7) == Words.Box.none)
        #expect(Byes.played(5, fromWeek: 7))
        #expect(!Byes.played(nil, fromWeek: 7))
        #expect(!Byes.played(5, fromWeek: nil))
    }

    @Test func compareDropsItsByeRowOnlyWhenBothArePlayed() {
        let texts = { (byes: (Int?, Int?), from: Int?) in
            CompareRows.byeRow(byes, from: from).map { $0.cells.map(\.text) }
        }
        #expect(texts((7, 11), 7) == [["7", "11"]])
        #expect(texts((6, 11), 7) == [["", "11"]])
        #expect(texts((nil, 11), 7) == [[Words.Box.none, "11"]])
        #expect(texts((nil, nil), 7) == [[Words.Box.none, Words.Box.none]])
        #expect(CompareRows.byeRow((5, 6), from: 7).isEmpty)
        // A full season keeps both.
        #expect(texts((5, 6), nil) == [["5", "6"]])
    }

    @Test func compareTablesDropTheByeRowWhenBothSidesArePlayed() throws {
        let run = RunFixture.contract
        let index = try run.indexEntries()
        let manifest = try run.manifest()
        let format = try #require(manifest.formats.first)
        let side = { (id: String, bye: Int?) throws -> CompareSide in
            let entry = try #require(index.first { $0.id == id })
            let player = try ComparePlayer(run.page(id: id), entry: entry)
            return try CompareSide(player: player, numbers: #require(player.formats[format.id]), bye: bye)
        }
        let labels = { (first: CompareSide, second: CompareSide, from: Int?) in
            CompareRows.rows(first, second, season: manifest.season, underway: true, byesFrom: from).map(\.label)
        }
        let first = try side("3918298", 5)
        let second = try side("4047365", 6)
        #expect(!labels(first, second, 7).contains(Words.Board.bye))
        #expect(labels(first, second, nil).contains(Words.Board.bye))
        #expect(try labels(first, side("4047365", 11), 7).contains(Words.Board.bye))
    }

    // MARK: The current week

    @Test func theCurrentWeekIsTheOneAfterTheLastCompleteWhileEveryStateIsRead() {
        let reach = Reach(complete: 6, partial: nil)
        let games = [Self.game(6, .final), Self.game(7, .final), Self.game(7, .upcoming)]
        #expect(ScheduleState.currentWeek(games, reach: reach, underway: true, readAt: Self.readAt)?.week == 7)
        #expect(ScheduleState.currentWeek([Self.game(1, .upcoming)], reach: .none, underway: true, readAt: Self.readAt)?
            .week == 1)
        #expect(ScheduleState.currentWeek(games, reach: reach, underway: false, readAt: Self.readAt) == nil)
        let unread = [Self.game(7, .final), Game(week: 7, opponent: "KC", home: false, kickoff: Self.sundayNoon)]
        #expect(ScheduleState.currentWeek(unread, reach: reach, underway: true, readAt: Self.readAt) == nil)
        // The season over: no week after the last.
        #expect(ScheduleState.currentWeek(
            games,
            reach: Reach(complete: 18, partial: nil),
            underway: true,
            readAt: Self.readAt
        ) == nil)
    }

    @Test func aGameSaysFinalKickedOffOrItsKickoffOnTheCurrentWeekAlone() {
        let current = CurrentWeek(week: 7, readAt: Self.readAt)
        let word = { (game: Game) in ScheduleState.word(game, current: current, zone: Self.zone) }
        #expect(word(Self.game(7, .final)) == Words.Kickoff.final)
        #expect(word(Self.game(7, .kickedOff)) == Words.Kickoff.kickedOff)
        #expect(word(Self.game(7, .upcoming)) == "Sun 12:00 pm CT")
        #expect(word(Self.game(7, nil, unknown: "postponed")) == nil)
        #expect(word(Self.game(6, .final)) == nil)
        #expect(ScheduleState.word(Self.game(7, .final), current: nil, zone: Self.zone) == nil)
    }

    @Test func theAsOfLineNamesTheRunsReadNeverTheClock() {
        let line = ScheduleState.asOf(CurrentWeek(week: 6, readAt: Self.readAt), zone: Self.zone)
        #expect(line == "Week 6's games as of Wed Oct 21, 7:00 am Central.")
    }
}
