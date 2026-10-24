@testable import CommishCore
import Foundation
import Testing

/// The copy rules over every word the app prints: shared/words/banned-words.json (the web's and the
/// research writer's one list) and its marks, over the word tables (the generated web words, the
/// app's own and the ported ones) and any string catalog; and no view writes a word of its own.
struct CopyGuardTests {
    private static let apps = Fixtures.shared.appendingPathComponent("../apps/ios").standardized

    @Test func theGuardCatchesAndSparesTheListsOwnExamples() throws {
        let guardian = try CopyGuard.shared()
        for text in guardian.examples.caught {
            #expect(guardian.banned(in: text) != nil, "should catch: \(text)")
        }
        for text in guardian.examples.spared {
            #expect(guardian.banned(in: text) == nil, "should spare: \(text)")
        }
    }

    @Test func everyWordTableAndCatalogPassesTheCopyRules() throws {
        let guardian = try CopyGuard.shared()
        let files = try Self.wordFiles()
        #expect(files.count >= 3, "\(files)")
        for file in files {
            for text in try Self.strings(in: file) {
                #expect(guardian.banned(in: text) == nil, "\(file.lastPathComponent): \(text)")
            }
        }
    }

    @Test func noViewWritesAWordOfItsOwn() throws {
        let literal =
            try NSRegularExpression(
                pattern: #"\b(Text|Label|Button|navigationTitle|Verb|QuietButton|BasisText|SectionHead|Pill)\(\s*""#
            )
        for file in try Self.swiftFiles(under: ["Commish", "Packages/Features"]) {
            let source = try String(contentsOf: file, encoding: .utf8)
            let found = literal.firstMatch(in: source, range: NSRange(source.startIndex..., in: source))
            #expect(found == nil, "\(file.path) writes a literal word")
        }
    }

    /// The generated web words, every literal in the Core (its word tables and the sentences its
    /// ported readers build), and every string catalog in the app.
    static func wordFiles() throws -> [URL] {
        let tables = try swiftFiles(under: ["Packages/CommishCore/Sources/CommishCore"])
        let generated = apps.appendingPathComponent(
            "Packages/CommishDesign/Sources/CommishDesign/Words.generated.swift"
        )
        let catalogs = try files(under: ["Commish"]).filter { $0.pathExtension == "xcstrings" }
        return [generated] + tables + catalogs
    }

    static func swiftFiles(under folders: [String]) throws -> [URL] {
        try files(under: folders).filter { $0.pathExtension == "swift" && !$0.path.contains("/.build/") }
    }

    static func files(under folders: [String]) throws -> [URL] {
        folders.flatMap { folder -> [URL] in
            let root = apps.appendingPathComponent(folder)
            let walker = FileManager.default.enumerator(at: root, includingPropertiesForKeys: nil)
            return (walker?.allObjects as? [URL]) ?? []
        }
    }

    /// The string literals of a Swift file (comments are not copy), or a catalog's source strings.
    static func strings(in file: URL) throws -> [String] {
        let text = try String(contentsOf: file, encoding: .utf8)
        if file.pathExtension == "xcstrings" {
            let catalog = try JSONSerialization.jsonObject(with: Data(text.utf8)) as? [String: Any]
            let entries = catalog?["strings"] as? [String: Any] ?? [:]
            return Array(entries.keys)
        }
        let code = text.split(separator: "\n").filter { !$0.trimmingCharacters(in: .whitespaces).hasPrefix("//") }
        let literal = try NSRegularExpression(pattern: #""((?:[^"\\]|\\.)*)""#)
        // An interpolation is code, not copy: "\(rulesOwner(host))" says no word.
        let interpolation = try NSRegularExpression(pattern: #"\\\((?:[^()]|\([^()]*\))*\)"#)
        return code.flatMap { line -> [String] in
            let line = String(line)
            return literal.matches(in: line, range: NSRange(line.startIndex..., in: line)).compactMap {
                Range($0.range(at: 1), in: line).map { String(line[$0]) }
            }.map {
                interpolation.stringByReplacingMatches(
                    in: $0, range: NSRange($0.startIndex..., in: $0), withTemplate: " "
                )
            }
        }
    }
}
