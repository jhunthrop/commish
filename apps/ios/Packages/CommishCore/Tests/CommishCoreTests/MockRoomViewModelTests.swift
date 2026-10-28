import CommishAPI
@testable import CommishCore
import CommishDesign
import Foundation
import RunFixtures
import Testing

/// The mock room's view model over the recorded draft: a pick names the pick on the clock and lands as
/// the API answers it; a room read offline shows the saved one, stale, and drafts nothing; a refused
/// write keeps the room and says the API's sentence; a refused token signs out; a turn whose call
/// cannot be read drafts from the pool; the report's verbs and the setup start what they say.
@MainActor
struct MockRoomViewModelTests {
    static func viewModel(
        _ api: StubMock,
        cache: FileCache = MockParityTests.cache(),
        signedOut: @escaping @MainActor () -> Void = {}
    )
        -> MockRoomViewModel {
        MockRoomViewModel(
            id: MockFixture.id, api: api, cache: cache, clock: MockParityTests.clock,
            zone: TimeZone(identifier: "America/Chicago")!,
            onSignedOut: signedOut
        )
    }

    @Test func aPickRoundTripNamesThePickOnTheClockAndShowsTheAnswer() async throws {
        let api = StubMock()
        let viewModel = Self.viewModel(api)
        await viewModel.load()
        let call = try MockFixture.room(.create)
        let expected = try MockFixture.card().call
        await viewModel.draft()
        let sent = await api.picks
        #expect(sent.map(\.pick) == [call.pickNumber])
        #expect(sent.map(\.player) == [expected])
        guard case let .room(model, stale) = viewModel.state else {
            Issue.record("no room")
            return
        }
        #expect(!stale)
        #expect(try model.room.pickNumber == (MockFixture.room(.pick1)).pickNumber)
        #expect(model.team.slots.contains { $0.player?.id == expected })
    }

    @Test func aMarkedRowIsTheOneDrafted() async {
        let api = StubMock()
        let viewModel = Self.viewModel(api)
        await viewModel.load()
        guard case let .room(model, _) = viewModel.state, let row = model.pool?.rows.dropFirst(3).first else {
            Issue.record("no pool")
            return
        }
        viewModel.mark(row.id)
        guard case let .room(marked, _) = viewModel.state else {
            Issue.record("no room after the mark")
            return
        }
        #expect(marked.pool?.rows.first { $0.marked }?.id == row.id)
        await viewModel.draft()
        #expect(await api.picks.map(\.player) == [row.id])
    }

    @Test func offlineTheSavedRoomShowsStaleAndDraftsNothing() async {
        let cache = MockParityTests.cache()
        let api = StubMock()
        let first = Self.viewModel(api, cache: cache)
        await first.load()
        await api.setOffline(true)
        let viewModel = Self.viewModel(api, cache: cache)
        await viewModel.load()
        guard case let .room(_, stale) = viewModel.state else {
            Issue.record("no saved room: \(viewModel.state)")
            return
        }
        #expect(stale)
        #expect(!viewModel.canWrite)
        #expect(viewModel.staleWords?.hasPrefix(Words.Mock.unreachablePhone) == true)
        await viewModel.draft()
        await viewModel.finish()
        #expect(await api.picks.isEmpty)
    }

    @Test func offlineWithNothingSavedSaysTheRoomCannotBeReached() async {
        let api = StubMock()
        await api.setOffline(true)
        let viewModel = Self.viewModel(api)
        await viewModel.load()
        #expect(viewModel.state == .failed(Words.Mock.unreachablePhone))
    }

    @Test func aRefusedPickKeepsTheRoomAndSaysTheAPIsSentence() async throws {
        let api = StubMock()
        let viewModel = Self.viewModel(api)
        await viewModel.load()
        await api.setRefusal("You are not on the clock.")
        await viewModel.draft()
        #expect(viewModel.refusal == "You are not on the clock.")
        guard case let .room(model, _) = viewModel.state else {
            Issue.record("no room")
            return
        }
        #expect(try model.room.pickNumber == (MockFixture.room(.create)).pickNumber)
        #expect(viewModel.canWrite)
    }

    @Test func aRefusedTokenSignsOut() async {
        var signedOut = false
        let viewModel = Self.viewModel(StubMock(signedOut: true)) { signedOut = true }
        await viewModel.load()
        #expect(signedOut)
        #expect(viewModel.state == .failed(AppWords.Failure.signedOut))
    }

    @Test func aTurnWhoseCallCannotBeReadDraftsFromThePool() async {
        // The first answer carries no card and the card route fails.
        let api = StubMock()
        await api.setCardMissing(true)
        let viewModel = Self.viewModel(api)
        await viewModel.load()
        guard case let .room(model, _) = viewModel.state, case let .noCall(verb, player) = model.call else {
            Issue.record("not the no-call state: \(viewModel.state)")
            return
        }
        #expect(player == model.pool?.rows.first?.id)
        #expect(verb?.hasPrefix(Words.Mock.draft) == true)
        await viewModel.draft()
        #expect(await api.picks.map(\.player) == [player].compactMap(\.self))
    }

    @Test func theQueueIsSentWhole() async throws {
        let api = StubMock(opened: .round5)
        let viewModel = Self.viewModel(api)
        await viewModel.load()
        let player = try #require(try MockFixture.room(.queue).queue.first)
        await viewModel.toggleQueue(player)
        #expect(await api.queues == [[player]])
        guard case let .room(model, _) = viewModel.state else {
            Issue.record("no room after the queue")
            return
        }
        #expect(try model.room.queue == (MockFixture.room(.queue)).queue)
    }

    @Test func undoTakesBackYourLatestPick() async throws {
        let api = StubMock(opened: .round5)
        let viewModel = Self.viewModel(api)
        await viewModel.load()
        await viewModel.undo()
        let round5 = try MockFixture.room(.round5)
        #expect(await api.undone == [round5.picks.last { $0.seat == round5.slot }?.pick].compactMap(\.self))
    }

    @Test func pickForMeDraftsThroughThreeRoundsPastTheOneOnTheClock() async {
        let api = StubMock(opened: .round5)
        let viewModel = Self.viewModel(api)
        await viewModel.load()
        await viewModel.autopick()
        #expect(await api.autopicks == [8])
    }

    @Test func finishReadsTheReportAndItsVerbsRunTheDraftAgain() async throws {
        let api = StubMock(opened: .round5)
        let viewModel = Self.viewModel(api)
        await viewModel.load()
        await viewModel.finish()
        guard case let .report(_, code, _, slot) = viewModel.state else {
            Issue.record("no report: \(viewModel.state)")
            return
        }
        #expect(viewModel.shareURL == code.map(MockRoomViewModel.shareLink))
        #expect(viewModel.shareURL?.absoluteString.hasPrefix("https://trycommish.app/mock/share/") == true)
        let again = await viewModel.runAgain()
        #expect(try again == (MockFixture.room(.create)).id)
        #expect(await api.created.first?.settings?.value1.slot == slot)
    }

    @Test func theLinkCopiedLineShowsForItsMomentThenGoes() async {
        let seen = CopiedProbe()
        let timer = ProbeTimer { await seen.look() }
        let viewModel = MockRoomViewModel(
            id: MockFixture.id, api: StubMock(), cache: MockParityTests.cache(), clock: MockParityTests.clock,
            timer: timer
        )
        seen.viewModel = viewModel
        await viewModel.linkCopied()
        #expect(seen.during == [true])
        #expect(!viewModel.copied)
    }

    @Test func theSetupStartsWhatItShows() async throws {
        let api = StubMock()
        let setup = MockSetupViewModel(api: api)
        setup.choose(teams: 14)
        setup.choose(slot: 14)
        setup.choose(teams: 10)
        #expect(setup.settings.slot == nil)
        setup.choose(slot: 7)
        setup.choose(lineup: .superflex)
        setup.choose(preset: .halfPpr)
        let id = await setup.start()
        #expect(try id == (MockFixture.room(.create)).id)
        let sent = try #require(await api.created.first?.settings?.value1)
        #expect(sent.teams == 10 && sent.slot == 7)
        #expect(MockWords.formatLine(sent) == "10 teams · half PPR · superflex")
        #expect(setup.slots.count == 11)
    }

    @Test func tryAnotherSlotStartsFromTheDraftsSettingsWithItsSlotLetGo() throws {
        let report = try MockFixture.report()
        let setup = MockSetupViewModel(api: StubMock(), from: report.settings)
        #expect(setup.settings.slot == nil)
        #expect(setup.settings.teams == report.settings.teams)
    }
}

/// A timer whose sleeps return at once.
struct InstantTimer: PollTimer {
    func sleep(for _: Duration) async throws {}
}
