import CommishAPI
@testable import CommishCore
import Foundation
import RunFixtures
import Testing

/// The cheat sheet's view model over a stub account at a fixed clock (Lane 254): an edit's round trip
/// guarded by the sheet's stamp, an edit made with no signal or over a sheet changed elsewhere never
/// saying saved and saved by a retry, an import accepted and refused, the export's file as the web's,
/// and the empty sheet started from our board.
@MainActor
struct CheatSheetViewModelTests {
    static let zone = TimeZone(identifier: "America/Chicago")!

    static func viewModel(
        _ stub: SheetStub, cache: (any AnswerCache)? = nil, run: any RunAPI = StubRun(.standIn),
        signedOut: @escaping @MainActor () -> Void = {}
    ) -> CheatSheetViewModel {
        CheatSheetViewModel(
            api: stub, run: run, cache: cache ?? Self.cache(), clock: FixedClock(SheetClock.now), format: .ppr,
            zone: zone,
            exports: FileManager.default.temporaryDirectory.appendingPathComponent("sheet-exports-\(UUID())"),
            onSignedOut: signedOut
        )
    }

    static func cache() -> FileCache {
        FileCache(folder: FileManager.default.temporaryDirectory.appendingPathComponent("sheet-\(UUID().uuidString)"))
    }

    static func loaded() async throws -> (SheetStub, CheatSheetViewModel) {
        let stub = try SheetStub(sheetDetail(parityRows()))
        let viewModel = Self.viewModel(stub)
        await viewModel.load()
        return (stub, viewModel)
    }

    @Test func theSheetOpensWithItsRowsAndTheAccountsStamp() async throws {
        let (_, viewModel) = try await Self.loaded()
        let model = try #require(viewModel.model)
        #expect(model.name == "My sheet")
        #expect(model.line == "PPR · 8 players · Saved to your account at 10:41 AM")
        #expect(model.lines.map(\.place) == Array(1 ... 8))
        #expect(model.lines.first?.name == "Ja'Marr Chase")
        #expect(model.lines.first?.tags == [TagMark(label: "Target", tone: .you)])
        #expect(model.lines[3].tags.first == TagMark(label: "Avoid", tone: .loss))
        #expect(model.lines.allSatisfy { $0.save == .saved })
        #expect(model.ownTags == ["PPR bump"])
        #expect(viewModel.stampWords == nil)
    }

    @Test func aPositionNarrowsTheRowsAndKeepsTheirPlaces() async throws {
        let (_, viewModel) = try await Self.loaded()
        viewModel.choose(position: "RB")
        let model = try #require(viewModel.model)
        #expect(model.lines.map(\.place) == [2, 5])
        #expect(model.shown == "2 players shown")
        #expect(model.positions.map(\.label) == ["All", "QB", "RB", "WR", "K", "DST"])
    }

    @Test func aNoteIsWrittenWithEveryRowGuardedByTheStampAndSaved() async throws {
        let (stub, viewModel) = try await Self.loaded()
        await viewModel.setNote("4689114", "  Upside late  ")
        let writes = await stub.writes
        #expect(writes.count == 1)
        #expect(writes.first?.guarded == SheetClock.stamp)
        #expect(writes.first?.rows.count == 8)
        #expect(writes.first?.rows[5].note == "Upside late")
        #expect(viewModel.save == .saved)
        #expect(!viewModel.unsaved)
        let model = try #require(viewModel.model)
        #expect(model.lines[5].note == "Upside late")
        #expect(model.lines[5].save == .saved)
    }

    @Test func theGuardedStampGoesOutToTheMicrosecond() {
        #expect(APIDecoding.text(SheetClock.stamp) == "2026-10-23T15:41:07.123456Z")
        #expect(APIDecoding.text(SheetClock.now) == "2026-10-23T16:00:00.000Z")
    }

    @Test func aNoteThatReadsTheSameWritesNothing() async throws {
        let (stub, viewModel) = try await Self.loaded()
        await viewModel.setNote("4362628", "Round one, no thinking. ")
        #expect(await stub.writes.isEmpty)
    }

    @Test func aTagTapTakesItsOppositesPlaceAndAFullRowRefuses() async throws {
        let (stub, viewModel) = try await Self.loaded()
        #expect(await viewModel.toggleTag("4362628", "avoid"))
        #expect(await stub.writes.last?.rows.first?.tags == ["avoid"])
        await viewModel.toggleTag("4430807", "target")
        await viewModel.toggleTag("4430807", "breakout")
        #expect(await viewModel.toggleTag("4430807", "injury") == false)
        #expect(await viewModel.addTag("4430807", "late round") == SheetWords.full)
        #expect(await viewModel.addTag("4239996", "-late") == "A tag is 1 to 20 letters or numbers")
        #expect(await viewModel.addTag("4239996", "late   round") == nil)
        #expect(viewModel.model?.lines[4].tags.map(\.label) == ["Handcuff", "late round"])
    }

    @Test func anEditWithNoSignalSaysItIsNotSavedAndARetrySavesIt() async throws {
        let (stub, viewModel) = try await Self.loaded()
        await stub.set(offline: true)
        await viewModel.setNote("4689114", "Stash")
        #expect(viewModel.save == .failed(reason: SheetWords.offline, changed: false))
        let row = try #require(viewModel.model?.lines[5])
        #expect(row.note == "Stash", "the edit stays on the row")
        #expect(row.save == .unsaved(SheetWords.offline))
        #expect(row.save.words == "Not saved to your account. No connection.")
        #expect(viewModel.model?.line.hasSuffix(SheetWords.offline) == true, "the head never says saved")
        #expect(viewModel.unsaved)
        await stub.set(offline: false)
        await viewModel.retry()
        #expect(viewModel.save == .saved)
        #expect(viewModel.model?.lines[5].save == .saved)
        #expect(await stub.writes.last?.rows[5].note == "Stash")
    }

    @Test func anEditOverASavedCopyIsWrittenOnlyOnceTheAccountAnswers() async throws {
        let stub = try SheetStub(sheetDetail(parityRows()))
        let cache = Self.cache()
        await Self.viewModel(stub, cache: cache).load()
        await stub.set(offline: true)
        let viewModel = Self.viewModel(stub, cache: cache)
        await viewModel.load()
        #expect(viewModel.stale)
        #expect(viewModel.stampWords == "Last read Fri 11:00 am")
        await viewModel.toggleTag("3054850", "sleeper")
        #expect(viewModel.model?.lines[7].save == .unsaved(SheetWords.offline))
        await stub.set(offline: false)
        await viewModel.retry()
        #expect(await stub.reads == 2, "a saved copy is read again before the retry writes")
        #expect(viewModel.save == .saved)
        #expect(!viewModel.stale)
        #expect(await stub.writes.last?.rows[7].tags == ["sleeper"])
        #expect(await stub.writes.last?.guarded == SheetClock.stamp)
    }

    @Test func aSheetChangedOnAnotherDeviceIsReadAgainAndTheEditWrittenOverIt() async throws {
        let (stub, viewModel) = try await Self.loaded()
        await stub.set(changedElsewhere: true)
        await viewModel.setNote("4689114", "Stash")
        #expect(viewModel.save == .failed(reason: "This sheet changed on another device", changed: true))
        #expect(viewModel.model?.lines[5].save == .unsaved("This sheet changed on another device"))
        await viewModel.retry()
        #expect(viewModel.save == .saved)
        let writes = await stub.writes
        #expect(writes.count == 2)
        #expect(writes.last?.guarded == SheetClock.stamp.addingTimeInterval(30))
        #expect(writes.last?.rows[5].note == "Stash")
    }

    @Test func aRowTakenOffIsWrittenWithoutHim() async throws {
        let (stub, viewModel) = try await Self.loaded()
        await viewModel.remove("dst-BUF")
        #expect(await stub.writes.last?.rows.count == 7)
        #expect(viewModel.model?.players == 7)
    }

    @Test func aRefusedTokenSignsOut() async throws {
        let stub = try SheetStub(sheetDetail(parityRows()))
        await stub.set(refusesToken: true)
        var out = false
        let viewModel = Self.viewModel(stub) { out = true }
        await viewModel.load()
        #expect(out)
        #expect(viewModel.phase == .failed(AppWords.Failure.signedOut))
    }

    // MARK: import

    @Test func anImportReplacesTheRowsAndSaysWhatItReadAndSkipped() async throws {
        let (stub, viewModel) = try await Self.loaded()
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
        let (stub, viewModel) = try await Self.loaded()
        let sentence = "The first line must name rank, player_id, name and position"
        await stub.set(importAnswer: nil, refusal: .envelope(code: "invalid", message: sentence))
        await viewModel.importCSV("name,team\nJa'Marr Chase,CIN\n")
        #expect(viewModel.importing == .open(problem: sentence))
        #expect(viewModel.model?.players == 8)
    }

    @Test func aFileOverOneMegabyteIsRefusedBeforeItIsSent() async throws {
        let (stub, viewModel) = try await Self.loaded()
        await viewModel.importCSV(String(repeating: "x", count: SheetLimits.csvBytes + 1))
        #expect(viewModel.importing == .open(problem: SheetWords.tooLarge))
        #expect(await stub.imports.isEmpty)
    }

    @Test func anImportThatReadsNoPlayerPutsTheSheetBack() async throws {
        let (stub, viewModel) = try await Self.loaded()
        let skip = Components.Schemas.ImportSkip(line: 2, reason: "The position is not QB, RB, WR, TE, K or DST")
        await stub.set(importAnswer: SheetImportAnswer(imported: 0, skipped: [skip], rows: []))
        await viewModel.importCSV("rank,player_id,name,position\n1,x,Somebody,LB\n")
        guard case let .done(words) = viewModel.importing else {
            Issue.record("the import did not finish")
            return
        }
        #expect(words.read == "0 players read")
        #expect(words.kept == SheetWords.keptAsItWas)
        #expect(await stub.writes.last?.rows.count == 8)
        #expect(viewModel.model?.players == 8)
    }

    @Test func anImportIntoAnEmptyAccountMakesTheSheetAndTakesItOffWhenRefused() async throws {
        let stub = SheetStub(nil)
        let viewModel = Self.viewModel(stub)
        await viewModel.load()
        #expect(viewModel.model == nil)
        #expect(viewModel.importVerb == SheetWords.use)
        await stub.set(importAnswer: nil, refusal: .envelope(code: "invalid", message: "Refused"))
        await viewModel.importCSV("rank\n")
        #expect(await stub.created.count == 1)
        #expect(await stub.deleted == [SheetClock.sheetID])
        #expect(viewModel.model == nil)
        try await stub.set(importAnswer: SheetImportAnswer(imported: 8, skipped: [], rows: parityRows()))
        try await viewModel.importCSV(SheetParity.load().csv)
        #expect(viewModel.model?.players == 8)
    }

    // MARK: export

    @Test func theExportIsTheWebsFileUnderTheAPIsName() async throws {
        let (stub, viewModel) = try await Self.loaded()
        let csv = try SheetParity.load().csv
        await stub.set(export: "My sheet.csv", Data(csv.utf8))
        await viewModel.exportFile()
        guard case let .ready(file) = viewModel.export else {
            Issue.record("no file: \(viewModel.export)")
            return
        }
        #expect(file.lastPathComponent == "My sheet.csv")
        #expect(try Data(contentsOf: file) == Data(csv.utf8), "the file is shared as the export wrote it")
        viewModel.finishExport()
        #expect(viewModel.export == .idle)
    }

    @Test func theExportWaitsWhileAnEditIsNotSaved() async throws {
        let (stub, viewModel) = try await Self.loaded()
        await stub.set(offline: true)
        await viewModel.setNote("4689114", "Stash")
        await viewModel.exportFile()
        #expect(viewModel.export == .idle)
    }

    @Test func anExportWithNoSignalSaysSo() async throws {
        let (stub, viewModel) = try await Self.loaded()
        await stub.set(offline: true)
        await viewModel.exportFile()
        #expect(viewModel.export == .failed(SheetWords.offline))
    }

    // MARK: the empty sheet

    @Test func anEmptyAccountPreviewsOurBoardAndStartsFromIt() async throws {
        let stub = SheetStub(nil)
        let viewModel = Self.viewModel(stub)
        await viewModel.load()
        guard case let .ready(entries) = viewModel.board else {
            Issue.record("no board: \(viewModel.board)")
            return
        }
        let board = try RunFixture.standIn.board(format: "ppr-12")
        #expect(entries.count == board.rows.count + board.market.count)
        #expect(entries.first?.id == board.rows.first?.id)
        #expect(Set(entries.suffix(board.market.count).map(\.id)) == Set(board.market.map(\.id)))
        #expect(viewModel.preview.count == 5)
        #expect(viewModel.formatLabel == "PPR")
        await viewModel.start()
        #expect(await stub.created.first?.count == entries.count)
        #expect(viewModel.model?.players == entries.count)
        #expect(viewModel.model?.lines.first?.player.boardID == board.rows.first?.id)
    }

    @Test func aFormatTheRunHasNoBoardForSaysItIsNotOut() async {
        let viewModel = CheatSheetViewModel(
            api: SheetStub(nil), run: StubRun(.standIn), cache: Self.cache(), clock: FixedClock(SheetClock.now),
            format: .dynasty, zone: Self.zone
        )
        await viewModel.load()
        #expect(viewModel.board == .none)
    }
}
