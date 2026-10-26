import CommishAPI
import CommishDesign
import Foundation
import Observation

/// A shared draft opened from its link's code (web/src/routes/mock/share/[code]): the room as it stood,
/// read and never drafted in, or the report once it is finished; its one verb runs the same settings
/// and seed as the reader's own mock from the drafter's slot.
@MainActor
@Observable
public final class SharedMockViewModel {
    public enum State: Equatable, Sendable {
        case loading
        case room(MockRoomModel)
        case report(DraftReportModel, verb: String)
        case failed(String)
    }

    public private(set) var state: State = .loading
    public private(set) var starting = false
    public private(set) var problem: String?
    public let code: String
    private let api: any MockAPI
    private var room: MockRoom?
    private var filter = "All"

    public init(code: String, api: any MockAPI) {
        self.code = code
        self.api = api
    }

    public func load() async {
        do {
            let room = try await api.sharedMock(code: code)
            self.room = room
            if MockRoomModel.status(room) == "complete" {
                let report = try await api.sharedReport(code: code)
                let drafter: String?? = .some(room.sharedBy)
                state = .report(
                    DraftReportModel(
                        report, names: MockWords.seatNames(teams: report.teams, slot: report.slot, sharedBy: drafter),
                        seats: Words.Mock.botsByAdp, reshuffled: Words.Mock.reshuffled, sharedBy: drafter
                    ),
                    verb: MockWords.runShared(report.slot)
                )
            } else {
                show()
            }
        } catch {
            state = .failed(MockRoomViewModel.sentence(for: error))
        }
    }

    public func choose(filter: String) {
        self.filter = filter
        show()
    }

    /// Run this draft from the drafter's slot: the reader's own mock, the same settings and seed, its id.
    public func run() async -> String? {
        guard let room, !starting else {
            return nil
        }
        starting = true
        problem = nil
        defer { starting = false }
        var settings = room.settings
        settings.slot = room.slot
        do {
            return try await api.createMock(MockCreate(
                leagueId: nil,
                settings: .init(value1: settings),
                seed: room.seed
            )).id
        } catch {
            problem = MockRoomViewModel.sentence(for: error)
            return nil
        }
    }

    private func show() {
        guard let room, let board = room.board?.value1 else {
            return
        }
        var ui = MockRoomUI()
        ui.filter = filter
        state = .room(MockRoomModel(
            room: room, board: RoomBoardView(board, teams: room.teams), card: nil, ui: ui,
            sharedBy: .some(room.sharedBy)
        ))
    }
}
