import CommishAPI
import CommishDesign
import Foundation

/// One row's cells as the phone draws them (BoxLine and BoxPlayer at 390): the slot with the move's
/// arrow, the player (his name, his club and position with his status, his game, the expected score
/// and weather while it is to come, the evidence line), Our rank, Proj and Pts.
public struct RowCells: Equatable, Sendable, Identifiable {
    public let row: StartRow
    public let move: Move?
    public let idle: Bool
    public let why: String?
    /// "" on an injured reserve row, the rank, or "--".
    public let rank: String
    /// "Bye", "No club", or nil beside the game's two halves.
    public let game: RowGame
    /// Said in place of the game: why a bench player on injured reserve is a drop.
    public let note: String?
    public let proj: String
    public let pts: String
    /// "Opp 2nd, Avg 23.3, Last 19.0"; the Opp rank's own words and its tint while to come.
    public let evidence: String
    public let oppRank: String?
    public let ease: Ease
    /// His rest-of-season points a game, "--" without one (the Trades screen's last cell).
    public let season: String

    public var id: String {
        row.id
    }

    /// A trade's row (TradeFinder's opened players): which way he moves for the member, his side in
    /// the slot's cell.
    init(trade row: StartRow, move: Move) {
        self.init(nil, row: row, reserve: nil, move: move)
    }

    init(_ entry: LineupEntry?, row plain: StartRow, reserve: ReserveRow?, move: Move? = nil) {
        let row = plain.reserved(reserve)
        self.row = row
        self.move = move ?? entry?.move
        season = StartWords.number(row.season)
        idle = entry?.idle ?? false
        why = entry?.why
        rank = reserve != nil ? "" : row.rank.map(String.init) ?? Words.Box.none
        game = row.game
        note = reserve == .bench ? Words.Box.irBench : nil
        proj = StartWords.number(row.proj)
        pts = StartWords.number(row.pts)
        let pairs = [
            "\(Words.Box.avg) \(StartWords.number(row.avg))",
            "\(Words.Box.last) \(StartWords.number(row.last))",
        ]
        let opp = row.oppRank.map { Formatting.ordinal($0) }
        oppRank = opp
        evidence = ((opp.map { ["\(Words.Box.opp) \($0)"] } ?? []) + pairs).joined(separator: ", ")
        ease = row.oppRank.map { row.toCome ? StartRows.ease($0, outOf: row.oppOf) : .even } ?? .even
    }
}

/// The Team row (LineupTable totals, TeamFigures): its note, the Proj cell (the projected final or
/// the final total captioned once a starter has kicked off) and the Pts.
public struct TeamRow: Equatable, Sendable {
    public let note: String?
    /// Pts is the big figure from kickoff, the Proj before it.
    public let live: Bool
    public let caption: String?
    public let proj: String
    public let pts: String
}

/// A chip in the strip: a spot no one can play, or a swap as the phone names it ("QB", "Mahomes in").
public enum StripChip: Equatable, Sendable, Identifiable {
    case idle(String)
    case swap(Swap)

    public var id: String {
        switch self {
        case let .idle(words): "idle-\(words)"
        case let .swap(swap): "swap-\(swap.id)"
        }
    }
}

/// The verb the screen pins above the bar: the changes made on the platform from here, or the lineup
/// copied for the platform's own page (StartScreen.svelte).
public enum StartVerb: Equatable, Sendable {
    case make
    case copy

    public var title: String {
        switch self {
        case .make: Words.Lineup.make
        case .copy: Words.Lineup.copy
        }
    }
}

/// A run of the line under the verb: words, or words that open a page.
public struct FootRun: Equatable, Sendable {
    public let text: String
    public let url: URL?
}

/// The Start screen at one clock (StartScreen.svelte at 390): the strip, the lineup, the Team row,
/// the bench and the injured reserve, the basis once, and the one verb with the line under it.
public struct StartModel: Equatable, Sendable {
    public let week: String
    public let title: String
    /// The decision in one sentence, the strip's name for VoiceOver (words.ts lineupDecision).
    public let decision: String
    public let sum: StripSum?
    /// The API's sentence once every starter has kicked off, in the sum's place.
    public let done: String?
    public let missed: String?
    public let chips: [StripChip]
    /// The advice's swaps, which the sheet's verb says under it for the row they name.
    public let swaps: [Swap]
    public let starters: [RowCells]
    /// Spots empty on the platform that no one who can play fills: their slot words.
    public let empty: [String]
    public let team: TeamRow
    public let bench: [RowCells]
    public let reserve: [RowCells]
    public let basis: String
    public let platform: String
    /// The verb, nil with nothing to change (the lineup set, or every starter kicked off).
    public let verb: StartVerb?
    /// The platform's lineup page, nil when the API knows none.
    public let page: URL?
    /// The line under the verb before it is pressed.
    public let foot: [[FootRun]]
    /// The move the verb plans: each changed slot's player in and the starter it sits.
    public let move: HostMoveInput
    /// The lineup as the copy verb puts it on the clipboard.
    public let copyText: String

    /// `words` is the platform's words, the league's own unless a store graphic passes the neutral one
    /// (Lane 310).
    public init(
        advice answer: LineupAdvice, host: Components.Schemas.LeagueHost, now: Date, zone: TimeZone,
        words: HostWords? = nil
    ) {
        let (advice, held) = LineupBoxes.held(answer, now: now)
        let box = LineupBoxes.box(advice, held: held, zone: zone, now: now)
        let hostWords = words ?? .of(host)
        let platform = hostWords.name
        let done = advice.weekDone
        self.platform = platform
        week = "\(Words.LeagueHome.week) \(advice.week)"
        title = StartWords.changesTitle(box.swaps.count, done: done, state: advice.weekDoneState?.value1)
        decision = StartModel.decision(advice)
        sum = StartWords.lineupSum(box, host: hostWords, done: done)
        self.done = done
        missed = advice.missed
        chips = done == nil ? box.idle.map(StripChip.idle) + box.swaps.map(StripChip.swap) : []
        swaps = box.swaps
        starters = box.starters.map { RowCells($0, row: $0.row, reserve: nil) }
        empty = box.empty
        let small = StartWords.teamSmall(box.totals)
        team = TeamRow(
            note: box.totals.note, live: box.totals.live, caption: small?.caption,
            proj: StartWords.number(small.map(\.figure) ?? box.totals.proj), pts: StartWords.number(box.totals.pts)
        )
        bench = box.bench.map { RowCells($0, row: $0.row, reserve: $0.row.reserve ? .bench : nil) }
        reserve = box.reserve.map { RowCells(nil, row: $0, reserve: .slot) }
        let lines = advice.slots.flatMap { [$0.ours] + ($0.host.map { [$0.value1] } ?? []) } + advice.bench
            + advice.reserve
        basis = LineupBasis.phone(.init(
            advice: advice, host: host, lines: lines, totals: box.totals, zone: zone, now: now, words: hostWords
        ))
        let onHost = Self.setsOnHost(advice)
        verb = box.swaps.isEmpty ? nil : onHost ? .make : .copy
        page = advice.hostLineupUrl.isEmpty ? nil : URL(string: advice.hostLineupUrl)
        foot = Self.foot(advice, box: box, onHost: onHost, platform: platform, page: page)
        move = Self.lineupMove(advice)
        copyText = StartWords.lineupText(box, week: advice.week)
    }

    /// The line under the verb once the lineup is copied: "Copied. Set it on FFPC's lineup page.", or
    /// what the phone could not do.
    public func copied(_ didCopy: Bool) -> [[FootRun]] {
        let said = didCopy ? Words.Lineup.copied : Words.Lineup.copyFailed
        return [[
            FootRun(text: "\(said) \(Words.Lineup.setItOn) ", url: nil),
            FootRun(text: StartWords.lineupPage(platform), url: page),
            FootRun(text: ".", url: nil),
        ]]
    }

    /// move.ts setsOnHost: the API opens the move, and there is a change to make.
    static func setsOnHost(_ advice: LineupAdvice) -> Bool {
        advice.moves.lineup.value1 == .available && !advice.set && advice.slots.contains(where: \.changed)
    }

    /// StartScreen.svelte verbFoot: the platform's page and the API's reason under Copy the lineup;
    /// "Lineup set on ESPN" under a set lineup the platform takes from here; nothing once every
    /// starter has kicked off.
    static func foot(
        _ advice: LineupAdvice, box: LineupBox, onHost: Bool, platform: String, page: URL?
    ) -> [[FootRun]] {
        guard advice.weekDone == nil else {
            return []
        }
        if box.swaps.isEmpty {
            return advice.moves.lineup.value1 == .available
                ? [[FootRun(text: StartWords.setOn(platform), url: nil)]] : []
        }
        guard !onHost else {
            return []
        }
        let link = page.map { [[FootRun(text: StartWords.lineupPage(platform), url: $0)]] } ?? []
        let line = advice.moves.reason ?? advice.hostNote ?? ""
        return link + (line.isEmpty ? [] : [[FootRun(text: line, url: nil)]])
    }

    /// move.ts lineupMove: each changed slot's player in and the starter it sits, for the week read.
    static func lineupMove(_ advice: LineupAdvice) -> HostMoveInput {
        let changes = advice.slots.filter(\.changed).map { slot in
            HostMoveChange(
                slot: .init(
                    value1: slot.slot.value1.flatMap { .init(rawValue: $0.rawValue) },
                    value2: slot.slot.value2
                ),
                _in: slot.ours.player.hostId, out: slot.host?.value1.player.hostId
            )
        }
        return HostMoveInput(kind: .init(value1: .lineup), week: advice.week, changes: changes)
    }

    /// words.ts lineupDecision.
    static func decision(_ advice: LineupAdvice) -> String {
        let labels = slotLabels(advice.slots.map { $0.slot.value1?.rawValue ?? $0.slot.value2 ?? "" })
        let changes = zip(advice.slots, labels).compactMap { slot, label -> String? in
            guard slot.changed else {
                return nil
            }
            let over = slot.host.map { " over \($0.value1.player.name)" } ?? ""
            let flex = label.replacingOccurrences(of: #" \d+$"#, with: "", options: .regularExpression)
            let place = label.lowercased().contains("flex") ? "in the \(flex.lowercased())" : "at \(label)"
            return "start \(slot.ours.player.name)\(over) \(place)"
        }
        if advice.set || changes.isEmpty {
            return "\(Words.Lineup.set)."
        }
        let count = StartWords.changeCount(changes.count)
        if changes.count > 2 {
            let first = changes[0].replacingOccurrences(of: "start ", with: "", options: .anchored)
            return "\(count), starting with \(first)."
        }
        return "\(count): \(changes.joined(separator: ", "))."
    }

    /// words.ts slotLabels: "QB", "RB1", "RB2", "Flex 1", numbered where the lineup has more than one.
    static func slotLabels(_ slots: [String]) -> [String] {
        let names = ["FLEX": "Flex", "SUPERFLEX": "Superflex"]
        var seen: [String: Int] = [:]
        return slots.map { slot in
            let count = slots.filter { $0 == slot }.count
            seen[slot, default: 0] += 1
            let name = names[slot] ?? slot
            guard count >= 2 else {
                return name
            }
            let number = seen[slot] ?? 1
            return name.count > 3 ? "\(name) \(number)" : "\(name)\(number)"
        }
    }
}

public extension RowCells {
    /// The player the row's name opens in the sheet, by his platform id: nil where the site has no
    /// page for him (a kicker, a defense, a shared name), as the web's row draws no link.
    var sheetPlayer: SheetPlayer? {
        row.slug.map { slug in
            SheetPlayer(
                id: row.id, slug: slug, name: row.name, position: row.position,
                rank: row.rank.map(String.init) ?? row.status?.rank, club: row.club, boardID: row.boardID
            )
        }
    }
}

public extension StartModel {
    /// lineup.ts swapOf and swapWords: the swap that names his row, as the strip says it ("QB, Dart in,
    /// Rodgers out"); nil where none does.
    func swapLine(_ row: StartRow) -> String? {
        let short = LineupBoxes.shortName(row.name)
        return swaps.first { $0.id == row.id || $0.out == short }.map(StartWords.swap)
    }
}
