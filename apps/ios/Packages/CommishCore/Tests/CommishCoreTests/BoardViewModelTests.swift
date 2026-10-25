import CommishAPI
@testable import CommishCore
import Foundation
import HTTPTypes
import OpenAPIRuntime
import Testing

/// The Board's view model: each format's saved board at once and dated, then the API's (the board is
/// read with no signal, over the generated client and a throwing transport); the chips' choice kept
/// across the sheet opened from a row and a pull that reads again (plan Task D1); a format chip reads
/// its own board in the same view; a refused token signs out.
@MainActor
struct BoardViewModelTests {
    private let folder = FileManager.default.temporaryDirectory
        .appendingPathComponent("commish-board-tests-\(UUID().uuidString)")
    private static let base = URL(string: "http://localhost:8080")!
    static let saturday = Fixtures.instant(Fixtures.week)

    private func model(
        _ api: any BoardAPI, cache: (any AnswerCache)? = nil, clock: any Clock = FixedClock(saturday),
        onSignedOut: @escaping @MainActor () -> Void = {}
    ) -> BoardViewModel {
        BoardViewModel(
            api: api, cache: cache ?? FileCache(folder: folder), clock: clock, inSeason: false, following: false,
            zone: Fixtures.zone, onSignedOut: onSignedOut
        )
    }

    private func loaded(_ viewModel: BoardViewModel) -> (BoardModel, Bool)? {
        guard case let .loaded(model, _, stale) = viewModel.state else {
            Issue.record("Expected loaded, got \(viewModel.state)")
            return nil
        }
        return (model, stale)
    }

    @Test func theBoardReadsFreshAndIsSavedForNoSignal() async throws {
        let cache = FileCache(folder: folder)
        let viewModel = try model(BoardStub(boards: [.ppr: Fixtures.board()]), cache: cache)
        await viewModel.load()
        let (board, stale) = try #require(loaded(viewModel))
        #expect(!stale)
        #expect(viewModel.stampWords == nil)
        #expect(board.rows.first?.name == "Puka Nacua")
        let saved = await cache.read(RoomBoard.self, route: BoardViewModel.route(.ppr))
        #expect(saved?.stamp == Self.saturday)
    }

    @Test func withNoSignalTheSavedBoardShowsDatedThroughTheGeneratedClient() async throws {
        let cache = FileCache(folder: folder)
        try await cache.write(Fixtures.board(), route: BoardViewModel.route(.ppr), stamp: Self.saturday)
        let offline = APIClient(client: Client(
            serverURL: Self.base, transport: FailingTransport(URLError(.notConnectedToInternet))
        ))
        let viewModel = model(offline, cache: cache, clock: FixedClock(Self.saturday.addingTimeInterval(3600)))
        await viewModel.load()
        let (board, stale) = try #require(loaded(viewModel))
        #expect(stale)
        #expect(viewModel.stampWords == "Last read Sat 12:00 pm")
        #expect(board.rows.count > 300)
    }

    @Test func withNoSignalAndNothingSavedItSaysSoInWords() async {
        let offline = APIClient(client: Client(
            serverURL: Self.base, transport: FailingTransport(URLError(.notConnectedToInternet))
        ))
        let viewModel = model(offline)
        await viewModel.load()
        #expect(viewModel.state == .failed(AppWords.Failure.offline))
    }

    @Test func theChipsKeepTheirStateAcrossTheSheetAndAPullThatReadsAgain() async throws {
        let viewModel = try model(BoardStub(boards: [.ppr: Fixtures.board()]))
        await viewModel.load()
        viewModel.choose(position: .receiver)
        let (receivers, _) = try #require(loaded(viewModel))
        let sheet = PlayerSheetHost()
        let row = try #require(receivers.rows.dropFirst(3).first)
        try sheet.open(#require(row.sheetPlayer))
        // The pull under the open sheet reads the board again.
        await viewModel.load()
        let (again, _) = try #require(loaded(viewModel))
        sheet.parentRefreshed(again.rows.compactMap(\.sheetPlayer))
        sheet.close()
        #expect(viewModel.filter == BoardFilter(format: .ppr, position: .receiver))
        #expect(again.positions.filter(\.pressed).map(\.value) == [.receiver])
        #expect(again.rows.map(\.id) == receivers.rows.map(\.id))
        #expect(sheet.shown == nil)
    }

    @Test func theSheetKeepsItsPlayerWhenTheBoardReadsAgainUnderIt() async throws {
        let viewModel = try model(BoardStub(boards: [.ppr: Fixtures.board()]))
        await viewModel.load()
        viewModel.choose(position: .runningBack)
        let (backs, _) = try #require(loaded(viewModel))
        let player = try #require(backs.rows.first?.sheetPlayer)
        let sheet = PlayerSheetHost()
        sheet.open(player)
        viewModel.choose(position: .receiver)
        await viewModel.load()
        let (receivers, _) = try #require(loaded(viewModel))
        sheet.parentRefreshed(receivers.rows.compactMap(\.sheetPlayer))
        #expect(sheet.shown?.id == player.id)
    }

    @Test func aFormatChipReadsThatFormatsBoardInTheSameView() async throws {
        let stub = try BoardStub(boards: [.ppr: Fixtures.board()])
        let viewModel = model(stub)
        await viewModel.load()
        viewModel.choose(position: .tightEnd)
        await viewModel.choose(format: .half)
        #expect(viewModel.filter == BoardFilter(format: .half, position: .tightEnd))
        #expect(await stub.asked == [.ppr, .half])
        // The stub keeps no half-PPR board and nothing of it is saved: said in words, never PPR's rows.
        #expect(viewModel.state == .failed(AppWords.Failure.offline))
    }

    @Test func aFormatsSavedBoardNeverShowsUnderAnotherFormatsChip() async throws {
        let cache = FileCache(folder: folder)
        try await cache.write(Fixtures.board(), route: BoardViewModel.route(.ppr), stamp: Self.saturday)
        let viewModel = model(BoardStub(boards: [:]), cache: cache)
        await viewModel.load()
        #expect(viewModel.stampWords == "Last read Sat 12:00 pm")
        await viewModel.choose(format: .std)
        #expect(viewModel.state == .failed(AppWords.Failure.offline), "PPR's saved rows are not standard's")
        await viewModel.choose(format: .ppr)
        let (board, stale) = try #require(loaded(viewModel))
        #expect(stale)
        #expect(board.formats.filter(\.pressed).map(\.value) == [.ppr])
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

/// The board route as a stub answers it: the boards it keeps, no signal for any other format; it
/// records each format asked.
actor BoardStub: BoardAPI {
    let boards: [BoardFormat: RoomBoard]
    private(set) var asked: [BoardFormat] = []

    init(boards: [BoardFormat: RoomBoard]) {
        self.boards = boards
    }

    func board(format: BoardFormat) async throws -> RoomBoard {
        asked.append(format)
        guard let board = boards[format] else {
            throw URLError(.notConnectedToInternet)
        }
        return board
    }
}
