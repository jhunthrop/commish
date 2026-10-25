import CommishAPI
import Foundation

/// Why a read shown is a saved one: no connection, or the latest read failed another way.
public enum SavedReason: Equatable, Sendable {
    case offline
    case failed

    init(_ error: any Error) {
        self = error is URLError ? .offline : .failed
    }
}

/// A run file as read now or as last saved: its kept copy, when that copy was read, and why it is a
/// saved one (nil for this open's read).
struct FileRead<Value: Codable & Sendable & Equatable>: Sendable {
    let kept: Kept<Value>
    let stamp: Date
    let saved: SavedReason?

    var value: Value {
        kept.value
    }
}

/// The run's files the player sheet and page read, each kept on the phone with the ETag the API gave
/// it (Lane 185's ETags): a read names the kept ETag, a 304 keeps the copy and refreshes its stamp, and
/// with no answer the saved copy stands, saved with the reason. One file per route, so the sheet and
/// the page share the index, the manifest and the capture whoever reads them first.
struct RunFiles: Sendable {
    let cache: any AnswerCache
    let clock: any Clock

    /// The cache's key for a run file: its own, so no screen's saved read under the route is overwritten.
    static func key(_ route: String) -> String {
        "run-file:\(route)"
    }

    func read<Value: Codable & Sendable & Equatable>(
        _ route: String, _ fetch: @Sendable (String?) async throws -> RunRead<Value>
    ) async throws -> FileRead<Value> {
        let saved = await cache.read(Kept<Value>.self, route: Self.key(route))
        do {
            let kept = try await RunBoardReader.resolve(fetch(saved?.value.tag), kept: saved?.value)
            let stamp = clock.now
            await cache.write(kept, route: Self.key(route), stamp: stamp)
            return FileRead(kept: kept, stamp: stamp, saved: nil)
        } catch where !APIError.signsOut(error) && !Self.refused(error) {
            guard let saved else {
                throw error
            }
            return FileRead(kept: saved.value, stamp: saved.stamp, saved: SavedReason(error))
        }
    }

    /// The API answered and said no (a page the run lacks or holds): no saved copy stands in for it.
    static func refused(_ error: any Error) -> Bool {
        if case let APIError.envelope(code, _) = error {
            return code == "not_found" || code == "bad_request"
        }
        return false
    }
}

/// A non-run answer as read now or as last saved (his week): the same rule without an ETag.
struct AnswerRead<Value: Codable & Sendable>: Sendable {
    let value: Value
    let stamp: Date
    let saved: SavedReason?

    static func read(
        _ route: String, cache: any AnswerCache, clock: any Clock, _ fetch: @Sendable () async throws -> Value
    ) async throws -> AnswerRead<Value> {
        do {
            let value = try await fetch()
            let stamp = clock.now
            await cache.write(value, route: route, stamp: stamp)
            return AnswerRead(value: value, stamp: stamp, saved: nil)
        } catch where !APIError.signsOut(error) {
            guard let saved = await cache.read(Value.self, route: route) else {
                throw error
            }
            return AnswerRead(value: saved.value, stamp: saved.stamp, saved: SavedReason(error))
        }
    }
}
