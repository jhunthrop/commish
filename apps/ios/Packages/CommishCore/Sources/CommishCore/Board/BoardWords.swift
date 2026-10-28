import CommishAPI
import CommishDesign
import Foundation

/// The season pages' verbs (web/src/lib/site/season-words.ts PageVerb), each by what it does, its words
/// generated (PAGE_VERBS).
public enum PageVerb: String, Sendable, Equatable {
    case follow
    case openLeague = "open_league"
    case mock
    case sheet

    public var title: String {
        switch self {
        case .follow: Words.PageVerb.follow
        case .openLeague: Words.PageVerb.open_league
        case .mock: Words.PageVerb.mock
        case .sheet: Words.PageVerb.sheet
        }
    }

    /// Where the verb goes on the site (verb-links.ts verbHref): following a league to the follow
    /// page, a mock to its setup, the sheet to its page. The app has no screen for them yet, so the
    /// site's page opens.
    public var page: URL {
        switch self {
        case .follow, .openLeague: SiteLinks.leagueStart
        case .mock: SiteLinks.mockSetup
        case .sheet: SiteLinks.sheet
        }
    }
}

/// What a board covers, as its words need it (season-words.ts BoardCover with its label and view).
public struct BoardCover: Equatable, Sendable {
    public let season: Int
    /// The format's chip, "PPR".
    public let label: String
    /// The view's position, nil for All.
    public let position: String?
    /// The board ranks the rest of the season (the run's rosFromWeek).
    public let restOfSeason: Bool

    public init(season: Int, label: String, position: String?, restOfSeason: Bool) {
        self.season = season
        self.label = label
        self.position = position
        self.restOfSeason = restOfSeason
    }
}

/// The capture a board's statuses come from (designation.ts CaptureStamp): when its list last
/// changed, and the capture job's last check of it, nil when none is recorded.
public struct CaptureStamp: Equatable, Sendable {
    public let asOf: Date
    public let checkedAt: Date?

    public init(asOf: Date, checkedAt: Date?) {
        self.asOf = asOf
        self.checkedAt = checkedAt
    }

    /// When it was last known to stand: its check, else its list's change.
    var last: Date {
        checkedAt ?? asOf
    }

    /// designation.ts newerCapture (Lane 280, B257): the stamp a board's status column is as of, the
    /// newer of the run's capture and the live order's, the run's on a tie, either alone without the
    /// other. Held to board-run.json's liveStamps.
    public static func newer(run: CaptureStamp?, live: CaptureStamp?) -> CaptureStamp? {
        guard let run, let live else {
            return live ?? run
        }
        return live.last > run.last ? live : run
    }
}

/// The board's words as the web's season pages say them (season-words.ts boardWords, ported and held to
/// shared/fixtures/parity/board.json): the bar's word, the document's title, the heading and the one
/// verb. In season the board is the rest of the season where the run ranks it, and the verb follows the
/// league: none once a league is followed, following one until then; before the draft, the mock.
public struct BoardWords: Equatable, Sendable {
    public let bar: String
    public let title: String
    public let heading: String
    public let verb: PageVerb?

    /// `inSeason` is the rail's season (railInSeason); `following` whether the member follows a league.
    public static func of(inSeason: Bool, cover: BoardCover, following: Bool) -> BoardWords {
        let ranksRest = inSeason && cover.restOfSeason
        let noun = ranksRest ? AppWords.Tab.restOfSeason : AppWords.Tab.board
        let lower = ranksRest ? noun.lowercased() : noun
        let named = { (prefix: String) in "\(prefix) \(lower)" }
        return BoardWords(
            bar: cover.position.map(named) ?? noun,
            title: named(cover.position.map { "\($0) \(cover.label)" } ?? cover.label),
            heading: ranksRest ? "Rest of \(cover.season)" : "\(cover.season) \(AppWords.Tab.board)",
            verb: inSeason ? (following ? nil : .follow) : .mock
        )
    }

    /// The capture the statuses come from in the few words a board's basis has room for
    /// (designation.ts captureShort): "Status read Oct 16.", "as of" its last change with no check,
    /// and past a day and a half how old it is.
    public static func capture(asOf: Date, checkedAt: Date?, now: Date, zone: TimeZone) -> String {
        let last = checkedAt ?? asOf
        let when = checkedAt.map { "\(Words.Capture.read) \(Formatting.shortDay($0, zone: zone))" }
            ?? "\(Words.Capture.asOf) \(Formatting.shortDay(asOf, zone: zone))"
        let old = now.timeIntervalSince(last) > captureBehind ? ", \(Words.Capture.old)" : ""
        return "\(Words.Capture.status) \(when)\(old)."
    }

    /// The capture's words for a stamp (capture above).
    public static func capture(_ stamp: CaptureStamp, now: Date, zone: TimeZone) -> String {
        capture(asOf: stamp.asOf, checkedAt: stamp.checkedAt, now: now, zone: zone)
    }

    /// designation.ts CAPTURE_BEHIND_MS: past it the capture says how old it is.
    static let captureBehind: TimeInterval = 36 * 60 * 60
}

/// The run's words beside its board, each on the clock the site prints a run's dates on (format/date.ts,
/// US Eastern, the NFL's), held to shared/fixtures/parity/board-run.json.
public enum RunWords {
    /// format/date.ts ZONE.
    static let eastern = TimeZone(identifier: "America/New_York")!

    /// run/stamp.ts runStampText: "Updated Oct 21", "Stand-in, updated Sep 1" before the first real run.
    public static func stamp(_ manifest: RunManifest) -> String {
        let words = manifest.standIn ? Words.RunStamp.standIn : Words.RunStamp.updated
        return "\(words) \(Formatting.shortDay(manifest.runAt, zone: eastern))"
    }

    /// site/absent.ts absentWords' title: "Half PPR is not on our board yet", a format the run lacks.
    public static func absent(_ label: String) -> String {
        "\(label) is not on our board yet"
    }

    /// site/offline-words.ts offlineLead: the reason a saved board shows, said with its run's day.
    public static func offline(_ manifest: RunManifest) -> String {
        "You're offline, so this is the last board this device saved, updated "
            + "\(Formatting.shortDay(manifest.runAt, zone: eastern))."
    }

    /// run/rest-from.ts restFromWords: "from week 7", "from week 7's games left" while a game of it
    /// had kicked off at the run.
    static func restFrom(week: Int, partial: Bool) -> String {
        (partial ? Words.Figure.restFromPartial : Words.Figure.restFrom)
            .replacingOccurrences(of: "{week}", with: String(week))
    }

    /// run/rest-words.ts restCaption: "PPR points for the rest of the 2026 season from week 7, refreshed
    /// October 21"; nil on a board of the full season.
    public static func restCaption(_ format: RunFormat, season: Int) -> String? {
        guard let rest = restOfSeason(format, season: season), let refreshed = format.refreshedAt else {
            return nil
        }
        return "\(format.label) points for \(rest), refreshed \(Formatting.monthDay(refreshed, zone: eastern))"
    }

    /// "the rest of the 2026 season from week 7", nil before the run ranks the rest.
    static func restOfSeason(_ format: RunFormat, season: Int) -> String? {
        format.rosFromWeek.map {
            "the rest of the \(season) season \(restFrom(week: $0, partial: format.rosFromWeekPartial == true))"
        }
    }

    /// run/adp-drafts.ts adpDrafts: the drafts behind a format's ADP with their window, "PPR drafts, Sep 9".
    static func adpDrafts(_ sources: [RunAdpSource], format: String) -> [String] {
        sources.filter { $0.formats.contains(format) }.map { "\($0.drafts), \(window($0.window))" }
    }

    /// format/date.ts windowLabel: "Sep 9", "Sep 5 to Sep 9".
    static func window(_ window: Components.Schemas.RunWindow) -> String {
        let from = Formatting.shortDay(window.from, zone: eastern)
        let to = Formatting.shortDay(window.to, zone: eastern)
        return from == to ? from : "\(from) to \(to)"
    }
}

/// A board row's figures as the phone prints them (web/src/lib/format/number.ts and gap.ts).
public enum BoardFigures {
    /// His projected points, "262.1"; the empty figure for none.
    public static func projected(_ value: Double?) -> String {
        value.map { Formatting.fixed($0) } ?? Words.Box.none
    }

    /// number.ts signed: "+113.9", "−12.5", "+0.0" for a figure that rounds to nothing.
    public static func signed(_ value: Double) -> String {
        Formatting.signed(value)
    }

    /// gap.ts gapText: "+1.8", "−4.5", "0.0", the empty figure for none.
    public static func gap(_ value: Double?) -> String {
        guard let value else {
            return Words.Box.none
        }
        return value == 0 ? Formatting.fixed(0) : signed(value)
    }
}

/// The board's basis on a phone as the web says it (run/board-basis.ts boardBasis, site/market.ts
/// marketBasis), held to shared/fixtures/parity/board-run.json: our board's sentence (the rest of the
/// season's from its week, once the run ranks it), the tiers' position on a position's view, the drafts
/// behind the ADP before the season, and the Gap's definition where its column shows; a kicker's or a
/// defense's view says the drafts' order instead.
public enum BoardBasis {
    /// What a view's basis is said over.
    struct Facts {
        let format: RunFormat
        let season: Int
        /// The ranked position the view's tiers are drawn within; nil for All.
        let position: BoardPosition?
        let sources: [RunAdpSource]
        let gap: Bool
    }

    /// board-basis.ts ourBoard.
    static func ourBoard(_ format: RunFormat, season: Int) -> String {
        let league = "for \(format.teams) teams"
        guard let rest = RunWords.restOfSeason(format, season: season), let refreshed = format.refreshedAt else {
            return "Our \(format.label) board, by points over replacement \(league)."
        }
        return "Our \(format.label) board, \(rest), by points over replacement \(league), refreshed "
            + "\(Formatting.monthDay(refreshed, zone: RunWords.eastern))."
    }

    /// market.ts marketBasis: the drafts the order is taken from, where the run names them.
    static func draftOrder(_ format: RunFormat, sources: [RunAdpSource]) -> String {
        let source = sources.first { $0.id == format.marketOrder }
        let from = source.map { " from \($0.drafts), \(RunWords.window($0.window))" } ?? ""
        return "Kickers and defenses the drafters take rank in their draft order\(from), "
            + "with no projected points and no tiers."
    }

    /// The phone's parts of a ranked view's basis.
    static func ranked(_ facts: Facts) -> [String] {
        let drafts = RunWords.adpDrafts(facts.sources, format: facts.format.id).joined(separator: " and ")
        return [ourBoard(facts.format, season: facts.season)]
            + (facts.position.map { ["Tiers are drawn within \($0.label)."] } ?? [])
            + (facts.format.rosFromWeek == nil ? ["ADP from \(drafts)."] : [])
            + (facts.gap ? [Words.BoardBasis.gap] : [])
    }
}
