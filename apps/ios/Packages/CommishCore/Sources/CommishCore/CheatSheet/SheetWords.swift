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

/// The cheat sheet's words: the web's, written inline in web/src/lib/sheet (SheetPage.svelte,
/// RowEditor.svelte, ImportPanel.svelte, EmptySheet.svelte, status.ts), copied here because the web keeps
/// no word table for them; the status line and the tags are held to shared/fixtures/parity/sheet.json.
/// The phone's own words, where the web has no such state, are marked so.
public enum SheetWords {
    /// limits.ts DEFAULT_SHEET_NAME.
    public static let defaultName = "My sheet"
    /// The page's title in the bar (SheetPage.svelte Shell title).
    public static let title = "Cheat sheet"

    // MARK: the status line (status.ts STATUS_WORDS and statusWords)

    static let saving = "Saving to your account"
    static let saved = "Saved to your account"
    static let notSaved = "Not saved to your account"

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

    public static let importTool = "Import"
    /// The export, handed to the phone's share sheet where the site downloads it and prints.
    public static let exportTool = "Export CSV"
    public static let all = "All"

    /// "3 players shown" while a filter narrows the sheet.
    public static func shown(_ count: Int) -> String {
        "\(Formatting.plural(count, "player")) shown"
    }

    // MARK: a row and its editor (SheetRow.svelte, RowEditor.svelte)

    public static let notePlaceholder = "Your note"
    public static let ownTagPlaceholder = "Your own tag"
    public static let addTag = "Add tag"
    public static let remove = "Take off my sheet"
    public static let full = "Keep it to \(SheetLimits.tags) tags"

    /// "Edit Ja'Marr Chase": the row's disclosure, for a screen reader.
    public static func edit(_ name: String) -> String {
        "Edit \(name)"
    }

    /// "2 tags: Target, Sleeper" (SheetRow.svelte's count, said).
    public static func tagsSaid(_ marks: [TagMark]) -> String {
        "\(Formatting.plural(marks.count, "tag")): \(marks.map(\.label).joined(separator: ", "))"
    }

    public static let hasNote = "Has a note"

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

    public static let importHead = "Import"
    public static let fileLabel = "A CSV file"
    public static let chooseFile = "Choose a CSV"
    /// The phone's paste box takes the sheet's CSV: a list of names is read against our board in the
    /// browser, which the API's import does not do (Lane 254 report, NEEDS_CONTEXT).
    public static let pasteLabel = "Or paste a CSV"
    public static let pastePlaceholder = "rank,player_id,name,position,team,tier,tags,note"
    public static let replace = "Replace my sheet"
    public static let use = "Use this sheet"
    public static let cancel = "Cancel"
    public static let done = "Done"
    public static let tooLarge = "That file is over 1 MB"
    public static let unreadable = "That file does not read as CSV"
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

    /// The phone's own: an import that read no player is not let replace a sheet (the web's verb waits
    /// for a player read; the API's import writes what it reads, so the phone puts the rows back).
    public static let keptAsItWas = "No player read, so your sheet is as it was."

    // MARK: the empty sheet (EmptySheet.svelte, SheetPage.svelte)

    public static let startHead = "Start your sheet"
    public static let start = "Start from our board"
    public static let importSheet = "Import a sheet"
    public static let boardFailed = "Our board did not load. Try again in a moment"

    /// "Our PPR board, best first".
    public static func boardLead(_ format: String) -> String {
        "Our \(format) board, best first"
    }

    /// "Our PPR board is not out yet".
    public static func boardNone(_ format: String) -> String {
        "Our \(format) board is not out yet"
    }
}
