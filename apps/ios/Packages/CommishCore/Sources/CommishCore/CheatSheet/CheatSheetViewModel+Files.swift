import CommishAPI
import Foundation

/// Our board for an empty sheet (our-board.svelte.ts OurBoardState): on its way, here, not out for the
/// format, or failed to load.
public enum SheetBoard: Equatable, Sendable {
    case loading
    case ready([SheetEntry])
    case none
    case failed
}

/// The import panel (ImportPanel.svelte): closed, open with what was refused, the CSV on its way, or
/// what the import read and skipped.
public enum SheetImport: Equatable, Sendable {
    case closed
    case open(problem: String?)
    case sending
    case done(SheetImportWords)
}

/// What an import says once it is in: the players read, the lines skipped and why, the first twelve
/// named and the rest counted, and, when it read no player, that the sheet was kept as it was.
public struct SheetImportWords: Equatable, Sendable {
    public let read: String
    public let skipped: String?
    public let lines: [String]
    public let kept: String?

    init(_ result: SheetImportResult, kept: Bool) {
        read = SheetWords.read(result.imported)
        skipped = result.skipped.isEmpty ? nil : SheetWords.skipped(result.skipped.count)
        let named = result.skipped.prefix(SheetWords.skipsShown)
            .map { SheetWords.skip(line: $0.line, reason: $0.reason) }
        let rest = result.skipped.count - named.count
        lines = named + (rest > 0 ? [SheetWords.more(rest)] : [])
        self.kept = kept ? SheetWords.keptAsItWas : nil
    }
}

/// The export (files.ts downloadCsv, handed to the share sheet): writing, the file ready to share, or
/// why it is not.
public enum SheetExport: Equatable, Sendable {
    case idle
    case writing
    case ready(URL)
    case failed(String)
}

public extension CheatSheetViewModel {
    // MARK: our board for an empty sheet

    /// Our board for the empty sheet's format.
    internal func readBoard() async {
        board = .loading
        do {
            board = try await SheetStart.rows(run, format: format).map(SheetBoard.ready) ?? .none
        } catch {
            board = .failed
        }
    }

    /// The first players our board would put on the sheet (EmptySheet.svelte PREVIEWED).
    var preview: [SheetLine] {
        guard case let .ready(entries) = board else {
            return []
        }
        return entries.prefix(Self.previewed).enumerated().map { SheetModel.line($1, place: $0 + 1, save: .saved) }
    }

    static let previewed = 5

    /// Starts the account's sheet from our board, every row of it.
    func start() async {
        guard case let .ready(entries) = board, !starting else {
            return
        }
        starting = true
        startProblem = nil
        do {
            let made = try await api.createSheet(
                name: SheetWords.defaultName, format: format, rows: entries.map(\.input)
            )
            show(made, stamp: clock.now, stale: false)
            await keep()
        } catch where APIError.signsOut(error) {
            signedOut()
        } catch {
            startProblem = Self.reason(error)
        }
        starting = false
    }

    // MARK: import

    /// The panel's verb: "Replace my sheet" over rows, else "Use this sheet".
    var importVerb: String {
        entries.isEmpty ? SheetWords.use : SheetWords.replace
    }

    func openImport() {
        importing = .open(problem: nil)
    }

    func closeImport() {
        if importing != .sending {
            importing = .closed
            pasted = ""
        }
    }

    /// A chosen file read into the paste box, so the verb replaces the sheet with what the box shows:
    /// refused past 1 MB (files.ts readCsvFile) or when it is not text.
    func chose(file data: Data) {
        guard data.count <= SheetLimits.csvBytes else {
            importing = .open(problem: SheetWords.tooLarge)
            return
        }
        guard let text = String(data: data, encoding: .utf8) else {
            importing = .open(problem: SheetWords.unreadable)
            return
        }
        pasted = text
        importing = .open(problem: nil)
    }

    /// The CSV sent to the account's import, which replaces the rows: refused here past 1 MB, as the web
    /// refuses a file; an empty account's sheet made for it first and taken off again if the import is
    /// refused or reads no player; a sheet the import read no player into put back as it was.
    func importCSV(_ text: String) async {
        guard text.utf8.count <= SheetLimits.csvBytes else {
            importing = .open(problem: SheetWords.tooLarge)
            return
        }
        guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, importing != .sending else {
            return
        }
        importing = .sending
        var made: String?
        do {
            let id: String
            if let detail {
                id = detail.value1.id
            } else {
                let sheet = try await api.createSheet(name: SheetWords.defaultName, format: format, rows: [])
                made = sheet.value1.id
                id = sheet.value1.id
            }
            let before = detail?.value2.rows.map(SheetEntry.init) ?? []
            let result = try await api.importSheet(id: id, csv: text)
            let sheet = try await settle(result, id: id, made: made != nil, before: before)
            if result.imported > 0 {
                edits = [:]
            }
            if let sheet {
                show(sheet, stamp: clock.now, stale: false)
                await keep()
            }
            importing = .done(SheetImportWords(result, kept: result.imported == 0))
            pasted = ""
        } catch where APIError.signsOut(error) {
            signedOut()
        } catch {
            if let made {
                try? await api.deleteSheet(id: made)
            }
            importing = .open(problem: Self.reason(error))
        }
    }

    /// The sheet after an import: its answer, or with no player read the rows put back (or the sheet made
    /// for it taken off, nil).
    private func settle(
        _ result: SheetImportResult, id: String, made: Bool, before: [SheetEntry]
    ) async throws -> SheetDetail? {
        guard result.imported == 0 else {
            return result.sheet
        }
        if made {
            try await api.deleteSheet(id: id)
            return nil
        }
        guard !before.isEmpty else {
            return result.sheet
        }
        return try await api.replaceRows(
            id: id, rows: before.map(\.input), ifUpdatedAt: result.sheet.value1.updatedAt
        )
    }

    // MARK: export

    /// The account's sheet written as the CSV file (the web's format byte for byte: the API's EncodeCSV
    /// is held to the web's encodeCsv), fetched and kept on the phone under the API's file name for the
    /// share sheet. Held while an edit is not saved, which the account's file would leave out.
    func exportFile() async {
        guard let id = detail?.value1.id, !unsaved, export != .writing else {
            return
        }
        export = .writing
        do {
            let link = try await api.exportSheet(id: id)
            guard let url = URL(string: link.value2.url) else {
                throw APIError.emptyEnvelope
            }
            let data = try await api.download(url)
            try FileManager.default.createDirectory(at: exports, withIntermediateDirectories: true)
            let file = exports.appendingPathComponent((link.value1.fileName as NSString).lastPathComponent)
            try data.write(to: file, options: .atomic)
            export = .ready(file)
        } catch where APIError.signsOut(error) {
            signedOut()
        } catch {
            export = .failed(Self.reason(error))
        }
    }

    /// The share sheet closed.
    func finishExport() {
        export = .idle
    }
}
