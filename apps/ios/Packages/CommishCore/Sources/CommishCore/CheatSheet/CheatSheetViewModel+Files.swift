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
/// twelve named and the rest counted, and, when it read no player, what became of the sheet, what a list
/// that reads looks like when no skipped row says why (or, for a CSV, that it held a header alone), and that
/// its verb ("Fix the list") goes back to the box with the text kept so it can be fixed. A pasted list's
/// skipped rows repeat what was typed on them.
public struct SheetImportWords: Equatable, Sendable {
    public let read: String
    public let skipped: String?
    public let lines: [String]
    public let kept: String?
    /// When nothing was read and no skipped row says why: the shape a list is read in, or for a CSV that it
    /// held a header alone.
    public let shape: String?
    /// True when nothing was read: the verb goes back to the box, the text kept, to fix it.
    public let again: Bool

    /// `list` is the pasted list the account read, whose rows a skipped row repeats; nil for a CSV, whose
    /// rows the account numbers by record, not by the text's lines.
    init(read count: Int, skipped skips: [SheetCSV.Skip], kept: String?, list: String? = nil) {
        read = SheetWords.read(count)
        skipped = skips.isEmpty ? nil : SheetWords.skipped(skips.count)
        let typed = list.map(Self.rows) ?? []
        let named = skips.prefix(SheetWords.skipsShown).map { skip in
            Self.typed(typed, skip.line).map { SheetWords.skip(line: skip.line, typed: $0, reason: skip.reason) }
                ?? SheetWords.skip(line: skip.line, reason: skip.reason)
        }
        let rest = skips.count - named.count
        lines = named + (rest > 0 ? [SheetWords.more(rest)] : [])
        self.kept = kept
        again = count == 0
        shape = count == 0 && skips.isEmpty ? (list == nil ? SheetWords.headerOnly : SheetWords.listShape) : nil
    }

    /// The account's answer, its reasons said with the phone's word for a line (SheetWords.rowWords).
    init(_ result: SheetImportResult, list: String? = nil) {
        self.init(
            read: result.imported,
            skipped: result.skipped.map { SheetCSV.Skip(line: $0.line, reason: SheetWords.rowWords($0.reason)) },
            kept: nil,
            list: list
        )
    }

    /// The account's refusal of a body that read to no player, in its own sentence (the sheet is as it was),
    /// with each line it skipped and why, said as a CSV import's are; an older API sends none.
    init(refused sentence: String, skipped: [ImportSkip] = [], list: String?) {
        self.init(
            read: 0,
            skipped: skipped.map { SheetCSV.Skip(line: $0.line, reason: SheetWords.rowWords($0.reason)) },
            kept: SheetWords.rowWords(sentence),
            list: list
        )
    }

    /// Space as the account reads it, a byte order mark among it.
    static let blank = CharacterSet.whitespacesAndNewlines.union(CharacterSet(charactersIn: "\u{FEFF}"))

    /// A list's rows as the account numbers them (api/internal/sheets/paste.go ReadList: split at each
    /// line break, CRLF as one). Split by scalar: Swift reads "\r\n" as one Character, which a Character
    /// split on "\n" would not cut.
    static func rows(_ list: String) -> [String] {
        list.unicodeScalars.split(separator: "\n", omittingEmptySubsequences: false).map { String($0) }
    }

    /// What was typed on row `line`, its rank set aside as the account sets it aside (paste.ts LEADING_RANK),
    /// trimmed and cut to SheetWords.typedShown; nil when the row is not there or holds nothing.
    static func typed(_ rows: [String], _ line: Int) -> String? {
        guard rows.indices.contains(line - 1) else {
            return nil
        }
        let text = rows[line - 1]
            .trimmingCharacters(in: blank)
            .replacingOccurrences(of: #"^\d+\s*[.)\-:]?\s+"#, with: "", options: .regularExpression)
        guard !text.isEmpty else {
            return nil
        }
        return String(text.prefix(SheetWords.typedShown)).trimmingCharacters(in: .whitespaces)
    }

    /// The result's verb: "Fix the list" when nothing was read and the box opens again with the text kept,
    /// else Done.
    public var verb: String {
        again ? SheetWords.fixList : SheetWords.done
    }
}

extension SheetImportBody {
    /// The pasted list, nil for a CSV.
    var list: String? {
        if case let .names(text) = self {
            return text
        }
        return nil
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

    /// The result's verb: an import that read nothing goes back to the box with the text kept, to fix it;
    /// any other closes the panel.
    func finishImport() {
        if case let .done(words) = importing, words.again {
            importing = .open(problem: nil)
            return
        }
        closeImport()
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
    /// refuses because it read no player is shown as the import's result in the account's sentence with the
    /// lines it skipped and why, and the sheet read again as the account holds it; nothing is written back.
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

    /// The code of the import's 400 without skipped lines (api/internal/sheets/handler.go): a header the
    /// import cannot use, or an API from before Lane 297 refusing a body that read to no player.
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
            importing = .done(SheetImportWords(result, list: body.list))
            pasted = ""
        } catch where APIError.signsOut(error) {
            signedOut()
        } catch let refused as SheetImportRefused {
            importing = .done(
                SheetImportWords(refused: refused.sentence, skipped: refused.skipped, list: body.list)
            )
            await reread(made: made)
        } catch let APIError.envelope(code, sentence) where code == Self.readNothing {
            importing = .done(SheetImportWords(refused: sentence, list: body.list))
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
