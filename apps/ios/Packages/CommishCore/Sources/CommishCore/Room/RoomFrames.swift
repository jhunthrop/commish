import Foundation

/// A JSON value as the room's log carries it in a row's payload (openapi.yaml `RoomAction.payload`,
/// an object whose shape depends on the row's kind), kept whole so a reader takes what it needs.
public enum RoomValue: Codable, Sendable, Equatable {
    case null
    case bool(Bool)
    case number(Double)
    case string(String)
    case array([RoomValue])
    case object([String: RoomValue])

    public init(from decoder: any Decoder) throws {
        let single = try decoder.singleValueContainer()
        if single.decodeNil() {
            self = .null
        } else if let value = try? single.decode(Bool.self) {
            self = .bool(value)
        } else if let value = try? single.decode(Double.self) {
            self = .number(value)
        } else if let value = try? single.decode(String.self) {
            self = .string(value)
        } else if let value = try? single.decode([RoomValue].self) {
            self = .array(value)
        } else {
            self = try .object(single.decode([String: RoomValue].self))
        }
    }

    public func encode(to encoder: any Encoder) throws {
        var single = encoder.singleValueContainer()
        switch self {
        case .null: try single.encodeNil()
        case let .bool(value): try single.encode(value)
        case let .number(value): try single.encode(value)
        case let .string(value): try single.encode(value)
        case let .array(value): try single.encode(value)
        case let .object(value): try single.encode(value)
        }
    }

    /// The value under a key of an object, nil for anything else.
    public subscript(key: String) -> RoomValue? {
        guard case let .object(fields) = self else {
            return nil
        }
        return fields[key]
    }
}

/// One row of the room's log (openapi.yaml `RoomAction`): its seq, its kind, the seat it is about and
/// its payload, as the room sent it.
public struct RoomRow: Codable, Sendable, Equatable {
    public let seq: Int64
    public let kind: String
    public let seat: Int?
    public let payload: RoomValue
    /// When the row was written, as the room wrote it.
    public let written: String

    enum CodingKeys: String, CodingKey {
        case seq, kind, seat, payload
        case written = "at"
    }

    public init(seq: Int64, kind: String, seat: Int?, payload: RoomValue, written: String) {
        self.seq = seq
        self.kind = kind
        self.seat = seat
        self.payload = payload
        self.written = written
    }
}

/// A frame the room sends (openapi.yaml `RoomWelcome`, `RoomUpdate`, `RoomError`).
public enum RoomFrame: Sendable, Equatable {
    /// The answer to the hello: every row after the hello's seq, the room's latest seq, its clock.
    case welcome(seq: Int64, now: Date, rows: [RoomRow])
    /// A batch of new rows, in seq order.
    case update(seq: Int64, rows: [RoomRow])
    /// A refusal in the room's own words.
    case error(code: String, message: String)

    private struct Wire: Decodable {
        let type: String
        let seq: Int64?
        let now: String?
        let actions: [RoomRow]?
        let code: String?
        let message: String?
    }

    /// The frame in a text message, or a thrown error for one the client does not know.
    public static func decode(_ text: String) throws -> RoomFrame {
        let wire = try JSONDecoder().decode(Wire.self, from: Data(text.utf8))
        switch wire.type {
        case "welcome":
            guard let seq = wire.seq, let now = wire.now.flatMap(RoomClockReading.parse) else {
                throw RoomFrameError.malformed(wire.type)
            }
            return .welcome(seq: seq, now: now, rows: wire.actions ?? [])
        case "update":
            guard let seq = wire.seq else {
                throw RoomFrameError.malformed(wire.type)
            }
            return .update(seq: seq, rows: wire.actions ?? [])
        case "error":
            return .error(code: wire.code ?? "", message: wire.message ?? "")
        default:
            throw RoomFrameError.malformed(wire.type)
        }
    }
}

public enum RoomFrameError: Error, Equatable {
    case malformed(String)
}

/// A frame the client sends: the hello, then commands (openapi.yaml `RoomHello`, `RoomCommand`).
public enum RoomCommand: Sendable, Equatable {
    /// The player and the overall pick the drafter saw on the clock, so a stale pick is refused.
    case pick(playerID: String, pick: Int)
    /// The whole queue, best first, at most 50; empty clears it.
    case queue([String])
    /// Give the seat up.
    case leave

    /// The command as its JSON text.
    public var text: String {
        switch self {
        case let .pick(playerID, pick):
            Self.json(["type": .string("pick"), "player_id": .string(playerID), "pick": .number(Double(pick))])
        case let .queue(ids):
            Self.json(["type": .string("queue"), "player_ids": .array(ids.map(RoomValue.string))])
        case .leave:
            Self.json(["type": .string("leave")])
        }
    }

    /// The hello with the last seq applied, 0 for none.
    public static func hello(lastSeq: Int64) -> String {
        json(["type": .string("hello"), "last_seq": .number(Double(lastSeq))])
    }

    static func json(_ fields: [String: RoomValue]) -> String {
        let encoder = JSONEncoder()
        encoder.outputFormatting = .sortedKeys
        guard let data = try? encoder.encode(RoomValue.object(fields)) else {
            return "{}"
        }
        return String(bytes: data, encoding: .utf8) ?? "{}"
    }
}

/// The room's clock as it writes it: RFC 3339 with or without a fraction.
enum RoomClockReading {
    static func parse(_ text: String) -> Date? {
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return fractional.date(from: text) ?? ISO8601DateFormatter().date(from: text)
    }
}
