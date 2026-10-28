import CommishAPI
import CommishCore
import CommishDesign
import CommishSnapshotSupport
import Foundation
@testable import Player
import RunFixtures
import Shell
import SwiftUI
import Testing

/// The player sheet's and page's mock: each drawn through its view model over the stand-in run's pages
/// and the fixture league's weeks at the fixture clocks, both themes, iPhone 17 Pro and iPhone SE, at 1x.
/// The sheet in the frame at both heights with a written read standing from kickoff (Odunze, Sunday),
/// no read written (Mahomes, Saturday) and a read held for his status (Etienne, Saturday), and once
/// saved and read with no signal; the page's hero and number, its prose, a held page with no copy, and
/// in season (the contract run) the week's read in the capsule's place; and at the order's clock (Lane
/// 224, the one-value stand-in at the fixture's Sunday) the hero and the every-format table once his
/// week has answered (the read's figures and its rank, the footnote naming the formats it does not
/// rank) and while it is unread (the run's). A face draws its initials here. With SNAPSHOT_SHOTS set
/// each is also written at its phone's own scale for the persona panel.
@MainActor
struct PlayerSnapshotTests {
    static let folder = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
        .appendingPathComponent("__Snapshots__")
    static let zone = TimeZone(identifier: "America/Chicago")!
    nonisolated static let week = "2026-10-17T17-00-00Z"
    nonisolated static let sunday = "2026-10-18T18-56-00Z"
    static let league = FollowedLeague(
        id: WeekFixture.league, name: "The fixture league", host: .init(value1: .ffpc), scoring: .ppr, format: .ppr,
        phase: nil, draftAt: nil, waiversOpen: true
    )

    enum Scene: String, CaseIterable, Sendable {
        case writtenMedium = "sheet-written-medium"
        case writtenLarge = "sheet-written-large"
        case unwrittenMedium = "sheet-unwritten-medium"
        case unwrittenLarge = "sheet-unwritten-large"
        case heldMedium = "sheet-held-medium"
        case heldLarge = "sheet-held-large"
        case staleMedium = "sheet-stale-medium"
        case pageHero = "page-hero"
        case pageProse = "page-prose"
        case pageHeld = "page-held"
        case pageSeason = "page-season"
        case pageLog = "page-log"
        case pageTier = "page-tier"
        /// The hero and the every-format table at the read's clock, and unread.
        case pageFormats = "page-formats"
        case pageFormatsUnread = "page-formats-unread"

        var sheet: SheetPlayer? {
            switch self {
            case .writtenMedium, .writtenLarge, .staleMedium:
                SheetPlayer(
                    id: "4431299",
                    slug: "rome-odunze",
                    name: "Rome Odunze",
                    position: "WR",
                    rank: "25",
                    club: "CHI"
                )
            case .unwrittenMedium, .unwrittenLarge:
                SheetPlayer(
                    id: "3139477",
                    slug: "patrick-mahomes",
                    name: "Patrick Mahomes",
                    position: "QB",
                    rank: "9",
                    club: "KC"
                )
            case .heldMedium, .heldLarge:
                SheetPlayer(
                    id: "4239996", slug: "travis-etienne-jr", name: "Travis Etienne Jr.", position: "RB", rank: "14",
                    club: "NO"
                )
            case .pageHero, .pageProse, .pageHeld, .pageSeason, .pageLog, .pageTier, .pageFormats,
                 .pageFormatsUnread:
                nil
            }
        }

        /// The screen's verb the sheet pins: the Lineup's way back with his swap (held once his game has
        /// kicked off), the Matchup's way to the lineup; none on a saved sheet.
        var offer: SheetOffer? {
            switch self {
            case .writtenMedium, .writtenLarge, .unwrittenMedium, .unwrittenLarge:
                SheetOffer(label: Words.Shelf.backToLineup, line: nil, lineup: true) {}
            case .heldMedium, .heldLarge:
                SheetOffer(label: Words.Card.openLineup, line: nil, lineup: true) {}
            default:
                nil
            }
        }

        /// The page scenes in season, from the contract run.
        var inSeason: Bool {
            self == .pageSeason || self == .pageTier
        }

        var clock: String {
            switch self {
            case .writtenMedium, .writtenLarge, .staleMedium: PlayerSnapshotTests.sunday
            default: PlayerSnapshotTests.week
            }
        }

        var large: Bool {
            [.writtenLarge, .unwrittenLarge, .heldLarge].contains(self)
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

    /// A fixture file's clock as its instant: `2026-10-18T18-56-00Z` as 18:56 UTC that day.
    static func instant(_ clock: String) -> Date {
        let text = clock.replacingOccurrences(
            of: #"T(\d\d)-(\d\d)-(\d\d)Z"#, with: "T$1:$2:$3Z", options: .regularExpression
        )
        guard let date = APIDecoding.parseDate(text) else {
            preconditionFailure("\(clock) is not a fixture clock.")
        }
        return date
    }

    static func cache() -> FileCache {
        FileCache(folder: FileManager.default.temporaryDirectory
            .appendingPathComponent("player-snapshots-\(UUID().uuidString)"))
    }

    /// The sheet's view model at the scene's state: read fresh, or saved and then read with no signal.
    static func sheet(_ scene: Scene, player: SheetPlayer) async -> PlayerSheetViewModel {
        let cache = cache()
        let clock = FixedClock(PlayerSnapshotTests.instant(scene.clock))
        if scene == .staleMedium {
            let saved = PlayerSheetViewModel(
                player: player, run: StubRun(.standIn), pages: StubPages(.standIn), weeks: Weeks(clock: week),
                cache: cache, clock: FixedClock(PlayerSnapshotTests.instant(week)), league: league, zone: zone
            )
            await saved.load()
        }
        let offline = scene == .staleMedium
        let viewModel = PlayerSheetViewModel(
            player: player, run: StubRun(.standIn, offline: offline), pages: StubPages(.standIn, offline: offline),
            weeks: Weeks(clock: scene.clock, offline: offline), cache: cache, clock: clock, league: league, zone: zone
        )
        await viewModel.load()
        return viewModel
    }

    static func page(_ scene: Scene) async -> PlayerPageViewModel {
        if scene == .pageFormats || scene == .pageFormatsUnread {
            let viewModel = PlayerPageViewModel(
                slug: "d-andre-swift", run: StubRun(.oneValue), pages: StubPages(.oneValue),
                weeks: StubOneValueWeeks(offline: scene == .pageFormatsUnread), cache: cache(),
                clock: FixedClock(OneValueFixture.now), league: nil, zone: zone
            )
            await viewModel.load()
            return viewModel
        }
        let season = scene.inSeason
        let fixture: RunFixture = season ? .contract : .standIn
        let held: [String: RunFixture?] = scene == .pageHeld ? ["4431299": nil] : [:]
        let viewModel = PlayerPageViewModel(
            slug: season ? "jahmyr-gibbs" : "rome-odunze", run: StubRun(fixture),
            pages: StubPages(fixture, held: held), weeks: Weeks(clock: week), cache: cache(),
            clock: FixedClock(PlayerSnapshotTests.instant(week)), league: league, zone: zone
        )
        await viewModel.load()
        return viewModel
    }

    static func view(_ item: Case) async throws -> AnyView {
        if let player = item.scene.sheet {
            let viewModel = await sheet(item.scene, player: player)
            return AnyView(SheetMock(
                player: player, state: viewModel.state, stamp: viewModel.stampWords, offer: item.scene.offer,
                device: item.device, large: item.scene.large
            ))
        }
        let viewModel = await page(item.scene)
        guard case let .loaded(model, _) = viewModel.state else {
            throw SceneError.notLoaded(item.scene.rawValue)
        }
        return AnyView(PageMock(model: model, scene: item.scene, device: item.device))
    }

    @Test(arguments: 0 ..< cases.count)
    func player(index: Int) async throws {
        let item = Self.cases[index]
        let name = "player-\(item.scene.rawValue)-\(item.device.name)-\(item.scheme)"
        let view = try await Self.view(item)
        Snapshot.shoot(view, named: name, device: item.device, scheme: item.scheme)
        let result = Snapshot.verify(view, named: name, device: item.device, scheme: item.scheme, in: Self.folder)
        #expect(result.matches, "\(result.message)")
    }

    @Test func everyReferenceIsSmallEnoughToKeep() {
        #expect(Snapshot.oversized(in: Self.folder).isEmpty, "\(Snapshot.oversized(in: Self.folder))")
    }

    @Test func eachSheetSceneIsTheStateItNames() async throws {
        for scene in [Scene.writtenMedium, .unwrittenMedium, .heldMedium, .staleMedium] {
            let player = try #require(scene.sheet)
            let viewModel = await Self.sheet(scene, player: player)
            guard case let .loaded(card, freshness) = viewModel.state else {
                Issue.record("\(scene.rawValue): \(viewModel.state)")
                continue
            }
            switch scene {
            case .writtenMedium:
                #expect(card.tiles.first?.label == "Pts")
                guard case .shown(.written) = card.read else {
                    Issue.record("a written read, got \(String(describing: card.read))")
                    continue
                }
            case .unwrittenMedium:
                #expect(card.read == .none("Our read for his next game is not written yet."))
            case .heldMedium:
                guard case let .shown(.written(_, caption)) = card.read else {
                    Issue.record("a read under the status caption, got \(String(describing: card.read))")
                    continue
                }
                #expect(caption == "His status changed since this read was written. "
                    + "A new read is due by Sat Oct 17, 1:00 pm CT.")
            default:
                #expect(freshness.saved == .offline)
                #expect(viewModel.stampWords == "Last read Sat 12:00 pm")
            }
        }
    }

    @Test func theFormatsScenesAreTheStatesTheyName() async throws {
        for scene in [Scene.pageFormats, .pageFormatsUnread] {
            let viewModel = await Self.page(scene)
            guard case let .loaded(model, _) = viewModel.state else {
                throw SceneError.notLoaded(scene.rawValue)
            }
            let table = try #require(model.formats)
            #expect((table.footnote != nil) == (scene == .pageFormats), "\(scene)")
        }
    }

    enum SceneError: Error {
        case notLoaded(String)
    }
}

/// The sheet over a dimmed screen at one of its two heights, as Lane 177's mock draws the frame: half
/// the phone's screen (medium), or all of it under the status bar (large); its body the sheet's state.
struct SheetMock: View {
    @Environment(\.colorScheme) private var colorScheme
    let player: SheetPlayer
    let state: PlayerSheetViewModel.State
    let stamp: String?
    let offer: SheetOffer?
    let device: SnapshotDevice
    let large: Bool

    /// The status bar's room above a large sheet: the notch phone's and the home-button phone's.
    private var top: Double {
        device.height > 700 ? 72 : 30
    }

    var body: some View {
        let theme = Theme(colorScheme)
        let height = large ? device.height - top : device.height / 2
        VStack(spacing: 0) {
            Color.black.opacity(colorScheme == .dark ? 0.6 : 0.3)
            VStack(spacing: 0) {
                Capsule().fill(theme.color(Tokens.Color.lineStrong)).frame(width: 36, height: 5).padding(.top, 5)
                PlayerSheetView(
                    model: PlayerSheetModel(player: player), close: {},
                    content: { PlayerSheetState(state: state, stamp: stamp) }
                )
                .frame(maxHeight: .infinity, alignment: .top)
                .clipped()
                if let verb = SheetVerb.of(offer, game: PlayerSheetBody.game(state)) {
                    SheetVerbView(verb: verb) {}.padding(.horizontal, Tokens.Space.s4)
                }
            }
            .frame(height: height, alignment: .top)
            .clipped()
            .background(theme.color(Tokens.Color.bg))
            .clipShape(UnevenRoundedRectangle(topLeadingRadius: 12, topTrailingRadius: 12))
        }
        .frame(height: device.height)
    }
}

/// The page as the mock draws it, from the screen's own parts (PlayerPageScreen draws PageSectionsView
/// under the pinned verb): its first screen between the top bar and the tab bar with the verb pinned over
/// its foot (before the season, a held page, in season); and further down as it scrolls into view, the
/// season block, the read, and the tier box with the every-format table and the basis.
struct PageMock: View {
    let model: PlayerPageModel
    let scene: PlayerSnapshotTests.Scene
    let device: SnapshotDevice

    /// The pin's room: the verb and its padding.
    static let pinHeight: Double = 64

    /// The status bar, the top bar and the tab bar the screen sits between, by phone.
    private var room: Double {
        device.height - (device.height > 700 ? 54 + 34 : 20) - 56 - 50
    }

    var body: some View {
        switch scene {
        case .pageProse:
            model.read.map { PageRead(read: $0).padding(Tokens.Space.s4) }
        case .pageLog:
            SeasonBlock(season: model.season).padding(Tokens.Space.s4)
        case .pageFormats, .pageFormatsUnread:
            VStack(alignment: .leading, spacing: Tokens.Space.s5) {
                PageHero(hero: model.hero, stamp: nil)
                if let formats = model.formats {
                    FormatsTableView(table: formats)
                }
            }
            .padding(Tokens.Space.s4)
        case .pageTier:
            VStack(alignment: .leading, spacing: Tokens.Space.s5) {
                if let tier = model.tier {
                    TierBoxView(box: tier)
                }
                if let formats = model.formats {
                    FormatsTableView(table: formats)
                }
                PageFoot(model: model)
            }
            .padding(Tokens.Space.s4)
        default:
            VStack(spacing: 0) {
                PageSectionsView(model: model, stamp: nil)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(height: room - (model.verb == nil ? 0 : Self.pinHeight), alignment: .top)
                    .clipped()
                if let verb = model.verb {
                    PinnedVerb(verb: verb) {}
                }
            }
            .frame(height: room, alignment: .top)
        }
    }
}

/// The fixture league's weeks at a clock, the public read standing in where the fixture keeps none.
struct Weeks: PlayerWeekAPI {
    let clock: String
    var offline = false

    func leagueWeek(league _: String, player: String) async throws -> PlayerWeek {
        if offline {
            throw URLError(.notConnectedToInternet)
        }
        return try WeekFixture.league(player, at: clock)
    }

    func publicWeek(player: String) async throws -> PlayerWeek {
        if offline {
            throw URLError(.notConnectedToInternet)
        }
        return try WeekFixture.publicWeek(player, at: clock)
    }
}
