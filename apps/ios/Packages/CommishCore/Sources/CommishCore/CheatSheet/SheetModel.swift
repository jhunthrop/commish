import CommishAPI
import Foundation

/// One player's row on the sheet as the account holds it, with any edit the phone has not saved yet
/// laid over it: who he is, his tier, his tags and his note (web model.ts SheetRow).
public struct SheetEntry: Equatable, Sendable, Identifiable {
    public let id: String
    public let name: String
    public let position: String
    public let team: String?
    public let headshot: String?
    public let tier: Int?
    public let tags: [String]
    public let note: String?

    public init(
        id: String, name: String, position: String, team: String?, headshot: String?, tier: Int?, tags: [String],
        note: String?
    ) {
        self.id = id
        self.name = name
        self.position = position
        self.team = team
        self.headshot = headshot
        self.tier = tier
        self.tags = tags
        self.note = note
    }

    init(_ row: SheetRowAnswer) {
        self.init(
            id: row.playerId, name: row.name, position: row.position, team: row.team, headshot: row.headshot,
            tier: row.tier, tags: SheetTags.normalized(row.tags), note: row.note
        )
    }

    /// The row as a write sends it (remote.ts toApiRow).
    var input: SheetRowInput {
        SheetRowInput(
            playerId: id, name: name, position: position, team: team, headshot: headshot, tier: tier, tags: tags,
            note: note
        )
    }

    func with(tags: [String], note: String?) -> SheetEntry {
        SheetEntry(
            id: id, name: name, position: position, team: team, headshot: headshot, tier: tier, tags: tags, note: note
        )
    }
}

/// An edit made on the phone and not yet saved to the account: the account's row it was made over (the
/// ancestor merge.ts keeps), and the row as the phone set it, or nil when his row is taken off. The rows
/// drawn and written lay the edit over the account's row field by field (SheetMerge), so a field another
/// device changed and the phone did not is never written back as it was.
public struct SheetEdit: Equatable, Sendable {
    let base: SheetEntry
    let local: SheetEntry?

    /// The account's row with this edit laid over it; nil when the edit takes him off.
    func over(_ server: SheetEntry) -> SheetEntry? {
        local.map { SheetMerge.row(base: base, local: $0, server: server).entry }
    }
}

/// A row's save as the row says it: nothing to say, on its way, or not saved with the reason.
public enum RowSave: Equatable, Sendable {
    case saved
    case saving
    case unsaved(String)

    /// The line under the row, nil once saved.
    public var words: String? {
        switch self {
        case .saved: nil
        case .saving: SheetWords.rowSaving
        case let .unsaved(reason): SheetWords.rowUnsaved(reason)
        }
    }
}

/// A row as the phone draws it (SheetRow.svelte's compact row): his face, his name the biggest thing,
/// his position and club, his tier as a chip, his tags and note, his place on the sheet; whether its
/// edit is saved; the player his face and name open in the player sheet.
public struct SheetLine: Equatable, Sendable, Identifiable {
    public let id: String
    public let place: Int
    public let name: String
    public let initials: String
    public let headshot: URL?
    public let position: String
    public let team: String?
    public let tier: Int?
    public let tags: [TagMark]
    /// His tags as stored, which the editor's chips are pressed by.
    public let tagged: [String]
    public let note: String?
    public let save: RowSave
    /// What the phone had where the account's copy won a conflict ("Your note on X was replaced by the one
    /// saved on another device").
    public let notices: [String]
    public let player: SheetPlayer
    /// A defense: its face is its club's chip (B245).
    public let clubMark: Bool
}

/// What the screen draws from the sheet: its name and line, the position chips, the rows in the
/// order the account holds them with the chosen position's alone, and the count shown under a filter.
public struct SheetModel: Equatable, Sendable {
    public let name: String
    public let line: String
    public let positions: [BoardChip<String?>]
    public let lines: [SheetLine]
    /// "3 players shown" while a position narrows the sheet.
    public let shown: String?
    public let players: Int
    /// The drafter's own tags anywhere on the sheet, offered in every row's editor.
    public let ownTags: [String]

    /// The positions in the order the sheet draws its chips (types/player.ts POSITIONS).
    static let order = ["QB", "RB", "WR", "TE", "K", "DST"]

    init(
        name: String, line: String, entries: [SheetEntry], saves: [String: RowSave], position: String?,
        notices: [String: [String]] = [:]
    ) {
        self.name = name
        self.line = line
        players = entries.count
        let present = Self.order.filter { position in entries.contains { $0.position == position } }
        positions = [BoardChip(label: SheetWords.all, value: nil, pressed: position == nil)]
            + present.map { BoardChip(label: $0, value: $0, pressed: $0 == position) }
        let drawn = entries.enumerated().filter { position == nil || $0.element.position == position }
        lines = drawn.map { index, entry in
            Self.line(entry, place: index + 1, save: saves[entry.id] ?? .saved, notices: notices[entry.id] ?? [])
        }
        shown = drawn.count == entries.count ? nil : SheetWords.shown(drawn.count)
        ownTags = SheetTags.own(entries.map(\.tags))
    }

    /// The editor's chips (RowEditor.svelte): the fixed tags in their order, then the drafter's own, each
    /// pressed where it is on his row.
    public static func tagChips(_ line: SheetLine, ownTags: [String]) -> [BoardChip<String>] {
        (SheetTags.fixed.map(\.tag) + ownTags).map {
            BoardChip(label: SheetTags.label($0), value: $0, pressed: SheetTags.has(line.tagged, $0))
        }
    }

    static func line(_ entry: SheetEntry, place: Int, save: RowSave, notices: [String] = []) -> SheetLine {
        let defense = entry.position == "DST"
        return SheetLine(
            id: entry.id, place: place, name: entry.name, initials: Initials.of(entry.name),
            headshot: defense ? nil : entry.headshot.flatMap(URL.init(string:)), position: entry.position,
            team: entry.team, tier: entry.tier, tags: SheetTags.marks(entry.tags), tagged: entry.tags, note: entry.note,
            save: save, notices: notices,
            player: SheetPlayer(
                id: entry.id, slug: PlayerSlug.of(entry.name), name: entry.name, position: entry.position, rank: nil,
                club: entry.team, boardID: entry.id
            ),
            clubMark: defense && entry.team != nil
        )
    }
}
