import CommishAPI
@testable import CommishCore
import Foundation
import Testing

/// The Matchup's view model: the poll starts when the screen is visible, reads on the web's cadence
/// and stops when it is hidden (an injected timer and the visibility signal, plan Task S3); a failed
/// poll keeps the last week with its stamp; the saved week at once; a refused token signs out and
/// stops the poll; the box refused stands on the read's starters. And the screen at the three Sunday
/// fixture clocks and after Sunday, every line's state read from the API's field.
@MainActor
struct MatchupViewModelTests {
    private let folder = FileManager.default.temporaryDirectory
        .appendingPathComponent("commish-matchup-tests-\(UUID().uuidString)")
    static let before = "2026-10-17T17-00-00Z"
    static let sunday = "2026-10-18T18-56-00Z"
    static let monday = "2026-10-19T16-00-00Z"
    static let tuesday = "2026-10-20T17-00-00Z"

    static func answer(_ clock: String) throws -> MatchupAnswer {
        try MatchupAnswer(sync: Fixtures.matchupSync(clock), box: Fixtures.matchupBox(clock))
    }

    private func model(
        _ api: any MatchupAPI, clock: String, timer: any PollTimer = ManualTimer(), cache: (any AnswerCache)? = nil,
        onSignedOut: @escaping @MainActor () -> Void = {}
    ) -> MatchupViewModel {
        MatchupViewModel(
            api: api, cache: cache ?? FileCache(folder: folder), clock: FixedClock(Fixtures.instant(clock)),
            timer: timer, zone: Fixtures.zone, onSignedOut: onSignedOut
        )
    }

    /// The week a view model shows, when it was read and whether that read is stale.
    struct Shown {
        let week: MatchupWeek
        let stamp: Date
        let stale: Bool
    }

    static func week(_ viewModel: MatchupViewModel) throws -> Shown {
        guard case let .loaded(.week(week), stamp, stale) = viewModel.state else {
            throw Unexpected.state("\(viewModel.state)")
        }
        return Shown(week: week, stamp: stamp, stale: stale)
    }

    static func week(_ clock: String, edit: (inout MatchupAnswer) -> Void = { _ in }) throws -> MatchupWeek {
        var answer = try answer(clock)
        edit(&answer)
        guard case let .week(week) = MatchupModel(
            sync: answer.sync, box: answer.box, clock: Fixtures.instant(clock), zone: Fixtures.zone
        ) else {
            throw Unexpected.state(clock)
        }
        return week
    }

    enum Unexpected: Error {
        case state(String)
    }

    // MARK: the poll

    @Test func visibleReadsAtOnceThenOnTheWebsCadence() async throws {
        let stub = try MatchupStub(answer: Self.answer(Self.sunday))
        let timer = ManualTimer()
        let viewModel = model(stub, clock: Self.sunday, timer: timer)
        viewModel.setVisible(true, leagueID: Fixtures.league)
        #expect(viewModel.polling)
        try await eventually { await (stub.reads, timer.sleepers) == (1, 1) }
        #expect(await timer.intervals == [.seconds(60)])
        #expect(MatchupViewModel.pollInterval == .seconds(60))
        await timer.tick()
        try await eventually { await (stub.reads, timer.sleepers) == (2, 1) }
        await timer.tick()
        try await eventually { await stub.reads == 3 }
        viewModel.setVisible(false, leagueID: Fixtures.league)
    }

    @Test func hiddenStopsThePollAndReadsNothingMore() async throws {
        let stub = try MatchupStub(answer: Self.answer(Self.sunday))
        let timer = ManualTimer()
        let viewModel = model(stub, clock: Self.sunday, timer: timer)
        viewModel.setVisible(true, leagueID: Fixtures.league)
        try await eventually { await (stub.reads, timer.sleepers) == (1, 1) }
        viewModel.setVisible(false, leagueID: Fixtures.league)
        #expect(!viewModel.polling)
        try await eventually { await timer.sleepers == 0 }
        await timer.tick()
        await settle()
        #expect(await stub.reads == 1)
        // Hidden twice changes nothing; visible again reads at once.
        viewModel.setVisible(false, leagueID: Fixtures.league)
        viewModel.setVisible(true, leagueID: Fixtures.league)
        try await eventually { await (stub.reads, timer.sleepers) == (2, 1) }
        viewModel.setVisible(false, leagueID: Fixtures.league)
    }

    @Test func visibleTwiceRunsOnePoll() async throws {
        let stub = try MatchupStub(answer: Self.answer(Self.sunday))
        let timer = ManualTimer()
        let viewModel = model(stub, clock: Self.sunday, timer: timer)
        viewModel.setVisible(true, leagueID: Fixtures.league)
        viewModel.setVisible(true, leagueID: Fixtures.league)
        try await eventually { await (stub.reads, timer.sleepers) == (1, 1) }
        await settle()
        #expect(await stub.reads == 1)
        viewModel.setVisible(false, leagueID: Fixtures.league)
    }

    @Test func aFailedPollKeepsTheLastWeekWithItsStampNeverBlank() async throws {
        let stub = try MatchupStub(answer: Self.answer(Self.sunday))
        let timer = ManualTimer()
        let viewModel = model(stub, clock: Self.sunday, timer: timer)
        viewModel.setVisible(true, leagueID: Fixtures.league)
        try await eventually { await (stub.reads, timer.sleepers) == (1, 1) }
        let shown = try Self.week(viewModel)
        #expect(!shown.stale)
        #expect(viewModel.stampWords == nil)
        await stub.fail(URLError(.notConnectedToInternet))
        await timer.tick()
        try await eventually { await (stub.reads, timer.sleepers) == (2, 1) }
        let kept = try Self.week(viewModel)
        #expect(kept.week == shown.week)
        #expect(kept.stamp == shown.stamp)
        #expect(kept.stale)
        #expect(viewModel.stampWords == "Last read Sun 1:56 pm")
        // The next good read takes the stamp off.
        await stub.fail(nil)
        await timer.tick()
        try await eventually { await (stub.reads, timer.sleepers) == (3, 1) }
        #expect(try !Self.week(viewModel).stale)
        viewModel.setVisible(false, leagueID: Fixtures.league)
    }

    @Test func aViewModelDroppedWhilePollingReadsNoMore() async throws {
        let stub = try MatchupStub(answer: Self.answer(Self.sunday))
        let timer = ManualTimer()
        var viewModel: MatchupViewModel? = model(stub, clock: Self.sunday, timer: timer)
        viewModel?.setVisible(true, leagueID: Fixtures.league)
        try await eventually { await (stub.reads, timer.sleepers) == (1, 1) }
        weak let dropped = viewModel
        viewModel = nil
        // Nothing but the screen held it: the poll holds it only for a read.
        #expect(dropped == nil)
        await timer.tick()
        try await eventually { await timer.sleepers == 0 }
        await settle()
        #expect(await stub.reads == 1)
    }

    @Test func aFailedPollAgesTheLiveReadCellToTheClock() async throws {
        let stub = try MatchupStub(answer: Self.answer(Self.sunday))
        let timer = ManualTimer()
        let clock = MovingClock(Fixtures.instant(Self.sunday))
        let viewModel = MatchupViewModel(
            api: stub, cache: FileCache(folder: folder), clock: clock, timer: timer, zone: Fixtures.zone
        )
        viewModel.setVisible(true, leagueID: Fixtures.league)
        try await eventually { await (stub.reads, timer.sleepers) == (1, 1) }
        #expect(try Self.week(viewModel).week.bug.read == "FFPC 4 min ago")
        clock.now = clock.now.addingTimeInterval(600)
        await stub.fail(URLError(.notConnectedToInternet))
        await timer.tick()
        try await eventually { await (stub.reads, timer.sleepers) == (2, 1) }
        let shown = try Self.week(viewModel)
        #expect(shown.stale)
        #expect(shown.week.bug.read == "FFPC 14 min ago")
        #expect(viewModel.stampWords == "Last read Sun 1:56 pm")
        viewModel.setVisible(false, leagueID: Fixtures.league)
    }

    @Test func aRefusedTokenSignsOutAndStopsThePoll() async throws {
        let stub = try MatchupStub(answer: Self.answer(Self.sunday))
        await stub.fail(APIError.status(401))
        let timer = ManualTimer()
        var signedOut = 0
        let viewModel = model(stub, clock: Self.sunday, timer: timer) { signedOut += 1 }
        viewModel.setVisible(true, leagueID: Fixtures.league)
        try await eventually { await stub.reads == 1 }
        await settle()
        #expect(signedOut == 1)
        #expect(viewModel.state == .failed(AppWords.Failure.signedOut))
        #expect(await timer.sleepers == 0)
        #expect(await stub.reads == 1)
        #expect(!viewModel.polling)
    }

    @Test func theSavedWeekShowsAtOnceDatedWhenTheReadFails() async throws {
        let cache = FileCache(folder: folder)
        let saved = Fixtures.instant(Self.sunday).addingTimeInterval(-300)
        try await cache.write(Self.answer(Self.sunday), route: MatchupViewModel.route(Fixtures.league), stamp: saved)
        let stub = try MatchupStub(answer: Self.answer(Self.sunday))
        await stub.fail(URLError(.notConnectedToInternet))
        let viewModel = model(stub, clock: Self.sunday, cache: cache)
        await viewModel.load(leagueID: Fixtures.league)
        let shown = try Self.week(viewModel)
        #expect(try shown.week == Self.week(Self.sunday))
        #expect(shown.stamp == saved)
        #expect(shown.stale)
        #expect(viewModel.stampWords == "Last read Sun 1:51 pm")
    }

    @Test func nothingSavedAndNoSignalSaysSoInWords() async throws {
        let stub = try MatchupStub(answer: Self.answer(Self.sunday))
        await stub.fail(URLError(.notConnectedToInternet))
        let viewModel = model(stub, clock: Self.sunday)
        await viewModel.load(leagueID: Fixtures.league)
        #expect(viewModel.state == .failed(AppWords.Failure.offline))
    }

    @Test func aLeagueTheAPIHasNoBoxForStandsOnTheReadsStarters() async throws {
        let stub = try MatchupStub(answer: Self.answer(Self.sunday), box: false)
        let viewModel = model(stub, clock: Self.sunday)
        await viewModel.load(leagueID: Fixtures.league)
        let week = try Self.week(viewModel).week
        #expect(week.boxes.map(\.starters.count) == [10, 10])
        #expect(week.boxes[0].teamRow.pts == "39.1")
        let starters: [RowCells] = week.boxes.flatMap(\.starters)
        let bare: Bool = starters.allSatisfy { $0.proj == "--" && $0.game == .none }
        #expect(bare)
    }

    // MARK: the three Sunday clocks and after Sunday

    @Test func beforeTheFirstKickoffTheBugDrawsEachSidesProjAndTheFirstKickoff() throws {
        let week = try Self.week(Self.before)
        #expect(week.bug.mine.big == "74.7")
        #expect(week.bug.mine.bigLabel == "Proj")
        #expect(week.bug.mine.small.isEmpty)
        #expect(week.bug.opponent?.big == "104.8")
        #expect(week.bug.head == "First kickoff")
        #expect(week.bug.words == "Sun 8:30 am, JAX vs HOU")
        #expect(week.bug.read == nil)
        #expect(week.boxes[0].teamRow.live == false)
    }

    @Test func onSundayAfternoonTheBugIsLiveAndEachRowSaysItsGamesState() throws {
        let week = try Self.week(Self.sunday)
        #expect(week.bug.started)
        #expect(week.bug.mine.big == "39.1")
        #expect(week.bug.mine.bigLabel == "Pts")
        #expect(week.bug.mine.small == "Proj final 73.2")
        #expect(week.bug.mine.toPlay == "3 to play")
        #expect(week.bug.opponent?.small == "Proj final 121.2")
        #expect(week.bug.head == "Next kickoff")
        #expect(week.bug.words == "Sun 3:05 pm, ARI at LAR")
        #expect(week.bug.read == "FFPC 4 min ago")
        let states = week.boxes[0].starters.map(\.row.read)
        #expect(states.contains(.kickedOff))
        #expect(states.contains(.upcoming))
        #expect(states.contains(.final))
        #expect(week.boxes[0].starters[0].game == .game(where: "at TB", when: "Kicked off"))
        #expect(week.boxes[1].empty == "FFPC shows us your lineup only.")
    }

    @Test func onSundayAPlatformThatGivesEachPlayersPointsDrawsThemLive() throws {
        let week = try Self.week(Self.sunday) { answer in
            guard var box = answer.box else {
                return
            }
            box.sides[0].playerPoints = true
            box.sides[0].teamTotal = false
            box.sides[0].starters[0].line.facts.pointsThisWeek = 18.4
            box.sides[0].starters[8].line.facts.pointsThisWeek = 9.6
            answer = MatchupAnswer(sync: answer.sync, box: box)
        }
        #expect(week.boxes[0].starters[0].pts == "18.4")
        #expect(week.boxes[0].starters[8].pts == "9.6")
        #expect(week.boxes[0].teamRow.pts == "28.0")
        #expect(week.bug.mine.big == "28.0")
    }

    @Test func aLinesStateIsTheAPIsFieldNeverItsKickoff() throws {
        // Jeremiyah Love kicks off at 3:05 pm; the field says final, so the row says Final.
        let week = try Self.week(Self.sunday) { answer in
            guard var box = answer.box else {
                return
            }
            box.sides[0].starters[1].line.gameState = .init(value1: .init(state: .init(value1: .final), word: "Final"))
            answer = MatchupAnswer(sync: answer.sync, box: box)
        }
        #expect(week.boxes[0].starters[1].row.read == .final)
        #expect(week.boxes[0].starters[1].game == .game(where: "at LAR", when: "Final"))
    }

    @Test func afterSundayTheMemberWaitsOnMondayNight() throws {
        let week = try Self.week(Self.monday)
        #expect(week.bug.head == "Next kickoff")
        #expect(week.bug.words == "Mon 7:15 pm, WAS at SF")
        #expect(week.bug.mine.small == "Proj final 64.0")
        #expect(week.bug.mine.toPlay == "1 to play")
        let finals: Int = week.boxes[0].starters.filter { $0.row.read == .final }.count
        #expect(finals == 6)
    }

    @Test func onceEveryGameIsFinalTheWeekIsDone() throws {
        let week = try Self.week(Self.tuesday)
        #expect(week.bug.head == "Final")
        #expect(week.bug.read == nil)
        #expect(week.bug.mine.small == "Final 63.5")
        #expect(week.bug.opponent?.small == "Final 83.7")
        let captions: [String?] = week.boxes.map(\.teamRow.caption)
        #expect(captions == ["Final", "Final"])
        #expect(!week.basis.contains("Proj final"))
    }

    @Test func everyRowWithAPageOpensThePlayerSheetByHisID() throws {
        let week = try Self.week(Self.sunday)
        let players: [SheetPlayer] = week.sheetPlayers
        let rodgers: SheetPlayer? = players.first { $0.id == "96" }
        #expect(rodgers?.slug == "aaron-rodgers")
        #expect(rodgers?.name == "Aaron Rodgers")
        let rows: [RowCells] = week.boxes.flatMap { $0.starters + $0.bench }
        let withPages: Int = rows.filter { $0.row.slug != nil }.count
        #expect(players.count == withPages)
    }
}
