@testable import Board
import CommishAPI
import CommishCore
import CommishDesign
import CommishSnapshotSupport
import Foundation
import RunFixtures
import SwiftUI
import Testing

/// The Board's mock: the run through the view model at each run's clock, both themes, iPhone 17 Pro and
/// iPhone SE, at 1x. Before the draft, the stand-in's PPR board (shared/fixtures/standin-run): the top of
/// the All view, a position's view (WR) at its first tier and its cliff, a tier's cliff mid-list, a
/// kicker's view in the drafts' order, the defenses' (each face its club's chip, B245), and the WR
/// view's foot with the complete basis under its last rows. In season, the contract run
/// (shared/fixtures/run): the rest of the season's head with its weeks and the verb to follow a league,
/// and the same board saved and read with no signal, stale with its reason. At the order's clock (Lane
/// 224), the one-value stand-in (shared/fixtures/one-value-run) at the fixture's Sunday: the top rows
/// and the basis once the order the Rankings read has answered (its figures, its lead in the basis),
/// and while it is unread (the run's rows, the run's stamp). A face draws its initials here (a
/// snapshot loads no image). With SNAPSHOT_SHOTS set each is also written at its phone's own scale for
/// the persona panel.
@MainActor
struct BoardSnapshotTests {
    static let folder = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
        .appendingPathComponent("__Snapshots__")
    static let zone = TimeZone(identifier: "America/Chicago")!
    nonisolated static let preDraft = APIDecoding.parseDate("2026-09-01T17:00:00Z")!
    nonisolated static let inSeason = APIDecoding.parseDate("2026-10-22T17:00:00Z")!
    /// The player the missing scene puts on IR: the one-value stand-in's D'Andre Swift.
    nonisolated static let missing = (try? RankingsFixture.order("-all", at: OneValueFixture.clock))?.rows
        .first { $0.line.player.name == "D'Andre Swift" }?.line.player.boardId

    enum Scene: String, CaseIterable, Sendable {
        case top
        case position
        /// A tier's cliff mid-list: the last rows of one tier, the next tier's band and its first rows.
        case cliff
        case kicker
        /// The defenses in the drafts' order, each face its club's chip (B245).
        case defense
        /// The foot: the WR view's last rows and the basis under them.
        case foot
        /// In season: the rest of the season's head.
        case rest
        /// In season, saved and read with no signal.
        case stale
        /// In season at the order's clock: the top rows and the basis with the order's lead.
        case clock
        /// In season with the order unread: the run's top rows and the basis with the run's stamp.
        case clockUnread = "clock-unread"
        /// At the order's clock with a player put on IR after the nightly the run's capture does not
        /// list, as the API answers him (Lane 243, B251, fix round 1): his points and value kept, his row
        /// after every available player with the list's word in his pill, and no count line under the
        /// All view's foot.
        case clockMissing = "clock-missing"
        /// At the order's clock with an uncut answer that no longer returns a player the run holds, its
        /// statuses from a capture newer than the run's (Lane 280, B257): he is drawn from the run at the
        /// foot, the basis says once how many come from the run, and its status stamp is the order's.
        case clockFromRun = "clock-from-run"

        var position: BoardPosition? {
            switch self {
            case .position, .cliff, .foot: .receiver
            case .kicker: .kicker
            case .defense: .defense
            default: nil
            }
        }

        var inSeason: Bool {
            [.rest, .stale, .clock, .clockUnread, .clockMissing, .clockFromRun].contains(self)
        }

        /// The scenes at the order's clock, read or unread.
        var atClock: Bool {
            [.clock, .clockUnread, .clockMissing, .clockFromRun].contains(self)
        }

        var fixture: RunFixture {
            atClock ? .oneValue : inSeason ? .contract : .standIn
        }

        var now: Date {
            atClock ? OneValueFixture.now : inSeason ? BoardSnapshotTests.inSeason : BoardSnapshotTests.preDraft
        }

        /// The order's read at the Sunday clock, failing with no signal while unread; none elsewhere.
        var orders: OrderReader? {
            guard atClock else {
                return nil
            }
            return OrderReader(
                api: StubOrderSearch(
                    offline: self == .clockUnread, listing: self == .clockMissing ? BoardSnapshotTests.missing : nil,
                    omitting: self == .clockFromRun ? BoardSnapshotTests.missing : nil
                ),
                clock: FixedClock(now), memo: OrderMemo()
            )
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

    /// The view model at the scene's state: read fresh through the run's routes, or saved and then read
    /// with no signal.
    static func viewModel(_ scene: Scene) async throws -> BoardViewModel {
        let now = scene.now
        let cache = FileCache(folder: FileManager.default.temporaryDirectory
            .appendingPathComponent("board-snapshots-\(UUID().uuidString)"))
        if scene == .stale {
            let saved = BoardViewModel(
                api: StubRun(scene.fixture), cache: cache, clock: FixedClock(now), inSeason: true,
                following: false, zone: zone
            )
            await saved.load()
        }
        let viewModel = BoardViewModel(
            api: StubRun(scene.fixture, offline: scene == .stale), cache: cache,
            clock: FixedClock(now.addingTimeInterval(scene == .stale ? 1800 : 0)),
            inSeason: scene.inSeason, following: false, zone: zone, orders: scene.orders
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

    @Test func theCliffSceneShowsADropBetweenTwoTiers() async throws {
        let viewModel = try await Self.viewModel(.cliff)
        guard case let .loaded(model, _, _) = viewModel.state else {
            throw SceneError.notLoaded("cliff")
        }
        let shown = BoardMock.aroundCliff(model.sections)
        #expect(shown.count == 2)
        #expect(shown.first?.band?.drop != nil, "the tier above says its drop")
    }

    @Test func theClockScenesAreTheStatesTheyName() async throws {
        for scene in [Scene.clock, .clockUnread] {
            let viewModel = try await Self.viewModel(scene)
            guard case let .loaded(model, _, _) = viewModel.state else {
                throw SceneError.notLoaded(scene.rawValue)
            }
            #expect(model.atClock == (scene == .clock), "\(scene)")
            let format = try #require(RunFixture.oneValue.manifest().formats.first)
            let stamp = try #require(LiveOrderWords.runStamp(format, zone: Self.zone))
            #expect(model.basis.contains(stamp) == (scene == .clockUnread), "\(scene)")
        }
    }

    @Test func theMissingSceneDrawsHimAfterTheRankedRowsWithNoCount() async throws {
        let viewModel = try await Self.viewModel(.clockMissing)
        guard case let .loaded(model, _, _) = viewModel.state else {
            throw SceneError.notLoaded("clock-missing")
        }
        #expect(model.atClock)
        #expect(Self.missing != nil)
        let row = try #require(model.rows.first { $0.id == Self.missing })
        #expect(model.rows.suffix(BoardMock.around).contains(row), "the foot draws him")
        #expect(row.pill == "RB \(Words.DesignationRank.injured_reserve)")
        #expect(!model.basis.contains { $0.hasPrefix("The first") })
    }

    @Test func theFromRunSceneDrawsHimFromTheRunAndDatesTheStatusesByTheOrder() async throws {
        let viewModel = try await Self.viewModel(.clockFromRun)
        guard case let .loaded(model, _, _) = viewModel.state else {
            throw SceneError.notLoaded("clock-from-run")
        }
        #expect(model.atClock)
        #expect(model.rows.last?.id == Self.missing, "the foot draws him, from the run")
        #expect(model.basis.last == LiveOrderWords.fromRun(1))
        #expect(model.basis.contains("Status read Oct 18."), "\(model.basis)")
    }

    @Test func theStaleSceneSaysWhyItsBoardShows() async throws {
        let viewModel = try await Self.viewModel(.stale)
        #expect(viewModel.stampWords == "You're offline, so this is the last board this device saved, updated Oct 21.")
    }

    enum SceneError: Error {
        case notLoaded(String)
    }
}

/// The screen as the mock draws it. The phone's first screen is the room between the top bar and the
/// tab bar (the app draws both natively), the board's top with the verb pinned over its foot; mid-list
/// is the table alone around a tier's cliff; the foot the last rows over the basis.
struct BoardMock: View {
    let model: BoardModel
    let stamp: String?
    let scene: BoardSnapshotTests.Scene
    let device: SnapshotDevice

    /// Rows enough to fill the first screen of the tallest phone.
    static let firstRows = 12
    /// The rows drawn on each side of a tier's cliff, and above the basis.
    static let around = 4

    /// The status bar, the top bar and the tab bar the screen sits between, by phone.
    private var room: Double {
        device.height - (device.height > 700 ? 54 + 34 : 20) - 56 - 50
    }

    var body: some View {
        switch scene {
        case .cliff:
            BoardTableView(
                columns: model.columns, sections: Self.aroundCliff(model.sections), open: { _ in }, live: false
            )
            .padding(.vertical, Tokens.Space.s4)
        case .foot, .clockMissing, .clockFromRun:
            VStack(alignment: .leading, spacing: Tokens.Space.s4) {
                BoardTableView(columns: model.columns, sections: lastRows, open: { _ in }, live: false)
                BoardBasisView(lines: model.basis)
            }
            .padding(.vertical, Tokens.Space.s4)
        case .clock, .clockUnread:
            // The top of the board and its basis: the rows' clock and the words that name it, together.
            BoardScreen(model: model, stamp: stamp, actions: .none, sections: topRows, live: false)
        default:
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

    /// The sections the first screen reaches, their rows up to the tallest phone's first screen.
    private var firstScreen: [BoardSection] {
        var left = Self.firstRows
        return model.sections.compactMap { section in
            guard left > 0 else {
                return nil
            }
            let kept = Array(section.rows.prefix(left))
            left -= kept.count
            return section.with(rows: kept)
        }
    }

    /// The rows a clock scene draws over the basis.
    static let clockRows = 4

    /// The view's first rows, the basis under them.
    private var topRows: [BoardSection] {
        model.sections.prefix(1).map { $0.with(rows: Array($0.rows.prefix(Self.clockRows))) }
    }

    /// The last rows of the view, above its basis.
    private var lastRows: [BoardSection] {
        model.sections.suffix(1).map { $0.with(rows: Array($0.rows.suffix(Self.around))) }
    }

    /// The first tier from the fourth on whose band says its drop: its band and last rows, then the next
    /// tier's band and its first rows.
    static func aroundCliff(_ sections: [BoardSection]) -> [BoardSection] {
        let banded = sections.filter { $0.band != nil }
        let firstMidList = 3
        guard let index = banded.indices.dropFirst(firstMidList).first(where: {
            banded[$0].band?.drop != nil && banded.indices.contains($0 + 1)
        }) else {
            return []
        }
        let above = banded[index]
        let below = banded[index + 1]
        return [
            above.with(rows: Array(above.rows.suffix(around))),
            below.with(rows: Array(below.rows.prefix(around))),
        ]
    }
}
