import CommishAPI
@testable import CommishCore
import CommishDesign
import Foundation
import RunFixtures
import Testing

/// The lobby through its view model and the room's socket, over the recorded lobby
/// (shared/fixtures/lobby-room): a join and the handle it may ask for; the whole recorded exchange
/// replayed to the web's end; a pick on your turn sent as the room's command and landing as its row; a
/// drop and the reconnect that says hello from the last seq; a frame that skips a seq, which reads the
/// room again and replays the whole log from the welcome (B219); a 1008 close; a room read refused with
/// 403, which is final and never polled (B208).
@MainActor
struct LobbySocketTests {
    /// The recorded room's frames: each server frame's rows, and the commands the drafter sent between.
    enum Recorded {
        case rows([RoomRow])
        case command(RoomCommand)
    }

    static func recorded() throws -> [Recorded] {
        try LobbyFixture.steps().compactMap { step in
            switch step {
            case let .server(text):
                guard let frame = try RoomFrame.decode(text) else {
                    return nil
                }
                switch frame {
                case let .welcome(_, _, rows), let .update(_, rows): return .rows(rows)
                case .error: return nil
                }
            case let .client(text):
                return ScriptedStep.client(text).command.map(Recorded.command)
            }
        }
    }

    static func rows() throws -> [[RoomRow]] {
        try recorded().compactMap {
            if case let .rows(rows) = $0 {
                rows
            } else {
                nil
            }
        }
    }

    static let now = "2026-10-26T08:15:02.712Z"
    static let phone = RoomClockReading.parse("2026-10-26T08:15:00.712Z")!

    static func welcome(_ rows: [RoomRow], seq: Int64? = nil) -> ScriptedStep {
        .server(frame("welcome", rows, seq: seq ?? rows.last?.seq ?? 0, now: now))
    }

    static func update(_ rows: [RoomRow]) -> ScriptedStep {
        .server(frame("update", rows, seq: rows.last?.seq ?? 0, now: nil))
    }

    static func frame(_ type: String, _ rows: [RoomRow], seq: Int64, now: String?) -> String {
        let encoder = JSONEncoder()
        encoder.outputFormatting = .sortedKeys
        let actions = rows.compactMap { try? String(bytes: encoder.encode($0), encoding: .utf8) }
        let clock = now.map { #","now":"\#($0)""# } ?? ""
        let list = actions.joined(separator: ",")
        return #"{"type":"\#(type)","room_id":"r","seq":\#(seq)\#(clock),"actions":[\#(list)]}"#
    }

    /// The whole recorded log, replayed as the page applies it.
    static func replayedEnd() throws -> LobbyState {
        let room = try LobbyFixture.room()
        return try rows().reduce(LobbyState(room: room)) { $0.applying($1, you: room.you) }
    }

    static func viewModel(
        _ api: StubLobby, _ connector: ScriptedConnector, timer: any PollTimer,
        signedOut: @escaping @MainActor () -> Void = {}
    ) -> LobbyViewModel {
        LobbyViewModel(
            id: LobbyFixture.id, api: api, connector: connector, tokens: FixedTokens(), clock: FixedClock(phone),
            timer: timer, onSignedOut: signedOut
        )
    }

    @Test func aJoinAnswersTheSeatAndTheCardThenReadsYourSeat() async throws {
        let api = StubLobby(needsHandle: true)
        let landing = LobbyLandingViewModel(api: api)
        await landing.load()
        let format = try #require(landing.cards.first?.format)
        #expect(await landing.join(format) == nil)
        #expect(landing.handleFor == format)
        let room = await landing.saveHandle(" you ")
        #expect(room == LobbyFixture.id)
        #expect(await api.handles == ["you"])
        #expect(await api.joins == ["12_ppr", "12_ppr"])
        #expect(landing.cards.first?.verb == Words.Lobby.yourSeat)
        #expect(landing.cards.first?.seat == LobbyFixture.id)
        // The seat opens the room again, never a second join.
        #expect(await landing.join(format) == LobbyFixture.id)
        #expect(await api.joins.count == 2)
        // A seat the API no longer holds is forgotten on the next read.
        await api.setRefusal(403)
        await landing.load()
        #expect(landing.cards.first?.verb == Words.Lobby.join)
    }

    @Test func theWholeRecordedExchangeReplaysToTheWebsEnd() async throws {
        let recorded = try Self.recorded()
        var script: [ScriptedStep] = []
        for (index, step) in recorded.enumerated() {
            switch step {
            case let .rows(rows): script.append(index == 0 ? Self.welcome(rows) : Self.update(rows))
            case let .command(command): script.append(.client(command.text))
            }
        }
        let connector = ScriptedConnector([script + [.end]])
        let api = StubLobby()
        let viewModel = Self.viewModel(api, connector, timer: RecordingTimer())
        await connector.drive { command in
            switch command {
            case let .pick(player, _): await viewModel.draft(player)
            case let .queue(ids): for id in ids {
                    await viewModel.toggleQueue(id)
                }
            case .leave: await viewModel.close()
            }
        }
        await viewModel.run()
        let end = try Self.replayedEnd()
        #expect(viewModel.lobby == end)
        #expect(viewModel.lobby?.complete == true)
        #expect(viewModel.lobby?.picks.count == 180)
        // The drawn room follows the rows, not the clock: built when the last row landed.
        #expect(viewModel.drawn == viewModel.model(at: Self.phone))
        #expect(viewModel.drawn?.pool == nil)
        // Every pick of the drafter's went over the socket as the room's command, at the pick on the clock.
        let sent = await connector.sent.first ?? []
        let picks = sent.filter { $0["type"] == .string("pick") }
        let mine = end.picks.filter { $0.seat == 9 }
        #expect(picks.count == mine.count)
        #expect(picks.map { $0["pick"] } == mine.map { .number(Double($0.pick)) })
        #expect(picks.map { $0["player_id"] } == mine.map { .string($0.playerID) })
        #expect(sent.first == .object(["type": .string("hello"), "last_seq": .number(0)]))
        #expect(await api.reads == 1)
    }

    @Test func aPickOnYourTurnLandsAsItsRowAndNotBefore() async throws {
        let rows = try Self.rows()
        let room = try LobbyFixture.room()
        // The frames up to your first turn, 1.09.
        var state = LobbyState(room: room)
        var upTo = 0
        for (index, batch) in rows.enumerated() where state.pickNumber < 9 || !state.drafting {
            state = state.applying(batch, you: room.you)
            upTo = index
        }
        let opening = Array(rows[0 ... upTo])
        let landing = rows[upTo + 1]
        let connector = ScriptedConnector([
            [Self.welcome(opening.flatMap(\.self))]
                + [.client(RoomCommand.pick(playerID: "x", pick: 9).text), Self.update(landing), .end],
        ])
        let api = StubLobby()
        let viewModel = Self.viewModel(api, connector, timer: RecordingTimer())
        let card = try #require(LobbyFixture.card(9))
        var before: Int?
        await connector.drive { command in
            if case .pick = command {
                #expect(viewModel.model(at: Self.phone)?.yourTurn == true)
                await viewModel.draft(card.call)
                // Sent, not applied: the pick lands only when its row comes back.
                before = viewModel.lobby?.picks.count
            } else {
                await viewModel.close()
            }
        }
        await viewModel.run()
        #expect(before == 8)
        let mine = viewModel.lobby?.picks.first { $0.pick == 9 }
        #expect(mine?.seat == 9)
        #expect(mine?.madeBy == .drafter)
        let sent = await connector.sent.first ?? []
        #expect(sent.contains(.object([
            "type": .string("pick"), "player_id": .string(card.call), "pick": .number(9),
        ])))
    }

    @Test func aDropReconnectsWithTheLastSeqAndLosesNoRow() async throws {
        let rows = try Self.rows()
        let cut = 20
        let first = [Self.welcome(rows[0])] + rows[1 ..< cut].map(Self.update) + [.close(RoomClosed(code: 1006))]
        let missed = rows[cut ..< cut + 3].flatMap(\.self)
        let second = [Self.welcome(missed)] + rows[(cut + 3)...].map(Self.update) + [.end]
        let connector = ScriptedConnector([first, second])
        let timer = RecordingTimer()
        let viewModel = Self.viewModel(StubLobby(), connector, timer: timer)
        await connector.drive { _ in await viewModel.close() }
        await viewModel.run()
        let lastSeq = try #require(rows[cut - 1].last?.seq)
        let hellos = await connector.sent.map(\.first)
        #expect(hellos == [
            .object(["type": .string("hello"), "last_seq": .number(0)]),
            .object(["type": .string("hello"), "last_seq": .number(Double(lastSeq))]),
        ])
        #expect(await timer.waits == [.milliseconds(250)])
        #expect(try viewModel.lobby == Self.replayedEnd())
    }

    @Test func aSeqGapReadsTheRoomAgainAndReplaysFromTheWelcome() async throws {
        let rows = try Self.rows()
        let cut = 20
        // The frame at `cut` is lost: the next update skips its seqs.
        let first = [Self.welcome(rows[0])] + rows[1 ..< cut].map(Self.update) + [Self.update(rows[cut + 1])]
        let second = [Self.welcome(rows.flatMap(\.self)), .end]
        let connector = ScriptedConnector([first, second])
        let timer = RecordingTimer()
        let api = StubLobby()
        let viewModel = Self.viewModel(api, connector, timer: timer)
        var stateBeforeGap: LobbyState?
        await connector.drive { _ in await viewModel.close() }
        let watch = Task { @MainActor in
            while await connector.closes.isEmpty {
                stateBeforeGap = viewModel.lobby
                await Task.yield()
            }
        }
        await viewModel.run()
        watch.cancel()
        #expect(await connector.closes.first == RoomClosed(code: 1000, reason: "resync"))
        // The room was read again, at once, with no wait on the ladder, and the second socket said hello
        // from nothing, so its welcome carried the whole log.
        #expect(await api.reads == 2)
        #expect(await timer.waits.isEmpty)
        let hellos = await connector.sent.map(\.first)
        #expect(hellos.last == .object(["type": .string("hello"), "last_seq": .number(0)]))
        // The skipped rows were never applied on their own: the state stopped before the gap.
        let gapStart = try #require(rows[cut].first?.seq)
        let before = try #require(stateBeforeGap)
        #expect(before.seq < gapStart)
        #expect(try viewModel.lobby == Self.replayedEnd())
    }

    @Test func aGapWhoseRoomReadIsRefusedStopsForGood() async throws {
        let rows = try Self.rows()
        let connector = ScriptedConnector([[Self.welcome(rows[0]), Self.update(rows[2])]])
        let api = StubLobby()
        await api.setRefusal(404, fromRead: 2)
        let timer = RecordingTimer()
        let viewModel = Self.viewModel(api, connector, timer: timer)
        await viewModel.run()
        #expect(await api.reads == 2)
        #expect(viewModel.state == .failed(Words.Lobby.gone, final: true))
        #expect(await connector.tokens.count == 1)
        #expect(await timer.waits.isEmpty)
    }

    @Test func a1008CloseSignsOutWithTheRoomsSentence() async throws {
        var signedOut = false
        let rows = try Self.rows()
        let connector = ScriptedConnector([[
            Self.welcome(rows[0]),
            .server(#"{"type":"error","code":"unauthorized","message":"Sign in to do that"}"#),
            .close(RoomClosed(code: 1008, reason: "signed out")),
        ]])
        let viewModel = Self.viewModel(StubLobby(), connector, timer: RecordingTimer(), signedOut: { signedOut = true })
        await viewModel.run()
        #expect(signedOut)
        #expect(viewModel.stopped == "Sign in to do that")
        #expect(!viewModel.open)
    }

    @Test func aRoomReadRefusedWith403IsFinalAndNeverPolled() async {
        let api = StubLobby()
        await api.setRefusal(403)
        let connector = ScriptedConnector([])
        let timer = RecordingTimer()
        let viewModel = Self.viewModel(api, connector, timer: timer)
        await viewModel.run()
        #expect(viewModel.state == .failed(Words.Lobby.noSeat, final: true))
        #expect(await api.reads == 1)
        #expect(await connector.tokens.isEmpty)
        #expect(await timer.waits.isEmpty)
    }

    @Test func aReadThatDidNotGoIsReadAgainInPlaceOnTryAgain() async throws {
        let api = StubLobby()
        await api.setRefusal(503)
        let rows = try Self.rows()
        let connector = ScriptedConnector([[Self.welcome(rows[0]), .end]])
        let viewModel = Self.viewModel(api, connector, timer: RecordingTimer())
        await viewModel.run()
        #expect(viewModel.state == .failed(Words.Mock.unreachable, final: false))
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
        let viewModel = Self.viewModel(api, connector, timer: RecordingTimer())
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

    @Test func aRoomRefusedForGoodIsNeverReadAgain() async {
        let api = StubLobby()
        await api.setRefusal(404)
        let viewModel = Self.viewModel(api, ScriptedConnector([]), timer: RecordingTimer())
        await viewModel.run()
        await viewModel.run()
        #expect(viewModel.state == .failed(Words.Lobby.gone, final: true))
        #expect(await api.reads == 1)
    }

    @Test func anUpgradeRefusedWith403StopsWithTheLobbysWords() async {
        let connector = ScriptedConnector([[.close(RoomClosed(code: 1006, status: 403))]])
        let viewModel = Self.viewModel(StubLobby(), connector, timer: RecordingTimer())
        await viewModel.run()
        #expect(viewModel.stopped == Words.Lobby.noSeat)
        #expect(await connector.tokens.count == 1)
    }

    @Test func leaveGoesThroughTheAPIAndAsksTheWebsQuestion() async throws {
        let api = StubLobby()
        let rows = try Self.rows()
        let connector = ScriptedConnector([[Self.welcome(rows[0]), .end]])
        let viewModel = Self.viewModel(api, connector, timer: RecordingTimer())
        await connector.drive { _ in
            #expect(viewModel.leaveQuestion == Words.Lobby.leaveFilling)
            #expect(await viewModel.leave())
        }
        await viewModel.run()
        #expect(await api.leaves == 1)
        #expect(await connector.closes == [RoomClosed(code: 1000, reason: "left the page")])
    }
}
