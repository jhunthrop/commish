import CommishAPI
import CommishDesign
import Foundation
import Observation

/// The lobby's report (web/src/routes/lobby/[id]/report): the room and its report read together, the
/// mock report's box score with the people's names in the field and "2 drafters, 10 bots" in its cells;
/// its verbs are the way back to the lobbies and the same draft against bots from the slot.
/// The web's lobby report has no share link, so neither has this.
@MainActor
@Observable
public final class LobbyReportViewModel {
    public enum State: Equatable, Sendable {
        case loading
        case report(DraftReportModel)
        case failed(String)
    }

    public private(set) var state: State = .loading
    public private(set) var starting = false
    public private(set) var problem: String?
    public private(set) var room: LobbyRoom?
    private var report: MockReport?

    public let id: String
    private let api: any LobbyAPI
    private let mocks: any MockAPI
    private let onSignedOut: @MainActor () -> Void

    public init(id: String, api: any LobbyAPI, mocks: any MockAPI, onSignedOut: @escaping @MainActor () -> Void = {}) {
        self.id = id
        self.api = api
        self.mocks = mocks
        self.onSignedOut = onSignedOut
    }

    public func load() async {
        do {
            async let room = api.lobby(id: id)
            async let report = api.lobbyReport(id: id)
            let (read, answer) = try await (room, report)
            self.room = read
            self.report = answer
            state = .report(Self.model(answer, room: read))
        } catch {
            if LobbyRefusal.status(error) == 401 {
                onSignedOut()
            }
            state = .failed(LobbyRefusal.sentence(error))
        }
    }

    /// The report as the lobby's page draws it: each seat's name (You, a handle, Bot N), the seats cell.
    public static func model(_ report: MockReport, room: LobbyRoom) -> DraftReportModel {
        let names = (1 ... max(room.teams, 1)).map { seat in
            room.seats.first { $0.seat == seat }.map { LobbySeats.name($0, you: room.you) } ?? "Bot \(seat)"
        }
        let people = LobbySeats.people(room.seats.map(LobbySeats.kind))
        return DraftReportModel(
            report, names: names, seats: LobbyWords.seats(people: people, teams: report.teams),
            reshuffled: Words.Mock.reshuffled
        )
    }

    /// The quiet verb's words.
    public var soloVerb: String? {
        report.map { LobbyWords.soloAgain($0.slot) }
    }

    /// The same draft against bots from the slot (actions.ts runAgain): the new mock's id.
    public func runSolo() async -> String? {
        guard let report, !starting else {
            return nil
        }
        starting = true
        defer { starting = false }
        var settings = report.settings
        settings.slot = report.slot
        do {
            return try await mocks.createMock(MockCreate(leagueId: nil, settings: .init(value1: settings), seed: nil)).id
        } catch {
            problem = LobbyRefusal.sentence(error)
            return nil
        }
    }
}
