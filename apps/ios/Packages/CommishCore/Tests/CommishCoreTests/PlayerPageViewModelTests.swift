import CommishAPI
@testable import CommishCore
import CommishDesign
import Foundation
import RunFixtures
import Testing

/// The player page's view model over the run's routes: found by his slug; before the season his capsule
/// as written with its stamp, his ADP words and his floor, median and ceiling; in season the week's read
/// in its place; the league's verb; a held page's copy with that run's stamp, or with none the board's
/// figures and the held words; the saved page with its stamp with no signal; a refused token signing out.
@MainActor
struct PlayerPageViewModelTests {
    private let folder = FileManager.default.temporaryDirectory
        .appendingPathComponent("commish-page-tests-\(UUID().uuidString)")

    private func model(
        _ slug: String, clock: String = Fixtures.week, pages: any RunPagesAPI = StubPages(.standIn),
        run: any RunAPI = StubRun(.standIn), weeks: (any PlayerWeekAPI)? = nil,
        league: FollowedLeague? = PlayerSheetViewModelTests.league, cache: (any AnswerCache)? = nil,
        onSignedOut: @escaping @MainActor () -> Void = {}
    ) -> PlayerPageViewModel {
        PlayerPageViewModel(
            slug: slug, run: run, pages: pages, weeks: weeks ?? FixtureWeeks(clock: clock),
            cache: cache ?? FileCache(folder: folder), clock: FixedClock(Fixtures.instant(clock)), league: league,
            zone: Fixtures.zone, onSignedOut: onSignedOut
        )
    }

    private func loaded(_ viewModel: PlayerPageViewModel) -> (PlayerPageModel, Freshness)? {
        guard case let .loaded(page, freshness) = viewModel.state else {
            Issue.record("Expected his page, got \(viewModel.state)")
            return nil
        }
        return (page, freshness)
    }

    @Test func beforeTheSeasonThePageIsHisCapsuleHisADPAndHisRange() async throws {
        let viewModel = model("rome-odunze")
        await viewModel.load()
        let (page, freshness) = try #require(loaded(viewModel))
        #expect(page.hero.name == "Rome Odunze")
        #expect(page.hero.club == "Chicago Bears")
        #expect(page.hero.pill == "WR 25")
        let facts = try #require(page.facts, "the facts before the season")
        #expect(facts.drafters.figure == "Pick 55")
        #expect(facts.drafters.words.hasPrefix("We have him at pick 50, so drafters take him 4.8 picks later."))
        #expect(facts.outcomes?.caption == "2026 PPR points, from his low case to his high case")
        // The card is his week's, read in the league: the week's figure and his game, the six tiles.
        #expect(page.card.head == CardHead(week: 6, opponent: "at ATL"))
        #expect(page.card.tiles.map(\.value) == ["11.0", "199.2", "12th", "9.3", "5.0", "\u{2212}1.4"])
        #expect(page.season.rows.count == 5)
        #expect(page.tier?.title == "Tier 5 WRs")
        #expect(page.formats == nil, "one format, no table")
        #expect(page.basis.first?.hasPrefix("Wk 6 is this week's published projection") == true)
        guard case let .prose(paragraphs, byline, _) = page.read else {
            Issue.record("his capsule, got \(page.read)")
            return
        }
        #expect(!paragraphs.isEmpty)
        #expect(byline == "Written Oct 13, from his facts through last season")
        #expect(page.verb == CardVerb(label: "Open your lineup", target: .lineup, note: nil))
        #expect(page.stamp == "Stand-in, updated Sep 1")
        #expect(freshness.saved == nil)
    }

    @Test func inSeasonTheWeeksReadStandsInTheCapsulesPlace() async throws {
        let viewModel = model("jahmyr-gibbs", pages: StubPages(.contract), run: StubRun(.contract))
        await viewModel.load()
        let (page, _) = try #require(loaded(viewModel))
        #expect(page.facts == nil, "the facts are the draft's: the page shows none in season")
        #expect(page.read == .weekNone("Our read for his next game is not written yet."))
        #expect(page.formats?.rows.map(\.label) == ["PPR", "Half PPR", "Standard"])
        // No week read: the card as built, and the basis says why the week's tiles show "--".
        #expect(page.card.tiles.first?.value == "--")
        #expect(page.basis.first?.hasSuffix("could not be read just now.") == true)
        #expect(page.verb == nil, "the fixture league holds no week for him")
    }

    @Test func aHeldPageShowsItsCopyWithThatRunsStamp() async throws {
        // The stand-in held his page, an earlier run's copy standing in: the copy carries its run's stamp.
        let pages = StubPages(.standIn, held: ["4431299": .standIn])
        let viewModel = model("rome-odunze", pages: pages)
        await viewModel.load()
        let (page, _) = try #require(loaded(viewModel))
        #expect(page.hero.name == "Rome Odunze")
        #expect(page.stamp == "Updated Sep 1", "the copy's own run, not the stand-in's")
        #expect(!page.basis.contains(Words.HeldPage.basis))
    }

    @Test func aHeldPageWithNoCopyIsTheBoardsFiguresAndTheHeldWords() async throws {
        let pages = StubPages(.standIn, held: ["4431299": nil])
        let viewModel = model("rome-odunze", pages: pages)
        await viewModel.load()
        let (page, _) = try #require(loaded(viewModel))
        #expect(page.basis.contains(Words.HeldPage.basis))
        #expect(page.read == nil, "the held words say once that our read is not written")
        #expect(page.season.none == Words.HeldPage.log)
        #expect(page.card.tiles[1].value == "199.2", "the board's figure")
    }

    @Test func eachVerbOpensItsLeagueScreensTabOrThePlatformsPage() throws {
        #expect(CardVerb.Target.lineup.tabKey == PhoneRail.lineupKey)
        #expect(CardVerb.Target.waivers.tabKey == "waivers")
        #expect(CardVerb.Target.trades.tabKey == "trades")
        #expect(try CardVerb.Target.platform(#require(URL(string: "https://fantasy.espn.com"))).tabKey == nil)
    }

    @Test func aSlugTheRunHasNoPageForSaysSo() async {
        let viewModel = model("no-such-player")
        await viewModel.load()
        #expect(viewModel.state == .failed(Words.InSeason.notFoundLine))
    }

    @Test func withNoSignalTheSavedPageStandsWithItsStamp() async throws {
        let cache = FileCache(folder: folder)
        await model("rome-odunze", cache: cache).load()
        let offline = model(
            "rome-odunze", clock: Fixtures.sunday, pages: StubPages(.standIn, offline: true),
            run: StubRun(.standIn, offline: true), weeks: FixtureWeeks(clock: Fixtures.sunday, offline: true),
            cache: cache
        )
        await offline.load()
        let (page, freshness) = try #require(loaded(offline))
        #expect(freshness.saved == .offline)
        #expect(offline.stampWords == "Last read Sat 12:00 pm")
        #expect(page.hero.name == "Rome Odunze")
    }

    @Test func aRefusedTokenSignsOut() async {
        var signedOut = false
        let refused = RefusedPages()
        let viewModel = model("rome-odunze", pages: refused, onSignedOut: { signedOut = true })
        await viewModel.load()
        #expect(signedOut)
        #expect(viewModel.state == .failed(AppWords.Failure.signedOut))
    }
}

/// The page routes refusing the device token.
struct RefusedPages: RunPagesAPI {
    func index(tag _: String?) async throws -> RunRead<[RunIndexEntry]> {
        throw APIError.status(401)
    }

    func page(id _: String, tag _: String?) async throws -> RunRead<RunPlayerAnswer> {
        throw APIError.status(401)
    }

    func held(tag _: String?) async throws -> RunRead<[RunHeldPage]?> {
        throw APIError.status(401)
    }

    func heldCopy(id _: String, tag _: String?) async throws -> RunRead<RunPlayer> {
        throw APIError.status(401)
    }

    func schedule(tag _: String?) async throws -> RunRead<RunSchedule> {
        throw APIError.status(401)
    }
}
