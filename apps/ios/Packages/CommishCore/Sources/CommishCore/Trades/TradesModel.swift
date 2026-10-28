import CommishAPI
import CommishDesign
import Foundation

/// A gain as its cell prints it, with its ink.
public struct GainCell: Equatable, Sendable {
    public let words: String
    public let tone: Tone

    init(_ value: Double) {
        words = TradesWords.gain(value)
        tone = TradesWords.tone(value)
    }
}

/// A card of the strip (TradeStrip.svelte): the other team, both sides by last name, both gains, the
/// need it fills, its week, the drop; the first of two says Best and draws its verb solid.
public struct StripCard: Equatable, Sendable, Identifiable {
    public let id: String
    public let mark: String?
    public let lead: Bool
    public let team: String
    public let initials: String
    public let give: String
    public let get: String
    public let mine: String
    public let theirs: String
    public let need: String?
    public let week: String?
    public let drop: String?
    public let dropReason: String?
}

/// The strip: the week, how many trades are worth proposing, the platform's reason, each card.
public struct TradesStrip: Equatable, Sendable {
    public let week: String
    public let title: String
    public let reason: String?
    public let cards: [StripCard]
}

/// One side of an opened trade: "From McConkey Kong Country, you" over the give and the drop, "From
/// Max_Jensen10" over the get, each row in the box score's cells.
public struct TradeGroup: Equatable, Sendable, Identifiable {
    public let head: String
    public let rows: [RowCells]

    public var id: String {
        head
    }
}

/// A trade's players opened (TradeFinder's opened row at 390): its week in one line, the drop's
/// sentence, both sides.
public struct OpenedTrade: Equatable, Sendable {
    public let week: String?
    public let dropReason: String?
    public let groups: [TradeGroup]
}

/// One trade of the finder as a phone draws it: you give, you get, with whom and your drop, the need
/// it fills, both gains; the offer its verb copies, and the check that asks for both lineups.
public struct TradeLine: Equatable, Sendable, Identifiable {
    /// The web's tradeKey: the team and both sides' host ids, so a re-read keeps a row open.
    public let id: String
    public let team: String
    public let give: String
    public let get: String
    public let with: String
    public let need: String?
    public let mine: GainCell
    public let theirs: GainCell
    /// The share text (trades.ts offerText).
    public let offer: String
    public let opened: OpenedTrade
    /// The builder's picks from this trade (Build from this, builder.ts builtFrom), nil when a player in
    /// it has no host id.
    public let built: TradePicks?
}

/// A player the Trades holding picker offers: his key (state.ts pickKey) and his name.
public struct PickOption: Equatable, Sendable, Identifiable {
    public let id: String
    public let name: String
}

/// The Trades holding picker (TradeScreen's PickSelect): every trade first, then your players, then
/// theirs from the trades found, each once; the one chosen.
public struct TradePicker: Equatable, Sendable {
    public let yours: [PickOption]
    public let theirs: [PickOption]
    public let chosen: String?

    /// The chosen player's name, or Every trade.
    public var label: String {
        (yours + theirs).first { $0.id == chosen }?.name ?? Words.TradePicker.every
    }
}

/// What the basis says the screen draws: the finder alone, a trade's players opened, or the builder.
public enum TradesOpened: Equatable, Sendable {
    case none
    case trade
    case builder
}

/// The finder's two orders a phone sorts by: your gain, their gain (TradeFinder's phone heads).
public enum TradeSort: String, CaseIterable, Equatable, Sendable {
    case mine
    case theirs

    public var head: String {
        switch self {
        case .mine: Words.Trades.yourGain
        case .theirs: Words.Trades.theirGain
        }
    }
}

/// A team the finder lists no trade with (builder.ts noIdeasFrom, B271): every idea it found with them,
/// they would not take (Lane 269), so its place says so rather than leaving the team out.
public struct NoIdeaLine: Equatable, Sendable, Identifiable {
    public let id: Int
    public let team: String
    /// "With Carried by QJs", over its line.
    public let with: String
    /// "No idea they would take."
    public let note: String

    /// The teams with no trade, in the answer's order.
    static func of(_ teams: [TradeTeam]) -> [NoIdeaLine] {
        teams.filter(\.trades.isEmpty).map {
            NoIdeaLine(
                id: $0.rosterId, team: $0.name, with: "\(Words.Trades.with) \($0.name)", note: Words.Trades.noIdea
            )
        }
    }
}

/// The Trades screen at one read (TradeScreen.svelte at 390): the decision as a strip, the chips, the
/// finder in the chosen order, the verb, the basis with no trade opened and with one.
public struct TradesModel: Equatable, Sendable {
    public let decision: String
    public let strip: TradesStrip?
    public let best: String
    public let every: String
    public let gainBasis: String?
    public let verb: String
    /// The platform's trade page the verb opens; nil when the API knows none, and the verb stands
    /// disabled with `reason` under it.
    public let page: URL?
    public let reason: String?
    public let rows: [TradeLine]
    public let picker: TradePicker
    /// No trade found holds the player picked: the decision says so in place of the strip.
    public let noneHolding: Bool
    public let platform: String
    /// The builder's opening picks for Build a trade.
    public let opening: TradePicks
    /// Each team the finder lists no trade with, its line in its place under the rows (B271), none
    /// while a player is picked.
    public let noIdeas: [NoIdeaLine]
    private let bases: [TradesOpened: String]

    /// The basis as the screen stands: closed, a trade opened, or the builder open.
    public func basis(_ opened: TradesOpened) -> String {
        bases[opened] ?? ""
    }

    /// Every player an opened row shows in the sheet.
    public var sheetPlayers: [SheetPlayer] {
        rows.flatMap { $0.opened.groups.flatMap(\.rows) }.compactMap(\.sheetPlayer)
    }

    /// The answer drawn at `now`, the member's team named `me`, every trade or each team's best, in
    /// `sort`'s order; with a player picked, the trades holding him from the narrowed answer (the web's
    /// shown), or none where it was not read.
    public init(
        advice answer: TradeAdvice, narrowed: TradeAdvice? = nil, holding: String? = nil,
        host: Components.Schemas.LeagueHost, me: String, every showsEvery: Bool, sort: TradeSort, now: Date,
        zone: TimeZone
    ) {
        let advice = TradeFinder.held(answer, now: now)
        let shown = narrowed.map { TradeFinder.held($0, now: now) } ?? advice
        let platform = ValueWords.platform(host)
        let worth = TradeFinder.worthProposing(advice.teams)
        let picker = TradeFinder.picker(advice, chosen: holding)
        let none = holding.map { !TradeFinder.holds(shown.teams, $0) } ?? false
        self.platform = platform
        self.picker = picker
        noneHolding = none
        decision = none
            ? TradesWords.noTradeWith(picker.label)
            : TradesWords.decision(worth.first.map { ($0.row, $0.team.name) })
        strip = worth.isEmpty || none ? nil : TradesStrip(
            week: "\(Words.Trades.weekWord) \(advice.forWeek ?? advice.week)",
            title: TradesWords.worthTitle(worth.count),
            reason: advice.moves.reason,
            cards: worth.enumerated().map { Self.card($1, index: $0, count: worth.count) }
        )
        best = "\(Words.Trades.best), \(advice.teams.filter { !$0.trades.isEmpty }.count)"
        every = "\(Words.Trades.every), \(advice.teams.reduce(0) { $0 + $1.trades.count })"
        gainBasis = advice.gainBasis
        verb = TradesWords.verb(advice.moves, platform: platform)
        page = advice.hostTradesUrl.isEmpty ? nil : URL(string: advice.hostTradesUrl)
        reason = advice.hostTradesUrl.isEmpty ? advice.hostNote : nil
        opening = TradeBuilder.opening(advice)
        noIdeas = holding == nil ? NoIdeaLine.of(advice.teams) : []
        let teams = TradeFinder.holding(shown.teams, player: holding)
        rows = TradeFinder.sorted(TradeFinder.rows(teams, every: showsEvery), by: sort).map {
            Self.line($0, me: me, zone: zone, now: now)
        }
        let lines = advice.roster + advice.teams.flatMap { $0.roster + $0.trades.flatMap { $0.give + $0.get } }
        let basis = { (opened: TradesOpened) in
            TradesBasis.phone(.init(advice: shown, host: host, lines: lines, opened: opened, zone: zone, now: now))
        }
        bases = [.none: basis(.none), .trade: basis(.trade), .builder: basis(.builder)]
    }

    static func card(_ entry: TradeFinder.Entry, index: Int, count: Int) -> StripCard {
        let row = entry.row
        return StripCard(
            id: entry.key, mark: index == 0 && count > 1 ? Words.Strip.best : nil, lead: index == 0,
            team: entry.team.name, initials: Initials.of(entry.team.name), give: TradesWords.shortSide(row.give),
            get: TradesWords.shortSide(row.get), mine: TradesWords.gain(row.myGain),
            theirs: TradesWords.gain(row.theirGain), need: row.need, week: TradesWords.weekLine(row),
            drop: row.drop == nil ? nil : TradesWords.yourRoom(row), dropReason: row.dropReason
        )
    }

    static func line(_ entry: TradeFinder.Entry, me: String, zone: TimeZone, now: Date) -> TradeLine {
        let row = entry.row
        let cells = { (line: PlayerLine, side: String, move: Move) in
            RowCells(trade: StartRows.row(line, slot: side, zone: zone, now: now, ranked: false), move: move)
        }
        let yours = row.give.map { cells($0, Words.Trades.sideGive, .out) }
            + (row.drop.map { [cells($0.value1, Words.Trades.sideDrop, .out)] } ?? [])
        let theirs = row.get.map { cells($0, Words.Trades.sideGet, .into) }
        return TradeLine(
            id: entry.key, team: entry.team.name, give: TradesWords.shortSide(row.give),
            get: TradesWords.shortSide(row.get), with: TradesWords.phoneWith(team: entry.team.name, row: row),
            need: row.need, mine: GainCell(row.myGain), theirs: GainCell(row.theirGain),
            offer: TradesWords.offer(team: entry.team.name, row: row),
            opened: OpenedTrade(
                week: TradesWords.weekLine(row), dropReason: row.dropReason,
                groups: [
                    TradeGroup(head: TradesWords.from(me, mine: true), rows: yours),
                    TradeGroup(head: TradesWords.from(entry.team.name, mine: false), rows: theirs),
                ]
            ),
            built: TradeBuilder.built(team: entry.team.rosterId, row: row)
        )
    }
}

/// trades.ts's finder: its rows, their orders, the strip's picks, the held week.
enum TradeFinder {
    struct Entry {
        let key: String
        let team: TradeTeam
        let row: TradeRow
    }

    /// state.ts tradeKey: "8:96>12481+8116".
    static func key(team: Int, row: TradeRow) -> String {
        let ids = { (side: [PlayerLine]) in side.map(\.player.hostId).sorted().joined(separator: "+") }
        return "\(team):\(ids(row.give))>\(ids(row.get))"
    }

    /// The API's order across teams: the trades they gain from first, then the close calls for them,
    /// each by your gain, then theirs.
    static func apiOrder(_ lhs: Entry, _ rhs: Entry) -> Bool {
        if lhs.row.closeForThem != rhs.row.closeForThem {
            return !lhs.row.closeForThem
        }
        if lhs.row.myGain != rhs.row.myGain {
            return lhs.row.myGain > rhs.row.myGain
        }
        return lhs.row.theirGain > rhs.row.theirGain
    }

    /// trades.ts finderRows: each team's first trade, or every trade, in the API's order (a stable
    /// sort, as JavaScript's).
    static func rows(_ teams: [TradeTeam], every: Bool) -> [Entry] {
        let entries = teams.flatMap { team in
            (every ? team.trades : Array(team.trades.prefix(1))).map {
                Entry(key: key(team: team.rosterId, row: $0), team: team, row: $0)
            }
        }
        return stable(entries, by: apiOrder)
    }

    /// trades.ts sortRows: best first by the column, ties in the API's order.
    static func sorted(_ entries: [Entry], by sort: TradeSort) -> [Entry] {
        let figure = { (entry: Entry) in sort == .mine ? entry.row.myGain : entry.row.theirGain }
        return stable(entries) { lhs, rhs in
            figure(lhs) == figure(rhs) ? apiOrder(lhs, rhs) : figure(lhs) > figure(rhs)
        }
    }

    /// trades.ts worthProposing: each team's best the other team gains from, at most two.
    static func worthProposing(_ teams: [TradeTeam]) -> [Entry] {
        Array(rows(teams, every: false).filter { !$0.row.closeForThem && $0.row.myGain > 0 }.prefix(2))
    }

    /// The prefix of a picker key for a player our board does not place (state.ts pickKey's own prefix
    /// names the platform's id field, a word the copy guard keeps out of sources).
    static let unplaced = "platform:"

    /// state.ts pickKey: his board id, or his platform id where our board does not place him.
    static func pickKey(_ line: PlayerLine) -> String {
        line.player.boardId ?? "\(unplaced)\(line.player.hostId)"
    }

    /// state.ts pickerPlayers: your roster, then theirs from the trades found, each once.
    static func picker(_ advice: TradeAdvice, chosen: String?) -> TradePicker {
        var seen: Set<String> = []
        let theirs = advice.teams.flatMap { $0.trades.flatMap(\.get) }.filter { line in
            guard let id = line.player.boardId else {
                return false
            }
            return seen.insert(id).inserted
        }
        let option = { (line: PlayerLine) in PickOption(id: pickKey(line), name: line.player.name) }
        return TradePicker(yours: advice.roster.map(option), theirs: theirs.map(option), chosen: chosen)
    }

    /// state.ts tradeHolding: a trade found holds the player, by board id.
    static func holds(_ teams: [TradeTeam], _ key: String) -> Bool {
        teams.contains { $0.trades.contains { trade(trade: $0, holds: key) } }
    }

    static func trade(trade row: TradeRow, holds key: String) -> Bool {
        (row.give + row.get).contains { $0.player.boardId == key }
    }

    /// TradeScreen's teams: each team's trades holding the player picked, every trade with none.
    static func holding(_ teams: [TradeTeam], player: String?) -> [TradeTeam] {
        guard let player else {
            return teams
        }
        return teams.map { team in
            var team = team
            team.trades = team.trades.filter { trade(trade: $0, holds: player) }
            return team
        }
    }

    /// trades.ts heldTrades: every trade's week change held once a player it moves has kicked off.
    static func held(_ advice: TradeAdvice, now: Date) -> TradeAdvice {
        var held = advice
        held.teams = advice.teams.map { team in
            var team = team
            team.trades = team.trades.map { TradeChecks.held($0, now: now) }
            return team
        }
        return held
    }

    /// A sort that keeps equal elements in their order, as Array.prototype.sort does.
    static func stable(_ entries: [Entry], by before: (Entry, Entry) -> Bool) -> [Entry] {
        entries.enumerated().sorted { lhs, rhs in
            if before(lhs.element, rhs.element) {
                return true
            }
            if before(rhs.element, lhs.element) {
                return false
            }
            return lhs.offset < rhs.offset
        }.map(\.element)
    }
}
