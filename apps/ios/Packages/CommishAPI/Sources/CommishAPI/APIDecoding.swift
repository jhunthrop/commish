import Foundation

/// What the API answered instead of a payload: its envelope's error, or a body that was not one.
public enum APIError: Error, Equatable, Sendable {
    /// The envelope's `error`: its code (`not_found`, `unauthorized`) and the API's own sentence.
    case envelope(code: String, message: String)
    /// A status the operation does not document, with the API's request id when it sent one.
    case status(Int)
    /// The body held neither a payload nor an error.
    case emptyEnvelope

    /// The API refused the device token: it lapsed with its session, or the phone was unpaired.
    public static func signsOut(_ error: any Error) -> Bool {
        switch error {
        case APIError.status(401), APIError.envelope(code: "unauthorized", _): true
        default: false
        }
    }
}

/// Reads the API's envelope (`ok`, `data`, `error`, `request_id`) the way the generated client does:
/// dates as ISO 8601 with or without fractional seconds, unknown fields ignored.
public enum APIDecoding {
    public static func decoder() -> JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .custom { decoder in
            let text = try decoder.singleValueContainer().decode(String.self)
            guard let date = parseDate(text) else {
                throw DecodingError.dataCorrupted(
                    .init(codingPath: decoder.codingPath, debugDescription: "Not an ISO 8601 date: \(text)")
                )
            }
            return date
        }
        return decoder
    }

    public static func encoder() -> JSONEncoder {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .custom { date, encoder in
            var container = encoder.singleValueContainer()
            try container.encode(text(date))
        }
        encoder.outputFormatting = [.sortedKeys]
        return encoder
    }

    /// The envelope's payload as `T`, or the envelope's error thrown as ``APIError``.
    public static func envelopeData<T: Decodable>(_: T.Type, from body: Data) throws -> T {
        let envelope = try decoder().decode(Envelope<T>.self, from: body)
        if let data = envelope.data {
            return data
        }
        if let error = envelope.error {
            throw APIError.envelope(code: error.code, message: error.message)
        }
        throw APIError.emptyEnvelope
    }

    static let fractional = Date.ISO8601FormatStyle(includingFractionalSeconds: true)
    static let whole = Date.ISO8601FormatStyle()

    /// An instant as the API wrote it: to the millisecond, or to the microsecond where Postgres stamped
    /// it finer (a sheet's updated_at, which a guarded write sends back and the API compares exactly, so
    /// a stamp cut to milliseconds would be refused as changed). A millisecond instant reads as before.
    public static func text(_ date: Date) -> String {
        let micros = (date.timeIntervalSince1970 * 1_000_000).rounded()
        guard micros.truncatingRemainder(dividingBy: 1000) != 0 else {
            return date.formatted(fractional)
        }
        let seconds = (micros / 1_000_000).rounded(.down)
        let fraction = Int(micros - seconds * 1_000_000)
        let stamp = Date(timeIntervalSince1970: seconds).formatted(whole)
        return "\(stamp.dropLast()).\(String(format: "%06d", fraction))Z"
    }

    public static func parseDate(_ text: String) -> Date? {
        (try? fractional.parse(text)) ?? (try? whole.parse(text))
    }
}

private struct Envelope<T: Decodable>: Decodable {
    struct Problem: Decodable {
        let code: String
        let message: String
    }

    let data: T?
    let error: Problem?
}
