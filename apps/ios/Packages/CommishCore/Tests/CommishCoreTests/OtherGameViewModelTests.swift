import CommishAPI
@testable import CommishCore
import Foundation
import Testing

/// Another team's game on the Matchup (Lane 206): asked by its first side's roster, scored from the
/// scoreboard, which failing never fails the box that arrived; the member's game asks no roster and no
/// scoreboard; each game saved under its own key.
@MainActor
struct OtherGameViewModelTests {
    private let folder = FileManager.default.temporaryDirectory
        .appendingPathComponent("commish-other-game-tests-\(UUID().uuidString)")
    static let sunday = MatchupViewModelTests.sunday

    @Test func theMembersGameAsksNoRosterAndReadsNoScoreboard() async throws {
        let stub = try MatchupStub(answer: MatchupViewModelTests.answer(Self.sunday))
        let viewModel = model(stub, roster: nil)
        await viewModel.load(leagueID: Fixtures.league)
        #expect(await stub.rosters == [nil])
        #expect(await stub.boardReads == 0)
        #expect(try MatchupViewModelTests.week(viewModel).week.whose == nil)
    }

    @Test func anotherTeamsGameIsAskedByItsRosterAndScoredFromTheScoreboard() async throws {
        let stub = try MatchupStub(answer: Fixtures.otherGame(Self.sunday))
        let viewModel = model(stub)
        await viewModel.load(leagueID: Fixtures.league)
        #expect(await stub.rosters == [2])
        #expect(await stub.boardReads == 1)
        let week = try MatchupViewModelTests.week(viewModel).week
        #expect(week.whose == GameWhose(head: "Their game", link: "Your game"))
        #expect(week.mine == "Carried by QJs")
        #expect(week.opponent == "Bower Rangers")
        #expect(week.bug.mine.big == "26.7")
        #expect(week.bug.opponent?.big == "43.6")
        #expect(week.bug.mine.label.isEmpty && week.bug.opponent?.label.isEmpty == true)
        #expect(week.bug.standing == nil)
        #expect(week.notes.isEmpty)
        #expect(week.boxes.map(\.mine) == [false, false])
    }

    @Test func aScoreboardThatFailsNeverFailsTheBoxThatArrived() async throws {
        let stub = try MatchupStub(answer: Fixtures.otherGame(Self.sunday))
        await stub.failBoard(URLError(.notConnectedToInternet))
        let viewModel = model(stub)
        await viewModel.load(leagueID: Fixtures.league)
        let shown = try MatchupViewModelTests.week(viewModel)
        #expect(!shown.stale)
        #expect(shown.week.whose != nil)
        #expect(shown.week.boxes.map(\.starters.count) == [10, 10])
        #expect(shown.week.bug.mine.name == "Carried by QJs")
        #expect(shown.week.notes.isEmpty)
    }

    @Test func eachGameIsSavedUnderItsOwnKeySoNoneShowsAnothersBox() async throws {
        let cache = FileCache(folder: folder)
        #expect(MatchupViewModel.route(Fixtures.league, roster: 2) != MatchupViewModel.route(Fixtures.league))
        let mine = try MatchupStub(answer: MatchupViewModelTests.answer(Self.sunday))
        await model(mine, roster: nil, cache: cache).load(leagueID: Fixtures.league)
        let theirs = try MatchupStub(answer: Fixtures.otherGame(Self.sunday))
        await theirs.fail(URLError(.notConnectedToInternet))
        let viewModel = model(theirs, cache: cache)
        await viewModel.load(leagueID: Fixtures.league)
        // Nothing saved for their game: the member's saved week is never drawn under it.
        #expect(viewModel.state == .failed(AppWords.Failure.offline))
    }

    private func model(
        _ api: any MatchupAPI, roster: Int? = 2, cache: (any AnswerCache)? = nil
    ) -> MatchupViewModel {
        MatchupViewModel(
            api: api, cache: cache ?? FileCache(folder: folder), clock: FixedClock(Fixtures.instant(Self.sunday)),
            timer: ManualTimer(), zone: Fixtures.zone, roster: roster
        )
    }
}
