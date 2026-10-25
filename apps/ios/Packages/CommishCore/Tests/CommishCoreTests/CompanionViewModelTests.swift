import CommishAPI
@testable import CommishCore
import CommishDesign
import Foundation
import RunFixtures
import Testing

/// A fresh answer cache in its own temporary folder.
func companionCache() -> FileCache {
    FileCache(folder: FileManager.default.temporaryDirectory.appendingPathComponent("companion-\(UUID().uuidString)"))
}

/// The companion's state through its view model over the recorded replay (plan Task D4's test): the
/// first read asks from pick 0 and takes the board, each later one the count held; the picks merge
/// across reads; the poll keeps the web's three seconds and stops with the report; a lost connection
/// keeps the last picks with their stamp; a refused token signs out; a draft not on the account says so.
@MainActor
struct CompanionViewModelTests {
    static let zone = TimeZone(identifier: "America/Chicago")!
    static let readAt = Date(timeIntervalSince1970: 1_792_008_000)

    static func viewModel(
        _ api: StubCompanion, cache: FileCache = companionCache(), clock: Date = readAt,
        timer: any PollTimer = ManualTimer(),
        signedOut: @escaping @MainActor () -> Void = {}
    ) -> CompanionViewModel {
        CompanionViewModel(
            id: CompanionFixture.id, api: api, cache: cache, clock: FixedClock(clock), timer: timer, zone: zone,
            onSignedOut: signedOut
        )
    }

    @Test func eachReadAsksSinceThePickCountHeldAndThePicksMerge() async {
        let api = StubCompanion()
        let viewModel = Self.viewModel(api)
        for _ in CompanionFixture.Moment.allCases.dropLast() {
            await viewModel.load()
        }
        #expect(await api.reads == [0, 2, 11, 19])
        guard case let .room(model, stale) = viewModel.state else {
            Issue.record("no room: \(viewModel.state)")
            return
        }
        #expect(!stale)
        // 22 picks held from four reads, the board from the first.
        #expect(model.bar.figure == "22 of 240")
        #expect(model.team.count == "2 of 20")
        #expect(model.strip?.picks.first?.lines == ["2.10", "GMenJay"])
    }

    @Test func theTurnDrawsOurCallAndTheVerbThatOpensThePlatform() async {
        let api = StubCompanion(moments: [.waiting, .between, .turn])
        let viewModel = Self.viewModel(api)
        for _ in 0 ..< 3 {
            await viewModel.load()
        }
        guard case let .room(model, _) = viewModel.state, let call = model.call else {
            Issue.record("no call at the turn")
            return
        }
        #expect(call.verb == "Make the pick on Sleeper")
        #expect(!call.waiting)
        #expect(model.bar.openURL?.absoluteString == "https://sleeper.com/draft/nfl/1382163311050645504")
        #expect(model.strip == nil)
        #expect(model.since?.lead == "14")
    }

    @Test func thePollKeepsTheWebsThreeSecondsAndStopsWithTheReport() async throws {
        let timer = ManualTimer()
        let api = StubCompanion()
        let viewModel = Self.viewModel(api, timer: timer)
        viewModel.setVisible(true)
        for reads in 1 ... 4 {
            try await eventually {
                let read = await api.reads.count
                let sleeping = await timer.sleepers
                return read == reads && sleeping == 1
            }
            await timer.tick()
        }
        try await eventually {
            if case .report = viewModel.state {
                return true
            }
            return false
        }
        try await eventually { !viewModel.polling }
        #expect(await api.reads.count == 5)
        #expect(await timer.intervals.allSatisfy { $0 == .seconds(3) })
        #expect(viewModel.done)
    }

    @Test func hiddenStopsThePoll() async throws {
        let timer = ManualTimer()
        let api = StubCompanion()
        let viewModel = Self.viewModel(api, timer: timer)
        viewModel.setVisible(true)
        try await eventually { await timer.sleepers == 1 }
        viewModel.setVisible(false)
        await timer.tick()
        await settle()
        #expect(await api.reads.count == 1)
        #expect(!viewModel.polling)
    }

    @Test func aLostConnectionKeepsTheLastPicksWithTheirStamp() async {
        let api = StubCompanion(moments: [.waiting, .between])
        let viewModel = Self.viewModel(api)
        await viewModel.load()
        await api.setOffline(true)
        await viewModel.load()
        guard case let .room(model, stale) = viewModel.state else {
            Issue.record("the room went away offline")
            return
        }
        #expect(stale)
        #expect(model.bar.figure == "2 of 240")
        #expect(viewModel.stampWords == "Last read \(Formatting.weekdayTime(Self.readAt, zone: Self.zone))")
        // Back online the poll goes on from the count held.
        await api.setOffline(false)
        await viewModel.load()
        #expect(await api.reads == [0, 2, 2])
        guard case let .room(back, false) = viewModel.state else {
            Issue.record("not fresh again")
            return
        }
        #expect(back.bar.figure == "11 of 240")
    }

    @Test func aSavedDraftOpensWithNoSignalDated() async {
        let cache = companionCache()
        let first = Self.viewModel(StubCompanion(moments: [.turn]), cache: cache)
        // The turn's answer alone carries no board: the first read is the waiting one.
        let saved = Self.viewModel(StubCompanion(moments: [.waiting]), cache: cache)
        await saved.load()
        _ = first
        let later = Self.viewModel(
            StubCompanion(offline: true),
            cache: cache,
            clock: Self.readAt.addingTimeInterval(600)
        )
        await later.load()
        guard case let .room(model, true) = later.state else {
            Issue.record("no saved room: \(later.state)")
            return
        }
        #expect(model.bar.figure == "2 of 240")
        #expect(later.stampWords == "Last read \(Formatting.weekdayTime(Self.readAt, zone: Self.zone))")
    }

    @Test func neverReadAndNothingSavedSaysSo() async {
        let viewModel = Self.viewModel(StubCompanion(offline: true))
        await viewModel.load()
        #expect(viewModel.state == .failed(.unreachable))
    }

    @Test func aRefusedTokenSignsOut() async {
        var signedOut = false
        let viewModel = Self.viewModel(StubCompanion(signedOut: true)) { signedOut = true }
        await viewModel.load()
        #expect(viewModel.state == .failed(.signedOut))
        #expect(signedOut)
        #expect(viewModel.done)
    }

    @Test func theChipFiltersThePoolWithNoRead() async {
        let api = StubCompanion(moments: [.waiting])
        let viewModel = Self.viewModel(api)
        await viewModel.load()
        viewModel.choose(filter: "TE")
        guard case let .room(model, _) = viewModel.state else {
            Issue.record("no room")
            return
        }
        #expect(model.pool?.filter == "TE")
        #expect(model.pool?.rows.allSatisfy { $0.player.position == "TE" } == true)
        #expect(await api.reads.count == 1)
        viewModel.choose(filter: "Nobody")
        #expect(viewModel.filter == "TE")
    }
}

/// The start page: the verb's readiness, the body it sends, the API's sentence on a refusal, and the
/// followed drafts' lines.
@MainActor
struct NewCompanionViewModelTests {
    @Test func theVerbWaitsOnALinkAndByUsernameOnAName() {
        let viewModel = NewCompanionViewModel(api: StubCompanion())
        #expect(!viewModel.ready)
        viewModel.link = "sleeper.com/draft/nfl/1382163311050645504"
        #expect(viewModel.ready)
        viewModel.seat = .username
        #expect(!viewModel.ready)
        viewModel.username = "  jh  "
        #expect(viewModel.ready)
    }

    @Test func followingSendsTheSeatAndOpensTheDraft() async throws {
        let api = StubCompanion()
        let viewModel = NewCompanionViewModel(api: api)
        viewModel.link = " sleeper.com/draft/nfl/1 "
        viewModel.slot = 5
        let id = await viewModel.follow()
        #expect(id == CompanionFixture.id)
        let body = try #require(await api.followed.first)
        #expect(body.draft == "sleeper.com/draft/nfl/1")
        #expect(body.seat.slot == 5)
        #expect(body.seat.username == nil)
        #expect(body.replay == nil)
        #expect(body.host.value1 == .sleeper)
    }

    @Test func theReplayFollowsTheRecordedDraftInTheWebsWords() async {
        let api = StubCompanion()
        let viewModel = NewCompanionViewModel(api: api, replay: true)
        #expect(viewModel.link == "The recorded draft (development replay)")
        _ = await viewModel.follow()
        #expect(await api.followed.first?.replay == true)
    }

    @Test func aRefusalSaysTheAPIsSentence() async {
        let viewModel = NewCompanionViewModel(api: StubCompanion(refusal: "That draft is an auction."))
        viewModel.link = "x"
        #expect(await viewModel.follow() == nil)
        #expect(viewModel.problem == "That draft is an auction.")
        #expect(!viewModel.busy)
    }

    @Test func noConnectionSaysTheWebsWords() async {
        let viewModel = NewCompanionViewModel(api: StubCompanion(offline: true))
        viewModel.link = "x"
        #expect(await viewModel.follow() == nil)
        #expect(viewModel.problem == Words.CompanionNew.failed)
        await viewModel.load()
        #expect(viewModel.recentFailed)
    }

    @Test func theFollowedDraftsAreListed() async {
        let viewModel = NewCompanionViewModel(api: StubCompanion())
        await viewModel.load()
        #expect(viewModel.recent.map(\.lead) == ["S.U.C.K. - Severely Underrated Carolina Keepers"])
        #expect(viewModel.recent.first?.text == "slot 5 · over, the report is ready · followed Oct 25")
        // Found by slot, so the seat stays by slot.
        #expect(viewModel.seat == .slot)
    }
}

/// The ways in: the bar's Advisor (on draft day first) and the site's companion links.
struct CompanionLinkTests {
    @Test func theAdvisorTabIsTheCompanionsWayIn() {
        let draftDay = PhoneRail.tabs(phase: .draftDay, waiversOpen: false).map(\.key)
        let before = PhoneRail.tabs(phase: .preDraft, waiversOpen: false).map(\.key)
        #expect(draftDay.first.map(PhoneRail.isAdvisor) == true)
        #expect(before.contains(where: PhoneRail.isAdvisor))
        #expect(!PhoneRail.tabs(phase: .inSeason, waiversOpen: true).map(\.key).contains(where: PhoneRail.isAdvisor))
    }

    @Test func theSitesCompanionLinksOpenInTheApp() throws {
        let start = try #require(URL(string: "https://trycommish.app/companion/new"))
        let replay = try #require(URL(string: "https://trycommish.app/companion/new?replay=1"))
        let followed = try #require(URL(string: "https://trycommish.app/companion/\(CompanionFixture.id)"))
        let section = try #require(URL(string: "https://trycommish.app/companion"))
        #expect(AppLink.of(start) == .companion(.companionNew(replay: false)))
        #expect(AppLink.of(replay) == .companion(.companionNew(replay: true)))
        #expect(AppLink.of(followed) == .companion(.companion(id: CompanionFixture.id)))
        #expect(AppLink.of(section) == nil)
    }
}
