import CommishAPI
@testable import CommishCore
import CommishDesign
import Foundation
import Testing

/// The Account's push switches (Lane 288): written to the account (PATCH /me `notifications`) behind the
/// phone's permission, the prompt asked once from a switch, quiet hours written once the wheel rests, a
/// failed write putting the account's back.
@MainActor
struct AccountPushSwitchTests {
    /// The switches are the account's (PATCH /me `notifications`): each move writes the three kinds as
    /// drawn with quiet hours in the phone's zone, and the account read back keeps them; the last one
    /// off takes this phone's token off.
    @Test func theSwitchesAreWrittenToTheAccountAndTheLastOffUnregisters() async throws {
        let stub = try StubAccountScreen.fixture()
        let push = StaticPush(.allowed)
        let viewModel = AccountViewModelTests.viewModel(stub, push: push)
        await viewModel.load()
        #expect(viewModel.push == .standard)
        #expect(viewModel.shownPush == .standard)
        await viewModel.set(.status, isOn: false)
        let first = try #require(await stub.notificationChanges.first)
        #expect(first.timeZone == Fixtures.zone.identifier)
        #expect(first.quietStart == "23:00")
        #expect(first.quietEnd == "08:00")
        #expect(first.kinds == .init(starterStatus: false, weekReads: true, waiverClaims: true))
        #expect(viewModel.push.on(.status) == false)
        #expect(push.disabled == 0)
        await viewModel.set(.thursday, isOn: false)
        await viewModel.set(.waivers, isOn: false)
        #expect(viewModel.push.anyOn == false)
        #expect(push.disabled == 1)
        await viewModel.set(.waivers, isOn: true)
        #expect(push.enabled == 1)
        #expect(await stub.notificationChanges.last?.kinds == .init(
            starterStatus: false, weekReads: false, waiverClaims: true
        ))
        // A relaunch reads them back from the account.
        let relaunched = AccountViewModelTests.viewModel(stub, push: StaticPush(.allowed))
        await relaunched.load()
        #expect(relaunched.push.on(.waivers))
        #expect(relaunched.push.on(.status) == false)
    }

    /// Never asked, every switch draws off and the sentence says a switch asks; turning one on shows the
    /// system prompt and, allowed, writes that one on and the others as drawn (off).
    @Test func aSwitchOnAsksThePhoneOnceThenWritesWhatIsDrawn() async throws {
        let stub = try StubAccountScreen.fixture()
        let push = StaticPush(.notAsked, asked: .allowed)
        let viewModel = AccountViewModelTests.viewModel(stub, push: push)
        await viewModel.load()
        #expect(viewModel.permission == .notAsked)
        #expect(viewModel.shownPush.anyOn == false)
        await viewModel.set(.status, isOn: true)
        #expect(push.enabled == 1)
        #expect(viewModel.permission == .allowed)
        #expect(await stub.notificationChanges.last?.kinds == .init(
            starterStatus: true, weekReads: false, waiverClaims: false
        ))
        #expect(viewModel.shownPush.on(.status))
        #expect(viewModel.shownPush.on(.thursday) == false)
    }

    /// The phone says no: nothing is written, the switch stays off and the sentence says where to allow it.
    @Test func aRefusedPromptWritesNothing() async throws {
        let stub = try StubAccountScreen.fixture()
        let viewModel = AccountViewModelTests.viewModel(stub, push: StaticPush(.notAsked, asked: .refused))
        await viewModel.load()
        await viewModel.set(.status, isOn: true)
        #expect(viewModel.permission == .refused)
        #expect(await stub.notificationChanges.isEmpty)
        #expect(viewModel.shownPush.on(.status) == false)
    }

    /// Quiet hours draw as the wheel turns and are written once it rests, in one PATCH.
    @Test func quietHoursAreWrittenOnceTheWheelRests() async throws {
        let stub = try StubAccountScreen.fixture()
        let viewModel = AccountViewModelTests.viewModel(stub, push: StaticPush(.allowed))
        await viewModel.load()
        viewModel.setQuiet(from: 22 * 60 + 30, to: 7 * 60 + 30)
        viewModel.setQuiet(from: 22 * 60, to: 7 * 60 + 30)
        #expect(viewModel.push.quietFrom == 22 * 60)
        await viewModel.pendingQuietWrite?.value
        let changes = await stub.notificationChanges
        #expect(changes.count == 1)
        #expect(changes.first?.quietStart == "22:00")
        #expect(changes.first?.quietEnd == "07:30")
        #expect(AccountWords.clockTime(viewModel.push.quietFrom) == "10:00 pm")
        #expect(AccountWords.clockTime(PushSettings.standard.quietTo) == "8:00 am")
    }

    /// A write that fails puts the account's switches back and says so beside them.
    @Test func aFailedWriteKeepsTheAccountsSwitches() async throws {
        let stub = try StubAccountScreen.fixture()
        let viewModel = AccountViewModelTests.viewModel(stub, push: StaticPush(.allowed))
        await viewModel.load()
        await stub.failWrites(with: URLError(.notConnectedToInternet))
        await viewModel.set(.status, isOn: false)
        #expect(viewModel.push.on(.status))
        #expect(viewModel.problem == AccountProblem(section: .notifications, text: Words.Account.failed))
    }
}
