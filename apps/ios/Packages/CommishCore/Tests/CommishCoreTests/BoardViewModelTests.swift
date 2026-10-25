import CommishAPI
@testable import CommishCore
import Foundation
import HTTPTypes
import OpenAPIRuntime
import RunFixtures
import Testing

/// The Board's view model over the run's routes: the first open reads all four files; the next names
/// each ETag it kept, and a run unchanged costs five 304s and refreshes only the read's stamp; with no
/// signal the saved board shows, stale with its reason (through the generated client and a throwing
/// transport too); the chips' choice holds across the sheet and a pull; a format chip reads its own
/// board and never shows another's; a refused token signs out.
@MainActor
struct BoardViewModelTests {
    private let folder = FileManager.default.temporaryDirectory
        .appendingPathComponent("commish-board-tests-\(UUID().uuidString)")
    private static let base = URL(string: "http://localhost:8080")!
    static let now = APIDecoding.parseDate("2026-10-22T17:00:00Z")!

    private func model(
        _ api: any RunAPI, cache: (any AnswerCache)? = nil, clock: any Clock = FixedClock(now),
        onSignedOut: @escaping @MainActor () -> Void = {}
    ) -> BoardViewModel {
        BoardViewModel(
            api: api, cache: cache ?? FileCache(folder: folder), clock: clock, inSeason: true, following: false,
            zone: Fixtures.zone, onSignedOut: onSignedOut
        )
    }

    /// A loaded state's parts.
    private struct Loaded {
        let board: BoardModel
        let stamp: Date
        let stale: BoardStale?
    }

    private func loaded(_ viewModel: BoardViewModel) -> Loaded? {
        guard case let .loaded(model, stamp, stale) = viewModel.state else {
            Issue.record("Expected loaded, got \(viewModel.state)")
            return nil
        }
        return Loaded(board: model, stamp: stamp, stale: stale)
    }

    @Test func theFirstOpenReadsTheRunAndSavesItWithItsETags() async throws {
        let cache = FileCache(folder: folder)
        let run = CountingRun(StubRun(.contract))
        let viewModel = model(run, cache: cache)
        await viewModel.load()
        let shown = try #require(loaded(viewModel))
        let (board, stale) = (shown.board, shown.stale)
        #expect(stale == nil)
        #expect(viewModel.stampWords == nil)
        #expect(board.words.heading == "Rest of 2026")
        #expect(board.rows.first?.name == "Jahmyr Gibbs")
        #expect(await run.tags == [nil, nil, nil, nil, nil], "nothing kept, nothing named")
        let saved = await cache.read(RunBoardRead.self, route: BoardViewModel.route(nil))
        #expect(saved?.stamp == Self.now)
        #expect(saved?.value.board.tag == #"W/"2026-10-21T12-ros/boards/ppr-12.json""#)
    }

    @Test func anUnchangedRunCostsFive304sAndRefreshesOnlyTheStamp() async throws {
        let cache = FileCache(folder: folder)
        let first = model(StubRun(.contract), cache: cache)
        await first.load()
        let later = Self.now.addingTimeInterval(3600)
        let run = CountingRun(StubRun(.contract))
        let viewModel = model(run, cache: cache, clock: FixedClock(later))
        await viewModel.load()
        let shown = try #require(loaded(viewModel))
        let (board, stamp, stale) = (shown.board, shown.stamp, shown.stale)
        #expect(stale == nil)
        #expect(stamp == later)
        #expect(await run.unchanged == 5, "every file named by its kept ETag, every one a 304")
        let fixture = RunFixture.contract
        #expect(try await run.tags == [
            fixture.tag("manifest.json"), fixture.tag("boards/ppr-12.json"), fixture.tag("adp.json"),
            fixture.tag("designations.json"), fixture.tag("clubs.json"),
        ])
        #expect(try board == BoardModel(
            read: fixture.read(format: "ppr-12"), position: nil, inSeason: true, following: false, now: later,
            zone: Fixtures.zone
        ))
        #expect(await cache.read(RunBoardRead.self, route: BoardViewModel.route(nil))?.stamp == later)
    }

    @Test func withNoSignalTheSavedBoardShowsStaleWithItsReasonThroughTheGeneratedClient() async throws {
        let cache = FileCache(folder: folder)
        try await cache.write(
            RunFixture.contract.read(format: "ppr-12"),
            route: BoardViewModel.route(nil),
            stamp: Self.now
        )
        let offline = APIClient(client: Client(
            serverURL: Self.base, transport: FailingTransport(URLError(.notConnectedToInternet))
        ))
        let viewModel = model(offline, cache: cache, clock: FixedClock(Self.now.addingTimeInterval(3600)))
        await viewModel.load()
        let shown = try #require(loaded(viewModel))
        let (board, stamp, stale) = (shown.board, shown.stamp, shown.stale)
        #expect(stale == .offline)
        #expect(stamp == Self.now)
        #expect(viewModel.stampWords == "You're offline, so this is the last board this device saved, updated Oct 21.")
        #expect(board.rows.count == 4)
    }

    @Test func aReadThatFailsAnotherWayKeepsTheBoardDated() async throws {
        let cache = FileCache(folder: folder)
        try await cache.write(
            RunFixture.contract.read(format: "ppr-12"),
            route: BoardViewModel.route(nil),
            stamp: Self.now
        )
        let unavailable = APIClient(client: Client(
            serverURL: Self.base,
            transport: StatusTransport(status: .badGateway)
        ))
        let viewModel = model(unavailable, cache: cache)
        await viewModel.load()
        #expect(loaded(viewModel)?.stale == .failed)
        #expect(viewModel.stampWords == "Last read Thu 12:00 pm")
    }

    @Test func withNoSignalAndNothingSavedItSaysSoInWords() async {
        let viewModel = model(StubRun(.contract, offline: true))
        await viewModel.load()
        #expect(viewModel.state == .failed(AppWords.Failure.offline))
    }

    @Test func theChipsKeepTheirStateAcrossTheSheetAndAPullThatReadsAgain() async throws {
        let viewModel = model(StubRun(.standIn))
        await viewModel.load()
        viewModel.choose(position: .receiver)
        let receivers = try #require(loaded(viewModel)).board
        let sheet = PlayerSheetHost()
        let row = try #require(receivers.rows.dropFirst(3).first)
        try sheet.open(#require(row.sheetPlayer))
        await viewModel.load()
        let again = try #require(loaded(viewModel)).board
        sheet.parentRefreshed(again.rows.compactMap(\.sheetPlayer))
        #expect(sheet.shown?.id == row.id, "the sheet keeps its player under a read")
        sheet.close()
        #expect(viewModel.filter == BoardFilter(format: nil, position: .receiver))
        #expect(again.positions.filter(\.pressed).map(\.value) == [.receiver])
        #expect(again.rows.map(\.id) == receivers.rows.map(\.id))
    }

    @Test func aFormatChipReadsThatFormatsBoardAndNeverShowsAnothers() async throws {
        let cache = FileCache(folder: folder)
        let viewModel = model(StubRun(.contract), cache: cache)
        await viewModel.load()
        viewModel.choose(position: .runningBack)
        // The contract run lists three formats and carries PPR's board alone.
        await viewModel.choose(format: "half-ppr-12")
        #expect(viewModel.filter == BoardFilter(format: "half-ppr-12", position: .runningBack))
        guard case .failed = viewModel.state else {
            Issue.record("the half PPR board is not read, and PPR's rows are not its")
            return
        }
        #expect(viewModel.formats.map(\.id) == ["ppr-12", "half-ppr-12", "standard-12"], "its chips stay")
        await viewModel.choose(format: "ppr-12")
        let board = try #require(loaded(viewModel)).board
        #expect(board.formats.filter(\.pressed).map(\.value) == ["ppr-12"])
    }

    @Test func aRefusedTokenSignsOut() async {
        var signedOut = false
        let refused = APIClient(client: Client(serverURL: Self.base, transport: StatusTransport(status: .unauthorized)))
        let viewModel = model(refused) { signedOut = true }
        await viewModel.load()
        #expect(signedOut)
        #expect(viewModel.state == .failed(AppWords.Failure.signedOut))
    }
}

/// The run's routes through a stub, keeping the ETag each read named in the order asked (the manifest
/// first, then the board, the ADP and the capture) and how many came back unchanged.
actor CountingRun: RunAPI {
    let run: StubRun
    private(set) var asked: [(file: String, tag: String?)] = []
    private(set) var unchanged = 0

    init(_ run: StubRun) {
        self.run = run
    }

    /// The tags named, the manifest's first, then the others in the board's, the ADP's, the capture's order.
    var tags: [String?] {
        let order = ["manifest", "board", "adp", "designations", "clubs"]
        return asked.sorted { order.firstIndex(of: $0.file) ?? 0 < order.firstIndex(of: $1.file) ?? 0 }.map(\.tag)
    }

    func manifest(tag: String?) async throws -> RunRead<RunManifest> {
        try await count("manifest", tag, run.manifest(tag: tag))
    }

    func board(format: String, tag: String?) async throws -> RunRead<RunBoardAnswer> {
        try await count("board", tag, run.board(format: format, tag: tag))
    }

    func adpSources(tag: String?) async throws -> RunRead<[RunAdpSource]> {
        try await count("adp", tag, run.adpSources(tag: tag))
    }

    func designations(tag: String?) async throws -> RunRead<RunDesignations?> {
        try await count("designations", tag, run.designations(tag: tag))
    }

    func clubs(tag: String?) async throws -> RunRead<[RunClub]> {
        try await count("clubs", tag, run.clubs(tag: tag))
    }

    private func count<Value>(_ file: String, _ tag: String?, _ read: RunRead<Value>) -> RunRead<Value> {
        asked.append((file, tag))
        if case .unchanged = read {
            unchanged += 1
        }
        return read
    }
}
