@testable import CommishCore
import Foundation
import Testing

struct CacheTests {
    private let folder = FileManager.default.temporaryDirectory
        .appendingPathComponent("commish-cache-tests-\(UUID().uuidString)")

    private struct Answer: Codable, Equatable, Sendable {
        let words: String
    }

    @Test func anAnswerReadsBackWithItsStamp() async {
        let cache = FileCache(folder: folder)
        let stamp = Date(timeIntervalSince1970: 1_760_000_000)
        await cache.write(Answer(words: "hello"), route: "/leagues/attached/x/home", stamp: stamp)
        let read = await cache.read(Answer.self, route: "/leagues/attached/x/home")
        #expect(read == Cached(value: Answer(words: "hello"), stamp: stamp))
    }

    @Test func aRouteNeverWrittenReadsNothing() async {
        #expect(await FileCache(folder: folder).read(Answer.self, route: "/nowhere") == nil)
    }

    @Test func routesDoNotCollideAndNoRouteLeavesTheFolder() {
        let first = FileCache.fileName("/leagues/attached/a/home")
        let second = FileCache.fileName("/leagues/attached/b/home")
        #expect(first != second)
        #expect(FileCache.fileName("../../etc/passwd").contains("/") == false)
    }

    @Test func clearingForgetsEveryAnswer() async {
        let cache = FileCache(folder: folder)
        await cache.write(Answer(words: "x"), route: "/a", stamp: .now)
        await cache.clear()
        #expect(await cache.read(Answer.self, route: "/a") == nil)
    }
}

struct FormattingTests {
    private let zone = Fixtures.zone

    @Test func aStampReadsAsTheWebsWeekdayAndTime() {
        #expect(Formatting.weekdayTime(Fixtures.instant(Fixtures.week), zone: zone) == "Sat 12:00 pm")
        #expect(Formatting.weekdayTime(Fixtures.instant("2026-10-16T02-00-00Z"), zone: zone) == "Thu 9:00 pm")
    }

    @Test func theZoneIsNamedShort() {
        #expect(Formatting.zoneWord(zone) == "Central")
    }

    @Test func numbersReadAsTheWebPrintsThem() {
        #expect(Formatting.fixed(0) == "0.0")
        #expect(Formatting.fixed(73.25) == "73.3")
        #expect(Formatting.dollars(1000) == "$1,000")
        #expect(Formatting.ordinal(1) == "1st")
        #expect(Formatting.ordinal(12) == "12th")
        #expect(Formatting.ordinal(23) == "23rd")
        #expect(Formatting.plural(1, "player") == "1 player")
        #expect(Formatting.plural(10, "player") == "10 players")
    }
}
