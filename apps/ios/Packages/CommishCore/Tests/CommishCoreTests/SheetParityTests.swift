import CommishAPI
@testable import CommishCore
import Foundation
import RunFixtures
import Testing

/// The sheet's ports held to the web's (shared/fixtures/parity/sheet.json, written by
/// shared/scripts/sheet-parity.ts): the fixed tags, a tag tap, a typed tag, the status line, the first
/// name; and a write carrying the fixture's rows as the account holds them.
struct SheetParityTests {
    let parity: SheetParity

    init() throws {
        parity = try SheetParity.load()
    }

    @Test func theFixedTagsAreTheWebsInItsOrderAndTone() {
        #expect(SheetTags.fixed.map(\.tag) == parity.fixedTags.map(\.tag))
        #expect(SheetTags.fixed.map(\.label) == parity.fixedTags.map(\.label))
        #expect(SheetTags.fixed.map { SheetTags.tone($0.tag).rawValue } == parity.fixedTags.map(\.tone))
        for label in parity.labels {
            #expect(SheetTags.label(label.tag) == label.label)
            #expect(SheetTags.tone(label.tag).rawValue == label.tone)
        }
        #expect(SheetWords.defaultName == parity.defaultName)
    }

    @Test func aTagTapDoesWhatTheWebsDoes() {
        for toggle in parity.toggles {
            #expect(SheetTags.toggled(toggle.tags, toggle.tag) == toggle.after, "\(toggle.tags) + \(toggle.tag)")
        }
    }

    @Test func aTypedTagIsSpelledAndRefusedAsTheWebsIs() {
        for typed in parity.typed {
            let canonical = SheetTags.canonical(typed.tag)
            #expect(canonical == typed.canonical, "\(typed.tag)")
            #expect(SheetTags.problem(canonical) == typed.problem, "\(typed.tag)")
        }
    }

    @Test func theStatusLineSaysWhatTheWebsSays() throws {
        let answered = try #require(APIDecoding.parseDate(parity.answeredAt))
        for status in parity.statuses {
            let save: SheetSave = switch status.status {
            case "saving": .saving
            case "saved": .saved
            default: .failed(reason: status.problem ?? SheetWords.notSaved, changed: false)
            }
            let words = try SheetWords.status(
                save, changedAt: status.changedAt.flatMap(APIDecoding.parseDate), answeredAt: answered,
                players: status.players, zone: #require(TimeZone(identifier: "America/Chicago"))
            )
            #expect(words == status.words, "\(status.status) \(status.players)")
        }
    }

    @Test func aSaveTodayIsSaidAtTheReadersTime() throws {
        let changed = SheetClock.stamp
        let zone = try #require(TimeZone(identifier: "America/Chicago"))
        #expect(SheetWords.status(.saved, changedAt: changed, answeredAt: SheetClock.now, players: 3, zone: zone)
            == "Saved to your account at 10:41 AM")
    }

    @Test func theLimitsAreTheWebs() {
        let limits = parity.limits
        #expect(SheetLimits.rows == limits.rows)
        #expect(SheetLimits.sheetName == limits.sheetName)
        #expect(SheetLimits.playerId == limits.playerId)
        #expect(SheetLimits.playerName == limits.playerName)
        #expect(SheetLimits.team == limits.team)
        #expect(SheetLimits.tier == limits.tier)
        #expect(SheetLimits.note == limits.note)
        #expect(SheetLimits.tags == limits.tags)
        #expect(SheetLimits.tagLength == limits.tagLength)
        #expect(SheetLimits.headshot == limits.headshot)
    }

    /// The web's reasons with "line" said as the phone says it, "row" (SheetCSV).
    static func phone(_ web: String?) -> String? {
        web?.replacingOccurrences(of: "line", with: "row")
    }

    @Test func aFileReadsOnThePhoneAsTheWebReadsIt() {
        for file in parity.reads {
            do {
                let read = try SheetCSV.read(file.text)
                #expect(file.header == nil, "\(file.text.prefix(30))")
                #expect(read.ids == file.ids, "\(file.text.prefix(30))")
                #expect(read.skipped.map(\.line) == file.skipped.map(\.line), "\(file.text.prefix(30))")
                #expect(
                    read.skipped.map(\.reason) == file.skipped.map { Self.phone($0.reason) },
                    "\(file.text.prefix(30))"
                )
            } catch {
                #expect((error as? SheetCSV.HeaderError)?.message == Self.phone(file.header), "\(file.text.prefix(30))")
            }
        }
    }

    @Test func aRowWritesBackAsTheAccountHoldsIt() throws {
        let rows = try parityRows()
        let entries = sheetDetail(rows).value2.rows.map(SheetEntry.init)
        #expect(entries.map(\.input) == rows)
    }
}
