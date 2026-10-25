import CommishAPI
import CommishDesign
import Foundation

/// The player page from the run (web/src/routes/(run)/players/[slug] over server/pages/player.ts at
/// 390): his face, name, club and position with his status, the one big number with its basis, where
/// drafters take him, his value, his floor, median and ceiling, our read, and the verb the league's
/// screens give him. Pure: the view decides nothing.
public struct PlayerPageModel: Equatable, Sendable {
    public struct Hero: Equatable, Sendable {
        public let name: String
        public let initials: String
        public let headshot: URL?
        /// "Chicago Bears", a free agent's "FA".
        public let club: String
        /// "WR 25", or with a season-long list its word, "QB IR".
        public let pill: String
        public let status: RowStatus?
    }

    /// A fact beside the big number (Fact.svelte): its label, its figure and the sentence under it.
    public struct Fact: Equatable, Sendable {
        public let label: String
        public let figure: String
        public let unit: String?
        public let words: String
    }

    public struct Outcomes: Equatable, Sendable {
        public let label: String
        public let floor: Double
        public let median: Double
        public let ceiling: Double
        public let caption: String
    }

    /// Our read as the page shows it: in season the week's read or the words for none written; before
    /// the season the writer's capsule as written, or the words for none ready.
    public enum Read: Equatable, Sendable {
        case week(ShownRead)
        case weekNone(String)
        case prose(paragraphs: [String], byline: String?, figures: [ReadFigure])
        case unwritten(String)
    }

    public let hero: Hero
    /// The one big number, "199.2", its unit and its basis.
    public let figure: String
    public let unit: String
    public let caption: String
    public let drafters: Fact
    public let overReplacement: Fact
    public let heat: Heat
    public let outcomes: Outcomes?
    /// In place of his tier for a player on a season-long list: "On IR, not ranked".
    public let heldTier: String?
    /// Nil for a page held back with no copy: its foot says once that our read is not written.
    public let read: Read?
    public let verb: CardVerb?
    /// The run's stamp the page is from: the earlier run's for a held page's copy.
    public let stamp: String
    /// A page held back with no copy says once that his log and our read are not written yet.
    public let heldBasis: String?
}

/// His page as read: his own, an earlier run's copy of a held one with that run's stamp, or for a
/// held page with no copy the board's figures alone.
public enum PageSource: Equatable, Sendable {
    case page(RunPlayer)
    case copy(RunPlayer, from: RunHeldCopy)
    case facts(RunIndexEntry, RunBoardRow)
}

/// Everything the page is built from, read from the run's routes and the week.
public struct PageInput: Sendable {
    public let source: PageSource
    public let manifest: RunManifest
    public let sources: [RunAdpSource]
    public let capture: RunDesignations?
    public let clubs: [RunClub]
    public let schedule: RunSchedule
    /// How many players the leading format's board ranks, nil where it was not read.
    public let boardSize: Int?
    /// His week, the league's with its verb where one is followed; nil where it could not be read.
    public let week: PlayerWeek?
    public let host: Components.Schemas.LeagueHost?
    public let zone: TimeZone
    public let now: Date

    public init(
        source: PageSource, manifest: RunManifest, sources: [RunAdpSource], capture: RunDesignations?,
        clubs: [RunClub], schedule: RunSchedule, boardSize: Int?, week: PlayerWeek?,
        host: Components.Schemas.LeagueHost?, zone: TimeZone, now: Date
    ) {
        self.source = source
        self.manifest = manifest
        self.sources = sources
        self.capture = capture
        self.clubs = clubs
        self.schedule = schedule
        self.boardSize = boardSize
        self.week = week
        self.host = host
        self.zone = zone
        self.now = now
    }
}

public enum PlayerPages {
    /// The page, nil where no format of the run ranks him.
    public static func page(_ input: PageInput) -> PlayerPageModel? {
        let who = Who(input.source)
        guard let (format, numbers) = lead(input) else {
            return nil
        }
        let listed = input.capture?.players.additionalProperties[who.id]
        let status = listed.flatMap { BoardStatus.view($0, zone: input.zone) }
        let heldOut = listed?.seasonLong == true
        let underway = underway(input)
        let words = PageWords.line(
            format, numbers: numbers, sources: RunWords.adpDrafts(input.sources, format: format.id),
            boardSize: input.boardSize,
            season: .init(year: input.manifest.season, underway: underway, heldOut: heldOut)
        )
        return PlayerPageModel(
            hero: .init(
                name: who.name, initials: Initials.of(who.name), headshot: BoardCells.face(who.headshot),
                club: PageWords.clubName(who.team, clubs: input.clubs),
                pill: "\(who.position) \(status?.rank ?? String(numbers.positionRank))", status: status
            ),
            figure: Formatting.fixed(numbers.projected), unit: format.unit, caption: words.caption,
            drafters: .init(label: words.draftersLabel, figure: words.draftersFigure, unit: nil, words: words.drafters),
            overReplacement: .init(
                label: Words.PlayerPage.overReplacement, figure: BoardFigures.signed(numbers.vor), unit: format.unit,
                words: words.value
            ),
            heat: Heat.of(vor: numbers.vor, round: numbers.vorRound),
            outcomes: outcomes(numbers, format: format, season: input.manifest.season),
            heldTier: heldOut ? listed?.status.value1.flatMap(PageWords.heldTier) : nil,
            read: heldBasis(input.source) == nil
                ? read(input, underway: underway, projection: numbers.projected) : nil,
            verb: verb(input),
            stamp: stamp(input),
            heldBasis: heldBasis(input.source)
        )
    }

    /// A page held back with no copy: his figures are the board's, his log and our read not written.
    static func heldBasis(_ source: PageSource) -> String? {
        guard case .facts = source else {
            return nil
        }
        return Words.HeldPage.basis
    }

    /// The format the page leads with, the first of the run's that ranks him, and his numbers in it.
    static func lead(_ input: PageInput) -> (RunFormat, LineNumbers)? {
        switch input.source {
        case let .page(player), let .copy(player, _):
            input.manifest.formats.lazy.compactMap { format in
                player.formats.additionalProperties[format.id].map { (format, LineNumbers($0)) }
            }.first
        case let .facts(_, row):
            input.manifest.formats.first.map { ($0, LineNumbers(row)) }
        }
    }

    /// run.ts seasonUnderway: the run was written at or after the season's first kickoff.
    static func underway(_ input: PageInput) -> Bool {
        let first = input.schedule.slates.flatMap(\.games).map(\.kickoff).min()
        return first.map { input.manifest.runAt >= $0 } ?? false
    }

    /// Each week's last kickoff on the run's schedule.
    static func lastKickoff(_ schedule: RunSchedule, week: Int) -> Date? {
        schedule.slates.flatMap(\.games).filter { $0.week == week }.map(\.kickoff).max()
    }

    static func outcomes(_ numbers: LineNumbers, format: RunFormat, season: Int) -> PlayerPageModel.Outcomes? {
        guard let floor = numbers.floor, let median = numbers.median, let ceiling = numbers.ceiling else {
            return nil
        }
        return .init(
            label: Words.PlayerPage.outcomes, floor: floor, median: median, ceiling: ceiling,
            caption: "\(season) \(format.label) points, from his low case to his high case"
        )
    }

    /// In season the week's read beside the week's projection, the words for none written with none;
    /// before the season the capsule as the writer wrote it, its paragraphs split by a blank line.
    static func read(_ input: PageInput, underway: Bool, projection: Double) -> PlayerPageModel.Read {
        let player: RunPlayer? = switch input.source {
        case let .page(player), let .copy(player, _): player
        case .facts: nil
        }
        let game = input.week.map { LineRead.game($0.line, now: input.now) }
        let state = game.flatMap(PlayerCards.readState)
        if underway {
            guard let read = player?.weekRead?.value1 else {
                return .weekNone(WeekReads.noRead(state))
            }
            let held = StatusHeld.read(read, capture: input.capture, player: player?.id ?? "", now: input.now)
            let card = input.week.map {
                CardProjection(
                    week: $0.week, ppr: $0.projectionScoring.format.value1 == .ppr, points: $0.line.weekProjection,
                    state: state
                )
            }
            return .week(WeekReads.shown(held, card: card))
        }
        guard let capsule = player?.capsule?.value1 else {
            return .unwritten(Words.Unwritten.read)
        }
        return .prose(
            paragraphs: paragraphs(capsule.body), byline: PageWords.readStamp(capsule),
            figures: ReadFigures.preseason(capsule.pulls, projection: projection)
        )
    }

    /// Capsule.svelte: paragraphs split by a blank line, each trimmed, none empty.
    static func paragraphs(_ body: String) -> [String] {
        body.components(separatedBy: "\n").split { $0.trimmingCharacters(in: .whitespaces).isEmpty }
            .map { $0.joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
    }

    static func verb(_ input: PageInput) -> CardVerb? {
        guard let week = input.week, let host = input.host else {
            return nil
        }
        return CardVerbs.pinned(
            week, host: host, lastKickoff: lastKickoff(input.schedule, week: week.week), now: input.now
        )
    }

    /// run/stamp.ts: "Updated Oct 21", a held page's copy by its own run's day.
    static func stamp(_ input: PageInput) -> String {
        guard case let .copy(_, copy) = input.source else {
            return RunWords.stamp(input.manifest)
        }
        return "\(Words.RunStamp.updated) \(Formatting.shortDay(copy.runAt, zone: RunWords.eastern))"
    }

    /// Who the page is of, from his page or the index.
    struct Who {
        let id: String
        let name: String
        let team: String
        let position: String
        let headshot: String

        init(_ source: PageSource) {
            switch source {
            case let .page(player), let .copy(player, _):
                self.init(
                    id: player.id,
                    name: player.name,
                    team: player.team,
                    position: player.position,
                    headshot: player.headshot
                )
            case let .facts(entry, _):
                self.init(
                    id: entry.id,
                    name: entry.name,
                    team: entry.team,
                    position: entry.position,
                    headshot: entry.headshot
                )
            }
        }

        init(id: String, name: String, team: String, position: Components.Schemas.RunPosition, headshot: String) {
            self.id = id
            self.name = name
            self.team = team
            self.position = position.value1?.rawValue ?? position.value2 ?? ""
            self.headshot = headshot
        }
    }
}
