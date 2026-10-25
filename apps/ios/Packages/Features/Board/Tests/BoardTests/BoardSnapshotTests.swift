@testable import Board
import CommishAPI
import CommishCore
import CommishDesign
import CommishSnapshotSupport
import Foundation
import SwiftUI
import Testing

/// The Board's mock: the API's PPR board (shared/fixtures/inseason/boards-ppr.json) through the view
/// model at the fixture's Saturday clock, both themes, iPhone 17 Pro and iPhone SE, at 1x. The phone's
/// first screen with the verb pinned: the PPR board at the top, a position view (WR), a kicker's view
/// in the drafts' order, the board in season as Rest of season with its verb to follow a league, and a
/// saved read with no signal, dated; mid-list, a position's last available players and the season-long
/// run under its head; and the foot, the last rows with the basis under them, the All view's and a
/// kicker's. A face draws its initials here (a snapshot loads no image). With SNAPSHOT_SHOTS set each is also written
/// at its phone's own
/// scale for the persona panel.
@MainActor
struct BoardSnapshotTests {
    static let folder = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
        .appendingPathComponent("__Snapshots__")
    static let fixture = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
        .appendingPathComponent("../../../../../../../shared/fixtures/inseason/boards-ppr.json").standardized
    static let zone = TimeZone(identifier: "America/Chicago")!
    static let saturday = APIDecoding.parseDate("2026-10-17T17:00:00Z")!

    enum Scene: String, CaseIterable, Sendable {
        case top
        case position
        case kicker
        case rest
        case stale
        case held
        /// The foot: the All view's last rows and the basis under them.
        case foot
        /// A kicker's view's foot with its own basis.
        case kickerFoot = "kicker-foot"

        var position: BoardPosition? {
            switch self {
            case .position: .receiver
            case .kicker, .kickerFoot: .kicker
            case .held: .runningBack
            default: nil
            }
        }
    }

    struct Case: Sendable {
        let scene: Scene
        let scheme: Scheme
        let device: SnapshotDevice
    }

    nonisolated static let cases: [Case] = Scene.allCases.flatMap { scene in
        [Scheme.light, .dark].flatMap { scheme in
            SnapshotDevice.screens.map { Case(scene: scene, scheme: scheme, device: $0) }
        }
    }

    static func board() throws -> RoomBoard {
        try APIDecoding.envelopeData(RoomBoard.self, from: Data(contentsOf: fixture))
    }

    /// The view model at the scene's state, through the stub: read fresh, or saved with no signal.
    static func viewModel(_ scene: Scene) async throws -> BoardViewModel {
        let board = try board()
        let cache = FileCache(folder: FileManager.default.temporaryDirectory
            .appendingPathComponent("board-snapshots-\(UUID().uuidString)"))
        if scene == .stale {
            await cache.write(board, route: BoardViewModel.route(.ppr), stamp: saturday)
        }
        let viewModel = BoardViewModel(
            api: StubBoard(board: scene == .stale ? nil : board), cache: cache,
            clock: FixedClock(saturday.addingTimeInterval(scene == .stale ? 1800 : 0)),
            inSeason: scene == .rest, following: false, zone: zone
        )
        await viewModel.load()
        viewModel.choose(position: scene.position)
        return viewModel
    }

    static func view(_ item: Case) async throws -> some View {
        let viewModel = try await viewModel(item.scene)
        guard case let .loaded(model, _, _) = viewModel.state else {
            throw SceneError.notLoaded(item.scene.rawValue)
        }
        return BoardMock(model: model, stamp: viewModel.stampWords, scene: item.scene, device: item.device)
    }

    @Test(arguments: 0 ..< cases.count)
    func board(index: Int) async throws {
        let item = Self.cases[index]
        let name = "board-\(item.scene.rawValue)-\(item.device.name)-\(item.scheme)"
        let view = try await Self.view(item)
        Snapshot.shoot(view, named: name, device: item.device, scheme: item.scheme)
        let result = Snapshot.verify(view, named: name, device: item.device, scheme: item.scheme, in: Self.folder)
        #expect(result.matches, "\(result.message)")
    }

    @Test func everyReferenceIsSmallEnoughToKeep() {
        #expect(Snapshot.oversized(in: Self.folder).isEmpty, "\(Snapshot.oversized(in: Self.folder))")
    }

    enum SceneError: Error {
        case notLoaded(String)
    }
}

/// The screen as the mock draws it. The phone's first screen is the room between the top bar and the
/// tab bar (the app draws both natively), the board's top with the verb pinned over its foot; mid-list
/// is the table alone around the season-long head.
struct BoardMock: View {
    let model: BoardModel
    let stamp: String?
    let scene: BoardSnapshotTests.Scene
    let device: SnapshotDevice

    /// Rows enough to fill the first screen of the tallest phone.
    static let firstRows = 12
    /// The available players drawn above the season-long head, and those on the list under it.
    static let aroundHead = 4

    /// The status bar, the top bar and the tab bar the screen sits between, by phone.
    private var room: Double {
        device.height - (device.height > 700 ? 54 + 34 : 20) - 56 - 50
    }

    var body: some View {
        if scene == .held {
            BoardTableView(columns: model.columns, sections: aroundHead, open: { _ in }, live: false)
                .padding(.vertical, Tokens.Space.s4)
        } else if scene == .foot || scene == .kickerFoot {
            VStack(alignment: .leading, spacing: Tokens.Space.s4) {
                BoardTableView(columns: model.columns, sections: lastRows, open: { _ in }, live: false)
                BoardBasisView(lines: model.basis)
            }
            .padding(.vertical, Tokens.Space.s4)
        } else {
            VStack(spacing: 0) {
                BoardScreen(model: model, stamp: stamp, actions: .none, sections: firstScreen, live: false)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(height: room - pinHeight, alignment: .top)
                    .clipped()
                if let verb = model.words.verb {
                    BoardPinView(verb: verb) {}
                }
            }
            .frame(height: room, alignment: .top)
        }
    }

    /// The pin's room: the verb and its padding.
    private var pinHeight: Double {
        model.words.verb == nil ? 0 : 64
    }

    private var firstScreen: [BoardSection] {
        model.sections.prefix(1).map { $0.with(rows: Array($0.rows.prefix(Self.firstRows))) }
    }

    /// The last rows of the view, above its basis.
    private var lastRows: [BoardSection] {
        model.sections.suffix(1).map { $0.with(rows: Array($0.rows.suffix(Self.aroundHead))) }
    }

    private var aroundHead: [BoardSection] {
        guard let available = model.sections.first, let held = model.sections.dropFirst().first else {
            return []
        }
        return [
            available.with(rows: Array(available.rows.suffix(Self.aroundHead))),
            held.with(rows: Array(held.rows.prefix(Self.aroundHead))),
        ]
    }
}

/// The board route as the fixture answers it, or no signal.
struct StubBoard: BoardAPI {
    let board: RoomBoard?

    func board(format _: BoardFormat) async throws -> RoomBoard {
        guard let board else {
            throw URLError(.notConnectedToInternet)
        }
        return board
    }
}
