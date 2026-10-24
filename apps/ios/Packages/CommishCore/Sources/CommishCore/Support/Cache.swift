import CommishAPI
import CryptoKit
import Foundation

/// A saved answer and when it was read.
public struct Cached<Value: Sendable>: Sendable {
    public let value: Value
    public let stamp: Date
}

extension Cached: Equatable where Value: Equatable {}

/// The last answer per screen, kept on the phone so the screen opens at once and with no signal,
/// dated by its stamp (spec §8).
public protocol AnswerCache: Sendable {
    func read<Value: Codable & Sendable>(_ type: Value.Type, route: String) async -> Cached<Value>?
    func write(_ value: some Codable & Sendable, route: String, stamp: Date) async
    func clear() async
}

/// One JSON file per route in a folder (the app's Caches folder). A file that will not read is no
/// answer: the screen then reads the API as on a first open.
public actor FileCache: AnswerCache {
    private let folder: URL

    public init(folder: URL) {
        self.folder = folder
    }

    /// The app's cache folder for answers.
    public static func standard() -> FileCache {
        let caches = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
        return FileCache(folder: caches.appendingPathComponent("answers", isDirectory: true))
    }

    public func read<Value: Codable & Sendable>(_: Value.Type, route: String) async -> Cached<Value>? {
        let file = folder.appendingPathComponent(Self.fileName(route))
        guard let data = try? Data(contentsOf: file),
              let saved = try? APIDecoding.decoder().decode(Saved<Value>.self, from: data)
        else {
            return nil
        }
        return Cached(value: saved.value, stamp: saved.stamp)
    }

    public func write(_ value: some Codable & Sendable, route: String, stamp: Date) async {
        guard let data = try? APIDecoding.encoder().encode(Saved(value: value, stamp: stamp)) else {
            return
        }
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        try? data.write(to: folder.appendingPathComponent(Self.fileName(route)), options: .atomic)
    }

    public func clear() async {
        try? FileManager.default.removeItem(at: folder)
    }

    /// A route's file: its SHA-256, so no route names a path outside the folder.
    static func fileName(_ route: String) -> String {
        SHA256.hash(data: Data(route.utf8)).map { String(format: "%02x", $0) }.joined() + ".json"
    }

    private struct Saved<Value: Codable>: Codable {
        let value: Value
        let stamp: Date
    }
}
