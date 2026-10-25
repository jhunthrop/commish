import Foundation
import OpenAPIRuntime

public typealias RoomBoard = Components.Schemas.RoomBoard
public typealias BoardPlayer = Components.Schemas.BoardPlayer
/// The scoring formats the API keeps a board for: GET /boards/{format}.
public typealias BoardFormat = Operations.RoomBoard.Input.Path.FormatPayload

/// The Board's read (web/src/routes/(run)/board): the draft board in a scoring format, every player
/// in the order drafters take them with his position rank, his figures and his designation on the
/// newest injury capture. The seam the view model's tests replace with a stub.
public protocol BoardAPI: Sendable {
    func board(format: BoardFormat) async throws -> RoomBoard
}

extension APIClient: BoardAPI {
    public func board(format: BoardFormat) async throws -> RoomBoard {
        switch try await Self.unwrapped({ try await client.roomBoard(path: .init(format: format)) }) {
        case let .ok(answer):
            return try Self.payload(answer.body.json.value2.data)
        case let .badRequest(answer):
            throw try Self.problem(answer.body.json)
        case let .undocumented(status, _):
            throw APIError.status(status)
        }
    }
}
