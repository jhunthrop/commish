@testable import CommishDesign
import Foundation
import Testing

/// A club is drawn as its chip, never a team logo (B245): the colours come from the shared table, every
/// club holds its letters at 4.5:1, and no source of the app builds or names a logo's address.
struct ClubChipTests {
    static let clubs = 32
    static let minContrast = 4.5
    static let minSources = 50
    /// A logo host path, the site's club image route, or a builder named for the mark (the web's
    /// web/src/lib/ui/club-mark.ts and headshot-provider.ts).
    static let marks = ["teamlogos", "/img/clubs", "clubMarkUrl", "upstreamClubMark", "func clubMark("]
    /// apps/ios, from this file's place in it.
    static let apps = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        .deletingLastPathComponent().deletingLastPathComponent()

    @Test func theTableNamesAllThirtyTwoClubsAndEachChipReads() {
        #expect(Tokens.Club.colors.count == Self.clubs)
        let weak = Tokens.Club.colors.filter { Self.contrast($0.value.fill, $0.value.ink) < Self.minContrast }
        #expect(weak.isEmpty, "\(weak.keys.sorted())")
        #expect(Tokens.Club.colors["HOU"] == ClubColor(fill: 0x03202F, ink: 0xFFFFFF))
    }

    @Test func noSourceOfTheAppBuildsOrNamesATeamLogosAddress() throws {
        let walker = try #require(FileManager.default.enumerator(at: Self.apps, includingPropertiesForKeys: nil))
        let sources = walker.compactMap { $0 as? URL }.filter { url in
            ["swift", "yml", "plist"].contains(url.pathExtension)
                && !url.path.contains("/.build/") && !url.path.contains("/DerivedData/")
                && url.lastPathComponent != "ClubChipTests.swift"
        }
        #expect(sources.count > Self.minSources, "only \(sources.count) sources under \(Self.apps.path)")
        let found = try sources.flatMap { url in
            let text = try String(contentsOf: url, encoding: .utf8)
            return Self.marks.filter { text.contains($0) }.map { "\(url.lastPathComponent): \($0)" }
        }
        #expect(found.isEmpty, "\(found)")
    }

    static func luminance(_ value: UInt32) -> Double {
        let rgb = RGB(value)
        let linear = [rgb.red, rgb.green, rgb.blue].map { channel in
            channel <= 0.03928 ? channel / 12.92 : pow((channel + 0.055) / 1.055, 2.4)
        }
        return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2]
    }

    static func contrast(_ one: UInt32, _ other: UInt32) -> Double {
        let lums = [luminance(one), luminance(other)]
        return ((lums.max() ?? 0) + 0.05) / ((lums.min() ?? 0) + 0.05)
    }
}
