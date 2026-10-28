import CommishAPI
@testable import CommishCore
import Foundation
import RunFixtures
import Testing

/// The cheat sheet's import over a stub account at a fixed clock (Lane 254): a file read on the phone
/// first, a list of names or a file that reads no player refused before any request, an import the
/// account answers sent and shown, one it refuses or reads no player from shown as refused with the sheet
/// read again and nothing written back, and no import while a row's write is on its way.
@MainActor
struct CheatSheetImportTests {
    @Test func anImportReplacesTheRowsAndSaysWhatItReadAndSkipped() async throws {
        let (stub, viewModel) = try await CheatSheetViewModelTests.loaded()
        let skips = (1 ... 14).map { Components.Schemas.ImportSkip(
            line: $0 + 1,
            reason: "The rank is not a whole number from 1"
        ) }
        let rows = try Array(parityRows().prefix(3))
        await stub.set(importAnswer: SheetImportAnswer(imported: 3, skipped: skips, rows: rows))
        #expect(viewModel.importVerb == SheetWords.replace)
        let csv = try SheetParity.load().csv
        await viewModel.importCSV(csv)
        #expect(await stub.imports == [csv])
        guard case let .done(words) = viewModel.importing else {
            Issue.record("the import did not finish: \(viewModel.importing)")
            return
        }
        #expect(words.read == "3 players read")
        #expect(words.skipped == "14 rows skipped")
        #expect(words.lines.count == 13)
        #expect(words.lines.first == "Row 2: The rank is not a whole number from 1")
        #expect(words.lines.last == "And 2 more")
        #expect(words.kept == nil)
        #expect(viewModel.model?.players == 3)
    }

    @Test func aRefusedImportSaysTheAPIsSentenceAndKeepsTheSheet() async throws {
        let (stub, viewModel) = try await CheatSheetViewModelTests.loaded()
        let sentence = "Some of that did not check out"
        await stub.set(importAnswer: nil, refusal: .envelope(code: "invalid", message: sentence))
        try await viewModel.importCSV(SheetParity.load().csv)
        #expect(viewModel.importing == .open(problem: sentence))
        #expect(viewModel.model?.players == 8)
        #expect(await stub.writes.isEmpty)
    }

    @Test func aPastedListOfNamesIsRefusedBeforeAnyRequest() async {
        let stub = SheetStub(nil)
        let viewModel = CheatSheetViewModelTests.viewModel(stub)
        await viewModel.load()
        await viewModel.importCSV("1. Puka Nacua\n2. Ja'Marr Chase")
        #expect(viewModel.importing == .open(problem: "The first row must name rank, player_id, name and position"))
        #expect(await stub.imports.isEmpty)
        #expect(await stub.created.isEmpty, "no sheet is made")
        #expect(await stub.deleted.isEmpty)
        #expect(viewModel.model == nil)
    }

    @Test func noImportWhileARowsWriteIsOnItsWay() async throws {
        let (stub, viewModel) = try await CheatSheetViewModelTests.loaded()
        viewModel.save = .saving
        viewModel.openImport()
        #expect(viewModel.importing == .closed)
        try await viewModel.importCSV(SheetParity.load().csv)
        #expect(await stub.imports.isEmpty)
    }

    @Test func aFileOverOneMegabyteIsRefusedBeforeItIsSent() async throws {
        let (stub, viewModel) = try await CheatSheetViewModelTests.loaded()
        await viewModel.importCSV(String(repeating: "x", count: SheetLimits.csvBytes + 1))
        #expect(viewModel.importing == .open(problem: SheetWords.tooLarge))
        #expect(await stub.imports.isEmpty)
    }

    @Test func aFileThatReadsNoPlayerOnThePhoneIsNotSent() async throws {
        let (stub, viewModel) = try await CheatSheetViewModelTests.loaded()
        await viewModel.importCSV("rank,player_id,name,position\n1,x,Somebody,LB\n")
        guard case let .done(words) = viewModel.importing else {
            Issue.record("the read was not shown: \(viewModel.importing)")
            return
        }
        #expect(words.read == "0 players read")
        #expect(words.lines == ["Row 2: The position is not QB, RB, WR, TE, K or DST"])
        #expect(words.kept == SheetWords.keptAsItWas)
        #expect(await stub.imports.isEmpty)
        #expect(await stub.writes.isEmpty)
        #expect(viewModel.model?.players == 8)
    }

    @Test func anImportTheAccountReadsNoPlayerFromIsRefusedAndTheSheetReadAgain() async throws {
        let (stub, viewModel) = try await CheatSheetViewModelTests.loaded()
        let skip = Components.Schemas.ImportSkip(line: 2, reason: "name: runs 1 to 80 characters")
        await stub.set(importAnswer: SheetImportAnswer(imported: 0, skipped: [skip], rows: []))
        try await viewModel.importCSV(SheetParity.load().csv)
        guard case let .done(words) = viewModel.importing else {
            Issue.record("the import did not finish")
            return
        }
        #expect(words.read == "0 players read")
        #expect(words.kept == SheetWords.readNone)
        #expect(await stub.writes.isEmpty, "the old rows are never written back")
        #expect(await stub.reads == 2, "the sheet is read again")
        #expect(viewModel.model?.players == 0, "the phone shows what the account holds")
        #expect(viewModel.model?.line.contains(SheetWords.saved) != true)
    }

    @Test func anImportIntoAnEmptyAccountMakesTheSheetAndTakesItOffWhenRefused() async throws {
        let stub = SheetStub(nil)
        let viewModel = CheatSheetViewModelTests.viewModel(stub)
        await viewModel.load()
        #expect(viewModel.model == nil)
        #expect(viewModel.importVerb == SheetWords.use)
        await stub.set(importAnswer: nil, refusal: .envelope(code: "invalid", message: "Refused"))
        try await viewModel.importCSV(SheetParity.load().csv)
        #expect(viewModel.importing == .open(problem: "Refused"))
        #expect(await stub.created.count == 1)
        #expect(await stub.deleted == [SheetClock.sheetID])
        #expect(viewModel.model == nil)
        try await stub.set(importAnswer: SheetImportAnswer(imported: 8, skipped: [], rows: parityRows()))
        try await viewModel.importCSV(SheetParity.load().csv)
        #expect(viewModel.model?.players == 8)
    }
}
