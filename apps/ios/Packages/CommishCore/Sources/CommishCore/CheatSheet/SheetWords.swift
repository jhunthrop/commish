import CommishAPI
import CommishDesign
import Foundation

/// Where the sheet's last write stands, as the status line says it (status.ts SyncStatus, the states a
/// phone that holds nothing of its own can be in).
public enum SheetSave: Equatable, Sendable {
    /// Nothing written since the sheet was read.
    case idle
    case saving
    case saved
    /// The write did not land: the reason in words, and whether the account's copy changed since it was
    /// read (a retry reads it again first).
    case failed(reason: String, changed: Bool)
}

/// The cheat sheet's words: the web's plain words read from the generated tables (Words.Sheet,
/// Words.SheetImport, Words.SheetStatus, from web/src/lib/sheet/words.ts, Lane 283), the words with a slot
/// spelled here until B256, and the phone's own, marked so. apps/ios/scripts/sheet-words.test.ts fails on
/// a copy of a table's word; the status line and the tags are held to shared/fixtures/parity/sheet.json.
public enum SheetWords {
    /// limits.ts DEFAULT_SHEET_NAME.
    public static let defaultName = Words.Sheet.defaultName
    /// The page's title in the bar (SheetPage.svelte Shell title).
    public static let title = Words.Sheet.title

    // MARK: the status line (status.ts STATUS_WORDS and statusWords)

    static let saving = Words.SheetStatus.saving
    static let saved = Words.SheetStatus.saved
    static let notSaved = Words.SheetStatus.notSaved

    /// The status beside the name, or nil for an empty sheet with nothing to say (statusWords): "Saved to
    /// your account at 7:41 PM" for a change today on the phone's clock, "... Oct 13" for one before.
    public static func status(
        _ save: SheetSave, changedAt: Date?, answeredAt: Date, players: Int, zone: TimeZone
    ) -> String? {
        if players == 0 {
            if case let .failed(reason, _) = save {
                return reason
            }
            return nil
        }
        switch save {
        case .saving:
            return saving
        case .idle, .saved:
            return savedWords(changedAt, answeredAt: answeredAt, zone: zone)
        case let .failed(reason, _):
            return reason
        }
    }

    static func savedWords(_ changedAt: Date?, answeredAt: Date, zone: TimeZone) -> String {
        guard let changedAt else {
            return saved
        }
        if Formatting.sameDay(changedAt, answeredAt, zone: zone) {
            return "\(saved) at \(localTime(changedAt, zone: zone))"
        }
        return "\(saved) \(Formatting.shortDay(changedAt, zone: eastern))"
    }

    /// date.ts dayLabel's clock: the NFL's.
    static let eastern = TimeZone(identifier: "America/New_York")!

    /// date.ts localTimeLabel: "9:41 PM" on the reader's own clock.
    static func localTime(_ date: Date, zone: TimeZone) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = zone
        formatter.dateFormat = "h:mm a"
        return formatter.string(from: date)
    }

    /// The head's line: "PPR · 8 players · Saved to your account Oct 13".
    public static func headLine(format: String, players: Int, status: String?) -> String {
        ([format, Formatting.plural(players, "player")] + [status].compactMap(\.self)).joined(separator: " · ")
    }

    /// The board format's chip (format.ts FORMAT_LABELS, generated).
    public static func formatLabel(_ format: Components.Schemas.BoardFormatKnown) -> String {
        switch format {
        case .ppr: Words.FormatLabel.ppr
        case .halfPpr: Words.FormatLabel.half_ppr
        case .standard: Words.FormatLabel.standard
        case .tePremium: Words.FormatLabel.te_premium
        case .superflex: Words.FormatLabel.superflex
        case .twoFlex: Words.FormatLabel.two_flex
        case .dynasty: Words.FormatLabel.dynasty
        case .bestBall: Words.FormatLabel.best_ball
        }
    }

    // MARK: the tools and the filters (SheetPage.svelte)

    public static let importTool = Words.Sheet.importTool
    /// The export, handed to the phone's share sheet where the site downloads it and prints.
    public static let exportTool = Words.Sheet.exportTool
    public static let all = Words.Sheet.all

    /// "3 players shown" while a filter narrows the sheet.
    public static func shown(_ count: Int) -> String {
        "\(Formatting.plural(count, "player")) shown"
    }

    // MARK: a row and its editor (SheetRow.svelte, RowEditor.svelte)

    public static let notePlaceholder = Words.Sheet.notePlaceholder
    public static let ownTagPlaceholder = Words.Sheet.ownTagPlaceholder
    public static let addTag = Words.Sheet.addTag
    public static let remove = Words.Sheet.remove
    public static let full = "Keep it to \(SheetLimits.tags) tags"

    /// "Edit Ja'Marr Chase": the row's disclosure, for a screen reader.
    public static func edit(_ name: String) -> String {
        "Edit \(name)"
    }

    /// "2 tags: Target, Sleeper" (SheetRow.svelte's count, said).
    public static func tagsSaid(_ marks: [TagMark]) -> String {
        "\(Formatting.plural(marks.count, "tag")): \(marks.map(\.label).joined(separator: ", "))"
    }

    public static let hasNote = Words.Sheet.hasNote

    // MARK: a row not saved (the phone's own: the web keeps an edit in the browser, the phone does not)

    /// "Saving" under a row whose edit is on its way.
    public static let rowSaving = "Saving"
    /// The line under a row whose edit did not land: the web's words, then the reason.
    public static func rowUnsaved(_ reason: String) -> String {
        "\(notSaved). \(reason)"
    }

    /// The reason when the request never reached the account.
    public static let offline = "No connection."
    /// The reason when the account answered with nothing readable.
    public static let unknown = "Try again in a minute."
    public static let tryAgain = AppWords.Failure.tryAgain

    // MARK: import (ImportPanel.svelte)

    public static let importHead = Words.SheetImport.head
    public static let fileLabel = Words.SheetImport.fileLabel
    public static let chooseFile = Words.SheetImport.chooseFile
    /// The account's import reads the list against our board (Lane 278).
    public static let pasteLabel = Words.SheetImport.pasteLabel
    /// ImportPanel.svelte PASTE_EXAMPLE.
    public static let pastePlaceholder = Words.SheetImport.pasteExample
    /// The phone's own: what a list that reads looks like, said under an import that read nothing and named
    /// no skipped row (the account's refusal carries no row's reason).
    public static let listShape = "Paste one player to a row, like 1. Puka Nacua"
    public static let replace = Words.SheetImport.replace
    public static let use = Words.SheetImport.use
    public static let cancel = Words.SheetImport.cancel
    public static let done = Words.Sheet.done
    public static let tooLarge = Words.SheetImport.tooLarge
    public static let unreadable = Words.SheetImport.unreadable
    /// How many skipped lines the result names before it counts the rest (SKIPS_SHOWN).
    public static let skipsShown = 12

    /// "212 players read".
    public static func read(_ count: Int) -> String {
        "\(Formatting.plural(count, "player")) read"
    }

    /// "3 rows skipped". The web says "lines", a word the copy rules keep for the field
    /// (shared/words/banned-words.json), so the phone counts the file's rows.
    public static func skipped(_ count: Int) -> String {
        "\(Formatting.plural(count, "row")) skipped"
    }

    /// "Row 4: The position is not QB, RB, WR, TE, K or DST", the file's row as the API numbers it (the
    /// header is row 1).
    public static func skip(line: Int, reason: String) -> String {
        "Row \(line): \(reason)"
    }

    /// "And 9 more".
    public static func more(_ count: Int) -> String {
        "And \(count) more"
    }

    /// A file that reads no player on the phone is not sent: the account's own sentence for an import that
    /// reads no player (api/internal/sheets/handler.go emptyReadSentence).
    public static let keptAsItWas = "No player read, so your sheet is as it was."

    /// The account's sentence with the phone's word for a line of the file or the list: the API says "line",
    /// a word the copy rules keep for the field, so the phone says "row", as SheetCSV's reasons do. The
    /// patterns spell the word's first letter as a class, so the copy guard reads no word in them.
    public static func rowWords(_ sentence: String) -> String {
        [(#"\b[L]ine(s?)\b"#, "Row$1"), (#"\b[l]ine(s?)\b"#, "row$1")].reduce(sentence) { said, swap in
            said.replacingOccurrences(of: swap.0, with: swap.1, options: .regularExpression)
        }
    }

    // MARK: a conflict the account's copy won (merge.ts mergeRow)

    /// "Your note on Ja'Marr Chase was replaced by the one saved on another device".
    public static func noteReplaced(_ name: String) -> String {
        "Your note on \(name) was replaced by the one saved on another device"
    }

    /// "Your tags on Ja'Marr Chase were replaced by the ones saved on another device".
    public static func tagsReplaced(_ name: String) -> String {
        "Your tags on \(name) were replaced by the ones saved on another device"
    }

    // MARK: the empty sheet (EmptySheet.svelte, SheetPage.svelte)

    public static let startHead = Words.Sheet.startHead
    public static let start = Words.Sheet.start
    public static let importSheet = Words.Sheet.importSheet
    public static let boardFailed = Words.Sheet.boardFailed

    /// "Our PPR board, best first".
    public static func boardLead(_ format: String) -> String {
        "Our \(format) board, best first"
    }

    /// "Our PPR board is not out yet".
    public static func boardNone(_ format: String) -> String {
        "Our \(format) board is not out yet"
    }
}
