import CommishAPI
import CommishCore
import CommishDesign
import CommishSnapshotSupport
import Foundation
@testable import MockRoom
import RunFixtures
import SwiftUI
import Testing

/// The lobby's mock, over the recorded lobby (shared/fixtures/lobby-room) replayed to each state on the
/// parity's clock, both themes, iPhone 17 Pro and iPhone SE, at 1x: the landing with three cards, one
/// your seat; the room before the start; the room on your turn; the room between your turns with a
/// notice; the report at 1st and well down the table; a room read that did not go, with Try again beside
/// the way out (B252).
@MainActor
struct LobbySnapshotTests {
    static let folder = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
        .appendingPathComponent("__Snapshots__")

    enum Scene: String, CaseIterable, Sendable {
        case landing
        case filling
        case yourTurn = "your-turn"
        case between
        case reportFirst = "report-first"
        case reportDown = "report-down"
        case failed
    }

    struct Case: Sendable {
        let scene: Scene
        let scheme: Scheme
        let device: SnapshotDevice
    }

    nonisolated static let cases: [Case] = Scene.allCases.flatMap { scene in
        [Scheme.light, .dark].flatMap { scheme in
            SnapshotDevice.screens.map { Case(scene: scene, scheme: scheme, device: $0) }
        }
    }

    /// The room replayed through the frame the parity draws a state at, and the parity's clock for it.
    /// A replayed state with the parity's clock and its card.
    struct Replayed {
        let lobby: LobbyState
        let now: Date
        let card: RoomCard?
    }

    static func state(_ name: String) throws -> Replayed {
        let parity = try #require(
            JSONSerialization.jsonObject(with: LobbyFixture.parity()) as? [String: Any]
        )
        let web = try #require((parity["states"] as? [String: Any])?[name] as? [String: Any])
        let frame = try #require(web["frame"] as? Int)
        let now = try #require((web["now"] as? String).flatMap(APIDecoding.parseDate))
        let room = try LobbyFixture.room()
        var lobby = LobbyState(room: room)
        for (index, step) in try LobbyFixture.steps().enumerated() where index <= frame {
            guard case let .server(text) = step, let frame = try RoomFrame.decode(text) else {
                continue
            }
            if case let .welcome(_, _, rows) = frame {
                lobby = lobby.applying(rows, you: room.you)
            } else if case let .update(_, rows) = frame {
                lobby = lobby.applying(rows, you: room.you)
            }
        }
        return Replayed(lobby: lobby, now: now, card: (web["card"] as? Int).flatMap(LobbyFixture.card))
    }

    static func view(_ item: Case) async throws -> AnyView {
        switch item.scene {
        case .landing:
            let landing = LobbyLandingViewModel(api: StubLobby())
            await landing.load()
            _ = await landing.join(LobbyFormat(value1: ._12Ppr))
            return framed(
                LobbyListView(head: landing.head, cards: landing.cards, problem: nil, enabled: true, join: { _ in })
                    .padding(.vertical, Tokens.Space.s4),
                item
            )
        case .failed:
            let height = MockRoomSnapshotTests.room(item.device)
            return framed(
                LobbyFailedView(sentence: Words.Mock.unreachable, retry: {}, back: {}).frame(height: height),
                item
            )
        case .reportFirst, .reportDown:
            let report = try LobbyFixture.report(item.scene == .reportFirst ? "jpk88" : "mara")
            let room = try LobbyFixture.room(complete: true)
            let names = (1 ... room.teams).map { seat in
                room.seats.first { $0.seat == seat }.map { LobbySeats.name($0, you: report.slot) } ?? "Bot \(seat)"
            }
            let model = DraftReportModel(
                report, names: names,
                seats: LobbyWords.seats(people: LobbySeats.people(room.seats.map(LobbySeats.kind)), teams: 12),
                reshuffled: Words.Mock.reshuffled
            )
            let verbs = MockReportVerbs(
                lead: Words.Lobby.joinAnother, run: {}, another: {}, anotherLabel: LobbyWords.soloAgain(report.slot),
                copied: false, copy: nil
            )
            return framed(MockReportScreen(report: model, verbs: verbs, parts: [.head]), item)
        case .filling, .yourTurn, .between:
            let name = item.scene == .filling ? "filling" : item.scene == .yourTurn ? "yourTurn" : "between"
            let replayed = try state(name)
            let room = try LobbyFixture.room()
            let model = LobbyRoomModel(
                room: room, board: RoomBoardView(room.board, teams: room.teams), lobby: replayed.lobby,
                card: replayed.card, now: replayed.now
            )
            let notices = item.scene == .between ? ["You are not on the clock."] : []
            return framed(
                LobbyRoomScreen(
                    model: model, notices: notices, complete: false, abandoned: false, actions: .none, live: false
                ),
                item
            )
        }
    }

    /// The screen on its phone under the room's top bar.
    static func framed(_ view: some View, _ item: Case) -> AnyView {
        let height = MockRoomSnapshotTests.room(item.device)
        return AnyView(
            VStack(spacing: 0) {
                LobbyTopBar(
                    open: [.filling, .yourTurn, .between].contains(item.scene),
                    close: {},
                    leave: {}
                )
                view.fixedSize(horizontal: false, vertical: true)
                    .frame(height: height, alignment: .top)
                    .clipped()
            }
            .frame(height: height + 45, alignment: .top)
        )
    }

    @Test(arguments: 0 ..< cases.count)
    func lobby(index: Int) async throws {
        let item = Self.cases[index]
        let name = "lobby-\(item.scene.rawValue)-\(item.device.name)-\(item.scheme)"
        let view = try await Self.view(item)
        Snapshot.shoot(view, named: name, device: item.device, scheme: item.scheme)
        let result = Snapshot.verify(view, named: name, device: item.device, scheme: item.scheme, in: Self.folder)
        #expect(result.matches, "\(result.message)")
    }
}
