import CommishAPI
@testable import CommishCore
import Foundation
import RunFixtures
import Testing

/// The cheat sheet's import over a stub account at a fixed clock (Lanes 254 and 278): a CSV read on the
/// phone first, a list of names sent as it is (text/plain) for the account to read, an import the account
/// answers shown with what it read and skipped, one it refuses for reading no player shown as the import's
/// result in its sentence with the sheet read again and nothing written back, any other refusal shown as
/// the panel's problem, and no import while a row's write is on its way.
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
        await viewModel.importText(csv)
        #expect(await stub.imports == [.csv(csv)])
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

    /// Every pasted list of the parity file: a list is sent as it is, typed text/plain, and what the account
    /// reads (the web's read, which the API is held to) is shown as a CSV import's is, each reason in the
    /// phone's word for a line; a list the account reads no player from is refused in its sentence; a first
    /// line that names player_id takes the CSV path.
    @Test func everyParityListIsSentAsNamesAndShownAsTheAccountReadsIt() async throws {
        let parity = try SheetParity.load()
        let rows = try parityRows()
        for list in parity.lists where !list.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            let (stub, viewModel) = try await CheatSheetViewModelTests.loaded()
            let skips = list.skipped.map { Components.Schemas.ImportSkip(line: $0.line, reason: $0.reason) }
            let kept = Array(rows.prefix(list.ids.count))
            await stub.set(importAnswer: SheetImportAnswer(imported: kept.count, skipped: skips, rows: kept))
            await viewModel.importText(list.text)
            if list.csv {
                #expect(await stub.imports == [.csv(list.text)], "\(list.text)")
                continue
            }
            #expect(await stub.imports == [.names(list.text)], "\(list.text)")
            guard case let .done(words) = viewModel.importing else {
                Issue.record("the import did not finish: \(viewModel.importing)")
                continue
            }
            #expect(words.read == SheetWords.read(kept.count))
            let named = list.skipped.prefix(SheetWords.skipsShown).map {
                Self.said($0.line, $0.reason.replacingOccurrences(of: "line", with: "row"), in: list.text)
            }
            #expect(Array(words.lines.prefix(named.count)) == named, "\(list.text)")
            if kept.isEmpty {
                #expect(words.kept == SheetStub.emptyRead, "\(list.text)")
                #expect(words.shape == (list.skipped.isEmpty ? SheetWords.listShape : nil), "\(list.text)")
                #expect(words.verb == SheetWords.fixList)
                #expect(viewModel.model?.players == 8, "the sheet is as it was")
                #expect(await stub.writes.isEmpty)
                continue
            }
            #expect(words.kept == nil)
            #expect(viewModel.model?.players == kept.count)
        }
    }

    /// "Row 3, Michael Thomas: reason" for a row of `text` that holds something, else "Row 3: reason": what
    /// the phone says for a pasted list's skipped row, written out here apart from the code.
    /// Space as the account reads it, a byte order mark among it.
    static let blank = CharacterSet.whitespacesAndNewlines.union(CharacterSet(charactersIn: "\u{FEFF}"))

    static func said(_ line: Int, _ reason: String, in text: String) -> String {
        let rows = text.components(separatedBy: "\n")
        let typed = line <= rows.count
            ? String(rows[line - 1].trimmingCharacters(in: Self.blank)
                .replacingOccurrences(of: #"^[0-9]+\s*[.)\-:]?\s+"#, with: "", options: .regularExpression)
                .prefix(40))
            : ""
        return typed.isEmpty ? "Row \(line): \(reason)" : "Row \(line), \(typed): \(reason)"
    }

    /// Every refusal of the parity file (Lane 297), pasted as the member would: a list the account refuses
    /// shows, under "0 players read" and the account's sentence, each row it skipped with what was typed on it
    /// and why; a CSV of a header alone is read on the phone, never sent, and says it held a header alone,
    /// never a list's shape. The verb is "Fix the list", which goes back to the box with the text kept;
    /// nothing is written.
    @Test func everyParityRefusalListsItsSkippedRowsAndFixTheListKeepsTheText() async throws {
        let parity = try SheetParity.load()
        #expect(parity.refusals.contains { !$0.error.skipped.isEmpty })
        #expect(parity.refusals.contains { $0.error.skipped.isEmpty })
        for refusal in parity.refusals {
            let (stub, viewModel) = try await CheatSheetViewModelTests.loaded()
            await stub.set(importAnswer: nil, refusal: refusal.refused)
            viewModel.openImport()
            viewModel.pasted = refusal.text
            await viewModel.importText(viewModel.pasted)
            guard case let .done(words) = viewModel.importing else {
                Issue.record("the refusal was not shown as the import's result: \(viewModel.importing)")
                continue
            }
            let skipped = refusal.error.skipped
            #expect(words.read == "0 players read")
            #expect(words.kept == refusal.error.fields.body)
            #expect(words.skipped == (skipped.isEmpty ? nil : SheetWords.skipped(skipped.count)))
            #expect(words.lines == skipped.map { Self.said($0.line, SheetWords.rowWords($0.reason), in: refusal.text) })
            #expect(words.shape == (skipped.isEmpty ? SheetWords.headerOnly : nil), "\(refusal.text)")
            #expect(words.verb == "Fix the list")
            #expect(await stub.imports.count == (refusal.csv ? 0 : 1), "a CSV is read on the phone first")
            #expect(await stub.writes.isEmpty)
            #expect(viewModel.model?.players == 8, "the sheet is as it was")
            viewModel.finishImport()
            #expect(viewModel.importing == .open(problem: nil))
            #expect(viewModel.pasted == refusal.text, "the text is kept to fix")
        }
        let named = try #require(parity.refusals.first { !$0.error.skipped.isEmpty })
        #expect(Self.said(3, "x", in: named.text) == "Row 3, Michael Thomas: x", "the typed name, not the count")
        #expect(Self.said(1, "x", in: named.text) == "Row 1, Puka Nacua: x", "the rank set aside")
    }

    @Test func aTypedRowIsCutAndAMissingOneSaysTheRowAlone() {
        let long = String(repeating: "Amon-Ra St. Brown ", count: 4)
        let words = SheetImportWords(
            refused: SheetStub.emptyRead,
            skipped: [.init(line: 1, reason: "R"), .init(line: 3, reason: "R"), .init(line: 9, reason: "R")],
            list: "\(long)\r\n   \nGibbs\r"
        )
        #expect(words.lines[0] == "Row 1, \(String(long.prefix(40)).trimmingCharacters(in: .whitespaces)): R")
        #expect(words.lines[1] == "Row 3, Gibbs: R")
        #expect(words.lines[2] == "Row 9: R")
    }

    /// An API from before Lane 297 refuses with its sentence alone: shown as the import's result, the shape
    /// said, the verb "Fix the list".
    @Test func anOlderAPIsRefusalWithoutRowsStillReadsAsTheResult() async throws {
        let (stub, viewModel) = try await CheatSheetViewModelTests.loaded()
        await stub.set(importAnswer: nil, refusal: APIError.envelope(code: "invalid", message: SheetStub.emptyRead))
        await viewModel.importText("Gibbs")
        guard case let .done(words) = viewModel.importing else {
            Issue.record("the refusal was not shown as the import's result: \(viewModel.importing)")
            return
        }
        #expect(words.kept == SheetStub.emptyRead)
        #expect(words.lines.isEmpty)
        #expect(words.shape == SheetWords.listShape)
        #expect(words.verb == SheetWords.fixList)
    }

    @Test func aResultThatReadPlayersSaysDone() throws {
        let rows = try Array(parityRows().prefix(1))
        let result = SheetImportResult(imported: 1, skipped: [], sheet: sheetDetail(rows))
        #expect(SheetImportWords(result).verb == SheetWords.done)
    }

    @Test func theAccountsWordForALineIsSaidAsARow() {
        #expect(SheetWords.rowWords("This player is already on an earlier line") ==
            "This player is already on an earlier row")
        #expect(SheetWords.rowWords("The first line must name rank, player_id, name and position") ==
            "The first row must name rank, player_id, name and position")
        #expect(SheetWords.rowWords("Lines past the limit") == "Rows past the limit")
        #expect(SheetWords.rowWords("A sideline pass") == "A sideline pass")
    }

    @Test func aListIsToldFromACSVByItsFirstLine() throws {
        for list in try SheetParity.load().lists {
            #expect(SheetCSV.looksLikeCSV(list.text) == list.csv, "\(list.text)")
        }
        #expect(SheetCSV.looksLikeCSV("\u{FEFF}\n  Rank,Player_ID,Name,Position\n1,a,B,QB"))
        // As the API reads it: a no-break space is not set aside, and "\r" alone does not end the line.
        #expect(!SheetCSV.looksLikeCSV("\u{00A0}\nrank,player_id,name,position"))
        #expect(SheetCSV.looksLikeCSV("Gibbs\rrank,player_id,name,position"))
    }

    @Test func aListOfNamesIntoAnEmptyAccountMakesTheSheetAndTakesItOffWhenNoPlayerIsRead() async {
        let stub = SheetStub(nil)
        let viewModel = CheatSheetViewModelTests.viewModel(stub)
        await viewModel.load()
        await viewModel.importText("Gibbs\nJahmyr")
        #expect(await stub.imports == [.names("Gibbs\nJahmyr")])
        guard case let .done(words) = viewModel.importing else {
            Issue.record("the refusal was not shown as the import's result: \(viewModel.importing)")
            return
        }
        #expect(words.read == "0 players read")
        #expect(words.kept == SheetStub.emptyRead)
        #expect(await stub.created.count == 1)
        #expect(await stub.deleted == [SheetClock.sheetID])
        #expect(viewModel.model == nil)
    }

    /// A list the account reads no player from and names no row for says why (its sentence), what a list
    /// that reads looks like, and "Fix the list" goes back to the box with the text kept; an import that read
    /// players closes.
    @Test func aListThatReadsNothingSaysWhatToPasteAndDoneKeepsTheText() async throws {
        let (stub, viewModel) = try await CheatSheetViewModelTests.loaded()
        viewModel.openImport()
        viewModel.pasted = "Puka Nacua - WR - LAR"
        await viewModel.importText(viewModel.pasted)
        guard case let .done(words) = viewModel.importing else {
            Issue.record("the refusal was not shown as the import's result: \(viewModel.importing)")
            return
        }
        #expect(words.kept == SheetStub.emptyRead)
        #expect(words.shape == SheetWords.listShape)
        #expect(words.again)
        viewModel.finishImport()
        #expect(viewModel.importing == .open(problem: nil))
        #expect(viewModel.pasted == "Puka Nacua - WR - LAR", "the text is kept to fix")
        try await stub.set(importAnswer: SheetImportAnswer(
            imported: 1,
            skipped: [],
            rows: Array(parityRows().prefix(1))
        ))
        await viewModel.importText("1. Ja'Marr Chase")
        guard case let .done(read) = viewModel.importing else {
            Issue.record("the import did not finish: \(viewModel.importing)")
            return
        }
        #expect(read.shape == nil)
        #expect(!read.again)
        viewModel.finishImport()
        #expect(viewModel.importing == .closed)
        #expect(viewModel.pasted.isEmpty)
    }

    @Test func aCSVThatReadsNoPlayerNamesItsRowsAndNoShape() async throws {
        let (_, viewModel) = try await CheatSheetViewModelTests.loaded()
        await viewModel.importText("rank,player_id,name,position\n1,x,Somebody,LB\n")
        guard case let .done(words) = viewModel.importing else {
            Issue.record("the read was not shown: \(viewModel.importing)")
            return
        }
        #expect(words.shape == nil, "the skipped row says why")
        #expect(words.again)
    }

    @Test func aRefusalForAnotherReasonSaysTheAPIsSentenceAndKeepsTheSheet() async throws {
        let (stub, viewModel) = try await CheatSheetViewModelTests.loaded()
        let sentence = "Our board did not load, so a list of names cannot be read yet"
        await stub.set(importAnswer: nil, refusal: APIError.envelope(code: "unavailable", message: sentence))
        await viewModel.importText("1. Puka Nacua")
        #expect(viewModel.importing == .open(problem: sentence))
        #expect(viewModel.model?.players == 8)
        #expect(await stub.writes.isEmpty)
    }

    @Test func aCSVWhoseHeaderCannotBeUsedIsRefusedBeforeAnyRequest() async {
        let stub = SheetStub(nil)
        let viewModel = CheatSheetViewModelTests.viewModel(stub)
        await viewModel.load()
        await viewModel.importText("player_id,name\n4362628,Ja'Marr Chase")
        #expect(viewModel.importing == .open(problem: "The first row must name rank, player_id, name and position"))
        #expect(await stub.imports.isEmpty)
        #expect(await stub.created.isEmpty, "no sheet is made")
        #expect(viewModel.model == nil)
    }

    @Test func noImportWhileARowsWriteIsOnItsWay() async throws {
        let (stub, viewModel) = try await CheatSheetViewModelTests.loaded()
        viewModel.save = .saving
        viewModel.openImport()
        #expect(viewModel.importing == .closed)
        try await viewModel.importText(SheetParity.load().csv)
        await viewModel.importText("1. Puka Nacua")
        #expect(await stub.imports.isEmpty)
    }

    @Test func aFileOverOneMegabyteIsRefusedBeforeItIsSent() async throws {
        let (stub, viewModel) = try await CheatSheetViewModelTests.loaded()
        await viewModel.importText(String(repeating: "x", count: SheetLimits.csvBytes + 1))
        #expect(viewModel.importing == .open(problem: SheetWords.tooLarge))
        #expect(await stub.imports.isEmpty)
    }

    @Test func aFileThatReadsNoPlayerOnThePhoneIsNotSent() async throws {
        let (stub, viewModel) = try await CheatSheetViewModelTests.loaded()
        await viewModel.importText("rank,player_id,name,position\n1,x,Somebody,LB\n")
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

    @Test func anImportTheAccountReadsNoPlayerFromIsShownInItsSentenceAndTheSheetReadAgain() async throws {
        let (stub, viewModel) = try await CheatSheetViewModelTests.loaded()
        await stub.set(importAnswer: nil)
        try await viewModel.importText(SheetParity.load().csv)
        guard case let .done(words) = viewModel.importing else {
            Issue.record("the import did not finish")
            return
        }
        #expect(words.read == "0 players read")
        #expect(words.kept == SheetStub.emptyRead)
        #expect(await stub.writes.isEmpty, "the old rows are never written back")
        #expect(await stub.reads == 2, "the sheet is read again")
        #expect(viewModel.model?.players == 8, "the account kept the sheet")
    }

    @Test func anImportIntoAnEmptyAccountMakesTheSheetAndTakesItOffWhenRefused() async throws {
        let stub = SheetStub(nil)
        let viewModel = CheatSheetViewModelTests.viewModel(stub)
        await viewModel.load()
        #expect(viewModel.model == nil)
        #expect(viewModel.importVerb == SheetWords.use)
        await stub.set(importAnswer: nil, refusal: APIError.envelope(code: "unavailable", message: "Refused"))
        try await viewModel.importText(SheetParity.load().csv)
        #expect(viewModel.importing == .open(problem: "Refused"))
        #expect(await stub.created.count == 1)
        #expect(await stub.deleted == [SheetClock.sheetID])
        #expect(viewModel.model == nil)
        try await stub.set(importAnswer: SheetImportAnswer(imported: 8, skipped: [], rows: parityRows()))
        try await viewModel.importText(SheetParity.load().csv)
        #expect(viewModel.model?.players == 8)
    }
}
