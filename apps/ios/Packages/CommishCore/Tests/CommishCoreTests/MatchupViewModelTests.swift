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
        #expect(week.boxes.flatMap(\.starters).allSatisfy { $0.proj == "--" && $0.game == .none })
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
        #expect(week.boxes[0].starters.filter { $0.row.read == .final }.count == 6)
    }

    @Test func onceEveryGameIsFinalTheWeekIsDone() throws {
        let week = try Self.week(Self.tuesday)
        #expect(week.bug.head == "Final")
        #expect(week.bug.read == nil)
        #expect(week.bug.mine.small == "Final 63.5")
        #expect(week.bug.opponent?.small == "Final 83.7")
        #expect(week.boxes.allSatisfy { $0.teamRow.caption == "Final" })
        #expect(!week.basis.contains("Proj final"))
    }

    @Test func everyRowWithAPageOpensThePlayerSheetByHisID() throws {
        let week = try Self.week(Self.sunday)
        let players = week.sheetPlayers
        #expect(players.contains { $0.id == "96" && $0.slug == "aaron-rodgers" && $0.name == "Aaron Rodgers" })
        #expect(players.count == (week.boxes.flatMap { $0.starters + $0.bench }.filter { $0.row.slug != nil }.count))
    }
}

/// Waits, a little at a time, until `condition` holds; fails the test after about two seconds.
@MainActor
func eventually(_ condition: () async -> Bool) async throws {
    for _ in 0 ..< 400 {
        if await condition() {
            return
        }
        try await Task.sleep(for: .milliseconds(5))
    }
    Issue.record("The condition never held.")
}

/// Lets every task that could run run.
@MainActor
func settle() async {
    for _ in 0 ..< 20 {
        await Task.yield()
        try? await Task.sleep(for: .milliseconds(2))
    }
}

/// The poll's timer by hand: each sleep is kept until the test ticks it, its interval recorded; a
/// cancelled sleep throws at once.
actor ManualTimer: PollTimer {
    private(set) var intervals: [Duration] = []
    private var waiting: [UUID: CheckedContinuation<Void, any Error>] = [:]
    private var cancelled: Set<UUID> = []

    var sleepers: Int {
        waiting.count
    }

    func sleep(for interval: Duration) async throws {
        intervals.append(interval)
        let id = UUID()
        try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, any Error>) in
                if cancelled.remove(id) != nil {
                    continuation.resume(throwing: CancellationError())
                } else {
                    waiting[id] = continuation
                }
            }
        } onCancel: {
            Task { await self.cancel(id) }
        }
    }

    func tick() {
        let due = waiting.values
        waiting = [:]
        for continuation in due {
            continuation.resume()
        }
    }

    private func cancel(_ id: UUID) {
        if let continuation = waiting.removeValue(forKey: id) {
            continuation.resume(throwing: CancellationError())
        } else {
            cancelled.insert(id)
        }
    }
}

/// The Matchup's two reads as the fixture answers them at a clock, counted; or failing as told.
actor MatchupStub: MatchupAPI {
    private let answer: MatchupAnswer
    private let box: Bool
    private var failure: (any Error)?
    private(set) var reads = 0

    init(answer: MatchupAnswer, box: Bool = true) {
        self.answer = answer
        self.box = box
    }

    func fail(_ error: (any Error)?) {
        failure = error
    }

    func leagueSync(id _: String) async throws -> LeagueSync {
        reads += 1
        if let failure {
            throw failure
        }
        return answer.sync
    }

    func matchup(id _: String) async throws -> MatchupBox? {
        if let failure {
            throw failure
        }
        return box ? answer.box : nil
    }
}
