import CommishAPI
import CommishDesign
import Foundation

/// The tier box (server/pages/player.ts mates and tierBasisOf, TierMates.svelte): his tier among the
/// available players at his position on the leading board, the line under its band, its players and
/// the basis at its foot.
public struct TierBox: Equatable, Sendable {
    public struct Mate: Equatable, Sendable, Identifiable {
        public let id: String
        public let name: String
        public let positionRank: Int
        public let team: String
        public let projected: String
        /// The weeks his figure counts where they are not the page's player's.
        public let span: String?
        public let current: Bool
    }

    public let tier: Int
    /// "Tier 5 WRs".
    public let title: String
    /// "12 players, then 9.8 PPR pts down to tier 6", or "..., the last tier".
    public let drop: String?
    public let mates: [Mate]
    public let basis: String
}

/// The every-format table (player-words.ts formatTable, the page's table): its rank and points heads,
/// each format's row, why the formats need not line up, and at the read's clock which formats show no
/// position rank (Lane 224, the web's lineRanksAt).
public struct FormatsTable: Equatable, Sendable {
    public struct Row: Equatable, Sendable, Identifiable {
        public let label: String
        public let rank: String
        public let points: String
        public let vor: String
        public let tier: String

        public var id: String {
            label
        }
    }

    /// "Position rank": his place at his position, the head's own figure.
    public let rankHead: String
    public let head: String
    public let rows: [Row]
    public let note: String?
    /// Under the table when a format's rank reads "--": "Half PPR and Standard show no position rank at
    /// this read; their points are."
    public let footnote: String?
}

/// The every-format table at the read's clock (week-words.ts LiveFormats): its points head and each
/// format's figures by the API's name for it.
struct LiveFormats: Equatable {
    struct Figure: Equatable {
        let points: Double
        let vor: Double?
    }

    let head: String
    let figures: [String: Figure]
}

/// The read's rank for the every-format table (live-figures.ts RankRead): his place at his position in
/// the format the read is in.
struct RankRead: Equatable {
    let format: String?
    let positionRank: Int?
}

/// A fact the written read will be built from (run/unwritten-words.ts UnwrittenLine).
public struct UnwrittenLine: Equatable, Sendable, Identifiable {
    public let lead: String
    public let text: String
    public let figure: String

    public var id: String {
        lead
    }
}

/// The page's sections beside the card, ported from the web's page build.
enum PageSections {
    /// player-words.ts FORMATS_FITTED_APART.
    static let fittedApart = "Each format weighs his season against his preseason pace by its own fit, "
        + "so Half PPR need not sit halfway between PPR and Standard."

    /// rest-from.ts restSpanWords: "weeks 7 to 17", "week 18", "with no game left".
    static func restSpan(_ week: Int?) -> String {
        guard let week else {
            return "with no game left"
        }
        let last = max(PageWords.runLastWeek, week)
        return week == last ? "week \(week)" : "weeks \(week) to \(last)"
    }

    /// rest-from.ts playerRestWords: "from week 7", "with no game left".
    static func restWords(_ week: Int?) -> String {
        week.map { RunWords.restFrom(week: $0, partial: false) } ?? "with no game left"
    }

    /// rest-from.ts restOfSeasonHead: the every-format table's points head, "Rest of season from week 7".
    static func restHead(_ week: Int?) -> String {
        "Rest of season \(restWords(week))"
    }

    /// The tier box over the leading board, nil where he is not on it.
    static func tier(
        _ board: RunBoardAnswer, player: String, format: RunFormat, season: Int, capture: RunDesignations?
    ) -> TierBox? {
        let statuses = capture?.players.additionalProperties ?? [:]
        guard let row = board.rows.first(where: { $0.id == player }),
              let position = BoardPosition(rawValue: row.positionName)
        else {
            return nil
        }
        let his = format.rosFromWeek == nil ? nil : (row.restFromWeek ?? format.rosFromWeek)
        let basis = format.rosFromWeek == nil
            ? "Projected \(format.label) points, \(season)"
            : "Projected \(format.label) points for the rest of \(season), \(restSpan(his))"
        let title = "Tier \(row.tier) \(position.group.many)"
        let tiers = BoardOrder.tiers(board.rows, position: position, statuses)
        guard !BoardOrder.heldOut(row, statuses), let group = tiers.first(where: { $0.tier == row.tier }) else {
            return TierBox(tier: row.tier, title: title, drop: nil, mates: [], basis: basis)
        }
        let count = Formatting.plural(group.rows.count, "player")
        let drop = group.drop
            .map { "\(count), then \(Formatting.fixed($0)) \(format.unit) down to tier \(group.tier + 1)" }
            ?? "\(count), the last tier"
        return TierBox(
            tier: group.tier, title: "Tier \(group.tier) \(position.group.many)", drop: drop,
            mates: group.rows.map { mate in
                let theirs = format.rosFromWeek == nil ? nil : (mate.restFromWeek ?? format.rosFromWeek)
                return TierBox.Mate(
                    id: mate.id, name: mate.name, positionRank: mate.positionRank, team: mate.team,
                    projected: Formatting.fixed(mate.projected), span: theirs == his ? nil : restSpan(theirs),
                    current: mate.id == player
                )
            },
            basis: basis
        )
    }

    /// A format line the table and the unwritten list read: the format, his numbers in it, whether the
    /// run ranks the rest of the season in it, and its board's size.
    struct Line {
        let format: RunFormat
        let numbers: RunPlayerFormat
        let rest: Bool
    }

    /// week-words.ts formatsOf over restNow: the read's every-format figures, only when it carries one
    /// for the page's lead format (its rest tile's); nil before the season, with no read, or on a read
    /// with none, so the run's figures and their head stand together.
    static func liveFormats(_ week: PlayerWeek?, lead: RunFormat) -> LiveFormats? {
        let api = { (figure: Components.Schemas.RestOfSeasonFigure) in
            figure.format.value1?.rawValue ?? figure.format.value2
        }
        guard let week, lead.rosFromWeek != nil, let board = lead.apiFormat, let all = week.restOfSeason,
              all.contains(where: { api($0) == board })
        else {
            return nil
        }
        return LiveFormats(
            head: restHead(week.restFromWeek),
            figures: Dictionary(
                all.compactMap { figure in api(figure).map { (
                    $0,
                    LiveFormats.Figure(points: figure.points, vor: figure.pointsOverReplacement)
                ) } },
                uniquingKeysWith: { first, _ in first }
            )
        )
    }

    /// live-figures.ts lineFiguresAt: one format line's points and Over repl., the read's once its
    /// figures stand (a figure it lacks the empty one).
    static func lineFigures(_ line: Line, live: LiveFormats?) -> (points: Double?, vor: Double?) {
        guard let live else {
            return (line.numbers.projected, line.numbers.vor)
        }
        let read = line.format.apiFormat.flatMap { live.figures[$0] }
        return (read?.points, read?.vor)
    }

    /// live-figures.ts lineRanksAt: while the figures are the run's every rank is the run's; once the
    /// read's figures stand, the read's format takes the head's rank and every other shows none, as the
    /// read places him in its own format alone (the per-format rank is an API field still to come,
    /// B206). `unranked` is the labels of the lines that show none, for the table's one footnote.
    static func lineRanks(_ lines: [Line], live: LiveFormats?, read: RankRead?) -> (ranks: [Int?], unranked: [String]) {
        guard live != nil, let read else {
            return (lines.map(\.numbers.positionRank), [])
        }
        let ranks = lines.map { line in
            line.format.apiFormat != nil && line.format.apiFormat == read.format ? read.positionRank : nil
        }
        return (ranks, zip(lines, ranks).filter { $0.1 == nil }.map(\.0.format.label))
    }

    static func lines(_ player: RunPlayer, formats: [RunFormat]) -> [Line] {
        formats.compactMap { format in
            player.formats.additionalProperties[format.id].map {
                Line(format: format, numbers: $0, rest: PageWords.ranksRest(format))
            }
        }
    }

    /// What the every-format table is drawn over: his position, the word his ranks show as on a
    /// season-long list, and at the read's clock its figures and its rank.
    struct FormatsFacts {
        let position: String
        let held: String?
        let live: LiveFormats?
        let read: RankRead?
    }

    /// player-words.ts formatTable, with the page's rows on one clock (Lane 224, the web's Lane 220):
    /// his position rank in each format ("RB 15") beside its points and Over repl., the run's or the
    /// read's; nil with one format, which the page draws none of.
    static func formats(_ lines: [Line], facts: FormatsFacts) -> FormatsTable? {
        let held = facts.held
        guard lines.count > 1 else {
            return nil
        }
        let from = { (entry: Line) in
            let week = entry.format.rosFromWeek == nil ? nil : (entry.numbers.restFromWeek ?? entry.format.rosFromWeek)
            return restHead(week)
        }
        let rest = lines.filter(\.rest)
        let note = rest.count > 1 ? fittedApart : nil
        let head: String
        let labels: [String]
        if rest.isEmpty {
            (head, labels) = (Words.Figure.projected, lines.map(\.format.label))
        } else if let first = rest.first, rest.count == lines.count {
            (head, labels) = (from(first), lines.map(\.format.label))
        } else {
            head = Words.Figure.projected
            labels = lines.map { $0.rest ? "\($0.format.label), \(from($0).lowercased())" : $0.format.label }
        }
        let ranks = lineRanks(lines, live: facts.live, read: facts.read)
        let rows = zip(lines, labels).enumerated().map { index, pair in
            let (line, label) = pair
            let figures = lineFigures(line, live: facts.live)
            return FormatsTable.Row(
                label: label,
                rank: held ?? ranks.ranks[index].map { "\(facts.position) \($0)" } ?? Words.Box.none,
                points: figures.points.map { Formatting.fixed($0) } ?? Words.Box.none,
                vor: figures.vor.map { BoardFigures.signed($0) } ?? Words.Box.none,
                tier: held ?? String(line.numbers.tier)
            )
        }
        return FormatsTable(
            rankHead: Words.FormatsRank.head, head: facts.live?.head ?? head, rows: rows, note: note,
            footnote: ranks.unranked.isEmpty ? nil : LiveOrderWords.unranked(ranks.unranked)
        )
    }

    /// What the unwritten list is said over: his position, the board's size, the format, the season and
    /// the word his ranks show as on a season-long list (unwritten-words.ts UnwrittenInput).
    struct UnwrittenFacts {
        let position: String
        let boardSize: Int
        let format: RunFormat
        let year: Int
        let held: String?
    }

    /// unwritten-words.ts unwrittenLines over the leading format.
    static func unwritten(_ numbers: RunPlayerFormat, _ facts: UnwrittenFacts) -> [UnwrittenLine] {
        let (position, boardSize, format, year) = (facts.position, facts.boardSize, facts.format, facts.year)
        let span = PageWords.ranksRest(format) ? "the rest of \(year)" : String(year)
        let label = format.label
        var lines: [UnwrittenLine] = if let held = facts.held {
            [UnwrittenLine(
                lead: "His place",
                text: "On a season-long list, so he sits below every available \(position) on our \(label) board, "
                    + "in no tier.",
                figure: "\(position) \(held)"
            )]
        } else {
            [
                UnwrittenLine(
                    lead: "Our rank",
                    text: "\(position) \(numbers.positionRank) and pick \(numbers.ourRank) overall among the "
                        + "\(boardSize) on our \(label) board.",
                    figure: "\(position)\(numbers.positionRank)"
                ),
                UnwrittenLine(
                    lead: "His tier",
                    text: "Tier \(numbers.tier) among \(position)s on our \(label) board.",
                    figure: "Tier \(numbers.tier)"
                ),
            ]
        }
        if let floor = numbers.floor, let median = numbers.median, let ceiling = numbers.ceiling {
            let (low, mid, high) = (Formatting.fixed(floor), Formatting.fixed(median), Formatting.fixed(ceiling))
            lines.append(UnwrittenLine(
                lead: "His range",
                text: "Low case \(low), middle \(mid) and high case \(high) \(format.unit) for \(span).",
                figure: "\(low) to \(high)"
            ))
        }
        lines.append(UnwrittenLine(
            lead: "Games we expect",
            text: "Games we expect him to play in \(span), the base of his projected \(label) points.",
            figure: Formatting.fixed(numbers.expectedGames)
        ))
        return lines
    }

    /// player-card.ts cardBuild's week ahead: the first week past his counted one that is a game to play
    /// or his bye.
    static func weekAhead(_ season: Components.Schemas.RunSeason) -> CardHead? {
        let counted = SeasonViews.countedWeek(season)
        return season.log.first { row in
            row.week > counted && (row.status.value1 == .bye || (row.status.value1 == .upcoming && row.opponent != nil))
        }.map { row in
            CardHead(
                week: row.week,
                opponent: row.opponent.map { "\(row.home == true ? "vs" : "at") \($0)" } ?? Words.Box.bye
            )
        }
    }

    /// The card's tiles as built, before the week is read: the week's "--", rest of season in the lead
    /// format, Avg and Last from his season.
    static func builtTiles(page: RunPlayer?, format: RunFormat, next: CardHead?, projected: Double) -> [CardTile] {
        let built = CardTiles.builtTiles(page: page, format: format, projected: projected)
        return [
            CardTile(
                key: .proj,
                label: next.map { CardTiles.weekHead($0.week) } ?? Words.Figure.week,
                value: CardTiles.none,
                tone: .lead
            ),
            built.rest,
            CardTile(key: .opp, label: Words.Card.opp, value: CardTiles.none, tone: nil),
            built.avg,
            built.last,
            CardTile(key: .delta, label: Words.Card.delta, value: CardTiles.none, tone: .quiet),
        ]
    }
}
