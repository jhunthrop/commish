import CommishCore
import Foundation

/// The neutral platform the store shots draw in place of the league's own (shared/store/store-host.json,
/// Lane 310), read through the same words every screen takes. The store run names the file in STORE_HOST.
enum StoreHost {
    nonisolated static let variable = "STORE_HOST"

    static func words() throws -> HostWords {
        guard let path = ProcessInfo.processInfo.environment[variable] else {
            throw StoreHostError.unnamed
        }
        let entry = try JSONDecoder().decode(Entry.self, from: Data(contentsOf: URL(fileURLWithPath: path)))
        return HostWords(name: entry.name, placed: entry.placed, stamp: entry.stamp, own: entry.own)
    }

    private struct Entry: Decodable {
        let name: String
        let placed: String
        let stamp: String
        let own: String
    }
}

enum StoreHostError: Error {
    case unnamed
}

/// Every string a scene draws from (Lane 310): each string reachable from the views handed to the frame
/// (their models, stamps and pins) and the shell's bars, sorted once each. A screen can only draw what
/// these hold, so a platform's name in none of them is a platform's name in no pixel. The store check
/// (shared/store/scene-strings.ts) reads them for a platform's name.
enum SceneStrings {
    /// Where the lists are written, one JSON list per shot beside the PNGs.
    static let folder = "scene-strings"
    /// Deep enough for a view's model's rows' cells, short of looping through the framework's own types.
    private static let depthLimit = 40

    static func of(_ roots: [Any]) -> [String] {
        var walk = Walk()
        for root in roots {
            walk.visit(root, depth: 0)
        }
        return walk.found.sorted()
    }

    /// Writes a shot's list as the JSON the store check reads.
    static func write(_ roots: [Any], shot: StoreShot, into folder: String) throws {
        let dir = URL(fileURLWithPath: folder).appendingPathComponent(Self.folder)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .withoutEscapingSlashes]
        var data = try encoder.encode(of(roots))
        data.append(Data("\n".utf8))
        try data.write(to: dir.appendingPathComponent("\(shot.stem).json"))
    }

    private struct Walk {
        var found: Set<String> = []
        var seen: Set<ObjectIdentifier> = []

        mutating func visit(_ value: Any, depth: Int) {
            guard depth < SceneStrings.depthLimit else {
                return
            }
            if let text = value as? String {
                keep(text)
                return
            }
            if let text = value as? Substring {
                keep(String(text))
                return
            }
            if let text = value as? AttributedString {
                keep(String(text.characters))
                return
            }
            let mirror = Mirror(reflecting: value)
            if mirror.displayStyle == .class {
                guard seen.insert(ObjectIdentifier(value as AnyObject)).inserted else {
                    return
                }
            }
            for child in mirror.children {
                visit(child.value, depth: depth + 1)
            }
        }

        private mutating func keep(_ text: String) {
            if !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                found.insert(text)
            }
        }
    }
}
