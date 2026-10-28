import CommishAPI
@testable import CommishCore
import Foundation
import RunFixtures
import Testing

/// The player sheet's view model over the run's page routes and the fixture league's weeks: his card
/// as the shelf prints it in every read state; the league's week with a league, the public one without
/// or when the league's cannot answer; each run file's ETag named on the next open and a 304 keeping
/// the copy; the saved card with its stamp with no signal; a refused token signing out; and the sheet
/// keeping the player it opened on when the list under it reads again (plan Review Focus 3).
@MainActor
struct PlayerSheetViewModelTests {
    private let folder = FileManager.default.temporaryDirectory
        .appendingPathComponent("commish-sheet-tests-\(UUID().uuidString)")
    static let league = FollowedLeague(
        id: WeekFixture.league, name: "The fixture league", host: .init(value1: .ffpc), scoring: .ppr, format: .ppr,
        phase: nil, draftAt: nil, waiversOpen: true
    )

    static func player(_ id: String, slug: String, name: String) -> SheetPlayer {
        SheetPlayer(id: id, slug: slug, name: name, position: "WR", rank: "25", club: "CHI")
    }

    static let odunze = player("4431299", slug: "rome-odunze", name: "Rome Odunze")
    static let etienne = player("4239996", slug: "travis-etienne-jr", name: "Travis Etienne Jr.")
    static let dart = player("4689114", slug: "jaxson-dart", name: "Jaxson Dart")

    private func model(
        _ player: SheetPlayer, clock: String, pages: any RunPagesAPI = StubPages(.standIn),
        run: any RunAPI = StubRun(.standIn), weeks: (any PlayerWeekAPI)? = nil, league: FollowedLeague? = league,
        cache: (any AnswerCache)? = nil, onSignedOut: @escaping @MainActor () -> Void = {}
    ) -> PlayerSheetViewModel {
        PlayerSheetViewModel(
            player: player, run: run, pages: pages, weeks: weeks ?? FixtureWeeks(clock: clock),
            cache: cache ?? FileCache(folder: folder), clock: FixedClock(Fixtures.instant(clock)), league: league,
            zone: Fixtures.zone, onSignedOut: onSignedOut
        )
    }

    private func loaded(_ viewModel: PlayerSheetViewModel) -> (PlayerCard, Freshness)? {
        guard case let .loaded(card, freshness) = viewModel.state else {
            Issue.record("Expected his card, got \(viewModel.state)")
            return nil
        }
        return (card, freshness)
    }

    @Test func aWrittenReadStandsFromKickoffAndHisPtsTakeTheWeeksPlace() async throws {
        let viewModel = model(Self.odunze, clock: Fixtures.sunday)
        await viewModel.load()
        let (card, freshness) = try #require(loaded(viewModel))
        guard case let .shown(.written(body, caption)) = card.read else {
            Issue.record("a written read, got \(String(describing: card.read))")
            return
        }
        #expect(body.hasPrefix("Rome Odunze is questionable on Friday's report"))
        #expect(caption == "Written Sat Oct 17, 1:12 pm CT, for week 6")
        #expect(card.game == .kickedOff, "the line's field says it")
        #expect(card.tiles.first?.label == "Pts")
        #expect(card.head == CardHead(week: 6, opponent: "at ATL"))
        #expect(freshness.saved == nil)
        #expect(viewModel.stampWords == nil)
    }

    @Test func beforeKickoffHisStatusAndHisGameSay() async throws {
        let viewModel = model(Self.odunze, clock: Fixtures.week)
        await viewModel.load()
        let (card, _) = try #require(loaded(viewModel))
        #expect(card.status?.mark == "Questionable")
        #expect(card.cell?.when == "Sun 12:00 pm CT")
        #expect(card.tiles.map(\.value) == ["11.0", "199.2", "12th", "9.3", "5.0", "\u{2212}1.4"])
        // The projection moved since the read was written: the change tile says so and the read stands
        // (Lane 274).
        guard case let .shown(.written(body, _)) = card.read else {
            Issue.record("a written read, got \(String(describing: card.read))")
            return
        }
        #expect(body.hasPrefix("Rome Odunze is questionable on Friday's report"))
    }

    @Test func aReadWrittenBeforeHeWasDueBackStandsUnderTheStatusCaption() async throws {
        let viewModel = model(Self.etienne, clock: Fixtures.week)
        await viewModel.load()
        let (card, _) = try #require(loaded(viewModel))
        // Lane 274: the status caption goes over the kept read, never instead of it.
        guard case let .shown(.written(body, caption)) = card.read else {
            Issue.record("a written read, got \(String(describing: card.read))")
            return
        }
        #expect(body.hasPrefix("Travis Etienne Jr."))
        #expect(caption == "His status changed since this read was written. "
            + "A new read is due by Sat Oct 17, 1:00 pm CT.")
    }

    @Test func withNoReadWrittenThePlaceSaysSoAndAListedPlayersWeekIsHisList() async throws {
        let viewModel = model(Self.dart, clock: Fixtures.week)
        await viewModel.load()
        let (card, _) = try #require(loaded(viewModel))
        #expect(card.read == .none("Our read for his next game is not written yet."))
        #expect(card.status?.rank == "IR")
        #expect(card.tiles.filter { [.proj, .opp, .delta].contains($0.key) }.allSatisfy { $0.value == "--" })
    }

    @Test func withNoLeagueOrWhenTheLeaguesCannotAnswerThePublicWeekStands() async throws {
        let none = model(Self.odunze, clock: Fixtures.week, league: nil)
        await none.load()
        let (alone, _) = try #require(loaded(none))
        #expect(alone.basis.first?.contains("in PPR") == true, "the public week's scoring")
        let refused = FixtureWeeks(clock: Fixtures.week, leagueFails: true)
        let stood = model(Self.odunze, clock: Fixtures.week, weeks: refused)
        await stood.load()
        let (card, _) = try #require(loaded(stood))
        #expect(card.basis.first?.contains("in PPR") == true)
        #expect(await refused.asked == ["league", "public"])
    }

    @Test func theNextOpenNamesEveryKeptETagAndA304KeepsTheCopy() async throws {
        let cache = FileCache(folder: folder)
        let pages = CountingPages(StubPages(.standIn))
        let run = CountingRun(StubRun(.standIn))
        let first = model(Self.odunze, clock: Fixtures.week, pages: pages, run: run, cache: cache)
        await first.load()
        let (pagesRead, runRead) = await (pages.tags.count, run.asked.count)
        #expect(pagesRead == 2, "the index and his page")
        #expect(runRead == 2, "the manifest and the capture")
        #expect(await pages.tags.allSatisfy { $0 == nil }, "nothing kept, nothing named")
        #expect(await run.tags.allSatisfy { $0 == nil })
        let again = model(Self.odunze, clock: Fixtures.sunday, pages: pages, run: run, cache: cache)
        await again.load()
        #expect(await pages.tags.dropFirst(pagesRead).allSatisfy { $0 != nil }, "the index and his page by their ETags")
        #expect(
            await run.asked.dropFirst(runRead).allSatisfy { $0.tag != nil },
            "the manifest and the capture by theirs"
        )
        let (card, freshness) = try #require(loaded(again))
        #expect(card.tiles.first?.label == "Pts", "the copy kept, his week read again")
        #expect(freshness.stamp == Fixtures.instant(Fixtures.sunday), "a 304 refreshes the stamp")
    }

    @Test func withNoSignalTheSavedCardStandsWithItsStamp() async throws {
        let cache = FileCache(folder: folder)
        await model(Self.odunze, clock: Fixtures.week, cache: cache).load()
        let offline = model(
            Self.odunze, clock: Fixtures.sunday, pages: StubPages(.standIn, offline: true),
            run: StubRun(.standIn, offline: true), weeks: FixtureWeeks(clock: Fixtures.sunday, offline: true),
            cache: cache
        )
        await offline.load()
        let (card, freshness) = try #require(loaded(offline))
        #expect(freshness.saved == .offline)
        #expect(freshness.stamp == Fixtures.instant(Fixtures.week))
        #expect(offline.stampWords == "Last read Sat 12:00 pm")
        #expect(card.cell?.when == "Kicked off", "the saved line turns at kickoff by the clock")
    }

    @Test func withNoSignalAndNothingSavedTheWeekSaysItCouldNotBeRead() async {
        let viewModel = model(
            Self.odunze, clock: Fixtures.week, pages: StubPages(.standIn, offline: true),
            run: StubRun(.standIn, offline: true), weeks: FixtureWeeks(clock: Fixtures.week, offline: true)
        )
        await viewModel.load()
        #expect(viewModel.state == .failed(
            "Proj, Opp rank and Proj change show \"--\" because this week's figures could not be read just now."
        ))
    }

    @Test func aSlugTheIndexDoesNotNameKeepsHisWeeksCardByTheRowsBoardID() async throws {
        let player = SheetPlayer(
            id: "11620", slug: "not-a-page", name: "Rome Odunze", position: "WR", rank: "25", club: "CHI",
            boardID: "4431299"
        )
        let viewModel = model(player, clock: Fixtures.week)
        await viewModel.load()
        let (card, _) = try #require(loaded(viewModel))
        #expect(card.tiles.first?.value == "11.0", "his week")
        #expect(card.read == nil, "no page found, so no read drawn")
    }

    @Test func aRefusedTokenSignsOut() async {
        var signedOut = false
        let viewModel = model(
            Self.odunze, clock: Fixtures.week, weeks: FixtureWeeks(clock: Fixtures.week, refused: true), league: nil,
            onSignedOut: { signedOut = true }
        )
        await viewModel.load()
        #expect(signedOut)
        #expect(viewModel.state == .failed(AppWords.Failure.signedOut))
    }

    @Test func theSheetKeepsThePlayerItOpenedOnWhenTheListUnderItReadsAgain() async throws {
        let host = PlayerSheetHost()
        host.open(Self.odunze)
        let shown = try #require(host.shown)
        let viewModel = model(shown, clock: Fixtures.week)
        await viewModel.load()
        let before = viewModel.state
        // The list reads again: his row's fresh facts (another rank) and the others in a new order.
        let fresher = SheetPlayer(
            id: Self.odunze.id, slug: Self.odunze.slug, name: Self.odunze.name, position: "WR", rank: "24", club: "CHI"
        )
        host.parentRefreshed([Self.etienne, Self.dart, fresher])
        #expect(host.shown?.id == Self.odunze.id)
        #expect(host.shown?.rank == "24", "his fresh facts")
        #expect(viewModel.player.id == Self.odunze.id, "the sheet's player is the one it opened on")
        #expect(viewModel.state == before, "nothing read again under it")
        // A list that no longer has him keeps the sheet on him.
        host.parentRefreshed([Self.etienne, Self.dart])
        #expect(host.shown?.id == Self.odunze.id)
    }
}

/// The fixture league's weeks at a clock: the league's read, or the public read, failing as asked.
actor FixtureWeeks: PlayerWeekAPI {
    let clock: String
    let leagueFails: Bool
    let offline: Bool
    let refused: Bool
    private(set) var asked: [String] = []

    init(clock: String, leagueFails: Bool = false, offline: Bool = false, refused: Bool = false) {
        self.clock = clock
        self.leagueFails = leagueFails
        self.offline = offline
        self.refused = refused
    }

    func leagueWeek(league _: String, player: String) async throws -> PlayerWeek {
        asked.append("league")
        try fail()
        if leagueFails {
            throw APIError.envelope(code: "not_found", message: "Nothing here by that id")
        }
        return try WeekFixture.league(player, at: clock)
    }

    func publicWeek(player: String) async throws -> PlayerWeek {
        asked.append("public")
        try fail()
        // The fixture keeps the public week at the week's clock: a later clock reads the league's.
        return try (try? WeekFixture.publicWeek(player, at: clock)) ?? WeekFixture.league(player, at: clock)
    }

    private func fail() throws {
        if offline {
            throw URLError(.notConnectedToInternet)
        }
        if refused {
            throw APIError.status(401)
        }
    }
}

/// The page routes, counting the ETag each read named.
actor CountingPages: RunPagesAPI {
    let pages: StubPages
    private(set) var tags: [String?] = []

    init(_ pages: StubPages) {
        self.pages = pages
    }

    func index(tag: String?) async throws -> RunRead<[RunIndexEntry]> {
        tags.append(tag)
        return try await pages.index(tag: tag)
    }

    func page(id: String, tag: String?) async throws -> RunRead<RunPlayerAnswer> {
        tags.append(tag)
        return try await pages.page(id: id, tag: tag)
    }

    func held(tag: String?) async throws -> RunRead<[RunHeldPage]?> {
        tags.append(tag)
        return try await pages.held(tag: tag)
    }

    func heldCopy(id: String, tag: String?) async throws -> RunRead<RunPlayer> {
        tags.append(tag)
        return try await pages.heldCopy(id: id, tag: tag)
    }

    func schedule(tag: String?) async throws -> RunRead<RunSchedule> {
        tags.append(tag)
        return try await pages.schedule(tag: tag)
    }
}
