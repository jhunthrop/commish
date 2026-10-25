import CommishAPI
@testable import CommishCore
import CommishDesign
import Foundation
import HTTPTypes
import OpenAPIRuntime
import RunFixtures
import Testing

/// The reference screens' view models over the run's routes: each file read once with no ETag, then
/// named with the ETag kept and answered 304, the screen shown from the kept copies; with no signal the
/// saved files show, stale with their stamp and reason; ADP's format chip; Compare in the followed
/// league's format, with the web's absent words for a slug the run does not name and a page it cannot
/// give, and its first steps while a side is empty; a club the run lacks; a refused token signs out.
@MainActor
struct ReferenceViewModelTests {
    private let folder = FileManager.default.temporaryDirectory
        .appendingPathComponent("commish-reference-tests-\(UUID().uuidString)")
    static let now = APIDecoding.parseDate("2026-10-22T17:00:00Z")!
    private static let base = URL(string: "http://localhost:8080")!

    private func cache() -> FileCache {
        FileCache(folder: folder)
    }

    private func loaded<Model>(_ viewModel: RunScreenViewModel<Model>) -> (Model, Freshness)? {
        guard case let .loaded(model, freshness) = viewModel.state else {
            Issue.record("Expected loaded, got \(viewModel.state)")
            return nil
        }
        return (model, freshness)
    }

    private static func league(format: Components.Schemas.BoardFormatKnown?) -> FollowedLeague {
        FollowedLeague(
            id: "league", name: "League", host: .init(value1: .sleeper), scoring: nil, format: format, phase: nil,
            draftAt: nil,
            waiversOpen: false
        )
    }

    @Test func adpReadsTheRunOnceThenNamesEachETagAndKeepsItsCopy() async throws {
        let cache = cache()
        let run = CountingRun(StubRun(.contract))
        let first = RunScreenViewModel.adp(
            format: nil, run: run, pages: StubPages(.contract), cache: cache, clock: FixedClock(Self.now),
            zone: Fixtures.zone
        )
        await first.load()
        let (model, freshness) = try #require(loaded(first))
        #expect(freshness.saved == nil)
        #expect(first.stampWords == nil)
        #expect(model.heading == "2026 ADP")
        #expect(model.format == "ppr-12")
        #expect(model.rows.first?.row.name == "Jahmyr Gibbs")
        #expect(await run.unchanged == 0)
        let again = RunScreenViewModel.adp(
            format: nil, run: run, pages: StubPages(.contract), cache: cache, clock: FixedClock(Self.now + 60),
            zone: Fixtures.zone
        )
        await again.load()
        #expect(try #require(loaded(again)).0 == model)
        #expect(await run.unchanged == 5, "manifest, board, ADP, capture and clubs each a 304")
    }

    @Test func withNoSignalTheSavedScreenShowsStaleWithItsReason() async throws {
        let cache = cache()
        let online = RunScreenViewModel.schedule(
            run: StubRun(.contract), pages: StubPages(.contract), cache: cache, clock: FixedClock(Self.now),
            zone: Fixtures.zone
        )
        await online.load()
        let fresh = try #require(loaded(online)).0
        let offline = RunScreenViewModel.schedule(
            run: StubRun(.contract, offline: true), pages: StubPages(.contract, offline: true), cache: cache,
            clock: FixedClock(Self.now + 1800), zone: Fixtures.zone
        )
        await offline.load()
        let (saved, freshness) = try #require(loaded(offline))
        #expect(saved == fresh)
        #expect(freshness.saved == .offline)
        #expect(freshness.stamp == Self.now)
        #expect(offline.stampWords == "You're offline, so this is the last board this device saved, updated Oct 21.")
    }

    @Test func withNothingSavedAndNoSignalTheScreenSaysSo() async {
        let viewModel = RunScreenViewModel.clubs(
            run: StubRun(.contract, offline: true), pages: StubPages(.contract, offline: true), cache: cache(),
            clock: FixedClock(Self.now), zone: Fixtures.zone
        )
        await viewModel.load()
        #expect(viewModel.state == .failed(AppWords.Failure.offline))
    }

    @Test func adpsFormatChipReadsThatFormatsBoard() async throws {
        let viewModel = RunScreenViewModel.adp(
            format: nil, run: StubRun(.contract), pages: StubPages(.contract), cache: cache(),
            clock: FixedClock(Self.now), zone: Fixtures.zone
        )
        await viewModel.load()
        #expect(try #require(loaded(viewModel)).0.formats.map(\.label) == ["PPR", "Half PPR", "Standard"])
        // The contract run lists three formats and carries PPR's board alone: Half PPR is not read, and
        // PPR's rows never show under its chip.
        await viewModel.choose(format: "half-ppr-12")
        guard case .failed = viewModel.state else {
            Issue.record("expected the half PPR board to fail, got \(viewModel.state)")
            return
        }
    }

    @Test func compareOpensInTheFollowedLeaguesFormatWhereTheRunCarriesIt() async throws {
        let viewModel = RunScreenViewModel.compare(
            slugs: ["jahmyr-gibbs", "josh-allen"], league: Self.league(format: .halfPpr), run: StubRun(.contract),
            pages: StubPages(.contract), cache: cache(), clock: FixedClock(Self.now), zone: Fixtures.zone
        )
        await viewModel.load()
        let model = try #require(loaded(viewModel)).0
        #expect(model.format == "half-ppr-12")
        #expect(model.formats.filter(\.pressed).map(\.value) == ["half-ppr-12"])
        guard case let .table(table) = model.outcome else {
            Issue.record("expected the call")
            return
        }
        #expect(table.call == "We would take Gibbs")
        #expect(table.basis.first?.hasPrefix("Our Half PPR board") == true)
        // A league on a board the run does not carry opens in the run's default.
        let other = RunScreenViewModel.compare(
            slugs: ["jahmyr-gibbs", nil], league: Self.league(format: .superflex), run: StubRun(.contract),
            pages: StubPages(.contract), cache: cache(), clock: FixedClock(Self.now), zone: Fixtures.zone
        )
        await other.load()
        let one = try #require(loaded(other)).0
        #expect(one.format == "ppr-12")
        #expect(one.lead == "Pick a second player to set beside the first.")
        #expect(one.slots == [
            .picked(name: "Jahmyr Gibbs", initials: "JG", headshot: one.slots[0].headshotURL), .open,
        ])
    }

    @Test func aSlugTheRunDoesNotNameShowsTheWebsAbsentWordsNeverABlankColumn() async throws {
        let viewModel = RunScreenViewModel.compare(
            slugs: ["jahmyr-gibbs", "nobody-at-all"], league: nil, run: StubRun(.contract), pages: StubPages(.contract),
            cache: cache(), clock: FixedClock(Self.now), zone: Fixtures.zone
        )
        await viewModel.load()
        let model = try #require(loaded(viewModel)).0
        #expect(model.slots[1] == .missing)
        #expect(model.outcome == .none, "no table with one side")
        #expect(model.lead == "Pick a second player to set beside the first.")
        #expect(Words.ComparePage.missingTitle == "We couldn't find that player")
    }

    @Test func aPageTheRunCannotGiveShowsTheAbsentWordsToo() async throws {
        // The index names him, but his page is gone and the run held none: the route answers 404.
        let pages = MissingPage(StubPages(.contract), id: "4429795")
        let viewModel = RunScreenViewModel.compare(
            slugs: ["jahmyr-gibbs", "josh-allen"], league: nil, run: StubRun(.contract), pages: pages, cache: cache(),
            clock: FixedClock(Self.now), zone: Fixtures.zone
        )
        await viewModel.load()
        let model = try #require(loaded(viewModel)).0
        #expect(model.slots[0] == .missing)
        #expect(model.slots[1].picked)
        #expect(model.outcome == .none)
    }

    @Test func pickingAndClearingASideRebuildsTheTable() async throws {
        let viewModel = RunScreenViewModel.compare(
            slugs: [nil, nil], league: nil, run: StubRun(.contract), pages: StubPages(.contract), cache: cache(),
            clock: FixedClock(Self.now), zone: Fixtures.zone
        )
        await viewModel.load()
        let empty = try #require(loaded(viewModel)).0
        #expect(empty.lead == CompareModel.firstStep(0))
        #expect(empty.search("all").map(\.name) == ["Josh Allen"])
        #expect(empty.search("JOSH").map(\.name) == ["Josh Allen", "Josh Jacobs"])
        await viewModel.choose(slot: 0, slug: "josh-allen")
        await viewModel.choose(slot: 1, slug: "josh-jacobs")
        let both = try #require(loaded(viewModel)).0
        #expect(both.lead == nil)
        guard case let .table(table) = both.outcome else {
            Issue.record("expected the call")
            return
        }
        #expect(table.heads.map(\.name) == ["Josh Allen", "Josh Jacobs"])
        await viewModel.choose(slot: 0, slug: nil)
        #expect(try #require(loaded(viewModel)).0.slots[0] == .open)
        await viewModel.choose(slot: 0, slug: "josh-jacobs")
        guard case .same = try #require(loaded(viewModel)).0.outcome else {
            Issue.record("the same player twice")
            return
        }
    }

    @Test func aClubTheRunLacksFails() async {
        let viewModel = RunScreenViewModel.club(
            "zzz", run: StubRun(.contract), pages: StubPages(.contract), cache: cache(), clock: FixedClock(Self.now),
            zone: Fixtures.zone
        )
        await viewModel.load()
        guard case .failed = viewModel.state else {
            Issue.record("expected a failure, got \(viewModel.state)")
            return
        }
    }

    @Test func aClubsPageInSeasonFadesTheGamesInAndComparesItsTwoBest() async throws {
        let viewModel = RunScreenViewModel.club(
            "det", run: StubRun(.contract), pages: StubPages(.contract), cache: cache(), clock: FixedClock(Self.now),
            zone: Fixtures.zone
        )
        await viewModel.load()
        let model = try #require(loaded(viewModel)).0
        #expect(model.name == "Detroit Lions")
        #expect(model.scheduleCaption == "2026 schedule, weeks 1 to 5 and week 6's Thursday game are played, so faded")
        #expect(model.rows.map(\.name) == ["Jahmyr Gibbs"])
        #expect(model.compare == nil, "one available player, no pair")
    }

    @Test func theSitesReferenceLinksOpenTheAppsScreens() throws {
        #expect(AppLink.of(SiteLinks.adp("half-ppr-12")) == .reference(.adp(format: "half-ppr-12")))
        #expect(AppLink.of(SiteLinks.club("ARI")) == .reference(.club(abbr: "ari")))
        #expect(AppLink.of(SiteLinks.clubs) == .reference(.clubs))
        #expect(AppLink.of(SiteLinks.schedule) == .reference(.schedule))
        #expect(SiteLinks.compare(first: "ja-marr-chase")
            .absoluteString == "https://trycommish.app/compare?a=ja-marr-chase")
        #expect(AppLink.of(SiteLinks.compare(first: "a-b", second: "c-d")) == .reference(.compare(
            first: "a-b",
            second: "c-d"
        )))
        #expect(AppLink.of(SiteLinks.compare()) == .reference(.compare(first: nil, second: nil)))
        #expect(AppLink.of(SiteLinks.player("josh-allen")) == .player(slug: "josh-allen"))
        #expect(try AppLink.of(#require(URL(string: "https://example.com/clubs"))) == nil)
    }

    @Test func theSheetsCompareVerbOpensCompareWithHimOnOneSide() {
        var opened: URL?
        let player = SheetPlayer(
            id: "1",
            slug: "josh-allen",
            name: "Josh Allen",
            position: "QB",
            rank: "1",
            club: "BUF"
        )
        let offer = SheetOffer.compare(player) { opened = $0 }
        #expect(offer.label == Words.Card.compare)
        #expect(SheetVerb.of(offer, game: .kickedOff) == .act(label: "Compare", line: nil), "not a lineup verb")
        offer.act()
        #expect(opened.flatMap(AppLink.of) == .reference(.compare(first: "josh-allen", second: nil)))
    }

    @Test func aRefusedTokenSignsOut() async {
        var signedOut = false
        let refused = APIClient(client: Client(serverURL: Self.base, transport: StatusTransport(status: .unauthorized)))
        let viewModel = RunScreenViewModel.clubs(
            run: refused, pages: refused, cache: cache(), clock: FixedClock(Self.now), zone: Fixtures.zone
        ) { signedOut = true }
        await viewModel.load()
        #expect(signedOut)
        #expect(viewModel.state == .failed(AppWords.Failure.signedOut))
    }
}

extension CompareSlot {
    /// The face a picked side carries, for comparing a slot whose face the fixture names.
    var headshotURL: URL? {
        if case let .picked(_, _, headshot) = self {
            return headshot
        }
        return nil
    }
}

/// The page routes with one page the run cannot give: the API's 404, and no held copy.
struct MissingPage: RunPagesAPI {
    let pages: StubPages
    let id: String

    init(_ pages: StubPages, id: String) {
        self.pages = pages
        self.id = id
    }

    func index(tag: String?) async throws -> RunRead<[RunIndexEntry]> {
        try await pages.index(tag: tag)
    }

    func page(id: String, tag: String?) async throws -> RunRead<RunPlayerAnswer> {
        guard id != self.id else {
            throw APIError.envelope(code: "not_found", message: "The run has no page for this player.")
        }
        return try await pages.page(id: id, tag: tag)
    }

    func held(tag: String?) async throws -> RunRead<[RunHeldPage]?> {
        try await pages.held(tag: tag)
    }

    func heldCopy(id: String, tag: String?) async throws -> RunRead<RunPlayer> {
        try await pages.heldCopy(id: id, tag: tag)
    }

    func schedule(tag: String?) async throws -> RunRead<RunSchedule> {
        try await pages.schedule(tag: tag)
    }
}
