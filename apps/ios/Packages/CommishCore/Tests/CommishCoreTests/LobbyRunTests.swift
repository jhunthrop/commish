import CommishAPI
@testable import CommishCore
import CommishDesign
import Foundation
import RunFixtures
import Testing

/// The lobby room run again (B252): Try again after a read that did not go reads the room afresh, a
/// room refused for good is never read again, a cancelled read draws no failure, and a run again over
/// a live room never draws Loading over it.
@MainActor
struct LobbyRunTests {
    @Test func aReadThatDidNotGoIsReadAgainInPlaceOnTryAgain() async throws {
        let api = StubLobby()
        await api.setRefusal(503)
        let rows = try LobbySocketTests.rows()
        let connector = ScriptedConnector([[LobbySocketTests.welcome(rows[0]), .end]])
        let viewModel = LobbySocketTests.viewModel(api, connector, timer: RecordingTimer())
        await viewModel.run()
        #expect(viewModel.state == .failed(Words.Mock.unreachablePhone, final: false))
        #expect(await connector.tokens.isEmpty)
        // Try again: the screen runs the room again, which reads it afresh and opens its socket.
        await api.setRefusal(nil)
        await viewModel.run()
        #expect(viewModel.state == .room)
        #expect(await api.reads == 2)
        // The socket opened only after the second read, from the start of the log.
        #expect(await connector.sent.first?.first == .object(["type": .string("hello"), "last_seq": .number(0)]))
    }

    @Test func aCancelledReadLeavesNoFailureScreen() async {
        let api = StubLobby()
        await api.setHangs(true)
        let connector = ScriptedConnector([])
        let viewModel = LobbySocketTests.viewModel(api, connector, timer: RecordingTimer())
        let run = Task { await viewModel.run() }
        while await api.reads == 0 {
            await Task.yield()
        }
        run.cancel()
        await run.value
        // The screen went (or Try again started another run) mid-read: no failure, no Try again, no socket.
        #expect(viewModel.state == .loading)
        #expect(await connector.tokens.isEmpty)
    }

    @Test func aRunAgainOverALiveRoomNeverDrawsLoading() async throws {
        let api = StubLobby()
        let rows = try LobbySocketTests.rows()
        let connector = ScriptedConnector([[LobbySocketTests.welcome(rows[0]), .end]])
        let viewModel = LobbySocketTests.viewModel(api, connector, timer: RecordingTimer())
        // The screen goes: its socket closes with the seat kept.
        await connector.drive { _ in await viewModel.close() }
        await viewModel.run()
        #expect(viewModel.state == .room)
        #expect(viewModel.stopped == nil)
        // The screen reappears and its task fires again: the read is out, the room stays drawn.
        await api.setHangs(true)
        let again = Task { await viewModel.run() }
        for _ in 0 ..< 10000 where await api.reads < 2 {
            await Task.yield()
        }
        #expect(await api.reads == 2)
        #expect(viewModel.state == .room)
        again.cancel()
        await again.value
        #expect(viewModel.state == .room)
    }

    @Test func aRoomRefusedForGoodIsNeverReadAgain() async {
        let api = StubLobby()
        await api.setRefusal(404)
        let viewModel = LobbySocketTests.viewModel(api, ScriptedConnector([]), timer: RecordingTimer())
        await viewModel.run()
        await viewModel.run()
        #expect(viewModel.state == .failed(Words.Lobby.gone, final: true))
        #expect(await api.reads == 1)
    }
}
