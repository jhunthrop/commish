import CommishAPI
import CommishDesign
import Foundation

/// A club's lead player on the clubs index (PlayerLine.svelte with its Our rank label).
public struct ClubLead: Equatable, Sendable {
    public let name: String
    public let initials: String
    public let headshot: URL?
    /// "TE 1".
    public let pill: String
    /// "Our rank 12".
    public let rank: String
    public let sheetPlayer: SheetPlayer
}

/// A club on the clubs index (the web's Tile): its name, its line, its strength, its lead player and
/// how many of its players our board ranks.
public struct ClubCard: Equatable, Sendable, Identifiable {
    public let abbr: String
    public let name: String
    /// "ARI · Bye week 14", "KC" once the bye is played.
    public let meta: String
    public let strength: StrengthFigure?
    public let lead: ClubLead?
    /// "15 players on our board".
    public let players: String

    public var id: String {
        abbr
    }
}

/// The clubs index as the web's /clubs says it (server/pages/clubs.ts clubsPage, schedule-view.ts
/// clubCards): its lead with the strength's sentence, then every club's card in the run's order. In
/// season each card's lead is the first of its club's first three on the board at the order's clock,
/// once the order places every club's three (Lane 224, placedLeads), and the basis under the cards says
/// which clock they are on.
public struct ClubsModel: Equatable, Sendable {
    public let title: String
    public let stamp: String
    public let lead: String
    public let clubs: [ClubCard]
    /// The link to the strength of schedule, as the web's pages link it.
    public let scheduleLink: String
    /// In season the order's lead or the run's stamp, said once under the cards; none before.
    public let basis: [String]
    /// Whether the leads are the order's.
    public let atClock: Bool
}

/// A club's page as the web's /clubs/[abbr] says it at 390: the hero (its name, line, strength and
/// rank), the basis once, its players on the default board with the round tint and the Gap where drawn,
/// its kickers and defense in draft order, its schedule with the games played set back, and the verb
/// that sets its two best available players side by side. In season its players carry the order's
/// figures in the order's order once the order places every one of them, and the order's lead takes the
/// board sentence's place in the basis; until then the run's rows stand with the run's stamp (Lane 224).
public struct ClubPageModel: Equatable, Sendable {
    public let abbr: String
    public let name: String
    public let meta: String
    public let stamp: String
    public let hero: ClubHero?
    public let basis: [String]
    /// "On our PPR board" on the run's rows, "On our rest-of-season order" once the order's stand
    /// (Lane 223, Lane 220's D2): the head names what the basis beside it names.
    public let boardHead: String
    /// The section's spoken label, "Detroit Lions, On our PPR board", following the head.
    public let boardLabel: String
    /// "Nobody from Arizona is on this board" (or "in this order"), nil where the rows have some.
    public let nobody: String?
    public let columns: BoardColumns
    public let rows: [BoardRow]
    public let marketHead: String
    public let market: [BoardRow]
    public let scheduleCaption: String
    public let scheduleHeads: [String]
    public let games: [ClubGame]
    /// The line under the games naming the run's read, nil without a current week.
    public let asOf: String?
    /// The verb that sets its two best available players side by side, nil with fewer than two.
    public let compare: ClubCompare?
    public let clubsLink: String
    /// Whether the rows are the order's.
    public let atClock: Bool
}

/// A club page's verb: its words and the two players it compares, by id and by slug.
public struct ClubCompare: Equatable, Sendable {
    public let label: String
    public let ids: [String]
    public let slugs: [String]
}

/// The strength of schedule page as the web's /schedule says it (schedule-view.ts scheduleGrid): every
/// club by week, hardest first, the strongest opponents shaded and the games in set back.
public struct ScheduleGridModel: Equatable, Sendable {
    public let season: Int
    public let weeks: [Int]
    public let lead: String
    public let strengthLabel: String?
    /// The last complete week: its heads are set back.
    public let played: Int
    /// The week whose cells say the run's game state, the grid opening on it; nil out of season or
    /// where the run carries no states (Lane 223, B187).
    public let current: Int?
    /// "Week 6's games as of Wed Oct 21, 7:00 am Central.": the run's read, said once under the grid.
    public let asOf: String?
    public let rows: [ScheduleGridRow]
}

/// The schedule screen: its heading, the run's stamp, the grid, its legend and the verb.
public struct ScheduleModel: Equatable, Sendable {
    public let heading: String
    public let stamp: String
    public let caption: String
    public let grid: ScheduleGridModel
    /// "10.5 or more": the shaded cells' legend.
    public let legendHard: String
    public let legendPlayed: String
    public let verb: PageVerb
}

/// The run's files the club screens are built from: the manifest, the clubs, the schedule, the
/// default board and the capture, and where the season is.
struct ClubFiles: Sendable {
    let manifest: FileRead<RunManifest>
    let clubs: FileRead<[RunClub]>
    let schedule: FileRead<RunSchedule>
    let board: FileRead<RunBoardAnswer>
    let capture: FileRead<RunDesignations?>?
    let sources: FileRead<[RunAdpSource]>?
    let underway: Bool
    /// What the schedule sets back as played.
    let played: Reach
    let marks: [ReadMark]

    var format: RunFormat {
        manifest.value.formats.first { $0.id == board.value.format } ?? manifest.value.formats[0]
    }

    var statuses: BoardOrder.Statuses {
        capture?.value?.players.additionalProperties ?? [:]
    }

    /// The default format's files; the ADP's sources where the screen says the board's basis; and in
    /// season the run's complete week from an own page, for the games played.
    static func read(_ reads: RunReads, sources wanted: Bool) async throws -> ClubFiles {
        let manifest = try await reads.manifest()
        guard let format = manifest.value.formats.first?.id else {
            throw RunReadError.noFormat
        }
        async let clubs = reads.clubs()
        async let schedule = reads.schedule()
        async let board = reads.board(format, manifest: manifest.value)
        async let capture = reads.designations()
        let (clubsRead, scheduleRead, boardRead, captureRead) = try await (clubs, schedule, board, capture)
        let sources = wanted ? try await reads.sources() : nil
        let underway = RunReach.underway(manifest.value, schedule: scheduleRead.value)
        var marks = [manifest.mark, clubsRead.mark, scheduleRead.mark, boardRead.mark]
            + [captureRead?.mark, sources?.mark].compactMap(\.self)
        var played = Reach.none
        if underway {
            let index = try await reads.index()
            let (complete, completeMarks) = try await reads.complete(index.value, manifest: manifest.value)
            marks += [index.mark] + completeMarks
            played = RunReach.played(scheduleRead.value.slates, complete: complete ?? 0, underway: true)
        }
        return ClubFiles(
            manifest: manifest, clubs: clubsRead, schedule: scheduleRead, board: boardRead, capture: captureRead,
            sources: sources, underway: underway, played: played, marks: marks
        )
    }

    func cells(zone: TimeZone) -> BoardCells {
        // A club's rows share its bye, said once in its hero, so no row carries one.
        BoardCells(statuses: statuses, byes: [:], fromWeek: format.rosFromWeek, zone: zone)
    }

    func captureWords(now: Date, zone: TimeZone) -> String? {
        capture?.value.map { BoardWords.capture(asOf: $0.readAt, checkedAt: $0.checkedAt, now: now, zone: zone) }
    }
}

/// "On our PPR board", "Nobody from Arizona is on this board": a word with its one name filled
/// (reference-words.ts filled).
func filled(_ words: String, _ name: String) -> String {
    guard let range = words.range(of: #"\{[a-z]+\}"#, options: .regularExpression) else {
        return words
    }
    return words.replacingCharacters(in: range, with: name)
}

extension ClubsModel {
    init(_ files: ClubFiles, zone: TimeZone, order: OrderAtClock? = nil) {
        let format = files.format
        let ordered = BoardOrder.withStatuses(files.board.value.rows, files.statuses)
        let views = ScheduleViews.views(files.schedule.value, underway: files.underway)
        let first = files.clubs.value.lazy.compactMap { views[$0.abbr] }.first
        let cells = BoardCells(statuses: files.statuses, byes: [:], fromWeek: format.rosFromWeek, zone: zone)
        let leads = Self.leads(files.clubs.value, ordered: ordered, files: files, places: files.places(order))
        title = Words.ClubPage.clubs
        stamp = RunWords.stamp(files.manifest.value)
        lead = StrengthWords.clubsLead(format.label, first: first)
        scheduleLink = Words.AdpPage.scheduleLink
        atClock = leads.atClock
        basis = files.basis([], order: order, atClock: leads.atClock, zone: zone)
        clubs = files.clubs.value.map { club in
            let own = ordered.filter { $0.team == club.abbr }
            let lead = leads.byClub[club.abbr].map { row, figures in
                let drawn = cells.ranked(row, figures: figures)
                return ClubLead(
                    name: row.name, initials: drawn.initials, headshot: drawn.headshot,
                    pill: "\(row.positionName) \(figures.positionRank)",
                    rank: "\(Words.ClubPage.ourRank) \(figures.ourRank)",
                    sheetPlayer: drawn.sheetPlayer ?? SheetPlayer(
                        id: row.id, slug: row.slug, name: row.name, position: row.positionName, rank: nil,
                        club: row.team
                    )
                )
            }
            return ClubCard(
                abbr: club.abbr, name: "\(club.city) \(club.nickname)", meta: files.meta(club),
                strength: ScheduleViews.figure(views[club.abbr], of: views.count), lead: lead,
                players: "\(Formatting.plural(own.count, Words.ClubPage.player)) \(Words.ClubPage.onOurBoard)"
            )
        }
    }
}

extension ClubPageModel {
    init?(_ files: ClubFiles, abbr: String, now: Date, zone: TimeZone, order: OrderAtClock? = nil) {
        guard let club = files.clubs.value.first(where: { $0.abbr.lowercased() == abbr.lowercased() }) else {
            return nil
        }
        let format = files.format
        let cells = files.cells(zone: zone)
        let run = BoardOrder.withStatuses(files.board.value.rows, files.statuses).filter { $0.team == club.abbr }
        let placed = files.places(order).flatMap { LiveOrder.placed(run, id: \.id, places: $0) }
        let shown = placed?.map { ($0.row, $0.row.figures.at($0.place, teams: format.teams)) }
            ?? run.map { ($0, $0.figures) }
        let own = shown.map(\.0)
        let market = [BoardPosition.kicker, .defense].flatMap { position in
            BoardOrder.withStatuses(BoardOrder.at(files.board.value.market, position: position), files.statuses)
                .filter { $0.team == club.abbr }
        }
        let gap = format.rosFromWeek == nil && shown.contains { $0.1.gap != nil }
        let scheduled = ScheduleViews.club(
            club, schedule: files.schedule.value, clubs: files.clubs.value, at: files.season(zone: zone)
        )
        self.abbr = club.abbr
        name = "\(club.city) \(club.nickname)"
        meta = files.meta(club)
        stamp = RunWords.stamp(files.manifest.value)
        hero = scheduled.hero
        atClock = placed != nil
        basis = files.basis(
            [StrengthWords.winsBasis(files.schedule.value.opponentBasis)]
                + BoardBasis.ranked(.init(
                    format: format, season: files.manifest.value.season, position: nil,
                    sources: files.sources?.value ?? [], gap: gap
                ))
                + (files.captureWords(now: now, zone: zone).map { [$0] } ?? []),
            order: order, atClock: placed != nil, zone: zone
        )
        let head = ClubFiles.head(format, atClock: placed != nil)
        boardHead = head.title
        boardLabel = "\(name), \(head.title)"
        nobody = own.isEmpty ? filled(head.nobody, club.city) : nil
        columns = .ranked(gap: gap)
        rows = shown.map { cells.ranked($0.0, figures: $0.1) }
        marketHead = Words.ClubPage.kickers
        self.market = market.map { cells.market($0) }
        scheduleCaption = scheduled.caption
        scheduleHeads = [Words.ClubPage.week, Words.ClubPage.opponent, Words.ClubPage.expectedWins]
        games = scheduled.games
        asOf = scheduled.asOf
        let pair = Array(own.filter { !BoardOrder.heldOut($0, files.statuses) }.prefix(2))
        compare = pair.count == 2
            ? ClubCompare(label: Words.ClubPage.comparePair, ids: pair.map(\.id), slugs: pair.map(\.slug)) : nil
        clubsLink = Words.ClubPage.clubs
    }
}

extension ScheduleModel {
    init(_ files: ClubFiles, zone: TimeZone) {
        let schedule = files.schedule.value
        grid = ScheduleViews.grid(
            schedule, clubs: files.clubs.value, rows: files.board.value.rows, at: files.season(zone: zone)
        )
        heading = "\(schedule.season) \(Words.SchedulePage.heading)"
        stamp = RunWords.stamp(files.manifest.value)
        caption = grid.strengthLabel == nil ? Words.SchedulePage.caption : Words.SchedulePage.captionHardest
        let floor = ScheduleViews.strongFloor(Array(schedule.opponentValues.additionalProperties.values)).floor
        legendHard = filled(Words.SchedulePage.legendHard, Formatting.fixed(floor, 1))
        legendPlayed = Words.SchedulePage.legendPlayed
        verb = .mock
    }
}

public extension RunScreenViewModel where Model == ClubsModel {
    /// `orders` reads the order in season, the leads drawn again at its clock.
    static func clubs(
        run: any RunAPI, pages: any RunPagesAPI, cache: any AnswerCache, clock: any Clock,
        zone: TimeZone = .current, orders: OrderReader? = nil, onSignedOut: @escaping @MainActor () -> Void = {}
    ) -> RunScreenViewModel<ClubsModel> {
        RunScreenViewModel(
            reads: RunReads(run: run, pages: pages, cache: cache, clock: clock), zone: zone, orders: orders,
            onSignedOut: onSignedOut
        ) { reads in
            let files = try await ClubFiles.read(reads, sources: false)
            return BuiltScreen(
                model: ClubsModel(files, zone: zone), manifest: files.manifest.value, reads: files.marks,
                atClock: { orders in
                    // Every club's first three: the order's first rows, which a club's leads are among.
                    guard let order = try? await orders.read() else {
                        return nil
                    }
                    let placed = ClubsModel(files, zone: zone, order: order)
                    return placed.atClock ? placed : nil
                }
            )
        }
    }
}

/// A club the run does not carry.
public enum ClubError: Error, Equatable {
    case unknown(String)
}

public extension RunScreenViewModel where Model == ClubPageModel {
    /// A club's page by its abbreviation, in any case ("ari"); `orders` reads the order in season, its
    /// players drawn again at its clock.
    static func club(
        _ abbr: String, run: any RunAPI, pages: any RunPagesAPI, cache: any AnswerCache, clock: any Clock,
        zone: TimeZone = .current, orders: OrderReader? = nil, onSignedOut: @escaping @MainActor () -> Void = {}
    ) -> RunScreenViewModel<ClubPageModel> {
        RunScreenViewModel(
            reads: RunReads(run: run, pages: pages, cache: cache, clock: clock), zone: zone, orders: orders,
            onSignedOut: onSignedOut
        ) { reads in
            let files = try await ClubFiles.read(reads, sources: true)
            let now = clock.now
            guard let model = ClubPageModel(files, abbr: abbr, now: now, zone: zone) else {
                throw ClubError.unknown(abbr)
            }
            return BuiltScreen(
                model: model, manifest: files.manifest.value, reads: files.marks,
                atClock: { orders in
                    // Every player of the club, read by its name as the web's club page reads him.
                    guard let order = try? await orders.read(search: abbr) else {
                        return nil
                    }
                    return ClubPageModel(files, abbr: abbr, now: now, zone: zone, order: order)
                        .flatMap { $0.atClock ? $0 : nil }
                }
            )
        }
    }
}

public extension RunScreenViewModel where Model == ScheduleModel {
    static func schedule(
        run: any RunAPI, pages: any RunPagesAPI, cache: any AnswerCache, clock: any Clock,
        zone: TimeZone = .current, onSignedOut: @escaping @MainActor () -> Void = {}
    ) -> RunScreenViewModel<ScheduleModel> {
        RunScreenViewModel(
            reads: RunReads(run: run, pages: pages, cache: cache, clock: clock), zone: zone, onSignedOut: onSignedOut
        ) { reads in
            let files = try await ClubFiles.read(reads, sources: false)
            return BuiltScreen(
                model: ScheduleModel(files, zone: zone),
                manifest: files.manifest.value,
                reads: files.marks
            )
        }
    }
}
