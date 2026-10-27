import CommishAPI
@testable import CommishCore
import CommishDesign
import Foundation
import RunFixtures
import Testing

/// The pick race over the recorded lobby: off the clock Draft sends nothing; a pick sent on the clock
/// that the room overtakes (its clock drafts the seat first) is refused in the room's words, applies no
/// row of the member's own, and only a pick that goes out puts the refusal away (an off-clock Draft
/// leaves it, B252).
@MainActor
struct LobbyPickRaceTests {
    static let refusal = "You are not on the clock."

    /// The recorded rows through the frame that puts the drafter (seat 9) on the clock at 1.09, or
    /// through `pick` when given.
    static func opening(before pick: Int = 9) throws -> (rows: [RoomRow], next: [[RoomRow]]) {
        let rows = try LobbySocketTests.rows()
        let room = try LobbyFixture.room()
        var state = LobbyState(room: room)
        var upTo = 0
        for (index, batch) in rows.enumerated() where state.pickNumber < pick || !state.drafting {
            state = state.applying(batch, you: room.you)
            upTo = index
        }
        return (rows[0 ... upTo].flatMap(\.self), Array(rows[(upTo + 1)...]))
    }

    @Test func offTheClockDraftSendsNothing() async throws {
        // At 1.08 the clock is Bot 8's: the drafter is next, not on it.
        let (opening, _) = try Self.opening(before: 8)
        let connector = ScriptedConnector([[
            LobbySocketTests.welcome(opening), .client(RoomCommand.pick(playerID: "x", pick: 8).text), .end,
        ]])
        let viewModel = LobbySocketTests.viewModel(StubLobby(), connector, timer: RecordingTimer())
        let card = try #require(LobbyFixture.card(9))
        await connector.drive { command in
            if case .pick = command {
                #expect(viewModel.model(at: LobbySocketTests.phone)?.yourTurn == false)
                await viewModel.draft(card.call)
            } else {
                await viewModel.close()
            }
        }
        await viewModel.run()
        let sent = await connector.sent.first ?? []
        #expect(sent == [.object(["type": .string("hello"), "last_seq": .number(0)])])
    }

    /// B252 review M2: a Draft on the clock whose pick goes out puts the room's refusal away.
    @Test func aPickThatGoesOutPutsTheRefusalAway() async throws {
        let (opening, _) = try Self.opening()
        let queued = "That player is drafted."
        let connector = ScriptedConnector([[
            LobbySocketTests.welcome(opening),
            .server(#"{"type":"error","code":"conflict","message":"\#(queued)"}"#),
            .client(RoomCommand.pick(playerID: "x", pick: 9).text),
            .end,
        ]])
        let viewModel = LobbySocketTests.viewModel(StubLobby(), connector, timer: RecordingTimer())
        let card = try #require(LobbyFixture.card(9))
        var notices: [String?] = []
        await connector.drive { command in
            guard case .pick = command else {
                return
            }
            notices.append(viewModel.notice)
            await viewModel.draft(card.call)
            notices.append(viewModel.notice)
        }
        await viewModel.run()
        #expect(notices == [queued, nil])
        let sent = await connector.sent.first ?? []
        #expect(sent.filter { $0["type"] == .string("pick") }.count == 1)
    }

    /// B252 review M1: a Draft on the clock while the socket reconnects cannot go; the same refusal after
    /// the reconnect still shows, never hidden behind a dismissal it did not answer.
    @Test func aDraftWhileReconnectingHidesNoLaterRefusal() async throws {
        let (opening, _) = try Self.opening()
        let queued = "That player is drafted."
        let refused = ScriptedStep.server(#"{"type":"error","code":"conflict","message":"\#(queued)"}"#)
        let connector = ScriptedConnector([
            [LobbySocketTests.welcome(opening), refused, .close(RoomClosed(code: 1006))],
            [LobbySocketTests.welcome(opening), refused, .client(RoomCommand.queue([]).text), .end],
        ])
        let timer = TappingTimer()
        let viewModel = LobbySocketTests.viewModel(StubLobby(), connector, timer: timer)
        let card = try #require(LobbyFixture.card(9))
        var whileReconnecting: String?
        await timer.onWait {
            // On the clock with the socket down: the Draft is tapped and its pick cannot go.
            await viewModel.draft(card.call)
            whileReconnecting = viewModel.notice
        }
        var afterReconnect: String?
        await connector.drive { command in
            if case .queue = command {
                afterReconnect = viewModel.notice
            }
        }
        await viewModel.run()
        #expect(whileReconnecting == Words.Lobby.reconnecting)
        #expect(afterReconnect == queued)
        let sent = await connector.sent.flatMap(\.self)
        #expect(!sent.contains { $0["type"] == .string("pick") })
    }

    /// B252: an off-clock Draft sends nothing, so it puts no refusal away; the same refusal again shows.
    @Test func anOffClockDraftLeavesTheRefusalAndTheSameRefusalAgainShows() async throws {
        let (opening, _) = try Self.opening(before: 8)
        let queued = "That player is drafted."
        let refused = ScriptedStep.server(#"{"type":"error","code":"conflict","message":"\#(queued)"}"#)
        let connector = ScriptedConnector([[
            LobbySocketTests.welcome(opening),
            refused, .client(RoomCommand.queue([]).text),
            refused, .client(RoomCommand.queue([]).text),
            .end,
        ]])
        let viewModel = LobbySocketTests.viewModel(StubLobby(), connector, timer: RecordingTimer())
        let card = try #require(LobbyFixture.card(9))
        var notices: [String?] = []
        await connector.drive { command in
            guard case .queue = command else {
                return
            }
            if notices.isEmpty {
                // Refused, then the member taps Draft off the clock: nothing goes, the refusal stays.
                #expect(viewModel.notice == queued)
                await viewModel.draft(card.call)
            }
            notices.append(viewModel.notice)
        }
        await viewModel.run()
        #expect(notices == [queued, queued])
        let sent = await connector.sent.first ?? []
        #expect(!sent.contains { $0["type"] == .string("pick") })
    }

    @Test func aPickTheRoomOvertakesIsRefusedAndOnlyASentPickPutsItAway() async throws {
        let (opening, _) = try Self.opening()
        let last = try #require(opening.last?.seq)
        let card = try #require(LobbyFixture.card(9))
        // The room's clock drafts seat 9 before the member's pick lands: 1.09 by the clock, someone else.
        let clockPick = RoomRow(
            seq: last + 1, kind: "TIMER_EXPIRE", seat: 9,
            payload: .object([
                "pick": .object([
                    "pick": .number(9), "round": .number(1), "seat": .number(9),
                    "player_id": .string("4241389"), "auto": .bool(true), "by": .string("clock"),
                ]),
                "deadline": .string("2026-10-26T08:20:00Z"),
            ]),
            written: "2026-10-26T08:19:30Z"
        )
        let connector = ScriptedConnector([[
            LobbySocketTests.welcome(opening),
            .client(RoomCommand.pick(playerID: "x", pick: 9).text),
            LobbySocketTests.update([clockPick]),
            .server(#"{"type":"error","code":"conflict","message":"\#(Self.refusal)"}"#),
            .client(RoomCommand.queue([]).text),
            .end,
        ]])
        let viewModel = LobbySocketTests.viewModel(StubLobby(), connector, timer: RecordingTimer())
        var noticeAfterRefusal: String?
        var noticeAfterNextDraft: String?
        await connector.drive { command in
            switch command {
            case .pick:
                await viewModel.draft(card.call)
            case .queue:
                noticeAfterRefusal = viewModel.notice
                await viewModel.draft(card.call)
                noticeAfterNextDraft = viewModel.notice
            case .leave:
                await viewModel.close()
            }
        }
        await viewModel.run()
        #expect(noticeAfterRefusal == Self.refusal)
        // The next Draft is off the clock now: nothing is sent, so the refusal stays (B252).
        #expect(noticeAfterNextDraft == Self.refusal)
        let picks = viewModel.lobby?.picks ?? []
        #expect(picks.last?.pick == 9)
        #expect(picks.last?.madeBy == .clock)
        #expect(!picks.contains { $0.playerID == card.call })
        // One pick went out, at the pick on the clock when it was sent; the second Draft, off the clock
        // now, sent nothing.
        let sent = await connector.sent.first ?? []
        #expect(sent.filter { $0["type"] == .string("pick") } == [.object([
            "type": .string("pick"), "player_id": .string(card.call), "pick": .number(9),
        ])])
    }
}

/// A timer whose wait runs the test's step: the member's tap while the socket reconnects.
actor TappingTimer: PollTimer {
    private var step: (@MainActor @Sendable () async -> Void)?

    func onWait(_ step: @escaping @MainActor @Sendable () async -> Void) {
        self.step = step
    }

    func sleep(for _: Duration) async throws {
        await step?()
    }
}
