import CommishAPI
import CommishCore
import CommishDesign
import CommishSnapshotSupport
import Foundation
@testable import Reference
import RunFixtures
import SwiftUI
import Testing

/// The reference screens' mock: each through its view model over a fixture run at the run's clock, both
/// themes, iPhone 17 Pro and iPhone SE, at 1x. Before the draft, the stand-in (shared/fixtures/standin-run):
/// ADP's top with the Gap, Compare with two players and its call, the clubs index, a club's page (CIN)
/// and the first rows of the strength of schedule. In season, the contract run (shared/fixtures/run): ADP
/// with the run's three format chips and no Gap, Compare with one side a slug the run does not name, the
/// schedule's rest of season grid with its played weeks set back, and ADP saved and read with no signal,
/// stale with its reason. At the order's clock (Lane 224), the one-value stand-in
/// (shared/fixtures/one-value-run) at the fixture's Sunday: a club's hero, basis and players (CHI) and
/// Compare with Swift and Washington, each once the order the Rankings read has answered and while it is
/// unread. Game day (Lane 232, B224, the web's Lane 223): a club in season whose bye is played (KC,
/// its code alone, week 6's states after the opponents and the run's read under them), Compare's Bye row
/// with both byes ahead, one played, and both played (the row gone, the run's clubs read with both
/// byes before week 7), and the grid opening on week 6 as read on its Sunday morning (the Thursday game
/// Final, every other game still to come, each saying its kickoff). A face draws its initials (a
/// snapshot loads no image). With SNAPSHOT_SHOTS set each is also written at its phone's own scale for
/// the persona panel.
@MainActor
struct ReferenceSnapshotTests {
    static let folder = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
        .appendingPathComponent("__Snapshots__")
    static let zone = TimeZone(identifier: "America/Chicago")!
    nonisolated static let preDraft = APIDecoding.parseDate("2026-09-01T17:00:00Z")!
    nonisolated static let inSeason = APIDecoding.parseDate("2026-10-22T17:00:00Z")!

    enum Scene: String, CaseIterable, Sendable {
        case adpTop = "adp-top"
        case adpInSeason = "adp-inseason"
        case compareTwo = "compare-two"
        case compareAbsent = "compare-absent"
        case clubs
        case club
        case schedule
        case stale
        /// A club's players at the order's clock, and with the order unread.
        case clubClock = "club-clock"
        case clubUnread = "club-clock-unread"
        /// Compare's pair at the order's clock, and with the order unread.
        case compareClock = "compare-clock"
        case compareUnread = "compare-clock-unread"
        /// Game day: a club whose bye is played, Compare's Bye row in its three states, upcoming games.
        case clubInSeason = "club-inseason"
        case compareByeAhead = "compare-bye-ahead"
        case compareByePlayed = "compare-bye-played"
        case compareByeGone = "compare-bye-gone"
        case scheduleUpcoming = "schedule-upcoming"

        var inSeason: Bool {
            [
                .adpInSeason, .compareAbsent, .schedule, .stale, .clubInSeason, .compareByeAhead, .compareByePlayed,
                .compareByeGone, .scheduleUpcoming,
            ].contains(self)
        }

        /// The scenes over the one-value stand-in, read or unread.
        var atClock: Bool {
            [.clubClock, .clubUnread, .compareClock, .compareUnread].contains(self)
        }

        var fixture: RunFixture {
            atClock ? .oneValue : inSeason ? .contract : .standIn
        }

        var now: Date {
            atClock ? OneValueFixture.now : inSeason ? ReferenceSnapshotTests.inSeason : ReferenceSnapshotTests.preDraft
        }

        /// The order's read at the Sunday clock, failing with no signal while unread; none elsewhere.
        var orders: OrderReader? {
            guard atClock else {
                return nil
            }
            return OrderReader(
                api: StubOrderSearch(offline: self == .clubUnread || self == .compareUnread),
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

    static func cache() -> FileCache {
        FileCache(folder: FileManager.default.temporaryDirectory
            .appendingPathComponent("reference-snapshots-\(UUID().uuidString)"))
    }

    /// A view model's screen once read.
    static func loaded<Model>(_ viewModel: RunScreenViewModel<Model>) async throws -> Model {
        await viewModel.load()
        guard case let .loaded(model, _) = viewModel.state else {
            throw SceneError.notLoaded("\(viewModel.state)")
        }
        return model
    }

    static func adp(_ scene: Scene) async throws -> (AdpModel, String?) {
        let cache = cache()
        if scene == .stale {
            _ = try await loaded(RunScreenViewModel.adp(
                format: nil, run: StubRun(scene.fixture), pages: StubPages(scene.fixture), cache: cache,
                clock: FixedClock(scene.now), zone: zone
            ))
        }
        let offline = scene == .stale
        let viewModel = RunScreenViewModel.adp(
            format: nil, run: StubRun(scene.fixture, offline: offline),
            pages: StubPages(scene.fixture, offline: offline), cache: cache,
            clock: FixedClock(scene.now.addingTimeInterval(offline ? 1800 : 0)), zone: zone
        )
        return try await (loaded(viewModel), viewModel.stampWords)
    }

    static func compare(_ scene: Scene) async throws -> CompareModel {
        let slugs: (String?, String?) = switch scene {
        case .compareTwo: ("ja-marr-chase", "rome-odunze")
        case .compareClock, .compareUnread: ("d-andre-swift", "parker-washington")
        case .compareByeAhead, .compareByeGone: ("josh-allen", "josh-jacobs")
        case .compareByePlayed: ("josh-allen", "jahmyr-gibbs")
        default: ("jahmyr-gibbs", "nobody")
        }
        let run: any RunAPI = scene == .compareByeGone
            ? PlayedByes(base: StubRun(scene.fixture), clubs: ["BUF": 5, "GB": 6]) : StubRun(scene.fixture)
        return try await loaded(RunScreenViewModel.compare(
            slugs: [slugs.0, slugs.1], run: run, pages: StubPages(scene.fixture),
            cache: cache(), clock: FixedClock(scene.now), zone: zone, orders: scene.orders
        ))
    }

    /// The club the clock scenes draw: Chicago, Swift's.
    static func clockClub(_ scene: Scene) async throws -> ClubPageModel {
        try await loaded(RunScreenViewModel.club(
            "chi", run: StubRun(scene.fixture), pages: StubPages(scene.fixture), cache: cache(),
            clock: FixedClock(scene.now), zone: zone, orders: scene.orders
        ))
    }

    @ViewBuilder
    static func screen(_ scene: Scene) async throws -> some View {
        let run = StubRun(scene.fixture)
        let pages = StubPages(scene.fixture)
        let clock = FixedClock(scene.now)
        switch scene {
        case .adpTop, .adpInSeason, .stale:
            let (model, stamp) = try await adp(scene)
            AdpScreen(
                model: model, stamp: stamp, actions: .none, format: { _ in }, rows: Array(model.rows.prefix(12)),
                live: false
            )
        case .compareTwo, .compareAbsent, .compareClock, .compareUnread, .compareByeAhead, .compareByePlayed,
             .compareByeGone:
            try await CompareScreen(model: compare(scene), stamp: nil, actions: .none, live: false)
        case .clubInSeason:
            let model = try await loaded(RunScreenViewModel.club(
                "kc", run: run, pages: pages, cache: cache(), clock: clock, zone: zone
            ))
            ClubScreen(model: model, stamp: nil, actions: .none, parts: [.hero, .board, .schedule])
        case .clubClock, .clubUnread:
            try await ClubScreen(model: clockClub(scene), stamp: nil, actions: .none, parts: [.hero, .board])
        case .clubs:
            let model = try await loaded(RunScreenViewModel.clubs(
                run: run, pages: pages, cache: cache(), clock: clock, zone: zone
            ))
            ClubsScreen(model: model, stamp: nil, actions: .none, clubs: Array(model.clubs.prefix(4)))
        case .club:
            let model = try await loaded(RunScreenViewModel.club(
                "cin", run: run, pages: pages, cache: cache(), clock: clock, zone: zone
            ))
            ClubScreen(model: model, stamp: nil, actions: .none)
        case .schedule, .scheduleUpcoming:
            let model = try await loaded(RunScreenViewModel.schedule(
                run: run, pages: scene == .scheduleUpcoming ? UpcomingWeek(base: pages) : pages, cache: cache(),
                clock: clock, zone: zone
            ))
            ScheduleScreen(
                model: model,
                stamp: nil,
                actions: .none,
                rows: Array(model.grid.rows.prefix(10)),
                live: false
            )
        }
    }

    @Test(arguments: 0 ..< cases.count)
    func reference(index: Int) async throws {
        let item = Self.cases[index]
        let name = "reference-\(item.scene.rawValue)-\(item.device.name)-\(item.scheme)"
        let view = try await Self.screen(item.scene)
        Snapshot.shoot(view, named: name, device: item.device, scheme: item.scheme)
        let result = Snapshot.verify(view, named: name, device: item.device, scheme: item.scheme, in: Self.folder)
        #expect(result.matches, "\(result.message)")
    }

    @Test func everyReferenceIsSmallEnoughToKeep() {
        #expect(Snapshot.oversized(in: Self.folder).isEmpty, "\(Snapshot.oversized(in: Self.folder))")
    }

    @Test func theTopOfAdpCarriesAGapRow() async throws {
        let (model, _) = try await Self.adp(.adpTop)
        #expect(model.gap)
        #expect(model.rows.prefix(12).contains { $0.row.gapTone != nil })
    }

    @Test func theStaleSceneSaysWhyItsScreenShows() async throws {
        let (_, stamp) = try await Self.adp(.stale)
        #expect(stamp == "You're offline, so this is the last board this device saved, updated Oct 21.")
    }

    @Test func theClockScenesAreTheStatesTheyName() async throws {
        for scene in [Scene.clubClock, .clubUnread] {
            let model = try await Self.clockClub(scene)
            #expect(model.atClock == (scene == .clubClock), "\(scene)")
            // The head names the rows' basis: the order's once its rows stand, the run's board before.
            let head = scene == .clubClock ? Words.ClubOrder.onOrder : "On our PPR board"
            #expect(model.boardHead == head, "\(scene)")
            #expect(model.boardLabel == "\(model.name), \(head)", "\(scene)")
        }
        for scene in [Scene.compareClock, .compareUnread] {
            let model = try await Self.compare(scene)
            #expect(model.atClock == (scene == .compareClock), "\(scene)")
        }
    }

    @Test func theGameDayScenesAreTheStatesTheyName() async throws {
        let byeRow = { (scene: Scene) async throws -> [String]? in
            guard case let .table(table) = try await Self.compare(scene).outcome else {
                return nil
            }
            return table.rows.first { $0.label == Words.Board.bye }?.cells.map(\.text)
        }
        #expect(try await byeRow(.compareByeAhead) == ["7", "11"])
        #expect(try await byeRow(.compareByePlayed)?.contains("") == true)
        #expect(try await byeRow(.compareByeGone) == nil)
        let club = try await Self.loaded(RunScreenViewModel.club(
            "kc", run: StubRun(.contract), pages: StubPages(.contract), cache: Self.cache(),
            clock: FixedClock(Self.inSeason), zone: Self.zone
        ))
        #expect(club.meta == "KC")
        #expect(club.asOf == "Week 6's games as of Wed Oct 21, 7:00 am Central.")
        #expect(club.games.contains { $0.state == Words.Kickoff.kickedOff })
        let upcoming = try await Self.loaded(RunScreenViewModel.schedule(
            run: StubRun(.contract), pages: UpcomingWeek(base: StubPages(.contract)), cache: Self.cache(),
            clock: FixedClock(Self.inSeason), zone: Self.zone
        ))
        let words = Set(upcoming.grid.rows.flatMap(\.cells).compactMap(\.state))
        #expect(upcoming.grid.current == 6)
        #expect(words.contains(Words.Kickoff.final))
        #expect(words.contains { $0.hasSuffix(" CT") })
        // The current week's column holds its longest kickoff whole with its zone.
        let widest = words.map(GridSize.measured).max() ?? 0
        #expect(GridSize.width(6, in: upcoming.grid, rows: upcoming.grid.rows) >= widest + 2 * Tokens.Space.s2)
        #expect(GridSize.width(5, in: upcoming.grid, rows: upcoming.grid.rows) == GridSize.week)
    }

    @Test func theAbsentSceneSaysTheWebsWordsOverItsSearch() async throws {
        let model = try await Self.compare(.compareAbsent)
        #expect(model.slots == [model.slots[0], .missing])
        #expect(model.slots[0].picked)
    }

    enum SceneError: Error {
        case notLoaded(String)
    }
}

extension RunRead {
    /// A fresh read's value changed, an unchanged read as it is.
    func mapped(_ change: (Value) -> Value) -> RunRead<Value> {
        switch self {
        case let .fresh(value, tag): .fresh(change(value), tag: tag)
        case .unchanged: self
        }
    }
}

/// The run's clubs with some byes set (a club's abbreviation to its week), every other route the run's:
/// Compare's Bye row with both byes played, which the fixture's four players cannot draw.
struct PlayedByes: RunAPI {
    let base: StubRun
    let clubs: [String: Int]

    func manifest(tag: String?) async throws -> RunRead<RunManifest> {
        try await base.manifest(tag: tag)
    }

    func board(format: String, tag: String?) async throws -> RunRead<RunBoardAnswer> {
        try await base.board(format: format, tag: tag)
    }

    func adpSources(tag: String?) async throws -> RunRead<[RunAdpSource]> {
        try await base.adpSources(tag: tag)
    }

    func designations(tag: String?) async throws -> RunRead<RunDesignations?> {
        try await base.designations(tag: tag)
    }

    func clubs(tag: String?) async throws -> RunRead<[RunClub]> {
        let byes = clubs
        return try await base.clubs(tag: tag).mapped { clubs in
            clubs.map { club in
                var club = club
                club.bye = byes[club.abbr] ?? club.bye
                return club
            }
        }
    }
}

/// The run's pages with its schedule's current week read as on its Sunday morning: the Thursday game
/// Final, every game that had kicked off still to come, so each cell says its kickoff (Lane 231's
/// schedule-upcoming scene).
struct UpcomingWeek: RunPagesAPI {
    let base: StubPages
    static let week = 6

    func index(tag: String?) async throws -> RunRead<[RunIndexEntry]> {
        try await base.index(tag: tag)
    }

    func page(id: String, tag: String?) async throws -> RunRead<RunPlayerAnswer> {
        try await base.page(id: id, tag: tag)
    }

    func held(tag: String?) async throws -> RunRead<[RunHeldPage]?> {
        try await base.held(tag: tag)
    }

    func heldCopy(id: String, tag: String?) async throws -> RunRead<RunPlayer> {
        try await base.heldCopy(id: id, tag: tag)
    }

    func schedule(tag: String?) async throws -> RunRead<RunSchedule> {
        try await base.schedule(tag: tag).mapped { schedule in
            var schedule = schedule
            schedule.slates = schedule.slates.map { slate in
                var slate = slate
                slate.games = slate.games.map { game in
                    guard game.week == Self.week, game.state?.value1 == .kickedOff else {
                        return game
                    }
                    var game = game
                    game.state = .init(value1: .upcoming, value2: "upcoming")
                    return game
                }
                return slate
            }
            return schedule
        }
    }
}
