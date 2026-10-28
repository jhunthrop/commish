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

/// What an import says once it is in or refused: the players read, the lines skipped and why, the first
/// twelve named and the rest counted, and, when it read no player, what became of the sheet.
public struct SheetImportWords: Equatable, Sendable {
    public let read: String
    public let skipped: String?
    public let lines: [String]
    public let kept: String?

    init(read count: Int, skipped skips: [SheetCSV.Skip], kept: String?) {
        read = SheetWords.read(count)
        skipped = skips.isEmpty ? nil : SheetWords.skipped(skips.count)
        let named = skips.prefix(SheetWords.skipsShown).map { SheetWords.skip(line: $0.line, reason: $0.reason) }
        let rest = skips.count - named.count
        lines = named + (rest > 0 ? [SheetWords.more(rest)] : [])
        self.kept = kept
    }

    /// The account's answer, its reasons said with the phone's word for a line (SheetWords.rowWords).
    init(_ result: SheetImportResult) {
        self.init(
            read: result.imported,
            skipped: result.skipped.map { SheetCSV.Skip(line: $0.line, reason: SheetWords.rowWords($0.reason)) },
            kept: nil
        )
    }

    /// The account's refusal of a body that read to no player, in its own sentence: the sheet is as it was.
    init(refused sentence: String) {
        self.init(read: 0, skipped: [], kept: SheetWords.rowWords(sentence))
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

    /// The import panel opened; not while a row's write is on its way, whose answer would land over the
    /// imported rows.
    func openImport() {
        guard save != .saving else {
            return
        }
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

    /// A pasted or chosen text sent to the account's import, which replaces the rows; an empty account's
    /// sheet is made for it first. A list of names (a first line that does not name player_id) goes as it
    /// is, typed text/plain, and the account reads it against our board. A CSV is read on the phone first,
    /// as the web's panel reads it: a header that cannot be used is refused with its sentence and a file
    /// that reads no player with what it skipped, and nothing is sent or made. An import the account
    /// refuses because it read no player is shown as the import's result in the account's sentence, and the
    /// sheet read again as the account holds it; nothing is written back.
    func importText(_ text: String) async {
        guard text.utf8.count <= SheetLimits.csvBytes else {
            importing = .open(problem: SheetWords.tooLarge)
            return
        }
        guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, importing != .sending,
              save != .saving
        else {
            return
        }
        guard SheetCSV.looksLikeCSV(text) else {
            await send(.names(text))
            return
        }
        let read: SheetCSV.Read
        do {
            read = try SheetCSV.read(text)
        } catch {
            importing = .open(problem: (error as? SheetCSV.HeaderError)?.message ?? SheetWords.unreadable)
            return
        }
        guard !read.ids.isEmpty else {
            importing = .done(SheetImportWords(read: 0, skipped: read.skipped, kept: SheetWords.keptAsItWas))
            return
        }
        await send(.csv(text))
    }

    /// The code of the import's 400 (api/internal/sheets/handler.go, WriteInvalid): the body read to no
    /// player, or its first line was a header the import cannot use, and the sheet is as it was.
    internal static let readNothing = "invalid"

    private func send(_ body: SheetImportBody) async {
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
                show(sheet, stamp: clock.now, stale: false)
            }
            let result = try await api.importSheet(id: id, body: body)
            edits = [:]
            notices = [:]
            save = .idle
            show(result.sheet, stamp: clock.now, stale: false)
            await keep()
            importing = .done(SheetImportWords(result))
            pasted = ""
        } catch where APIError.signsOut(error) {
            signedOut()
        } catch let APIError.envelope(code, sentence) where code == Self.readNothing {
            importing = .done(SheetImportWords(refused: sentence))
            await reread(made: made)
        } catch {
            importing = .open(problem: Self.reason(error))
            await reread(made: made)
        }
    }

    /// After an import that did not land: the sheet made for it taken off, else the account's sheet read
    /// again, so the phone shows what the account holds (a failure leaves the made sheet shown, as it is).
    private func reread(made: String?) async {
        if let made {
            do {
                try await api.deleteSheet(id: made)
            } catch where APIError.signsOut(error) {
                signedOut()
                return
            } catch {
                return
            }
            show(nil, stamp: clock.now, stale: false)
            await keep()
            return
        }
        save = .idle
        await load()
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
