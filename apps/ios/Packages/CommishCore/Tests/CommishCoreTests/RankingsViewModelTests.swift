import CommishAPI
@testable import CommishCore
import Foundation
import RunFixtures
import Testing

/// The Rankings' and Our record's view models over the shared answers, at a fixed clock: the shell's
/// search opens the order with it; a chip reads its own view, the K and D/ST chips the week; a search on
/// the week filters its rows with no read; Show more asks for a hundred more; with no signal the saved
/// answer shows, stale with its stamp; the record's second read names both ETags and costs two 304s; a
/// refused token signs out.
@MainActor
struct RankingsViewModelTests {
    private let folder = FileManager.default.temporaryDirectory
        .appendingPathComponent("commish-rankings-tests-\(UUID().uuidString)")
    static let week = Fixtures.instant(RankingsFixture.week)

    private func rankings(
        _ api: any RankingsAPI, query: String = "", cache: (any AnswerCache)? = nil,
        clock: any Clock = FixedClock(week),
        onSignedOut: @escaping @MainActor () -> Void = {}
    ) -> RankingsViewModel {
        RankingsViewModel(
            api: api, cache: cache ?? FileCache(folder: folder), clock: clock, inSeason: true, query: query,
            zone: Fixtures.zone, onSignedOut: onSignedOut
        )
    }

    private func order(_ viewModel: RankingsViewModel) -> (RankingsModel, Bool)? {
        guard case let .loaded(.order(model), _, stale) = viewModel.state else {
            Issue.record("Expected the order, got \(viewModel.state)")
            return nil
        }
        return (model, stale)
    }

    private func week(_ viewModel: RankingsViewModel) -> WeekRankingsModel? {
        guard case let .loaded(.week(model), _, _) = viewModel.state else {
            Issue.record("Expected the week, got \(viewModel.state)")
            return nil
        }
        return model
    }

    @Test func theRankingsOpenOnOurOrderNamedForTheSeason() async throws {
        let api = CountingRankings()
        let viewModel = rankings(api)
        await viewModel.load()
        let (model, stale) = try #require(order(viewModel))
        #expect(viewModel.name == "Rankings")
        #expect(viewModel.lead == "Our rest-of-season order, with week 6's game beside each player")
        #expect(!stale)
        #expect(model.rows.first?.player.name == "D'Andre Swift")
        #expect(model.hits == "121 on NFL rosters today")
        #expect(viewModel.more)
        #expect(await api.queries == [OrderQuery(position: nil, search: nil, limit: 100)])
    }

    @Test func theShellsSearchOpensTheOrderWithItAndEachMatchKeepsItsPlace() async throws {
        let api = CountingRankings()
        let viewModel = rankings(api, query: "wa")
        await viewModel.load()
        let (model, _) = try #require(order(viewModel))
        #expect(await api.queries.first?.search == "wa")
        #expect(model.hits == "12 matches")
        #expect(model.rows.prefix(3).map(\.place) == ["7", "9", "15"])
    }

    @Test func aPositionChipReadsItsViewAndTheWeeksChipsReadTheWeek() async throws {
        let api = CountingRankings()
        let viewModel = rankings(api)
        await viewModel.load()
        await viewModel.choose(chip: .receiver)
        let (receivers, _) = try #require(order(viewModel))
        #expect(receivers.hits == "53 matches")
        #expect(receivers.rows.first?.player.pill == "WR", "a position's pill names his position alone")
        await viewModel.choose(chip: .defense)
        let defenses = try #require(week(viewModel))
        #expect(defenses.heading == "Week 6 defenses")
        #expect(defenses.rows.first?.player.name == "Titans D/ST")
        #expect(viewModel.lead == nil, "the week's basis line says the rest")
        #expect(await api.weeks == [.def])
    }

    @Test func aSearchOnTheWeekFiltersItsRowsWithNoRead() async throws {
        let api = CountingRankings()
        let viewModel = rankings(api)
        await viewModel.choose(chip: .defense)
        viewModel.find("ti")
        let shown = try #require(week(viewModel))
        #expect(shown.rows.map(\.player.name).contains("Titans D/ST"))
        let web = try #require(RankingsParityTests.parity.weeks["DEF-search"])
        #expect(shown.rows.map(\.player.name) == web.sections.flatMap(\.rows).map(\.player.name))
        #expect(!viewModel.searchReads)
        #expect(await api.weeks.count == 1)
    }

    @Test func showMoreAsksForAHundredMore() async {
        let api = CountingRankings()
        let viewModel = rankings(api)
        await viewModel.load()
        await viewModel.showMore()
        #expect(viewModel.limit == 200)
        #expect(await api.queries.last?.limit == 200)
    }

    @Test func withNoSignalTheSavedOrderShowsStaleWithItsStamp() async throws {
        let cache = FileCache(folder: folder)
        await rankings(CountingRankings(), cache: cache).load()
        let later = Self.week.addingTimeInterval(3600)
        let viewModel = rankings(StubRankings(offline: true), cache: cache, clock: FixedClock(later))
        await viewModel.load()
        let (model, stale) = try #require(order(viewModel))
        #expect(stale)
        #expect(viewModel.stampWords == "Last read Sat 12:00 pm")
        #expect(model.rows.count == 100)
    }

    @Test func withNoSignalAndNothingSavedTheScreenSaysSo() async {
        let viewModel = rankings(StubRankings(offline: true))
        await viewModel.load()
        #expect(viewModel.state == .failed(AppWords.Failure.offline))
    }

    @Test func aRefusedTokenSignsOut() async {
        var signedOut = false
        let viewModel = rankings(RefusingRankings()) { signedOut = true }
        await viewModel.load()
        #expect(signedOut)
        #expect(viewModel.state == .failed(AppWords.Failure.signedOut))
    }

    // MARK: Our record

    private func record(
        _ api: any RecordAPI, cache: (any AnswerCache)? = nil, clock: any Clock = FixedClock(week)
    ) -> RecordViewModel {
        RecordViewModel(api: api, cache: cache ?? FileCache(folder: folder), clock: clock, zone: Fixtures.zone)
    }

    @Test func theRecordReadsWithItsScheduleAndSavesBothWithTheirETags() async {
        let cache = FileCache(folder: folder)
        let viewModel = record(StubRecord(.twoRecords("graded")), cache: cache)
        await viewModel.load()
        guard case let .loaded(model, _, stale) = viewModel.state else {
            Issue.record("Expected the record, got \(viewModel.state)")
            return
        }
        #expect(!stale)
        #expect(model.weekly.head?.title == "Weekly record")
        let saved = await cache.read(RecordRead.self, route: RecordViewModel.route)
        #expect(saved?.value.record.tag == RecordFixture.twoRecords("graded").tag)
        #expect(saved?.value.schedule.tag == RecordFixture.scheduleTag)
    }

    @Test func anUnchangedRecordCostsTwo304sAndRefreshesOnlyTheStamp() async {
        let cache = FileCache(folder: folder)
        await record(StubRecord(.own), cache: cache).load()
        let later = Self.week.addingTimeInterval(3600)
        let api = CountingRecord(StubRecord(.own))
        let viewModel = record(api, cache: cache, clock: FixedClock(later))
        await viewModel.load()
        guard case let .loaded(model, stamp, stale) = viewModel.state else {
            Issue.record("Expected the record, got \(viewModel.state)")
            return
        }
        #expect(!stale)
        #expect(stamp == later)
        #expect(await api.unchanged == 2)
        #expect(await api.tags == [RecordFixture.own.tag, RecordFixture.scheduleTag])
        #expect(model.lead.hasPrefix("How the order we set before each week's kickoff"))
    }

    @Test func withNoSignalTheSavedRecordShowsStale() async {
        let cache = FileCache(folder: folder)
        await record(StubRecord(.own), cache: cache).load()
        let viewModel = record(StubRecord(.own, offline: true), cache: cache)
        await viewModel.load()
        guard case let .loaded(_, _, stale) = viewModel.state else {
            Issue.record("Expected the record, got \(viewModel.state)")
            return
        }
        #expect(stale)
        #expect(viewModel.stampWords == "Last read Sat 12:00 pm")
    }

    @Test func theRecordsChipsHoldWhatWasChosen() {
        let viewModel = record(StubRecord(.own))
        viewModel.choose(figure: .placesOff)
        viewModel.choose(position: "WR")
        viewModel.choose(draftFigure: .starters)
        #expect(viewModel.figure == .placesOff)
        #expect(viewModel.position == "WR")
        #expect(viewModel.draftFigure == .starters)
    }
}

/// The fixture's order, keeping each query and week read.
actor CountingRankings: RankingsAPI {
    private let stub = StubRankings()
    private(set) var queries: [OrderQuery] = []
    private(set) var weeks: [WeekOrderPosition] = []

    func order(_ query: OrderQuery) async throws -> OrderAdvice {
        queries.append(query)
        return try await stub.order(OrderQuery(position: query.position, search: query.search, limit: 100))
    }

    func weekOrder(position: WeekOrderPosition) async throws -> WeekOrderAdvice {
        weeks.append(position)
        return try await stub.weekOrder(position: position)
    }
}

/// Every read refused: the device token is no longer good.
struct RefusingRankings: RankingsAPI {
    func order(_: OrderQuery) async throws -> OrderAdvice {
        throw APIError.status(401)
    }

    func weekOrder(position _: WeekOrderPosition) async throws -> WeekOrderAdvice {
        throw APIError.status(401)
    }
}

/// The record's routes, keeping each ETag named and counting the 304s.
actor CountingRecord: RecordAPI {
    private let stub: StubRecord
    private(set) var tags: [String?] = []
    private(set) var unchanged = 0

    init(_ stub: StubRecord) {
        self.stub = stub
    }

    func record(tag: String?) async throws -> RunRead<RunRecord> {
        tags.append(tag)
        return try await count(stub.record(tag: tag))
    }

    func recordSchedule(tag: String?) async throws -> RunRead<RunRecordSchedule> {
        tags.append(tag)
        return try await count(stub.recordSchedule(tag: tag))
    }

    private func count<Value>(_ read: RunRead<Value>) -> RunRead<Value> {
        if case .unchanged = read {
            unchanged += 1
        }
        return read
    }
}
