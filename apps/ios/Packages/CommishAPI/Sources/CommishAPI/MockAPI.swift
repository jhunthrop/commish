import Foundation
import OpenAPIRuntime

public typealias MockRoom = Components.Schemas.MockRoom
public typealias MockCreate = Components.Schemas.MockCreate
public typealias RoomPick = Components.Schemas.RoomPick

/// The solo mock's calls (web/src/lib/room/api.ts `rooms`): start a mock, read it, draft, take a pick
/// back, Pick for me, Finish, the queue, the turn's call, the report, and a shared draft by its link's
/// code. Every write answers the room as it stands after it, so the screen is rebuilt from the
/// answer, never from a guess. The seam the view models' tests replace with a stub.
public protocol MockAPI: Sendable {
    /// POST /mocks: the room at the drafter's first turn, the board with it.
    func createMock(_ body: MockCreate) async throws -> MockRoom
    /// GET /mocks/{id}: the room as it stands, the board with it.
    func mock(id: String) async throws -> MockRoom
    /// POST /mocks/{id}/picks: the pick at the overall pick the drafter saw, the bots to his next turn.
    func pick(id: String, player: String, at pick: Int) async throws -> MockRoom
    /// POST /mocks/{id}/undo: one of the drafter's picks taken back, with every pick after it.
    func undo(id: String, pick: Int) async throws -> MockRoom
    /// POST /mocks/{id}/autopick?to_round=: the drafter's turns through that round made for him.
    func autopick(id: String, toRound: Int) async throws -> MockRoom
    /// POST /mocks/{id}/finish: every remaining turn made for him.
    func finish(id: String) async throws -> MockRoom
    /// PUT /mocks/{id}/queue: the whole queue, best first.
    func queue(id: String, players: [String]) async throws -> MockRoom
    /// GET /mocks/{id}/card: our call at the turn on the clock.
    func card(id: String) async throws -> RoomCard
    /// GET /mocks/{id}/report: the finished draft's report.
    func report(id: String) async throws -> MockReport
    /// GET /shared/mocks/{code}: a shared draft replayed, the board with it.
    func sharedMock(code: String) async throws -> MockRoom
    /// GET /shared/mocks/{code}/report: a shared, finished draft's report.
    func sharedReport(code: String) async throws -> MockReport
}

extension APIClient: MockAPI {
    public func createMock(_ body: MockCreate) async throws -> MockRoom {
        switch try await Self.unwrapped({ try await client.createMock(body: .json(body)) }) {
        case let .created(answer): return try Self.room(answer)
        case let .badRequest(answer): throw Self.problem(try answer.body.json)
        case let .unauthorized(answer): throw Self.problem(try answer.body.json)
        case let .forbidden(answer): throw Self.problem(try answer.body.json)
        case let .notFound(answer): throw Self.problem(try answer.body.json)
        case let .conflict(answer): throw Self.problem(try answer.body.json)
        case let .unsupportedMediaType(answer): throw Self.problem(try answer.body.json)
        case let .tooManyRequests(answer): throw Self.problem(try answer.body.json)
        case let .serviceUnavailable(answer): throw Self.problem(try answer.body.json)
        case let .undocumented(status, _): throw APIError.status(status)
        }
    }

    public func mock(id: String) async throws -> MockRoom {
        switch try await Self.unwrapped({ try await client.getMock(path: .init(id: id)) }) {
        case let .ok(answer): return try Self.room(answer)
        case let .notFound(answer): throw Self.problem(try answer.body.json)
        case let .undocumented(status, _): throw APIError.status(status)
        }
    }

    public func pick(id: String, player: String, at pick: Int) async throws -> MockRoom {
        let body = Components.Schemas.MockPickInput(playerId: player, pick: pick)
        switch try await Self.unwrapped({ try await client.pickMock(path: .init(id: id), body: .json(body)) }) {
        case let .ok(answer): return try Self.room(answer)
        case let .badRequest(answer): throw Self.problem(try answer.body.json)
        case let .notFound(answer): throw Self.problem(try answer.body.json)
        case let .conflict(answer): throw Self.problem(try answer.body.json)
        case let .unprocessableContent(answer): throw Self.problem(try answer.body.json)
        case let .undocumented(status, _): throw APIError.status(status)
        }
    }

    public func undo(id: String, pick: Int) async throws -> MockRoom {
        let body = Components.Schemas.MockUndoInput(pick: pick)
        switch try await Self.unwrapped({ try await client.undoMock(path: .init(id: id), body: .json(body)) }) {
        case let .ok(answer): return try Self.room(answer)
        case let .notFound(answer): throw Self.problem(try answer.body.json)
        case let .conflict(answer): throw Self.problem(try answer.body.json)
        case let .unprocessableContent(answer): throw Self.problem(try answer.body.json)
        case let .undocumented(status, _): throw APIError.status(status)
        }
    }

    public func autopick(id: String, toRound: Int) async throws -> MockRoom {
        let input = Operations.AutopickMock.Input(path: .init(id: id), query: .init(toRound: toRound))
        switch try await Self.unwrapped({ try await client.autopickMock(input) }) {
        case let .ok(answer): return try Self.room(answer)
        case let .badRequest(answer): throw Self.problem(try answer.body.json)
        case let .notFound(answer): throw Self.problem(try answer.body.json)
        case let .conflict(answer): throw Self.problem(try answer.body.json)
        case let .undocumented(status, _): throw APIError.status(status)
        }
    }

    public func finish(id: String) async throws -> MockRoom {
        switch try await Self.unwrapped({ try await client.finishMock(path: .init(id: id)) }) {
        case let .ok(answer): return try Self.room(answer)
        case let .notFound(answer): throw Self.problem(try answer.body.json)
        case let .conflict(answer): throw Self.problem(try answer.body.json)
        case let .undocumented(status, _): throw APIError.status(status)
        }
    }

    public func queue(id: String, players: [String]) async throws -> MockRoom {
        let body = Components.Schemas.MockQueueInput(playerIds: players)
        switch try await Self.unwrapped({ try await client.queueMock(path: .init(id: id), body: .json(body)) }) {
        case let .ok(answer): return try Self.room(answer)
        case let .badRequest(answer): throw Self.problem(try answer.body.json)
        case let .notFound(answer): throw Self.problem(try answer.body.json)
        case let .conflict(answer): throw Self.problem(try answer.body.json)
        case let .unprocessableContent(answer): throw Self.problem(try answer.body.json)
        case let .undocumented(status, _): throw APIError.status(status)
        }
    }

    public func card(id: String) async throws -> RoomCard {
        switch try await Self.unwrapped({ try await client.mockCard(path: .init(id: id)) }) {
        case let .ok(answer): return try Self.payload(answer.body.json.value2.data)
        case let .notFound(answer): throw Self.problem(try answer.body.json)
        case let .conflict(answer): throw Self.problem(try answer.body.json)
        case let .undocumented(status, _): throw APIError.status(status)
        }
    }

    public func report(id: String) async throws -> MockReport {
        switch try await Self.unwrapped({ try await client.mockReport(path: .init(id: id)) }) {
        case let .ok(answer): return try Self.payload(answer.body.json.value2.data)
        case let .notFound(answer): throw Self.problem(try answer.body.json)
        case let .conflict(answer): throw Self.problem(try answer.body.json)
        case let .undocumented(status, _): throw APIError.status(status)
        }
    }

    public func sharedMock(code: String) async throws -> MockRoom {
        switch try await Self.unwrapped({ try await client.sharedMock(path: .init(code: code)) }) {
        case let .ok(answer): return try Self.room(answer)
        case let .badRequest(answer): throw Self.problem(try answer.body.json)
        case let .unprocessableContent(answer): throw Self.problem(try answer.body.json)
        case let .undocumented(status, _): throw APIError.status(status)
        }
    }

    public func sharedReport(code: String) async throws -> MockReport {
        switch try await Self.unwrapped({ try await client.sharedMockReport(path: .init(code: code)) }) {
        case let .ok(answer): return try Self.payload(answer.body.json.value2.data)
        case let .badRequest(answer): throw Self.problem(try answer.body.json)
        case let .conflict(answer): throw Self.problem(try answer.body.json)
        case let .unprocessableContent(answer): throw Self.problem(try answer.body.json)
        case let .undocumented(status, _): throw APIError.status(status)
        }
    }

    /// A room answer's payload.
    static func room(_ answer: Components.Responses.MockRoomResponse) throws -> MockRoom {
        try payload(answer.body.json.value2.data)
    }
}
