import CommishAPI
import CommishDesign
import Foundation

/// The player page from the run, in the web's order (web/src/routes/(run)/players/[slug] over
/// server/pages/player.ts at 390): the card (his face, name, club, pill and status, the next game with
/// its expected score and weather, the six tiles), before the season the facts (where drafters take
/// him, Over replacement, his range), his season (the game log, Still to play, earlier seasons), our
/// read, his tier box or the held tier, the every-format table, the basis lines, and the verb the
/// league's screens give him. Pure: the view decides nothing.
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

    /// A fact (Fact.svelte): its label, its figure and the sentence under it.
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

    /// The facts the page shows before the season only, as the web does.
    public struct Facts: Equatable, Sendable {
        public let drafters: Fact
        public let overReplacement: Fact
        public let heat: Heat
        public let outcomes: Outcomes?
    }

    /// Our read as the page shows it: in season the week's read or the words for none written; before
    /// the season the writer's capsule as written, or the words for none ready with what it will be
    /// built from.
    public enum Read: Equatable, Sendable {
        case week(ShownRead)
        case weekNone(String)
        case prose(paragraphs: [String], byline: String?, figures: [ReadFigure])
        case unwritten(String, lines: [UnwrittenLine])
    }

    public let hero: Hero
    /// The card: the next game and the six tiles (its read and basis are the page's own sections).
    public let card: PlayerCard
    public let facts: Facts?
    public let season: SeasonView
    /// Nil for a page held back with no copy: its basis says once that our read is not written.
    public let read: Read?
    /// In place of his tier for a player on a season-long list: "On IR, not ranked".
    public let heldTier: String?
    public let tier: TierBox?
    public let formats: FormatsTable?
    /// Every number's basis, once: the week's, then the season's.
    public let basis: [String]
    public let verb: CardVerb?
    /// The run's stamp the page is from: the earlier run's for a held page's copy.
    public let stamp: String
}

/// His page as read: his own, an earlier run's copy of a held one with that run's stamp, or for a
/// held page with no copy the board's figures alone.
public enum PageSource: Equatable, Sendable {
    case page(RunPlayer)
    case copy(RunPlayer, from: RunHeldCopy)
    case facts(RunIndexEntry, RunBoardRow)

    var player: RunPlayer? {
        switch self {
        case let .page(player), let .copy(player, _): player
        case .facts: nil
        }
    }
}

/// Everything the page is built from, read from the run's routes and the week.
public struct PageInput: Sendable {
    public let source: PageSource
    public let manifest: RunManifest
    public let sources: [RunAdpSource]
    public let capture: RunDesignations?
    public let clubs: [RunClub]
    public let schedule: RunSchedule
    /// The leading format's board, nil where it was not read: its size and his tier.
    public let board: RunBoardAnswer?
    /// His week, the league's with its verb where one is followed; nil where it could not be read.
    public let week: PlayerWeek?
    public let host: Components.Schemas.LeagueHost?
    public let zone: TimeZone
    public let now: Date

    public init(
        source: PageSource, manifest: RunManifest, sources: [RunAdpSource], capture: RunDesignations?,
        clubs: [RunClub], schedule: RunSchedule, board: RunBoardAnswer?, week: PlayerWeek?,
        host: Components.Schemas.LeagueHost?, zone: TimeZone, now: Date
    ) {
        self.source = source
        self.manifest = manifest
        self.sources = sources
        self.capture = capture
        self.clubs = clubs
        self.schedule = schedule
        self.board = board
        self.week = week
        self.host = host
        self.zone = zone
        self.now = now
    }

    var boardSize: Int? {
        board.map { $0.rows.count + $0.market.count }
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
        let underway = underway(input)
        let season = season(input, who: who, format: format)
        let card = card(input, format: format, projected: numbers.projected, held: status?.rank)
        let rankRead = rankRead(input, format: format)
        let placeRank = rankRead?.positionRank ?? numbers.positionRank
        return PlayerPageModel(
            hero: .init(
                name: who.name, initials: Initials.of(who.name), headshot: BoardCells.face(who.headshot),
                club: PageWords.clubName(who.team, clubs: input.clubs),
                pill: "\(who.position) \(status?.rank ?? String(placeRank))", status: status
            ),
            card: card.card,
            facts: underway ? nil : facts(input, format: format, numbers: numbers, heldOut: listed?.seasonLong == true),
            season: season,
            read: input.source.player == nil ? nil : read(
                input,
                underway: underway,
                format: format,
                held: status?.rank
            ),
            heldTier: listed?.seasonLong == true ? listed?.status.value1.flatMap(PageWords.heldTier) : nil,
            tier: input.board.flatMap {
                PageSections.tier(
                    $0,
                    player: who.id,
                    format: format,
                    season: input.manifest.season,
                    capture: input.capture
                )
            },
            formats: input.source.player.flatMap {
                formats($0, input: input, facts: .init(
                    position: who.position, held: status?.rank,
                    live: PageSections.liveFormats(input.week, lead: format), read: rankRead
                ))
            },
            basis: card.basis + [season.basis].compactMap(\.self),
            verb: verb(input),
            stamp: stamp(input)
        )
    }

    /// His place at his position as his week's read places him once the lead format ranks the rest of
    /// the season: the head's and the every-format table's one rank (Lane 224, the web's head and
    /// lineRanksAt); nil before the season or with no read.
    static func rankRead(_ input: PageInput, format: RunFormat) -> RankRead? {
        input.week.flatMap { week in
            format.rosFromWeek == nil ? nil : RankRead(format: format.apiFormat, positionRank: week.line.positionRank)
        }
    }

    /// The every-format table over his page's formats.
    static func formats(_ player: RunPlayer, input: PageInput, facts: PageSections.FormatsFacts) -> FormatsTable? {
        PageSections.formats(PageSections.lines(player, formats: input.manifest.formats), facts: facts)
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

    /// The card: his week's read over the page's build where the week answered (the sheet's card), the
    /// build alone where it did not, with the basis the web says for an unread week.
    static func card(
        _ input: PageInput, format: RunFormat, projected: Double, held: String?
    ) -> (card: PlayerCard, basis: [String]) {
        if let week = input.week {
            let card = PlayerCards.card(CardInput(
                week: week, page: input.source.player, format: format, season: input.manifest.season,
                capture: input.capture, league: input.host != nil, zone: input.zone, now: input.now,
                projected: projected
            ))
            return (card.onPage, card.basis)
        }
        let next = input.source.player.flatMap { PageSections.weekAhead($0.season) }
        let tiles = PageSections.builtTiles(page: input.source.player, format: format, next: next, projected: projected)
        let basis = PlayerSheetWords.unreadBasis(failed: true, weekTile: tiles[0].label, listed: held)
        return (
            PlayerCard(head: next, cell: nil, tiles: tiles, basis: [], read: nil, status: nil, game: .noGame),
            [basis]
        )
    }

    static func season(_ input: PageInput, who: Who, format: RunFormat) -> SeasonView {
        input.source.player.flatMap {
            SeasonViews.view($0, formats: input.manifest.formats, slates: input.schedule.slates)
        } ?? SeasonViews.held(year: input.manifest.season, position: who.position, format: format)
    }

    static func facts(_ input: PageInput, format: RunFormat, numbers: LineNumbers, heldOut: Bool) -> PlayerPageModel
        .Facts {
        let words = PageWords.line(
            format, numbers: numbers, sources: RunWords.adpDrafts(input.sources, format: format.id),
            boardSize: input.boardSize, season: .init(year: input.manifest.season, underway: false, heldOut: heldOut)
        )
        return .init(
            drafters: .init(label: words.draftersLabel, figure: words.draftersFigure, unit: nil, words: words.drafters),
            overReplacement: .init(
                label: Words.PlayerPage.overReplacement, figure: BoardFigures.signed(numbers.vor), unit: format.unit,
                words: words.value
            ),
            heat: Heat.of(vor: numbers.vor, round: numbers.vorRound),
            outcomes: outcomes(numbers, format: format, season: input.manifest.season)
        )
    }

    static func outcomes(_ numbers: LineNumbers, format: RunFormat, season: Int) -> PlayerPageModel.Outcomes? {
        guard let floor = numbers.floor, let median = numbers.median, let ceiling = numbers.ceiling else {
            return nil
        }
        return .init(
            label: Words.PlayerPage.outcomes, floor: floor, median: median, ceiling: ceiling,
            caption: PageWords.outcomesCaption(season: season, scoring: format.label)
        )
    }

    /// In season the week's read beside the week's projection, the words for none written with none;
    /// before the season the capsule as the writer wrote it, its paragraphs split by a blank line, or
    /// with none the words for a read not ready and what it will be built from.
    static func read(_ input: PageInput, underway: Bool, format: RunFormat, held: String?) -> PlayerPageModel.Read {
        let player = input.source.player
        let game = input.week.map { LineRead.game($0.line, now: input.now) }
        let state = game.flatMap(PlayerCards.readState)
        if underway {
            guard let read = player?.weekRead?.value1 else {
                return .weekNone(WeekReads.noRead(state, due: player?.weekReadsDue?.value1))
            }
            let shown = StatusHeld.read(read, capture: input.capture, player: player?.id ?? "", now: input.now)
            let card = input.week.map {
                CardProjection(
                    week: $0.week, ppr: $0.projectionScoring.format.value1 == .ppr, points: $0.line.weekProjection,
                    state: state
                )
            }
            return .week(WeekReads.shown(shown, card: card))
        }
        guard let player, let capsule = player.capsule?.value1 else {
            let numbers = player?.formats.additionalProperties[format.id]
            let lines = numbers.map {
                PageSections.unwritten($0, .init(
                    position: Who(input.source).position, boardSize: input.boardSize ?? 0, format: format,
                    year: input.manifest.season, held: held
                ))
            } ?? []
            return .unwritten(Words.Unwritten.read, lines: lines)
        }
        let projected = player.formats.additionalProperties[format.id]?.projected ?? 0
        return .prose(
            paragraphs: paragraphs(capsule.body), byline: PageWords.readStamp(capsule),
            figures: ReadFigures.preseason(capsule.pulls, projection: projected)
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
