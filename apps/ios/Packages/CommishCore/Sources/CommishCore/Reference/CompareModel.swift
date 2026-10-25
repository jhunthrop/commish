import CommishAPI
import CommishDesign
import Foundation

/// A player the compare's search can set on a side: who he is, as the run's index names him.
public struct CompareCandidate: Equatable, Sendable, Identifiable {
    public let id: String
    public let slug: String
    public let name: String
    /// "WR · LAR".
    public let line: String
    /// search.ts folded: lower case, accents folded.
    let key: String
}

/// A side of Compare as its picker shows it: the player set on it, a link's slug that names nobody
/// (the web's absent words over the search), or nobody yet.
public enum CompareSlot: Equatable, Sendable {
    case picked(name: String, initials: String, headshot: URL?)
    case missing
    case open

    public var picked: Bool {
        if case .picked = self {
            return true
        }
        return false
    }
}

/// A side's head over the table: his face, name, pill and club, his sheet.
public struct CompareHead: Equatable, Sendable, Identifiable {
    public let id: String
    public let name: String
    public let initials: String
    public let headshot: URL?
    /// "WR 4".
    public let pill: String
    public let club: String
    public let sheetPlayer: SheetPlayer
    /// His floor, median and ceiling where the run carries them.
    public let range: CompareRange?
}

/// The table once both sides are in: the call and its evidence, the heads, the rows, the range scale
/// and the basis.
public struct CompareTable: Equatable, Sendable {
    public let call: String
    public let evidence: String
    public let heads: [CompareHead]
    public let rows: [CompareRow]
    /// The pair's shared scale for the range bars, nil where neither carries a range.
    public let scale: ClosedRange<Double>?
    public let basis: [String]
}

/// What Compare shows under the pickers: nothing until both sides are in, the same player twice, or
/// the call with its table.
public enum CompareOutcome: Equatable, Sendable {
    case none
    case same(title: String, line: String)
    case table(CompareTable)
}

/// Compare as the web's /compare says it at 390 (routes/(run)/compare): two players side by side in a
/// format, the leader's column first, from their pages (GET /run/players/{id}, a held page's copy or
/// the board's row as the web's reader falls back), the Bye row from the clubs, the basis under the
/// table with the last season's line; the format the followed league's where the run carries it, else
/// the run's default.
public struct CompareModel: Equatable, Sendable {
    public let title: String
    /// firstStep: what to do while a side is empty; nil once both are in.
    public let lead: String?
    public let formats: [BoardChip<String>]
    public let format: String
    public let slots: [CompareSlot]
    /// Each slot's words over its search.
    public let slotLabels: [String]
    public let outcome: CompareOutcome
    public let candidates: [CompareCandidate]
    /// The slugs set on each side, as the screen's address names them.
    public let slugs: [String?]

    /// search.ts searchPlayers: names starting with the query first, then a later word starting with
    /// it, then anywhere in a word, each in the index's order (our rank); eight at most.
    public func search(_ query: String) -> [CompareCandidate] {
        let wanted = CompareModel.folded(query.trimmingCharacters(in: .whitespacesAndNewlines))
        guard !wanted.isEmpty else {
            return []
        }
        return candidates.enumerated().compactMap { order, candidate in
            Self.matchRank(candidate.key, wanted).map { (rank: $0, order: order, candidate: candidate) }
        }
        .sorted { ($0.rank, $0.order) < ($1.rank, $1.order) }
        .prefix(Self.searchLimit)
        .map(\.candidate)
    }

    static let searchLimit = 8

    static func folded(_ text: String) -> String {
        text.folding(options: [.diacriticInsensitive], locale: Locale(identifier: "en_US")).lowercased()
    }

    private static func matchRank(_ key: String, _ query: String) -> Int? {
        if key.hasPrefix(query) {
            return 0
        }
        let words = key.split { " .'-".contains($0) }
        if words.contains(where: { $0.hasPrefix(query) }) {
            return 1
        }
        return key.contains(query) ? 2 : nil
    }
}

/// Everything Compare is built from.
struct CompareInput {
    let manifest: RunManifest
    let format: RunFormat
    let sources: [RunAdpSource]
    let clubs: [RunClub]
    let underway: Bool
    let reach: Reach
    /// The format the season block is scored in, as its chip prints it.
    let scoring: String
    let index: [RunIndexEntry]
    let sides: [CompareFound]
}

/// A side as the screen's address set it: nobody, a slug that names nobody, or a player.
enum CompareFound {
    case open
    case missing
    case player(ComparePlayer)
}

extension CompareModel {
    init(_ input: CompareInput) {
        let format = input.format
        title = Words.ComparePage.title
        self.format = format.id
        formats = input.manifest.formats.map { BoardChip(label: $0.label, value: $0.id, pressed: $0.id == format.id) }
        slotLabels = [Words.ComparePage.firstPlayer, Words.ComparePage.secondPlayer]
        let byes = BoardCells.byes(input.clubs)
        let sides: [CompareSide?] = input.sides.map { found in
            guard case let .player(player) = found, let numbers = player.formats[format.id] else {
                return nil
            }
            return CompareSide(player: player, numbers: numbers, bye: byes[player.team])
        }
        slots = zip(input.sides, sides).map { found, side in
            if let side {
                return .picked(
                    name: side.player.name,
                    initials: Initials.of(side.player.name),
                    headshot: side.player.headshot
                )
            }
            if case .missing = found {
                return .missing
            }
            return .open
        }
        slugs = input.sides.map { found in
            if case let .player(player) = found {
                return player.slug
            }
            return nil
        }
        let both = sides.compactMap(\.self)
        lead = Self.firstStep(both.count)
        candidates = input.index.map { entry in
            let position = entry.position.value1?.rawValue ?? entry.position.value2 ?? ""
            return CompareCandidate(
                id: entry.id, slug: entry.slug, name: entry.name, line: "\(position) · \(entry.team)",
                key: Self.folded(entry.name)
            )
        }
        outcome = Self.outcome(both, input: input)
    }

    /// compare-words.ts firstStep.
    static func firstStep(_ picked: Int) -> String? {
        if picked <= 0 {
            return "Pick two players to see which one we would take, with their figures side by side."
        }
        return picked == 1 ? "Pick a second player to set beside the first." : nil
    }

    private static func outcome(_ both: [CompareSide], input: CompareInput) -> CompareOutcome {
        guard both.count == 2 else {
            return .none
        }
        switch Verdict.between(both[0], both[1], formatLabel: input.format.label) {
        case .same:
            return .same(title: Words.ComparePage.sameTitle, line: Words.Verdict.samePlayer)
        case let .call(leader, other, _, call, evidence):
            let rows = CompareRows.rows(leader, other, season: input.manifest.season, underway: input.underway)
            let gapRow = rows.contains { $0.label == "Gap" }
            let ranges = [leader, other].compactMap(\.numbers.range)
            return .table(CompareTable(
                call: call,
                evidence: evidence,
                heads: [leader, other].map(head),
                rows: rows,
                scale: ranges.isEmpty ? nil : (ranges.map(\.floor).min() ?? 0) ... (ranges.map(\.ceiling).max() ?? 0),
                basis: basis(input).filter { gapRow || !$0.gap }.map(\.text)
            ))
        }
    }

    private static func head(_ side: CompareSide) -> CompareHead {
        let player = side.player
        let rank = player.heldRank ?? String(side.numbers.positionRank)
        return CompareHead(
            id: player.id, name: player.name, initials: Initials.of(player.name), headshot: player.headshot,
            pill: "\(player.position) \(rank)", club: player.team,
            sheetPlayer: SheetPlayer(
                id: player.id, slug: player.slug, name: player.name, position: player.position, rank: rank,
                club: player.team
            ),
            range: side.numbers.range
        )
    }

    /// compare/+page.server.ts: the board's basis in the format, every part on the phone, the season's
    /// reach once it is underway, then the last season's line.
    static func basis(_ input: CompareInput) -> [(text: String, gap: Bool)] {
        let format = input.format
        let drafts = RunWords.adpDrafts(input.sources, format: format.id).joined(separator: " and ")
        let compare = format.rosFromWeek == nil
        var parts: [(text: String, gap: Bool)] = [(BoardBasis.ourBoard(format, season: input.manifest.season), false)]
        if compare {
            parts.append(("ADP from \(drafts).", false))
            parts.append((Words.BoardBasis.gap, true))
        }
        if input.underway {
            let scoring = input.scoring == format.label ? "" : ", scored in \(input.scoring)"
            let through = RunReach.words(input.reach)
            parts.append((
                "GP and \(Words.Figure.avg) are this season's\(scoring)\(through.isEmpty ? "" : ", \(through)").",
                false
            ))
        }
        parts.append(("\(input.manifest.season - 1) a game is last season's points a game.", false))
        return parts
    }
}
