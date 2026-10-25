import CommishAPI
@testable import CommishCore
import Foundation
import HTTPTypes
import OpenAPIRuntime
import Testing

/// The Start screen's view model: the saved lineup then the API's; a kicked-off line never offers a
/// move (plan Review Focus 1, at the Sunday 18:56Z fixture clock); the verb disabled with the stamp's
/// reason when the lineup shown is a saved read (Review Focus 2, over the generated client and a
/// throwing transport); the move's round trip with its done, refused and pending words; the copy.
@MainActor
struct StartViewModelTests {
    private let folder = FileManager.default.temporaryDirectory
        .appendingPathComponent("commish-start-tests-\(UUID().uuidString)")
    private static let base = URL(string: "http://localhost:8080")!
    static let espn = Components.Schemas.LeagueHost(value1: .espn)
    static let ffpc = Components.Schemas.LeagueHost(value1: .ffpc)
    static let saturday = Fixtures.instant(Fixtures.week)
    static let sunday = Fixtures.instant(Fixtures.sunday)

    /// The fixture's lineup as a platform that takes lineups from here sends it.
    static func writes(_ clock: String) throws -> LineupAdvice {
        var advice = try Fixtures.lineup(clock)
        advice.moves = .init(
            takesWrites: true,
            writesOn: true,
            reason: nil,
            lineup: .init(value1: .available),
            note: nil
        )
        return advice
    }

    private func model(
        _ api: any LineupAPI, clock: any Clock, host: Components.Schemas.LeagueHost = espn,
        cache: (any AnswerCache)? = nil, copy: @escaping @MainActor (String) -> Bool = { _ in true },
        onSignedOut: @escaping @MainActor () -> Void = {}
    ) -> StartViewModel {
        StartViewModel(
            api: api, cache: cache ?? FileCache(folder: folder), clock: clock, host: host, zone: Fixtures.zone,
            copy: copy, onSignedOut: onSignedOut
        )
    }

    private func loaded(_ viewModel: StartViewModel) -> (StartModel, Bool)? {
        guard case let .loaded(model, _, stale) = viewModel.state else {
            Issue.record("Expected loaded, got \(viewModel.state)")
            return nil
        }
        return (model, stale)
    }

    // MARK: Review Focus 1: a kicked-off line never offers a move

    @Test func atSundayAfternoonNoKickedOffLineOffersAMoveAndTheVerbIsGone() async throws {
        let stub = try LineupStub(lineups: [Self.writes(Fixtures.sunday)])
        let viewModel = model(stub, clock: FixedClock(Self.sunday))
        await viewModel.load(leagueID: Fixtures.league)
        let (screen, _) = try #require(loaded(viewModel))
        for cells in screen.starters + screen.bench where cells.row.read.locked {
            #expect(cells.move == nil, "\(cells.row.name) has kicked off")
        }
        #expect(screen.chips.allSatisfy {
            if case .swap = $0 {
                false
            } else {
                true
            }
        })
        #expect(screen.move.changes.isEmpty)
        #expect(screen.verb == nil)
        #expect(viewModel.pin.verb == nil)
        await viewModel.press(leagueID: Fixtures.league)
        #expect(await stub.planned.isEmpty)
    }

    @Test func atSundayAfternoonAKickedOffLineShowsItsLiveFigures() async throws {
        var advice = try Self.writes(Fixtures.sunday)
        advice.playerPoints = true
        // The advice starts Mahomes over Rodgers at QB; Rodgers has kicked off, so the change is held
        // and the platform's starter keeps the spot with his points so far.
        advice.slots[0].host?.value1.facts.pointsThisWeek = 12.4
        let stub = LineupStub(lineups: [advice])
        let viewModel = model(stub, clock: FixedClock(Self.sunday))
        await viewModel.load(leagueID: Fixtures.league)
        let (screen, _) = try #require(loaded(viewModel))
        let rodgers = try #require(screen.starters.first { $0.row.name == "Aaron Rodgers" })
        #expect(rodgers.row.read == .kickedOff)
        #expect(rodgers.game == .game(where: "at TB", when: "Kicked off"))
        #expect(rodgers.pts == "12.4")
        #expect(rodgers.move == nil)
        #expect(screen.team.live)
        #expect(screen.team.caption == "Proj final")
    }

    @Test func aSaturdayReadPressedOnSundayTakesItsChangesBackAndSendsNothing() async throws {
        let clock = MovingClock(Self.saturday)
        let stub = try LineupStub(lineups: [Self.writes(Fixtures.week)])
        let viewModel = model(stub, clock: clock)
        await viewModel.load(leagueID: Fixtures.league)
        #expect(viewModel.pin.verb == "Make these changes")
        clock.now = Self.sunday
        await viewModel.press(leagueID: Fixtures.league)
        #expect(await stub.planned.isEmpty)
        let (screen, _) = try #require(loaded(viewModel))
        #expect(screen.verb == nil)
        #expect(viewModel.step == .closed)
    }

    // MARK: Review Focus 2: offline never pretends to set the lineup

    @Test func aSavedLineupShownWithNoSignalDisablesTheVerbWithItsStamp() async throws {
        let cache = FileCache(folder: folder)
        try await cache.write(
            Self.writes(Fixtures.week),
            route: StartViewModel.route(Fixtures.league),
            stamp: Self.saturday
        )
        let offline = APIClient(client: Client(
            serverURL: Self.base, transport: FailingTransport(URLError(.notConnectedToInternet))
        ))
        let viewModel = model(offline, clock: FixedClock(Self.saturday.addingTimeInterval(1800)), cache: cache)
        await viewModel.load(leagueID: Fixtures.league)
        let (_, stale) = try #require(loaded(viewModel))
        #expect(stale)
        #expect(viewModel.pin.verb == "Make these changes")
        #expect(viewModel.pin.enabled == false)
        #expect(viewModel.pin.foot.map { $0.map(\.text).joined() }
            == ["Last read Sat 12:00 pm. Pull down to read your lineup again before you set it."])
        await viewModel.press(leagueID: Fixtures.league)
        #expect(viewModel.step == .closed)
    }

    @Test func aSavedLineupDisablesTheCopyToo() async throws {
        let cache = FileCache(folder: folder)
        try await cache.write(
            Fixtures.lineup(Fixtures.week),
            route: StartViewModel.route(Fixtures.league),
            stamp: Self.saturday
        )
        var copies: [String] = []
        let viewModel = model(
            FailingLineupAPI(), clock: FixedClock(Self.saturday), host: Self.ffpc, cache: cache,
            copy: { copies.append($0)
                return true
            }
        )
        await viewModel.load(leagueID: Fixtures.league)
        #expect(viewModel.pin.verb == "Copy the lineup")
        #expect(viewModel.pin.enabled == false)
        await viewModel.press(leagueID: Fixtures.league)
        #expect(copies.isEmpty)
    }

    // MARK: the move's round trip

    @Test func aSwapRoundTripPlansConfirmsMakesAndReadsAgain() async throws {
        let stub = try LineupStub(lineups: [Self.writes(Fixtures.week), Self.writes(Fixtures.week)])
        let viewModel = model(stub, clock: FixedClock(Self.saturday))
        await viewModel.load(leagueID: Fixtures.league)
        let (screen, _) = try #require(loaded(viewModel))
        await viewModel.press(leagueID: Fixtures.league)
        #expect(viewModel.step == .confirm(sentence: LineupStub.planSentence, token: "tok-1"))
        #expect(viewModel.pin.panel?.verb == "Set it on ESPN")
        #expect(viewModel.pin.panel?.close == "Not now")
        #expect(viewModel.pin.verb == nil)
        await viewModel.confirm(leagueID: Fixtures.league)
        let planned = await stub.planned
        let made = await stub.made
        #expect(planned == [screen.move])
        #expect(made.map(\.move) == [screen.move])
        #expect(made.map(\.token) == ["tok-1"])
        #expect(planned.first?.changes.map(\._in) == ["4046", "7543", "HOU"])
        #expect(await stub.reads == 2)
        let panel = try #require(viewModel.pin.panel)
        #expect(panel.line == "Your lineup is set on ESPN.")
        #expect(panel.page == nil)
        #expect(panel.close == "Done")
        viewModel.close()
        #expect(viewModel.step == .closed)
    }

    @Test func aRefusalSaysThePlatformsOwnWords() async throws {
        let stub = try LineupStub(lineups: [Self.writes(Fixtures.week)], outcome: .refused)
        let viewModel = model(stub, clock: FixedClock(Self.saturday))
        await viewModel.load(leagueID: Fixtures.league)
        await viewModel.press(leagueID: Fixtures.league)
        await viewModel.confirm(leagueID: Fixtures.league)
        let panel = try #require(viewModel.pin.panel)
        #expect(panel.line == "ESPN did not take the move, and nothing changed.")
        #expect(panel.said == "ESPN said: Alexander Mattison is locked.")
        #expect(panel.page?.text == "Open ESPN")
    }

    @Test func aMoveNotShownYetSendsTheMemberToCheckThePlatform() async throws {
        let stub = try LineupStub(lineups: [Self.writes(Fixtures.week)], outcome: .pending)
        let viewModel = model(stub, clock: FixedClock(Self.saturday))
        await viewModel.load(leagueID: Fixtures.league)
        await viewModel.press(leagueID: Fixtures.league)
        await viewModel.confirm(leagueID: Fixtures.league)
        let panel = try #require(viewModel.pin.panel)
        #expect(panel.said == nil)
        #expect(panel.page?.text == "Open ESPN")
        #expect(panel.close == "Done")
    }

    @Test func aMoveWithNoAnswerMayHaveLeftSoTheMemberChecks() async throws {
        let stub = try LineupStub(lineups: [Self.writes(Fixtures.week)], makeError: URLError(.timedOut))
        let viewModel = model(stub, clock: FixedClock(Self.saturday))
        await viewModel.load(leagueID: Fixtures.league)
        await viewModel.press(leagueID: Fixtures.league)
        await viewModel.confirm(leagueID: Fixtures.league)
        let panel = try #require(viewModel.pin.panel)
        #expect(panel.tone == .problem)
        #expect(panel.line == StartWords.lost("ESPN"))
        #expect(panel.page?.url?.absoluteString == "https://sleeper.com/leagues/1382163311038038016/team")
    }

    @Test func aPlanWithNoAnswerSentNothing() async throws {
        let stub = try LineupStub(lineups: [Self.writes(Fixtures.week)], planError: URLError(.notConnectedToInternet))
        let viewModel = model(stub, clock: FixedClock(Self.saturday))
        await viewModel.load(leagueID: Fixtures.league)
        await viewModel.press(leagueID: Fixtures.league)
        #expect(viewModel.pin.panel?.line == "We could not reach Commish, and nothing was sent. Try again in a moment.")
        #expect(await stub.made.isEmpty)
    }

    @Test func aRefusedPlanSaysTheAPIsSentence() async throws {
        let refused = APIError.envelope(code: "invalid", message: "Aaron Rodgers has kicked off.")
        let stub = try LineupStub(lineups: [Self.writes(Fixtures.week)], planError: refused)
        let viewModel = model(stub, clock: FixedClock(Self.saturday))
        await viewModel.load(leagueID: Fixtures.league)
        await viewModel.press(leagueID: Fixtures.league)
        #expect(viewModel.pin.panel?.line == "Aaron Rodgers has kicked off.")
        #expect(viewModel.pin.panel?.page == nil)
    }

    @Test func aPlanTheAPICannotMakeHereOffersThePlatformsPage() async throws {
        let stub = try LineupStub(lineups: [Self.writes(Fixtures.week)], planReady: false)
        let viewModel = model(stub, clock: FixedClock(Self.saturday))
        await viewModel.load(leagueID: Fixtures.league)
        await viewModel.press(leagueID: Fixtures.league)
        let panel = try #require(viewModel.pin.panel)
        #expect(panel.pageSolid)
        #expect(panel.page?.text == "Set it on ESPN")
        #expect(panel.verb == nil)
    }

    @Test func aRefusedTokenSignsOutFromTheMove() async throws {
        var signedOut = 0
        let stub = try LineupStub(lineups: [Self.writes(Fixtures.week)], planError: APIError.status(401))
        let viewModel = model(stub, clock: FixedClock(Self.saturday), onSignedOut: { signedOut += 1 })
        await viewModel.load(leagueID: Fixtures.league)
        await viewModel.press(leagueID: Fixtures.league)
        #expect(signedOut == 1)
        #expect(viewModel.step == .closed)
    }

    // MARK: the copy, where the platform takes no lineup from here

    @Test func theCopyPutsTheLineupOnTheClipboardAndSaysWhereToSetIt() async throws {
        var copies: [String] = []
        let stub = try LineupStub(lineups: [Fixtures.lineup(Fixtures.week)])
        let viewModel = model(stub, clock: FixedClock(Self.saturday), host: Self.ffpc, copy: {
            copies.append($0)
            return true
        })
        await viewModel.load(leagueID: Fixtures.league)
        #expect(viewModel.pin.foot.map { $0.map(\.text).joined() }
            == ["FFPC's lineup page", "FFPC takes no lineups from here."])
        await viewModel.press(leagueID: Fixtures.league)
        #expect(copies.first?.hasPrefix("Week 6 lineup\nQB Patrick Mahomes") == true)
        #expect(viewModel.pin.foot.map { $0.map(\.text).joined() } == ["Copied. Set it on FFPC's lineup page."])
        #expect(await stub.planned.isEmpty)
    }

    @Test func aWhyLineOpensAndCloses() throws {
        let viewModel = try model(
            LineupStub(lineups: [Fixtures.lineup(Fixtures.week)]),
            clock: FixedClock(Self.saturday)
        )
        viewModel.toggleWhy("4046")
        #expect(viewModel.opened == ["4046"])
        viewModel.toggleWhy("4046")
        #expect(viewModel.opened.isEmpty)
    }
}

/// A clock a test moves.
final class MovingClock: Clock, @unchecked Sendable {
    var now: Date

    init(_ now: Date) {
        self.now = now
    }
}

/// The lineup's routes as a stub: each read answers the next lineup given (the last one again), the
/// plan answers ready with a token or unavailable, the make answers the outcome given; each call kept.
actor LineupStub: LineupAPI {
    static let planSentence = "Start Patrick Mahomes over Aaron Rodgers at QB, and two more, on ESPN now."

    private let lineups: [LineupAdvice]
    private let outcome: HostMoveResult.OutcomePayload.Value1Payload
    private let planReady: Bool
    private let planError: (any Error)?
    private let makeError: (any Error)?
    private(set) var reads = 0
    private(set) var planned: [HostMoveInput] = []
    private(set) var made: [(move: HostMoveInput, token: String)] = []

    init(
        lineups: [LineupAdvice], outcome: HostMoveResult.OutcomePayload.Value1Payload = .done, planReady: Bool = true,
        planError: (any Error)? = nil, makeError: (any Error)? = nil
    ) {
        self.lineups = lineups
        self.outcome = outcome
        self.planReady = planReady
        self.planError = planError
        self.makeError = makeError
    }

    func lineup(id _: String) async throws -> LineupAdvice {
        reads += 1
        return lineups[min(reads, lineups.count) - 1]
    }

    func planMove(id _: String, move: HostMoveInput) async throws -> HostMovePlan {
        planned.append(move)
        if let planError {
            throw planError
        }
        return HostMovePlan(
            status: .init(value1: planReady ? .ready : .unavailable),
            sentence: planReady ? Self.planSentence : "Connect ESPN again to agree to moves.",
            confirm: planReady ? "tok-1" : nil, expiresAt: nil, hostUrl: "https://fantasy.espn.com/football/team",
            bid: nil
        )
    }

    func makeMove(id _: String, move: HostMoveInput, confirm: String) async throws -> HostMoveResult {
        made.append((move, confirm))
        if let makeError {
            throw makeError
        }
        let sentences: [HostMoveResult.OutcomePayload.Value1Payload: String] = [
            .done: "Your lineup is set on ESPN.",
            .refused: "ESPN did not take the move, and nothing changed.",
            .pending: "We sent it, and ESPN has not shown it yet. Check your lineup on ESPN.",
        ]
        return HostMoveResult(
            outcome: .init(value1: outcome), sentence: sentences[outcome] ?? "", hostWords: outcome == .refused
                ? "Alexander Mattison is locked" : nil,
            hostUrl: "https://fantasy.espn.com/football/team", moveId: nil, processesAt: nil
        )
    }
}

/// Fails every read as with no signal.
struct FailingLineupAPI: LineupAPI {
    func lineup(id _: String) async throws -> LineupAdvice {
        throw URLError(.notConnectedToInternet)
    }

    func planMove(id _: String, move _: HostMoveInput) async throws -> HostMovePlan {
        throw URLError(.notConnectedToInternet)
    }

    func makeMove(id _: String, move _: HostMoveInput, confirm _: String) async throws -> HostMoveResult {
        throw URLError(.notConnectedToInternet)
    }
}

/// A row opens the player sheet by his platform id, with what the row drew of him.
struct StartSheetTests {
    @Test func aRowWithAPageOpensTheSheetByHisID() throws {
        let advice = try Fixtures.lineup(Fixtures.week)
        let model = StartModel(
            advice: advice, host: .init(value1: .ffpc), now: Fixtures.instant(Fixtures.week), zone: Fixtures.zone
        )
        let mahomes = try #require(model.starters.first?.sheetPlayer)
        #expect(mahomes == SheetPlayer(
            id: "4046", slug: "patrick-mahomes", name: "Patrick Mahomes", position: "QB", rank: "12", club: "KC",
            boardID: "3139477"
        ))
        let texans = try #require(model.starters.first { $0.row.position == "D/ST" })
        #expect(texans.sheetPlayer == nil)
        let dart = try #require(model.bench.first { $0.row.name == "Jaxson Dart" })
        #expect(dart.sheetPlayer?.rank == "IR")
    }
}
